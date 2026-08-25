BEGIN;
CREATE OR REPLACE FUNCTION guard_finance_control_child_write() RETURNS trigger
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;DECLARE run_status text;DECLARE request_id uuid;
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN COALESCE(NEW,OLD); END IF;
  actor:=public.aims_authenticated_finance_actor();
  SELECT status,payment_request_id INTO run_status,request_id FROM public.finance_control_runs
    WHERE id=COALESCE(NEW.finance_control_run_id,OLD.finance_control_run_id) FOR UPDATE;
  IF run_status IN('PASSED','SUPERSEDED') THEN
    RAISE EXCEPTION 'finalized Finance Control child records are immutable' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.finance_control_authorities a
    JOIN public.users u ON u.id=a.user_id AND u.active
    JOIN public.payment_requests pr ON pr.id=request_id
    WHERE a.user_id=actor AND a.active AND (a.scope='ORGANIZATION' OR a.department_id=pr.department_id)
      AND (a.allow_self_control OR actor<>pr.created_by)) THEN
    RAISE EXCEPTION 'authenticated Finance Controller authority is required' USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='finance_control_confirmations' THEN
    IF TG_OP IN('INSERT','UPDATE') AND NEW.confirmed_by<>actor THEN
      RAISE EXCEPTION 'confirmation actor mismatch' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME='finance_control_exceptions' THEN
    IF TG_OP='INSERT' AND NEW.created_by<>actor THEN
      RAISE EXCEPTION 'exception actor mismatch' USING ERRCODE='42501';
    ELSIF TG_OP='UPDATE' AND NEW.resolved_by IS NOT NULL AND NEW.resolved_by<>actor THEN
      RAISE EXCEPTION 'exception resolver mismatch' USING ERRCODE='42501';
    END IF;
  ELSIF TG_TABLE_NAME='finance_control_checks' THEN
    IF TG_OP='INSERT' AND NEW.source='FINANCE_USER' AND NEW.checked_by<>actor THEN
      RAISE EXCEPTION 'check actor mismatch' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_finance_control_child_write() FROM PUBLIC;
COMMIT;
