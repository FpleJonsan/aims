BEGIN;

ALTER TABLE policy_decision_runs ADD COLUMN evidence_fingerprint char(64)
  CHECK (evidence_fingerprint IS NULL OR evidence_fingerprint ~ '^[0-9a-f]{64}$');
ALTER TABLE policy_versions ADD COLUMN retired_by uuid REFERENCES users(id);
ALTER TABLE policy_versions ADD COLUMN retired_at timestamptz;
UPDATE policy_versions SET retired_by=COALESCE(activated_by,created_by),retired_at=COALESCE(activated_at,created_at) WHERE status='RETIRED';
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_retirement_metadata_check
  CHECK ((status='RETIRED' AND retired_by IS NOT NULL AND retired_at IS NOT NULL) OR status<>'RETIRED');

-- Day 5 supports one organization-wide policy scope. Later scoped policies require a new reviewed model.
CREATE UNIQUE INDEX policy_versions_one_global_active_idx ON policy_versions((1)) WHERE status='ACTIVE';

CREATE OR REPLACE FUNCTION protect_policy_rule_lifecycle() RETURNS trigger AS $$
DECLARE version_status varchar(16);
BEGIN
  SELECT status INTO version_status FROM policy_versions WHERE id=COALESCE(NEW.policy_version_id,OLD.policy_version_id) FOR SHARE;
  IF version_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'rules of active or retired policy versions are immutable';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER policy_rules_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON policy_rules
FOR EACH ROW EXECUTE FUNCTION protect_policy_rule_lifecycle();

CREATE OR REPLACE FUNCTION protect_policy_version_lifecycle() RETURNS trigger AS $$
BEGIN
  IF OLD.status='DRAFT' AND NEW.status='ACTIVE' THEN RETURN NEW; END IF;
  IF OLD.status='ACTIVE' AND NEW.status='RETIRED' AND NEW.retired_by IS NOT NULL AND NEW.retired_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.status=NEW.status AND OLD.policy_set_id=NEW.policy_set_id AND OLD.version=NEW.version
    AND OLD.effective_from=NEW.effective_from AND OLD.effective_to IS NOT DISTINCT FROM NEW.effective_to
    AND OLD.evaluation_version=NEW.evaluation_version THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid or immutable policy version transition';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER policy_versions_lifecycle
BEFORE UPDATE ON policy_versions
FOR EACH ROW EXECUTE FUNCTION protect_policy_version_lifecycle();

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
    UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false
      WHERE payment_request_id=request_id AND is_current;
    UPDATE policy_exceptions SET status='SUPERSEDED'
      WHERE payment_request_id=request_id AND status='OPEN';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_documents_invalidate_policy
AFTER INSERT OR UPDATE OF removed_at,version,document_type,sha256 ON payment_documents
FOR EACH ROW EXECUTE FUNCTION invalidate_policy_for_evidence_change();

GRANT UPDATE(status,activated_by,activated_at,retired_by,retired_at) ON policy_versions TO aims_app;
COMMIT;
