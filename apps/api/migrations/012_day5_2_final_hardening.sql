BEGIN;

-- Global lock order: payment_requests row -> evidence/dependent rows.
-- Policy administration uses the independent global-policy advisory lock and never requests a payment-request lock.
CREATE OR REPLACE FUNCTION invalidate_policy_for_evidence_change() RETURNS trigger AS $$
DECLARE request_id uuid;
DECLARE relevant boolean;
BEGIN
  request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
  relevant:=TG_OP='INSERT'
    OR (OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL)
    OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL)
    OR (OLD.removed_at IS NULL AND NEW.removed_at IS NULL AND
       (OLD.version IS DISTINCT FROM NEW.version OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.sha256 IS DISTINCT FROM NEW.sha256));
  IF relevant THEN
    PERFORM id FROM payment_requests WHERE id=request_id FOR UPDATE;
    UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false
      WHERE payment_request_id=request_id AND is_current;
    UPDATE policy_exceptions SET status='SUPERSEDED'
      WHERE payment_request_id=request_id AND status='OPEN';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_policy_version_lifecycle() RETURNS trigger AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF OLD.policy_set_id IS DISTINCT FROM NEW.policy_set_id OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.effective_from IS DISTINCT FROM NEW.effective_from OR OLD.effective_to IS DISTINCT FROM NEW.effective_to
    OR OLD.evaluation_version IS DISTINCT FROM NEW.evaluation_version OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'policy version definition is immutable';
  END IF;
  IF OLD.status='DRAFT' AND NEW.status='ACTIVE'
    AND OLD.activated_by IS NULL AND OLD.activated_at IS NULL
    AND NEW.activated_by IS NOT NULL AND NEW.activated_at IS NOT NULL
    AND NEW.retired_by IS NULL AND NEW.retired_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.status='ACTIVE' AND NEW.status='RETIRED'
    AND NEW.activated_by IS NOT DISTINCT FROM OLD.activated_by
    AND NEW.activated_at IS NOT DISTINCT FROM OLD.activated_at
    AND OLD.retired_by IS NULL AND OLD.retired_at IS NULL
    AND NEW.retired_by IS NOT NULL AND NEW.retired_at IS NOT NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid policy lifecycle or metadata rewrite';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_payment_document_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment documents use logical removal and cannot be physically deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_documents_no_physical_delete
BEFORE DELETE ON payment_documents FOR EACH ROW EXECUTE FUNCTION reject_payment_document_delete();

REVOKE DELETE ON payment_documents FROM aims_app;
COMMIT;
