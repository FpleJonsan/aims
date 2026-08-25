BEGIN;

ALTER TABLE payment_authorities
  ADD COLUMN minimum_amount_minor bigint CHECK(minimum_amount_minor IS NULL OR minimum_amount_minor >= 0),
  ADD COLUMN maximum_amount_minor bigint CHECK(maximum_amount_minor IS NULL OR maximum_amount_minor >= 0),
  ADD CONSTRAINT payment_authority_amount_range CHECK(
    minimum_amount_minor IS NULL OR maximum_amount_minor IS NULL OR minimum_amount_minor <= maximum_amount_minor
  );

ALTER TABLE payments
  ADD COLUMN command_version integer NOT NULL DEFAULT 1 CHECK(command_version = 1),
  ADD COLUMN command_fingerprint char(64);

DROP TRIGGER payments_immutable ON payments;
UPDATE payments p
SET command_fingerprint = encode(sha256(convert_to(concat_ws('|',
  '1', p.payment_request_id::text, p.payment_date::text, p.amount_minor::text,
  upper(p.currency), p.payment_method, p.bank_reference_normalized,
  p.slip_document_id::text, 'false'
), 'UTF8')), 'hex');
ALTER TABLE payments ALTER COLUMN command_fingerprint SET NOT NULL;
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION reject_payment_mutation();

CREATE OR REPLACE FUNCTION record_payment(
  request_id uuid,payment_id uuid,command_key uuid,payment_date date,
  amount_minor bigint,currency text,bank_reference text,slip_document_id uuid,
  confirm_possible boolean DEFAULT false
) RETURNS uuid
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 actor uuid; pr public.payment_requests%ROWTYPE; run public.finance_control_runs%ROWTYPE;
 commitment public.budget_commitments%ROWTYPE; approval public.approval_cases%ROWTYPE;
 existing public.payments%ROWTYPE; ledger_id uuid:=gen_random_uuid(); normalized text;
 fingerprint char(64); command_version constant integer:=1;
BEGIN
 actor:=public.aims_authenticated_payment_actor();
 PERFORM pg_advisory_xact_lock(hashtext('AIMS_DUPLICATE_CONTROL'));
 PERFORM pg_advisory_xact_lock(hashtextextended($1::text,0));

 -- Resolve and lock the request before replay. A command key is never authority.
 SELECT * INTO pr FROM public.payment_requests WHERE id=$1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found';END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.payment_authorities a JOIN public.users u ON u.id=a.user_id AND u.active
   WHERE a.user_id=actor AND a.active
     AND(a.scope='ORGANIZATION' OR a.department_id=pr.department_id)
     AND(a.allow_self_payment OR actor<>pr.created_by)
     AND(a.minimum_amount_minor IS NULL OR $5>=a.minimum_amount_minor)
     AND(a.maximum_amount_minor IS NULL OR $5<=a.maximum_amount_minor)
 ) THEN RAISE EXCEPTION 'Payment Operator authority required' USING ERRCODE='42501';END IF;

 normalized:=upper(regexp_replace(btrim($7),'[^A-Za-z0-9]','','g'));
 IF normalized='' THEN RAISE EXCEPTION 'bank reference required';END IF;
 fingerprint:=encode(sha256(convert_to(concat_ws('|',
   command_version::text,$1::text,$4::text,$5::text,upper($6),pr.payment_method,
   normalized,$8::text,lower($9::text)
 ),'UTF8')),'hex');

 SELECT * INTO existing FROM public.payments p WHERE p.command_key=$3;
 IF FOUND THEN
   IF existing.payment_request_id<>$1 OR existing.command_version<>command_version
      OR existing.command_fingerprint<>fingerprint THEN
     RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
   END IF;
   RETURN existing.id;
 END IF;

 IF pr.status<>'READY_FOR_PAYMENT' THEN RAISE EXCEPTION 'READY_FOR_PAYMENT request required';END IF;
 IF $4>current_date THEN RAISE EXCEPTION 'future payment date is not allowed';END IF;
 SELECT * INTO run FROM public.finance_control_runs WHERE payment_request_id=$1 AND is_current FOR UPDATE;
 IF NOT FOUND OR run.status<>'PASSED' THEN RAISE EXCEPTION 'current passed Finance Control required';END IF;
 SELECT * INTO approval FROM public.approval_cases WHERE id=run.approval_case_id AND is_current AND status='APPROVED' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'current Approval required';END IF;
 SELECT * INTO commitment FROM public.budget_commitments WHERE id=run.commitment_id FOR UPDATE;
 IF NOT FOUND OR commitment.status<>'ACTIVE' OR commitment.source<>'APPROVAL' THEN RAISE EXCEPTION 'active Approval commitment required';END IF;
 IF $5<>(pr.amount*100)::bigint OR $5<>commitment.amount_minor OR upper($6)<>pr.currency OR upper($6)<>commitment.currency THEN RAISE EXCEPTION 'payment amount and currency must match approved commitment';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.budgets b JOIN public.budget_versions bv ON bv.id=commitment.budget_version_id WHERE b.id=commitment.budget_id AND b.status='ACTIVE' AND bv.status='ACTIVE') THEN RAISE EXCEPTION 'active budget and version required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_documents d WHERE d.id=$8 AND d.payment_request_id=$1 AND d.document_type='PAYMENT_SLIP' AND d.removed_at IS NULL) THEN RAISE EXCEPTION 'current payment slip required';END IF;
 IF EXISTS(SELECT 1 FROM public.payments p WHERE p.payment_method=pr.payment_method AND p.currency=pr.currency AND p.bank_reference_normalized=normalized) THEN RAISE EXCEPTION 'CONFIRMED_DUPLICATE_PAYMENT';END IF;
 IF NOT $9 AND EXISTS(SELECT 1 FROM public.payments p WHERE p.payee=pr.payee AND p.amount_minor=$5 AND p.currency=upper($6)) THEN RAISE EXCEPTION 'POSSIBLE_DUPLICATE_PAYMENT_REQUIRES_CONFIRMATION';END IF;

 INSERT INTO public.payments(id,payment_request_id,finance_control_run_id,approval_case_id,commitment_id,ledger_entry_id,slip_document_id,ticket_number,payment_date,payee,department_id,category,purpose,amount_minor,currency,payment_method,bank_reference,bank_reference_normalized,recorded_by,command_key,command_version,command_fingerprint)
 VALUES($2,$1,run.id,approval.id,commitment.id,ledger_id,$8,pr.ticket_number,$4,pr.payee,pr.department_id,pr.category,pr.purpose,$5,upper($6),pr.payment_method,btrim($7),normalized,actor,$3,command_version,fingerprint);
 INSERT INTO public.financial_ledger_entries(id,budget_id,entry_type,amount_minor,currency,reference_type,reference_id,posted_at) VALUES(ledger_id,commitment.budget_id,'ACTUAL',$5,upper($6),'PAYMENT',$2,$4);
 UPDATE public.budget_commitments SET status='CONSUMED',consumed_at=now(),consumed_by=actor,payment_id=$2,consumption_reason='PAYMENT_RECORDED' WHERE id=commitment.id;
 UPDATE public.payment_requests SET status='PAID',updated_at=now(),row_version=row_version+1 WHERE id=$1;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata) VALUES
 (gen_random_uuid(),actor,'PAYMENT_RECORDED','PAYMENT_REQUEST',$1,'READY_FOR_PAYMENT','PAID',COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',$2,'commitmentId',commitment.id,'ledgerId',ledger_id,'commandVersion',command_version)),
 (gen_random_uuid(),actor,'COMMITMENT_CONSUMED','PAYMENT_REQUEST',$1,'ACTIVE','CONSUMED',COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',$2)),
 (gen_random_uuid(),actor,'ACTUAL_LEDGER_POSTED','PAYMENT_REQUEST',$1,NULL,NULL,COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',$2,'ledgerId',ledger_id)),
 (gen_random_uuid(),actor,'PAYMENT_REQUEST_PAID','PAYMENT_REQUEST',$1,'READY_FOR_PAYMENT','PAID',COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',$2));
 RETURN $2;
END;$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean) FROM PUBLIC,aims_app;
GRANT EXECUTE ON FUNCTION record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean) TO aims_payment_executor;

COMMENT ON INDEX payments_scoped_bank_reference_idx IS
  'Database-enforced scoped uniqueness. Global advisory duplicate lock is a TEMPORARY ACCEPTED PERFORMANCE TRADEOFF; owner: Finance platform; revisit before high-volume production.';

COMMIT;
