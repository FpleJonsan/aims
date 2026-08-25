BEGIN;

-- Internal transaction-local verification hook. No HTTP input, environment
-- setting, or application service can select a fault point. Only a session
-- already holding the trusted payment executor role can exercise it.
CREATE OR REPLACE FUNCTION payment_verification_fault() RETURNS trigger
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE requested text:=current_setting('aims.test_payment_fault',true);
DECLARE actual text;
BEGIN
 IF NOT pg_has_role(session_user,'aims_payment_executor','MEMBER') OR COALESCE(requested,'')='' THEN
   RETURN COALESCE(NEW,OLD);
 END IF;
 actual:=CASE
   WHEN TG_TABLE_NAME='payments' AND TG_OP='INSERT' THEN 'AFTER_PAYMENT_INSERT'
   WHEN TG_TABLE_NAME='financial_ledger_entries' AND TG_OP='INSERT' AND NEW.reference_type='PAYMENT' THEN 'AFTER_LEDGER_INSERT'
   WHEN TG_TABLE_NAME='budget_commitments' AND TG_OP='UPDATE' AND NEW.status='CONSUMED' THEN 'AFTER_COMMITMENT_CONSUMPTION'
   WHEN TG_TABLE_NAME='payment_requests' AND TG_WHEN='BEFORE' AND TG_OP='UPDATE' AND NEW.status='PAID' THEN 'BEFORE_REQUEST_PAID'
   WHEN TG_TABLE_NAME='payment_requests' AND TG_WHEN='AFTER' AND TG_OP='UPDATE' AND NEW.status='PAID' THEN 'AFTER_REQUEST_PAID_BEFORE_COMMIT'
   WHEN TG_TABLE_NAME='audit_events' AND TG_OP='INSERT' AND NEW.action='PAYMENT_RECORDED' THEN 'BEFORE_SUCCESS_AUDIT'
 END;
 IF requested=actual THEN RAISE EXCEPTION 'AIMS_TEST_PAYMENT_FAULT:%',actual USING ERRCODE='P0001';END IF;
 RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION payment_verification_fault() FROM PUBLIC,aims_app;

CREATE TRIGGER payment_verify_after_payment AFTER INSERT ON payments
 FOR EACH ROW EXECUTE FUNCTION payment_verification_fault();
CREATE TRIGGER payment_verify_after_ledger AFTER INSERT ON financial_ledger_entries
 FOR EACH ROW EXECUTE FUNCTION payment_verification_fault();
CREATE TRIGGER payment_verify_after_commitment AFTER UPDATE ON budget_commitments
 FOR EACH ROW EXECUTE FUNCTION payment_verification_fault();
CREATE TRIGGER payment_verify_before_paid BEFORE UPDATE ON payment_requests
 FOR EACH ROW EXECUTE FUNCTION payment_verification_fault();
CREATE TRIGGER payment_verify_after_paid AFTER UPDATE ON payment_requests
 FOR EACH ROW EXECUTE FUNCTION payment_verification_fault();
CREATE TRIGGER payment_verify_before_audit BEFORE INSERT ON audit_events
 FOR EACH ROW EXECUTE FUNCTION payment_verification_fault();

COMMENT ON FUNCTION payment_verification_fault() IS
 'Day 8.2 integration verification only: transaction-local, trusted-role-only rollback hook; not reachable from production API input.';

COMMIT;
