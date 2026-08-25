BEGIN;
CREATE OR REPLACE FUNCTION clear_readiness_for_control_supersession() RETURNS trigger AS $$
DECLARE old_state varchar(32);DECLARE next_state varchar(32);
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 IF OLD.is_current AND OLD.status='PASSED' AND (NOT NEW.is_current OR NEW.status='SUPERSEDED') THEN
  SELECT status INTO old_state FROM payment_requests WHERE id=OLD.payment_request_id FOR UPDATE;
  IF old_state='READY_FOR_PAYMENT' THEN
   next_state:=CASE WHEN EXISTS(SELECT 1 FROM approval_cases WHERE payment_request_id=OLD.payment_request_id AND is_current AND status='APPROVED')
     AND EXISTS(SELECT 1 FROM budget_commitments WHERE payment_request_id=OLD.payment_request_id AND status='ACTIVE' AND source='APPROVAL')
     THEN 'APPROVED' ELSE 'SUBMITTED' END;
   UPDATE payment_requests SET status=next_state,updated_at=now(),row_version=row_version+1 WHERE id=OLD.payment_request_id;
   INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
    VALUES(gen_random_uuid(),NULL,'READY_FOR_PAYMENT_INVALIDATED','PAYMENT_REQUEST',OLD.payment_request_id,old_state,next_state,gen_random_uuid(),
      jsonb_build_object('reason','FINANCE_CONTROL_SUPERSEDED','financeControlRunId',OLD.id));
  END IF;
 END IF;
 RETURN NEW;
END;$$ LANGUAGE plpgsql;
COMMIT;
