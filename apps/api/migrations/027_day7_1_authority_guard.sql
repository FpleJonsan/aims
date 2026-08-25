BEGIN;
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
COMMIT;
