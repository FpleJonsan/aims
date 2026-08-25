BEGIN;

ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_status_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_status_check CHECK(status IN(
  'DRAFT','SUBMITTED','VALIDATING','NEEDS_CLARIFICATION','PENDING_APPROVAL','APPROVED','FINANCE_CHECK','FINANCE_HOLD','READY_FOR_PAYMENT','PAID','REJECTED','CANCELLED'));

DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aims_payment_executor') THEN
 CREATE ROLE aims_payment_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
END IF;END$$;
GRANT aims_app TO aims_payment_executor;

CREATE TABLE payment_authorities(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),scope varchar(24) NOT NULL CHECK(scope IN('DEPARTMENT','ORGANIZATION')),
 department_id uuid REFERENCES departments(id),active boolean NOT NULL DEFAULT true,allow_self_payment boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((scope='DEPARTMENT' AND department_id IS NOT NULL) OR(scope='ORGANIZATION' AND department_id IS NULL)));
CREATE UNIQUE INDEX payment_authority_org_unique_idx ON payment_authorities(user_id) WHERE scope='ORGANIZATION' AND department_id IS NULL;
CREATE UNIQUE INDEX payment_authority_department_unique_idx ON payment_authorities(user_id,department_id) WHERE scope='DEPARTMENT' AND department_id IS NOT NULL;

ALTER TABLE budget_commitments ADD COLUMN consumed_at timestamptz,ADD COLUMN consumed_by uuid REFERENCES users(id),
 ADD COLUMN payment_id uuid,ADD COLUMN consumption_reason varchar(64);

CREATE TABLE payments(
 id uuid PRIMARY KEY,payment_request_id uuid NOT NULL UNIQUE REFERENCES payment_requests(id),finance_control_run_id uuid NOT NULL REFERENCES finance_control_runs(id),
 approval_case_id uuid NOT NULL REFERENCES approval_cases(id),commitment_id uuid NOT NULL UNIQUE REFERENCES budget_commitments(id),ledger_entry_id uuid NOT NULL UNIQUE,
 slip_document_id uuid NOT NULL UNIQUE REFERENCES payment_documents(id),ticket_number varchar(32) NOT NULL,payment_date date NOT NULL,payee varchar(200) NOT NULL,
 department_id uuid NOT NULL REFERENCES departments(id),category varchar(100) NOT NULL,purpose varchar(2000) NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),
 currency char(3) NOT NULL,payment_method varchar(64) NOT NULL,bank_reference varchar(200) NOT NULL,bank_reference_normalized varchar(200) NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'PAID' CHECK(status='PAID'),recorded_by uuid NOT NULL REFERENCES users(id),recorded_at timestamptz NOT NULL DEFAULT now(),
 command_key uuid NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX payments_scoped_bank_reference_idx ON payments(payment_method,currency,bank_reference_normalized);
CREATE INDEX payments_history_idx ON payments(payment_date DESC,id DESC);
CREATE INDEX payments_department_history_idx ON payments(department_id,payment_date DESC);
ALTER TABLE budget_commitments ADD CONSTRAINT budget_commitments_payment_fk FOREIGN KEY(payment_id) REFERENCES payments(id) DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION aims_authenticated_payment_actor() RETURNS uuid SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;BEGIN
 IF NOT pg_has_role(session_user,'aims_payment_executor','MEMBER') THEN RAISE EXCEPTION 'trusted Payment executor is required' USING ERRCODE='42501';END IF;
 BEGIN actor:=current_setting('aims.user_id',true)::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'authenticated Payment identity required' USING ERRCODE='42501';END;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND active) THEN RAISE EXCEPTION 'active authenticated Payment identity required' USING ERRCODE='42501';END IF;
 RETURN actor;END;$$ LANGUAGE plpgsql STABLE;
REVOKE ALL ON FUNCTION aims_authenticated_payment_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aims_authenticated_payment_actor() TO aims_payment_executor;

CREATE OR REPLACE FUNCTION attach_payment_slip(request_id uuid,document_id uuid,logical_id uuid,filename text,object_key text,mime text,size_bytes bigint,sha text) RETURNS uuid
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;DECLARE pr public.payment_requests%ROWTYPE;BEGIN
 actor:=public.aims_authenticated_payment_actor();SELECT * INTO pr FROM public.payment_requests WHERE id=request_id FOR UPDATE;
 IF NOT FOUND OR pr.status<>'READY_FOR_PAYMENT' THEN RAISE EXCEPTION 'READY_FOR_PAYMENT request required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_authorities a WHERE a.user_id=actor AND a.active AND(a.scope='ORGANIZATION' OR a.department_id=pr.department_id)AND(a.allow_self_payment OR actor<>pr.created_by)) THEN RAISE EXCEPTION 'Payment Operator authority required' USING ERRCODE='42501';END IF;
 INSERT INTO public.payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by)
 VALUES(document_id,request_id,logical_id,filename,object_key,mime,size_bytes,sha,'PAYMENT_SLIP',1,actor);
 RETURN document_id;END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION attach_payment_slip(uuid,uuid,uuid,text,text,text,bigint,text) FROM PUBLIC,aims_app;
GRANT EXECUTE ON FUNCTION attach_payment_slip(uuid,uuid,uuid,text,text,text,bigint,text) TO aims_payment_executor;

CREATE OR REPLACE FUNCTION record_payment(request_id uuid,payment_id uuid,command_key uuid,payment_date date,amount_minor bigint,currency text,bank_reference text,slip_document_id uuid,confirm_possible boolean DEFAULT false) RETURNS uuid
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;DECLARE pr public.payment_requests%ROWTYPE;DECLARE run public.finance_control_runs%ROWTYPE;DECLARE commitment public.budget_commitments%ROWTYPE;
DECLARE approval public.approval_cases%ROWTYPE;DECLARE existing uuid;DECLARE ledger_id uuid:=gen_random_uuid();DECLARE normalized text;
BEGIN
 actor:=public.aims_authenticated_payment_actor();
 SELECT id INTO existing FROM public.payments WHERE command_key=record_payment.command_key;
 IF FOUND THEN IF EXISTS(SELECT 1 FROM public.payments WHERE id=existing AND payment_request_id=request_id) THEN RETURN existing;END IF;RAISE EXCEPTION 'payment command key belongs to another request';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('AIMS_DUPLICATE_CONTROL'));
 PERFORM pg_advisory_xact_lock(hashtextextended(request_id::text,0));
 SELECT * INTO pr FROM public.payment_requests WHERE id=request_id FOR UPDATE;
 IF NOT FOUND OR pr.status<>'READY_FOR_PAYMENT' THEN RAISE EXCEPTION 'READY_FOR_PAYMENT request required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_authorities a WHERE a.user_id=actor AND a.active AND(a.scope='ORGANIZATION' OR a.department_id=pr.department_id)AND(a.allow_self_payment OR actor<>pr.created_by)) THEN RAISE EXCEPTION 'Payment Operator authority required' USING ERRCODE='42501';END IF;
 SELECT * INTO run FROM public.finance_control_runs WHERE payment_request_id=request_id AND is_current FOR UPDATE;
 IF NOT FOUND OR run.status<>'PASSED' THEN RAISE EXCEPTION 'current passed Finance Control required';END IF;
 SELECT * INTO approval FROM public.approval_cases WHERE id=run.approval_case_id AND is_current AND status='APPROVED' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'current Approval required';END IF;
 SELECT * INTO commitment FROM public.budget_commitments WHERE id=run.commitment_id FOR UPDATE;
 IF NOT FOUND OR commitment.status<>'ACTIVE' OR commitment.source<>'APPROVAL' THEN RAISE EXCEPTION 'active Approval commitment required';END IF;
 IF amount_minor<>(pr.amount*100)::bigint OR amount_minor<>commitment.amount_minor OR currency<>pr.currency OR currency<>commitment.currency THEN RAISE EXCEPTION 'payment amount and currency must match approved commitment';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.budgets b JOIN public.budget_versions bv ON bv.id=commitment.budget_version_id WHERE b.id=commitment.budget_id AND b.status='ACTIVE' AND bv.status='ACTIVE') THEN RAISE EXCEPTION 'active budget and version required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_documents d WHERE d.id=slip_document_id AND d.payment_request_id=request_id AND d.document_type='PAYMENT_SLIP' AND d.removed_at IS NULL) THEN RAISE EXCEPTION 'current payment slip required';END IF;
 normalized:=upper(regexp_replace(btrim(bank_reference),'[^A-Za-z0-9]','','g'));IF normalized='' THEN RAISE EXCEPTION 'bank reference required';END IF;
 IF EXISTS(SELECT 1 FROM public.payments p WHERE p.payment_method=pr.payment_method AND p.currency=pr.currency AND p.bank_reference_normalized=normalized) THEN RAISE EXCEPTION 'CONFIRMED_DUPLICATE_PAYMENT';END IF;
 IF NOT confirm_possible AND EXISTS(SELECT 1 FROM public.payments p WHERE p.payee=pr.payee AND p.amount_minor=amount_minor AND p.currency=currency) THEN RAISE EXCEPTION 'POSSIBLE_DUPLICATE_PAYMENT_REQUIRES_CONFIRMATION';END IF;
 INSERT INTO public.payments(id,payment_request_id,finance_control_run_id,approval_case_id,commitment_id,ledger_entry_id,slip_document_id,ticket_number,payment_date,payee,department_id,category,purpose,amount_minor,currency,payment_method,bank_reference,bank_reference_normalized,recorded_by,command_key)
 VALUES(payment_id,request_id,run.id,approval.id,commitment.id,ledger_id,slip_document_id,pr.ticket_number,payment_date,pr.payee,pr.department_id,pr.category,pr.purpose,amount_minor,currency,pr.payment_method,btrim(bank_reference),normalized,actor,command_key);
 INSERT INTO public.financial_ledger_entries(id,budget_id,entry_type,amount_minor,currency,reference_type,reference_id,posted_at) VALUES(ledger_id,commitment.budget_id,'ACTUAL',amount_minor,currency,'PAYMENT',payment_id,payment_date);
 UPDATE public.budget_commitments SET status='CONSUMED',consumed_at=now(),consumed_by=actor,payment_id=record_payment.payment_id,consumption_reason='PAYMENT_RECORDED' WHERE id=commitment.id;
 UPDATE public.payment_requests SET status='PAID',updated_at=now(),row_version=row_version+1 WHERE id=request_id;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata) VALUES
 (gen_random_uuid(),actor,'PAYMENT_RECORDED','PAYMENT_REQUEST',request_id,'READY_FOR_PAYMENT','PAID',COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',payment_id,'commitmentId',commitment.id,'ledgerId',ledger_id)),
 (gen_random_uuid(),actor,'COMMITMENT_CONSUMED','PAYMENT_REQUEST',request_id,'ACTIVE','CONSUMED',COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',payment_id)),
 (gen_random_uuid(),actor,'ACTUAL_LEDGER_POSTED','PAYMENT_REQUEST',request_id,NULL,NULL,COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',payment_id,'ledgerId',ledger_id)),
 (gen_random_uuid(),actor,'PAYMENT_REQUEST_PAID','PAYMENT_REQUEST',request_id,'READY_FOR_PAYMENT','PAID',COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('paymentId',payment_id));
 RETURN payment_id;END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean) FROM PUBLIC,aims_app;
GRANT EXECUTE ON FUNCTION record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean) TO aims_payment_executor;

CREATE OR REPLACE FUNCTION guard_paid_request() RETURNS trigger SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status='PAID' AND OLD.status IS DISTINCT FROM 'PAID' THEN
  PERFORM public.aims_authenticated_payment_actor();
  IF OLD.status<>'READY_FOR_PAYMENT' OR NOT EXISTS(SELECT 1 FROM public.payments p WHERE p.payment_request_id=NEW.id) THEN RAISE EXCEPTION 'PAID requires controlled Payment recording';END IF;
 ELSIF OLD.status='PAID' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.payee IS DISTINCT FROM NEW.payee OR OLD.purpose IS DISTINCT FROM NEW.purpose OR OLD.category IS DISTINCT FROM NEW.category OR OLD.amount IS DISTINCT FROM NEW.amount OR OLD.currency IS DISTINCT FROM NEW.currency OR OLD.department_id IS DISTINCT FROM NEW.department_id OR OLD.due_date IS DISTINCT FROM NEW.due_date OR OLD.payment_method IS DISTINCT FROM NEW.payment_method OR OLD.payment_details IS DISTINCT FROM NEW.payment_details) THEN
  RAISE EXCEPTION 'PAID request financial history is immutable';END IF;
 RETURN NEW;END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_paid_request() FROM PUBLIC;
CREATE TRIGGER payment_requests_paid_guard BEFORE UPDATE ON payment_requests FOR EACH ROW EXECUTE FUNCTION guard_paid_request();

CREATE OR REPLACE FUNCTION guard_paid_documents() RETURNS trigger SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request_id uuid;BEGIN request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 IF EXISTS(SELECT 1 FROM public.payment_requests WHERE id=request_id AND status='PAID') THEN RAISE EXCEPTION 'documents for PAID requests are immutable';END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_paid_documents() FROM PUBLIC;
CREATE TRIGGER payment_documents_paid_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_documents FOR EACH ROW EXECUTE FUNCTION guard_paid_documents();

CREATE OR REPLACE FUNCTION reject_payment_mutation() RETURNS trigger SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN RAISE EXCEPTION 'authoritative Payment records are immutable';END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION reject_payment_mutation() FROM PUBLIC;
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION reject_payment_mutation();

CREATE OR REPLACE FUNCTION guard_consumed_commitment() RETURNS trigger SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
 IF OLD.status='CONSUMED' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.payment_id IS DISTINCT FROM OLD.payment_id OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.currency IS DISTINCT FROM OLD.currency) THEN RAISE EXCEPTION 'consumed commitment is immutable';END IF;RETURN NEW;END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_consumed_commitment() FROM PUBLIC;
CREATE TRIGGER budget_commitments_consumed_guard BEFORE UPDATE ON budget_commitments FOR EACH ROW EXECUTE FUNCTION guard_consumed_commitment();

GRANT SELECT ON payment_authorities,payments TO aims_app;
REVOKE INSERT,UPDATE,DELETE ON payments,financial_ledger_entries FROM aims_app;
COMMIT;
