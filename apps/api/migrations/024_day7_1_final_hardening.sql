BEGIN;

ALTER TABLE finance_control_runs
  ADD COLUMN duplicate_checked_at timestamptz,
  ADD COLUMN duplicate_check_version integer NOT NULL DEFAULT 0,
  ADD COLUMN duplicate_evidence_fingerprint char(64),
  ADD COLUMN completed_command_type varchar(24);

UPDATE finance_control_runs
SET duplicate_checked_at=COALESCE(finalized_at,started_at),
    duplicate_check_version=1,
    duplicate_evidence_fingerprint=evidence_fingerprint,
    completed_command_type=CASE WHEN completed_command_key IS NOT NULL THEN 'FINALIZE' END;

ALTER TABLE finance_control_runs
  ADD CONSTRAINT finance_control_command_identity_check CHECK(
    (completed_command_key IS NULL AND completed_command_type IS NULL)
    OR (completed_command_key IS NOT NULL AND completed_command_type='FINALIZE')
  ),
  ADD CONSTRAINT finance_control_duplicate_snapshot_check CHECK(
    duplicate_check_version>=0 AND
    ((duplicate_checked_at IS NULL AND duplicate_evidence_fingerprint IS NULL)
      OR (duplicate_checked_at IS NOT NULL AND duplicate_evidence_fingerprint IS NOT NULL))
  );

ALTER TABLE finance_control_authorities
  DROP CONSTRAINT finance_control_authorities_user_id_scope_department_id_key;
CREATE UNIQUE INDEX finance_control_authority_organization_unique_idx
  ON finance_control_authorities(user_id) WHERE scope='ORGANIZATION' AND department_id IS NULL;
CREATE UNIQUE INDEX finance_control_authority_department_unique_idx
  ON finance_control_authorities(user_id,department_id) WHERE scope='DEPARTMENT' AND department_id IS NOT NULL;

CREATE OR REPLACE FUNCTION aims_require_request_serialization(request_id uuid) RETURNS void AS $$
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(request_id::text,0)) THEN
    RAISE EXCEPTION 'request is concurrently controlled; retry transaction' USING ERRCODE='40001';
  END IF;
END;$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION aims_dependent_request_serialization() RETURNS trigger AS $$
DECLARE request_id uuid;
BEGIN
  IF TG_TABLE_NAME='payment_requests' THEN request_id:=COALESCE(NEW.id,OLD.id);
  ELSE request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id); END IF;
  PERFORM aims_require_request_serialization(request_id);
  RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_requests_request_serialization
  BEFORE INSERT OR UPDATE ON payment_requests FOR EACH ROW EXECUTE FUNCTION aims_dependent_request_serialization();
CREATE TRIGGER payment_documents_request_serialization
  BEFORE INSERT OR UPDATE ON payment_documents FOR EACH ROW EXECUTE FUNCTION aims_dependent_request_serialization();
CREATE TRIGGER approval_cases_request_serialization
  BEFORE UPDATE ON approval_cases FOR EACH ROW EXECUTE FUNCTION aims_dependent_request_serialization();
CREATE TRIGGER budget_commitments_request_serialization
  BEFORE UPDATE ON budget_commitments FOR EACH ROW EXECUTE FUNCTION aims_dependent_request_serialization();

CREATE OR REPLACE FUNCTION invalidate_finance_control_for_authority_change() RETURNS trigger AS $$
DECLARE request_id uuid;DECLARE previous_state varchar(32);
BEGIN
 request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 IF NOT EXISTS(SELECT 1 FROM finance_control_runs WHERE payment_request_id=request_id AND is_current) THEN RETURN COALESCE(NEW,OLD); END IF;
 SELECT status INTO previous_state FROM payment_requests WHERE id=request_id FOR UPDATE;
 IF previous_state IN('FINANCE_CHECK','FINANCE_HOLD','READY_FOR_PAYMENT') THEN
  UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
  UPDATE finance_control_exceptions SET status='SUPERSEDED' WHERE finance_control_run_id IN(SELECT id FROM finance_control_runs WHERE payment_request_id=request_id) AND status='OPEN';
  UPDATE payment_requests SET status=CASE WHEN EXISTS(SELECT 1 FROM approval_cases WHERE payment_request_id=request_id AND is_current AND status='APPROVED') THEN 'APPROVED' ELSE 'SUBMITTED' END,
    updated_at=now(),row_version=row_version+1 WHERE id=request_id;
  INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
   VALUES(gen_random_uuid(),NULL,'READY_FOR_PAYMENT_INVALIDATED','PAYMENT_REQUEST',request_id,previous_state,
    CASE WHEN EXISTS(SELECT 1 FROM approval_cases WHERE payment_request_id=request_id AND is_current AND status='APPROVED') THEN 'APPROVED' ELSE 'SUBMITTED' END,
    gen_random_uuid(),jsonb_build_object('sourceTable',TG_TABLE_NAME));
 END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_finance_control_lifecycle() RETURNS trigger AS $$
BEGIN
  IF OLD.status<>NEW.status AND NOT (
    (OLD.status='CHECKING' AND NEW.status IN('HOLD','PASSED','SUPERSEDED')) OR
    (OLD.status IN('HOLD','PASSED') AND NEW.status='SUPERSEDED')
  ) THEN RAISE EXCEPTION 'illegal Finance Control transition % to %',OLD.status,NEW.status; END IF;
  IF OLD.status<>'PASSED' AND NEW.status='PASSED' AND current_user=session_user THEN
    RAISE EXCEPTION 'PASSED is only available through controlled Finance Control finalization';
  END IF;
  IF OLD.status<>'PASSED' AND NEW.status='PASSED' THEN
    IF NOT EXISTS(SELECT 1 FROM finance_control_authorities a JOIN users u ON u.id=a.user_id AND u.active
      JOIN payment_requests pr ON pr.id=NEW.payment_request_id
      WHERE a.user_id=NEW.finalized_by AND a.active AND (a.scope='ORGANIZATION' OR a.department_id=pr.department_id)
        AND (a.allow_self_control OR a.user_id<>pr.created_by))
    THEN RAISE EXCEPTION 'active Finance Controller authority is required'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(ARRAY['PAYEE_VERIFIED','PAYMENT_METHOD_VERIFIED','PAYMENT_DETAILS_VERIFIED','SUPPORTING_DOCUMENTS_VERIFIED']) code
      WHERE NOT EXISTS(SELECT 1 FROM finance_control_confirmations c JOIN finance_control_authorities a ON a.user_id=c.confirmed_by AND a.active
        JOIN users u ON u.id=a.user_id AND u.active JOIN payment_requests pr ON pr.id=NEW.payment_request_id
        WHERE c.finance_control_run_id=NEW.id AND c.code=code AND c.confirmed
          AND (a.scope='ORGANIZATION' OR a.department_id=pr.department_id) AND (a.allow_self_control OR a.user_id<>pr.created_by)))
    THEN RAISE EXCEPTION 'authorized Finance confirmations are incomplete'; END IF;
  END IF;
  IF OLD.status IN('HOLD','PASSED','SUPERSEDED') AND NEW.status=OLD.status AND (
    OLD.finalized_by IS DISTINCT FROM NEW.finalized_by OR OLD.finalized_at IS DISTINCT FROM NEW.finalized_at OR
    OLD.completed_command_key IS DISTINCT FROM NEW.completed_command_key OR OLD.completed_command_type IS DISTINCT FROM NEW.completed_command_type
  ) THEN RAISE EXCEPTION 'finalized Finance Control metadata is immutable'; END IF;
  RETURN NEW;
END;$$ LANGUAGE plpgsql;
CREATE TRIGGER finance_control_lifecycle_guard
  BEFORE UPDATE ON finance_control_runs FOR EACH ROW EXECUTE FUNCTION enforce_finance_control_lifecycle();

CREATE OR REPLACE FUNCTION complete_finance_control_pass(run_id uuid,actor_id uuid,command_key uuid) RETURNS void
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r finance_control_runs%ROWTYPE;DECLARE pr payment_requests%ROWTYPE;DECLARE request_id uuid;
DECLARE required_codes text[]:=ARRAY[
 'REQUEST_NOT_APPROVED','REQUEST_REVISION_CHANGED','APPROVAL_NOT_CURRENT','APPROVAL_ROUTE_INCOMPLETE','APPROVER_AUTHORITY_INVALID',
 'EVIDENCE_MISMATCH','REQUIRED_EVIDENCE_MISSING','AMOUNT_CHANGED','PAYEE_CHANGED','CURRENCY_CHANGED','DEPARTMENT_OR_CATEGORY_CHANGED',
 'PAYMENT_DETAILS_CHANGED','VALIDATION_STALE','FINANCE_CONTEXT_STALE','FINANCIAL_ANALYSIS_STALE','POLICY_DECISION_STALE',
 'COMMITMENT_MISSING','COMMITMENT_NOT_ACTIVE','COMMITMENT_AMOUNT_MISMATCH','COMMITMENT_CURRENCY_MISMATCH','COMMITMENT_BUDGET_INVALID',
 'DUPLICATE_INVOICE','DUPLICATE_PAYMENT','PAYMENT_DETAILS_INCOMPLETE','PAYEE_VERIFIED','PAYMENT_METHOD_VERIFIED',
 'PAYMENT_DETAILS_VERIFIED','SUPPORTING_DOCUMENTS_VERIFIED'];
BEGIN
 SELECT payment_request_id INTO request_id FROM finance_control_runs WHERE id=run_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Finance Control run not found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(request_id::text,0));
 SELECT * INTO pr FROM payment_requests WHERE id=request_id FOR UPDATE;
 SELECT * INTO r FROM finance_control_runs WHERE id=run_id FOR UPDATE;
 IF NOT FOUND OR NOT r.is_current OR r.status<>'CHECKING' THEN RAISE EXCEPTION 'current CHECKING Finance Control run required'; END IF;
 IF pr.status<>'FINANCE_CHECK' OR pr.row_version<>r.request_revision+1 THEN RAISE EXCEPTION 'request is not finalizable'; END IF;
 IF r.duplicate_checked_at IS NULL OR r.duplicate_evidence_fingerprint IS NULL OR r.duplicate_check_version<2 THEN RAISE EXCEPTION 'final duplicate snapshot required'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(required_codes) code WHERE NOT EXISTS(
   SELECT 1 FROM finance_control_checks c WHERE c.finance_control_run_id=r.id AND c.code=code AND c.result='PASS'))
   OR EXISTS(SELECT 1 FROM finance_control_checks c WHERE c.finance_control_run_id=r.id AND c.result<>'PASS')
 THEN RAISE EXCEPTION 'all mandatory Finance Control checks must pass'; END IF;
 IF r.duplicate_status='POSSIBLE_DUPLICATE' AND NOT EXISTS(
   SELECT 1 FROM finance_control_checks WHERE finance_control_run_id=r.id AND code='POSSIBLE_DUPLICATE_REVIEWED' AND result='PASS')
 THEN RAISE EXCEPTION 'possible duplicate review required'; END IF;
 IF EXISTS(SELECT 1 FROM finance_control_exceptions WHERE finance_control_run_id=r.id AND status='OPEN') THEN RAISE EXCEPTION 'open Finance Control exception blocks readiness'; END IF;
 IF NOT EXISTS(SELECT 1 FROM approval_cases ac
   JOIN validation_runs v ON v.id=r.validation_run_id AND v.is_current AND v.status='COMPLETED'
   JOIN finance_context_snapshots fc ON fc.id=r.finance_context_snapshot_id AND fc.is_current AND fc.status='COMPLETED'
   JOIN financial_analysis_runs fa ON fa.id=r.financial_analysis_run_id AND fa.is_current AND fa.status='FINALIZED'
   JOIN policy_decision_runs pd ON pd.id=r.policy_decision_run_id AND pd.is_current AND pd.status='CURRENT'
   JOIN budget_commitments bc ON bc.id=r.commitment_id AND bc.status='ACTIVE' AND bc.source='APPROVAL'
   JOIN budgets b ON b.id=bc.budget_id AND b.status='ACTIVE'
   JOIN budget_versions bv ON bv.id=bc.budget_version_id AND bv.status='ACTIVE'
   WHERE ac.id=r.approval_case_id AND ac.payment_request_id=pr.id AND ac.is_current AND ac.status='APPROVED'
     AND bc.approval_case_id=ac.id AND bc.payment_request_id=pr.id AND bc.amount_minor=(pr.amount*100)::bigint AND bc.currency=pr.currency)
 THEN RAISE EXCEPTION 'current upstream authority and commitment are required'; END IF;
 UPDATE finance_control_runs SET status='PASSED',finalized_by=actor_id,finalized_at=now(),completed_command_key=command_key,completed_command_type='FINALIZE' WHERE id=r.id;
 UPDATE payment_requests SET status='READY_FOR_PAYMENT',updated_at=now(),row_version=row_version+1 WHERE id=pr.id;
END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION complete_finance_control_pass(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_finance_control_pass(uuid,uuid,uuid) TO aims_app;

CREATE OR REPLACE FUNCTION enforce_ready_for_payment() RETURNS trigger AS $$
DECLARE run finance_control_runs%ROWTYPE;
BEGIN
 IF NEW.status='READY_FOR_PAYMENT' AND OLD.status IS DISTINCT FROM 'READY_FOR_PAYMENT' THEN
  IF OLD.status<>'FINANCE_CHECK' THEN RAISE EXCEPTION 'READY_FOR_PAYMENT requires FINANCE_CHECK predecessor'; END IF;
  SELECT * INTO run FROM finance_control_runs f WHERE f.payment_request_id=NEW.id AND f.is_current FOR UPDATE;
  IF NOT FOUND OR run.status<>'PASSED' OR run.finalized_at IS NULL OR run.finalized_by IS NULL OR run.completed_command_key IS NULL OR run.completed_command_type<>'FINALIZE'
    OR run.request_revision+2<>NEW.row_version OR run.duplicate_checked_at IS NULL OR run.duplicate_check_version<2
    OR EXISTS(SELECT 1 FROM finance_control_checks WHERE finance_control_run_id=run.id AND result<>'PASS')
    OR EXISTS(SELECT 1 FROM finance_control_exceptions WHERE finance_control_run_id=run.id AND status='OPEN')
    OR NOT EXISTS(SELECT 1 FROM budget_commitments bc JOIN budgets b ON b.id=bc.budget_id AND b.status='ACTIVE'
      JOIN budget_versions bv ON bv.id=bc.budget_version_id AND bv.status='ACTIVE'
      WHERE bc.id=run.commitment_id AND bc.payment_request_id=NEW.id AND bc.status='ACTIVE' AND bc.amount_minor=(NEW.amount*100)::bigint AND bc.currency=NEW.currency)
  THEN RAISE EXCEPTION 'READY_FOR_PAYMENT requires a valid finalized Finance Control run'; END IF;
 END IF;
 RETURN NEW;
END;$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION lock_duplicate_control() RETURNS trigger AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('AIMS_DUPLICATE_CONTROL'));
 RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_requests_duplicate_serialization BEFORE INSERT OR UPDATE OF status,payee,amount,currency ON payment_requests
 FOR EACH ROW EXECUTE FUNCTION lock_duplicate_control();
CREATE TRIGGER payment_documents_duplicate_serialization BEFORE INSERT OR UPDATE OF removed_at,sha256 ON payment_documents
 FOR EACH ROW EXECUTE FUNCTION lock_duplicate_control();

CREATE OR REPLACE FUNCTION invalidate_ready_for_new_duplicate() RETURNS trigger AS $$
DECLARE source_request_id uuid;DECLARE target record;
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN COALESCE(NEW,OLD); END IF;
 IF TG_TABLE_NAME='payment_requests' THEN source_request_id:=NEW.id;
 ELSE source_request_id:=NEW.payment_request_id; END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_requests WHERE id=source_request_id AND status NOT IN('DRAFT','REJECTED','CANCELLED')) THEN RETURN COALESCE(NEW,OLD); END IF;
 FOR target IN SELECT DISTINCT pr.id,f.id run_id FROM payment_requests pr
   JOIN finance_control_runs f ON f.payment_request_id=pr.id AND f.is_current AND f.status='PASSED'
   WHERE pr.id<>source_request_id AND pr.status='READY_FOR_PAYMENT' AND (
     EXISTS(SELECT 1 FROM payment_requests source WHERE source.id=source_request_id AND source.payee=pr.payee AND source.amount=pr.amount AND source.currency=pr.currency)
     OR EXISTS(SELECT 1 FROM payment_documents source_doc JOIN payment_documents target_doc ON target_doc.payment_request_id=pr.id
       AND target_doc.removed_at IS NULL AND target_doc.sha256=source_doc.sha256
       WHERE source_doc.payment_request_id=source_request_id AND source_doc.removed_at IS NULL))
 LOOP
   PERFORM aims_require_request_serialization(target.id);
   UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false WHERE id=target.run_id;
   UPDATE payment_requests SET status='APPROVED',updated_at=now(),row_version=row_version+1 WHERE id=target.id AND status='READY_FOR_PAYMENT';
   INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
    VALUES(gen_random_uuid(),NULL,'READY_FOR_PAYMENT_INVALIDATED','PAYMENT_REQUEST',target.id,'READY_FOR_PAYMENT','APPROVED',gen_random_uuid(),
      jsonb_build_object('reason','NEW_DUPLICATE_CANDIDATE','financeControlRunId',target.run_id));
 END LOOP;
 RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_requests_new_duplicate_invalidation AFTER INSERT OR UPDATE OF status,payee,amount,currency ON payment_requests
 FOR EACH ROW EXECUTE FUNCTION invalidate_ready_for_new_duplicate();
CREATE TRIGGER payment_documents_new_duplicate_invalidation AFTER INSERT OR UPDATE OF removed_at,sha256 ON payment_documents
 FOR EACH ROW EXECUTE FUNCTION invalidate_ready_for_new_duplicate();

GRANT UPDATE(duplicate_status,duplicate_checked_at,duplicate_check_version,duplicate_evidence_fingerprint,completed_command_type) ON finance_control_runs TO aims_app;

COMMIT;
