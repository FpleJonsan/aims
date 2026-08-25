BEGIN;
CREATE OR REPLACE FUNCTION audit_finance_control_database_transition() RETURNS trigger AS $$
BEGIN
 IF OLD.status IS DISTINCT FROM NEW.status THEN
  INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
   VALUES(gen_random_uuid(),NEW.finalized_by,'FINANCE_CONTROL_DB_TRANSITION','PAYMENT_REQUEST',NEW.payment_request_id,
    OLD.status,NEW.status,gen_random_uuid(),jsonb_build_object('financeControlRunId',NEW.id,'runVersion',NEW.run_version));
 END IF;
 RETURN NEW;
END;$$ LANGUAGE plpgsql;
CREATE TRIGGER finance_control_database_transition_audit AFTER UPDATE OF status ON finance_control_runs
 FOR EACH ROW EXECUTE FUNCTION audit_finance_control_database_transition();
COMMIT;
