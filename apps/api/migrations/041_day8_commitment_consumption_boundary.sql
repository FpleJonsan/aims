BEGIN;
CREATE OR REPLACE FUNCTION guard_consumed_commitment() RETURNS trigger SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
 IF NEW.status='CONSUMED' AND OLD.status IS DISTINCT FROM 'CONSUMED' THEN
  PERFORM public.aims_authenticated_payment_actor();
  IF OLD.status<>'ACTIVE' OR NEW.payment_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.payments p WHERE p.id=NEW.payment_id AND p.commitment_id=NEW.id) THEN RAISE EXCEPTION 'CONSUMED requires controlled Payment recording';END IF;
 ELSIF OLD.status='CONSUMED' AND(NEW.status IS DISTINCT FROM OLD.status OR NEW.payment_id IS DISTINCT FROM OLD.payment_id OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.currency IS DISTINCT FROM OLD.currency)THEN RAISE EXCEPTION 'consumed commitment is immutable';END IF;
 RETURN NEW;END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_consumed_commitment() FROM PUBLIC;
DROP TRIGGER commitment_invalidates_finance_control ON budget_commitments;
CREATE TRIGGER commitment_invalidates_finance_control
 AFTER UPDATE OF status,amount_minor,currency,budget_id,budget_version_id ON budget_commitments
 FOR EACH ROW WHEN (
   NEW.status<>'CONSUMED' AND (
    OLD.status IS DISTINCT FROM NEW.status OR OLD.amount_minor IS DISTINCT FROM NEW.amount_minor
    OR OLD.currency IS DISTINCT FROM NEW.currency OR OLD.budget_id IS DISTINCT FROM NEW.budget_id
    OR OLD.budget_version_id IS DISTINCT FROM NEW.budget_version_id))
 EXECUTE FUNCTION invalidate_finance_control_for_authority_change();
COMMIT;
