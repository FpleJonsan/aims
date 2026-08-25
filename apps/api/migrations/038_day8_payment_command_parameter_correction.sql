BEGIN;
CREATE OR REPLACE FUNCTION record_payment(request_id uuid,payment_id uuid,command_key uuid,payment_date date,amount_minor bigint,currency text,bank_reference text,slip_document_id uuid,confirm_possible boolean DEFAULT false) RETURNS uuid
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;DECLARE pr public.payment_requests%ROWTYPE;DECLARE run public.finance_control_runs%ROWTYPE;DECLARE commitment public.budget_commitments%ROWTYPE;DECLARE approval public.approval_cases%ROWTYPE;DECLARE existing uuid;DECLARE ledger_id uuid:=gen_random_uuid();DECLARE normalized text;
BEGIN
 actor:=public.aims_authenticated_payment_actor();
 SELECT p.id INTO existing FROM public.payments p WHERE p.command_key=$3;
 IF FOUND THEN IF EXISTS(SELECT 1 FROM public.payments p WHERE p.id=existing AND p.payment_request_id=$1) THEN RETURN existing;END IF;RAISE EXCEPTION 'payment command key belongs to another request';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('AIMS_DUPLICATE_CONTROL'));PERFORM pg_advisory_xact_lock(hashtextextended($1::text,0));
 SELECT * INTO pr FROM public.payment_requests WHERE id=$1 FOR UPDATE;
 IF NOT FOUND OR pr.status<>'READY_FOR_PAYMENT' THEN RAISE EXCEPTION 'READY_FOR_PAYMENT request required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_authorities a WHERE a.user_id=actor AND a.active AND(a.scope='ORGANIZATION' OR a.department_id=pr.department_id)AND(a.allow_self_payment OR actor<>pr.created_by)) THEN RAISE EXCEPTION 'Payment Operator authority required' USING ERRCODE='42501';END IF;
 SELECT * INTO run FROM public.finance_control_runs WHERE payment_request_id=$1 AND is_current FOR UPDATE;
 IF NOT FOUND OR run.status<>'PASSED' THEN RAISE EXCEPTION 'current passed Finance Control required';END IF;
 SELECT * INTO approval FROM public.approval_cases WHERE id=run.approval_case_id AND is_current AND status='APPROVED' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'current Approval required';END IF;
 SELECT * INTO commitment FROM public.budget_commitments WHERE id=run.commitment_id FOR UPDATE;
 IF NOT FOUND OR commitment.status<>'ACTIVE' OR commitment.source<>'APPROVAL' THEN RAISE EXCEPTION 'active Approval commitment required';END IF;
 IF $5<>(pr.amount*100)::bigint OR $5<>commitment.amount_minor OR $6<>pr.currency OR $6<>commitment.currency THEN RAISE EXCEPTION 'payment amount and currency must match approved commitment';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.budgets b JOIN public.budget_versions bv ON bv.id=commitment.budget_version_id WHERE b.id=commitment.budget_id AND b.status='ACTIVE' AND bv.status='ACTIVE') THEN RAISE EXCEPTION 'active budget and version required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_documents d WHERE d.id=$8 AND d.payment_request_id=$1 AND d.document_type='PAYMENT_SLIP' AND d.removed_at IS NULL) THEN RAISE EXCEPTION 'current payment slip required';END IF;
 normalized:=upper(regexp_replace(btrim($7),'[^A-Za-z0-9]','','g'));IF normalized='' THEN RAISE EXCEPTION 'bank reference required';END IF;
 IF EXISTS(SELECT 1 FROM public.payments p WHERE p.payment_method=pr.payment_method AND p.currency=pr.currency AND p.bank_reference_normalized=normalized) THEN RAISE EXCEPTION 'CONFIRMED_DUPLICATE_PAYMENT';END IF;
 IF NOT $9 AND EXISTS(SELECT 1 FROM public.payments p WHERE p.payee=pr.payee AND p.amount_minor=$5 AND p.currency=$6) THEN RAISE EXCEPTION 'POSSIBLE_DUPLICATE_PAYMENT_REQUIRES_CONFIRMATION';END IF;
 INSERT INTO public.payments(id,payment_request_id,finance_control_run_id,approval_case_id,commitment_id,ledger_entry_id,slip_document_id,ticket_number,payment_date,payee,department_id,category,purpose,amount_minor,currency,payment_method,bank_reference,bank_reference_normalized,recorded_by,command_key)
 VALUES($2,$1,run.id,approval.id,commitment.id,ledger_id,$8,pr.ticket_number,$4,pr.payee,pr.department_id,pr.category,pr.purpose,$5,$6,pr.payment_method,btrim($7),normalized,actor,$3);
 INSERT INTO public.financial_ledger_entries(id,budget_id,entry_type,amount_minor,currency,reference_type,reference_id,posted_at) VALUES(ledger_id,commitment.budget_id,'ACTUAL',$5,$6,'PAYMENT',$2,$4);
 UPDATE public.budget_commitments SET status='CONSUMED',consumed_at=now(),consumed_by=actor,payment_id=$2,consumption_reason='PAYMENT_RECORDED' WHERE id=commitment.id;
 UPDATE public.payment_requests SET status='PAID',updated_at=now(),row_version=row_version+1 WHERE id=$1;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata) VALUES
 (gen_random_uuid(),actor,'PAYMENT_RECORDED','PAYMENT_REQUEST',$1,'READY_FOR_PAYMENT','PAID',COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',$2,'commitmentId',commitment.id,'ledgerId',ledger_id)),
 (gen_random_uuid(),actor,'COMMITMENT_CONSUMED','PAYMENT_REQUEST',$1,'ACTIVE','CONSUMED',COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',$2)),
 (gen_random_uuid(),actor,'ACTUAL_LEDGER_POSTED','PAYMENT_REQUEST',$1,NULL,NULL,COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',$2,'ledgerId',ledger_id)),
 (gen_random_uuid(),actor,'PAYMENT_REQUEST_PAID','PAYMENT_REQUEST',$1,'READY_FOR_PAYMENT','PAID',COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',$2));
 RETURN $2;END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean) FROM PUBLIC,aims_app;
GRANT EXECUTE ON FUNCTION record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean) TO aims_payment_executor;
COMMIT;
