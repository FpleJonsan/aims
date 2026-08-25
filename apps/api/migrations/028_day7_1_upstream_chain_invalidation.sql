BEGIN;

CREATE TRIGGER validation_runs_request_serialization BEFORE UPDATE ON validation_runs
 FOR EACH ROW EXECUTE FUNCTION aims_dependent_request_serialization();
CREATE TRIGGER finance_context_request_serialization BEFORE UPDATE ON finance_context_snapshots
 FOR EACH ROW EXECUTE FUNCTION aims_dependent_request_serialization();
CREATE TRIGGER financial_analysis_request_serialization BEFORE UPDATE ON financial_analysis_runs
 FOR EACH ROW EXECUTE FUNCTION aims_dependent_request_serialization();
CREATE TRIGGER policy_decision_request_serialization BEFORE UPDATE ON policy_decision_runs
 FOR EACH ROW EXECUTE FUNCTION aims_dependent_request_serialization();

CREATE OR REPLACE FUNCTION invalidate_finance_control_for_authority_change() RETURNS trigger AS $$
DECLARE request_id uuid;DECLARE previous_state varchar(32);DECLARE prior_case_id uuid;DECLARE prior_run_id uuid;DECLARE released_ids uuid[];
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN COALESCE(NEW,OLD); END IF;
 request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 SELECT id INTO prior_run_id FROM finance_control_runs WHERE payment_request_id=request_id AND is_current FOR UPDATE;
 IF prior_run_id IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
 SELECT status INTO previous_state FROM payment_requests WHERE id=request_id FOR UPDATE;
 IF previous_state IN('FINANCE_CHECK','FINANCE_HOLD','READY_FOR_PAYMENT') THEN
  UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false WHERE id=prior_run_id;
  UPDATE finance_control_exceptions SET status='SUPERSEDED' WHERE finance_control_run_id=prior_run_id AND status='OPEN';
  SELECT id INTO prior_case_id FROM approval_cases WHERE payment_request_id=request_id AND is_current FOR UPDATE;
  UPDATE approval_cases SET status='SUPERSEDED',is_current=false,completed_at=COALESCE(completed_at,now()) WHERE id=prior_case_id;
  UPDATE approval_steps SET status='CLOSED',completed_at=COALESCE(completed_at,now()) WHERE approval_case_id=prior_case_id AND status IN('ACTIVE','WAITING');
  UPDATE approval_action_tokens SET status='REVOKED' WHERE approval_case_id=prior_case_id AND status='ACTIVE';
  UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE approval_case_id=prior_case_id AND status='PENDING';
  WITH released AS (UPDATE budget_commitments SET status='RELEASED',released_at=now(),release_reason='FINANCE_CONTROL_UPSTREAM_INVALIDATED',
    release_reference_type=upper(TG_TABLE_NAME),release_reference_id=COALESCE(NEW.id,OLD.id)
    WHERE payment_request_id=request_id AND source='APPROVAL' AND status='ACTIVE' RETURNING id)
    SELECT array_agg(id) INTO released_ids FROM released;
  UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
  UPDATE policy_exceptions SET status='SUPERSEDED' WHERE payment_request_id=request_id AND status='OPEN';
  UPDATE financial_analysis_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
  UPDATE finance_context_snapshots SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
  UPDATE validation_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
  UPDATE payment_requests SET status='SUBMITTED',updated_at=now(),row_version=row_version+1 WHERE id=request_id;
  INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
   VALUES(gen_random_uuid(),NULL,'READY_FOR_PAYMENT_INVALIDATED','PAYMENT_REQUEST',request_id,previous_state,'SUBMITTED',gen_random_uuid(),
    jsonb_build_object('sourceTable',TG_TABLE_NAME,'financeControlRunId',prior_run_id,'approvalCaseId',prior_case_id,
      'releasedCommitmentIds',COALESCE(released_ids,ARRAY[]::uuid[])));
 END IF;
 RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;

CREATE TRIGGER validation_run_invalidates_finance_control AFTER UPDATE OF status,is_current ON validation_runs
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_current IS DISTINCT FROM NEW.is_current)
 EXECUTE FUNCTION invalidate_finance_control_for_authority_change();
CREATE TRIGGER finance_context_invalidates_finance_control AFTER UPDATE OF status,is_current ON finance_context_snapshots
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_current IS DISTINCT FROM NEW.is_current)
 EXECUTE FUNCTION invalidate_finance_control_for_authority_change();
CREATE TRIGGER financial_analysis_invalidates_finance_control AFTER UPDATE OF status,is_current ON financial_analysis_runs
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_current IS DISTINCT FROM NEW.is_current)
 EXECUTE FUNCTION invalidate_finance_control_for_authority_change();
CREATE TRIGGER policy_decision_invalidates_finance_control AFTER UPDATE OF status,is_current ON policy_decision_runs
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_current IS DISTINCT FROM NEW.is_current)
 EXECUTE FUNCTION invalidate_finance_control_for_authority_change();

COMMIT;
