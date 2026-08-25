BEGIN;
CREATE OR REPLACE FUNCTION audit_finance_control_database_transition() RETURNS trigger
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;DECLARE source text;DECLARE correlation uuid;DECLARE supplied_correlation text;
BEGIN
 IF OLD.status IS DISTINCT FROM NEW.status THEN
  BEGIN actor:=public.aims_authenticated_finance_actor();source:='AUTHENTICATED_APPLICATION';
  EXCEPTION WHEN OTHERS THEN actor:=NULL;source:=CASE WHEN pg_trigger_depth()>1 THEN 'DATABASE_INVARIANT' ELSE 'SYSTEM' END; END;
  supplied_correlation:=current_setting('aims.correlation_id',true);
  correlation:=CASE WHEN supplied_correlation ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN supplied_correlation::uuid ELSE gen_random_uuid() END;
  INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
   VALUES(gen_random_uuid(),actor,'FINANCE_CONTROL_DB_TRANSITION','PAYMENT_REQUEST',NEW.payment_request_id,
    OLD.status,NEW.status,correlation,jsonb_build_object('financeControlRunId',NEW.id,'runVersion',NEW.run_version,'source',source));
 END IF;
 RETURN NEW;
END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION audit_finance_control_database_transition() FROM PUBLIC;
COMMIT;
