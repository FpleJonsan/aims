BEGIN;

CREATE OR REPLACE FUNCTION invalidate_finance_control_for_authority_change() RETURNS trigger AS $$
DECLARE request_id uuid;DECLARE previous_state varchar(32);
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN COALESCE(NEW,OLD); END IF;
 request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 -- A service-owned upstream invalidation supersedes the run before updating
 -- Approval and commitment rows. In that case, do not compete with it.
 IF NOT EXISTS(SELECT 1 FROM finance_control_runs WHERE payment_request_id=request_id AND is_current) THEN
  RETURN COALESCE(NEW,OLD);
 END IF;
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

COMMIT;
