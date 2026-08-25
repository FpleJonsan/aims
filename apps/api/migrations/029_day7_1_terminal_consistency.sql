BEGIN;

CREATE UNIQUE INDEX finance_control_finalize_command_scope_idx
 ON finance_control_runs(id,completed_command_type,completed_command_key)
 WHERE completed_command_key IS NOT NULL;

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
    OLD.completed_command_key IS DISTINCT FROM NEW.completed_command_key OR OLD.completed_command_type IS DISTINCT FROM NEW.completed_command_type OR
    OLD.duplicate_status IS DISTINCT FROM NEW.duplicate_status OR OLD.duplicate_checked_at IS DISTINCT FROM NEW.duplicate_checked_at OR
    OLD.duplicate_check_version IS DISTINCT FROM NEW.duplicate_check_version OR OLD.duplicate_evidence_fingerprint IS DISTINCT FROM NEW.duplicate_evidence_fingerprint
  ) THEN RAISE EXCEPTION 'finalized Finance Control metadata is immutable'; END IF;
  RETURN NEW;
END;$$ LANGUAGE plpgsql;

CREATE TRIGGER finance_control_request_serialization BEFORE UPDATE ON finance_control_runs
 FOR EACH ROW EXECUTE FUNCTION aims_dependent_request_serialization();

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
CREATE TRIGGER finance_control_supersession_clears_readiness AFTER UPDATE OF status,is_current ON finance_control_runs
 FOR EACH ROW EXECUTE FUNCTION clear_readiness_for_control_supersession();

COMMIT;
