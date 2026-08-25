BEGIN;
CREATE OR REPLACE FUNCTION payment_verification_fault() RETURNS trigger
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE requested text:=current_setting('aims.test_payment_fault',true);
DECLARE actual text;
BEGIN
 IF NOT pg_has_role(session_user,'aims_payment_executor','MEMBER') OR COALESCE(requested,'')='' THEN RETURN COALESCE(NEW,OLD);END IF;
 IF TG_TABLE_NAME='payments' AND TG_OP='INSERT' THEN actual:='AFTER_PAYMENT_INSERT';
 ELSIF TG_TABLE_NAME='financial_ledger_entries' AND TG_OP='INSERT' THEN
   IF NEW.reference_type='PAYMENT' THEN actual:='AFTER_LEDGER_INSERT';END IF;
 ELSIF TG_TABLE_NAME='budget_commitments' AND TG_OP='UPDATE' THEN
   IF NEW.status='CONSUMED' THEN actual:='AFTER_COMMITMENT_CONSUMPTION';END IF;
 ELSIF TG_TABLE_NAME='payment_requests' AND TG_OP='UPDATE' THEN
   IF NEW.status='PAID' THEN actual:=CASE WHEN TG_WHEN='BEFORE' THEN 'BEFORE_REQUEST_PAID' ELSE 'AFTER_REQUEST_PAID_BEFORE_COMMIT' END;END IF;
 ELSIF TG_TABLE_NAME='audit_events' AND TG_OP='INSERT' THEN
   IF NEW.action='PAYMENT_RECORDED' THEN actual:='BEFORE_SUCCESS_AUDIT';END IF;
 END IF;
 IF requested=actual THEN RAISE EXCEPTION 'AIMS_TEST_PAYMENT_FAULT:%',actual USING ERRCODE='P0001';END IF;
 RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION payment_verification_fault() FROM PUBLIC,aims_app;
COMMIT;
