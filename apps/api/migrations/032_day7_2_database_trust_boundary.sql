BEGIN;

DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_finance_executor') THEN
    CREATE ROLE aims_finance_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
  END IF;
END$$;
GRANT aims_app TO aims_finance_executor;

REVOKE INSERT,UPDATE,DELETE ON finance_control_runs,finance_control_checks,
  finance_control_confirmations,finance_control_exceptions FROM aims_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON finance_control_runs,finance_control_checks,
  finance_control_confirmations,finance_control_exceptions TO aims_finance_executor;

CREATE OR REPLACE FUNCTION aims_authenticated_finance_actor() RETURNS uuid
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;
BEGIN
  IF NOT pg_has_role(session_user,'aims_finance_executor','MEMBER') THEN
    RAISE EXCEPTION 'trusted Finance Control executor is required' USING ERRCODE='42501';
  END IF;
  BEGIN actor:=current_setting('aims.user_id',true)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'authenticated database execution identity is required' USING ERRCODE='42501';
  END;
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND active) THEN
    RAISE EXCEPTION 'active authenticated database execution identity is required' USING ERRCODE='42501';
  END IF;
  RETURN actor;
END;$$ LANGUAGE plpgsql STABLE;
REVOKE ALL ON FUNCTION aims_authenticated_finance_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aims_authenticated_finance_actor() TO aims_finance_executor;

CREATE OR REPLACE FUNCTION guard_finance_control_run_write() RETURNS trigger
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;DECLARE request_id uuid;
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN COALESCE(NEW,OLD); END IF;
  actor:=public.aims_authenticated_finance_actor();
  request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
  IF NOT EXISTS(SELECT 1 FROM public.finance_control_authorities a
    JOIN public.users u ON u.id=a.user_id AND u.active
    JOIN public.payment_requests pr ON pr.id=request_id
    WHERE a.user_id=actor AND a.active AND (a.scope='ORGANIZATION' OR a.department_id=pr.department_id)
      AND (a.allow_self_control OR actor<>pr.created_by)) THEN
    RAISE EXCEPTION 'authenticated Finance Controller authority is required' USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' AND NEW.started_by<>actor THEN
    RAISE EXCEPTION 'run starter must match authenticated execution identity' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND NEW.finalized_by IS NOT NULL AND NEW.finalized_by<>actor
    AND OLD.finalized_by IS DISTINCT FROM NEW.finalized_by THEN
    RAISE EXCEPTION 'run finalizer must match authenticated execution identity' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_finance_control_run_write() FROM PUBLIC;
DROP TRIGGER IF EXISTS finance_control_trusted_write_guard ON finance_control_runs;
CREATE TRIGGER finance_control_trusted_write_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_control_runs
  FOR EACH ROW EXECUTE FUNCTION guard_finance_control_run_write();

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
  IF TG_TABLE_NAME='finance_control_confirmations' AND TG_OP IN('INSERT','UPDATE') AND NEW.confirmed_by<>actor THEN
    RAISE EXCEPTION 'confirmation actor mismatch' USING ERRCODE='42501';
  ELSIF TG_TABLE_NAME='finance_control_exceptions' AND TG_OP='INSERT' AND NEW.created_by<>actor THEN
    RAISE EXCEPTION 'exception actor mismatch' USING ERRCODE='42501';
  ELSIF TG_TABLE_NAME='finance_control_exceptions' AND TG_OP='UPDATE'
    AND NEW.resolved_by IS NOT NULL AND NEW.resolved_by<>actor THEN
    RAISE EXCEPTION 'exception resolver mismatch' USING ERRCODE='42501';
  ELSIF TG_TABLE_NAME='finance_control_checks' AND TG_OP='INSERT'
    AND NEW.source='FINANCE_USER' AND NEW.checked_by<>actor THEN
    RAISE EXCEPTION 'check actor mismatch' USING ERRCODE='42501';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_finance_control_child_write() FROM PUBLIC;
CREATE TRIGGER finance_control_checks_trusted_write_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_control_checks
  FOR EACH ROW EXECUTE FUNCTION guard_finance_control_child_write();
CREATE TRIGGER finance_control_confirmations_trusted_write_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_control_confirmations
  FOR EACH ROW EXECUTE FUNCTION guard_finance_control_child_write();
CREATE TRIGGER finance_control_exceptions_trusted_write_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_control_exceptions
  FOR EACH ROW EXECUTE FUNCTION guard_finance_control_child_write();

DROP FUNCTION complete_finance_control_pass(uuid,uuid,uuid);
CREATE FUNCTION complete_finance_control_pass(run_id uuid,command_key uuid) RETURNS void
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.finance_control_runs%ROWTYPE;DECLARE pr public.payment_requests%ROWTYPE;
DECLARE actor uuid;DECLARE request_id uuid;DECLARE required_codes text[]:=ARRAY[
 'REQUEST_NOT_APPROVED','REQUEST_REVISION_CHANGED','APPROVAL_NOT_CURRENT','APPROVAL_ROUTE_INCOMPLETE','APPROVER_AUTHORITY_INVALID',
 'EVIDENCE_MISMATCH','REQUIRED_EVIDENCE_MISSING','AMOUNT_CHANGED','PAYEE_CHANGED','CURRENCY_CHANGED','DEPARTMENT_OR_CATEGORY_CHANGED',
 'PAYMENT_DETAILS_CHANGED','VALIDATION_STALE','FINANCE_CONTEXT_STALE','FINANCIAL_ANALYSIS_STALE','POLICY_DECISION_STALE',
 'COMMITMENT_MISSING','COMMITMENT_NOT_ACTIVE','COMMITMENT_AMOUNT_MISMATCH','COMMITMENT_CURRENCY_MISMATCH','COMMITMENT_BUDGET_INVALID',
 'DUPLICATE_INVOICE','DUPLICATE_PAYMENT','PAYMENT_DETAILS_INCOMPLETE','PAYEE_VERIFIED','PAYMENT_METHOD_VERIFIED',
 'PAYMENT_DETAILS_VERIFIED','SUPPORTING_DOCUMENTS_VERIFIED'];
BEGIN
 actor:=public.aims_authenticated_finance_actor();
 SELECT payment_request_id INTO request_id FROM public.finance_control_runs WHERE id=run_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Finance Control run not found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(request_id::text,0));
 SELECT * INTO pr FROM public.payment_requests WHERE id=request_id FOR UPDATE;
 SELECT * INTO r FROM public.finance_control_runs WHERE id=run_id FOR UPDATE;
 IF NOT r.is_current OR r.status<>'CHECKING' THEN RAISE EXCEPTION 'current CHECKING Finance Control run required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.finance_control_authorities a JOIN public.users u ON u.id=a.user_id AND u.active
   WHERE a.user_id=actor AND a.active AND (a.scope='ORGANIZATION' OR a.department_id=pr.department_id)
   AND (a.allow_self_control OR actor<>pr.created_by)) THEN RAISE EXCEPTION 'authenticated Finance Controller authority is required'; END IF;
 IF pr.status<>'FINANCE_CHECK' OR pr.row_version<>r.request_revision+1 THEN RAISE EXCEPTION 'request is not finalizable'; END IF;
 IF r.duplicate_checked_at IS NULL OR r.duplicate_evidence_fingerprint IS NULL OR r.duplicate_check_version<2 THEN RAISE EXCEPTION 'final duplicate snapshot required'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(required_codes) code WHERE NOT EXISTS(SELECT 1 FROM public.finance_control_checks c WHERE c.finance_control_run_id=r.id AND c.code=code AND c.result='PASS'))
   OR EXISTS(SELECT 1 FROM public.finance_control_checks c WHERE c.finance_control_run_id=r.id AND c.result<>'PASS')
 THEN RAISE EXCEPTION 'all mandatory Finance Control checks must pass'; END IF;
 IF r.duplicate_status='POSSIBLE_DUPLICATE' AND NOT EXISTS(SELECT 1 FROM public.finance_control_checks WHERE finance_control_run_id=r.id AND code='POSSIBLE_DUPLICATE_REVIEWED' AND result='PASS')
 THEN RAISE EXCEPTION 'possible duplicate review required'; END IF;
 IF EXISTS(SELECT 1 FROM public.finance_control_exceptions WHERE finance_control_run_id=r.id AND status='OPEN') THEN RAISE EXCEPTION 'open Finance Control exception blocks readiness'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.approval_cases ac
   JOIN public.validation_runs v ON v.id=r.validation_run_id AND v.is_current AND v.status='COMPLETED'
   JOIN public.finance_context_snapshots fc ON fc.id=r.finance_context_snapshot_id AND fc.is_current AND fc.status='COMPLETED'
   JOIN public.financial_analysis_runs fa ON fa.id=r.financial_analysis_run_id AND fa.is_current AND fa.status='FINALIZED'
   JOIN public.policy_decision_runs pd ON pd.id=r.policy_decision_run_id AND pd.is_current AND pd.status='CURRENT'
   JOIN public.budget_commitments bc ON bc.id=r.commitment_id AND bc.status='ACTIVE' AND bc.source='APPROVAL'
   JOIN public.budgets b ON b.id=bc.budget_id AND b.status='ACTIVE'
   JOIN public.budget_versions bv ON bv.id=bc.budget_version_id AND bv.status='ACTIVE'
   WHERE ac.id=r.approval_case_id AND ac.payment_request_id=pr.id AND ac.is_current AND ac.status='APPROVED'
     AND bc.approval_case_id=ac.id AND bc.payment_request_id=pr.id AND bc.amount_minor=(pr.amount*100)::bigint AND bc.currency=pr.currency)
 THEN RAISE EXCEPTION 'current upstream authority and commitment are required'; END IF;
 UPDATE public.finance_control_runs SET status='PASSED',finalized_by=actor,finalized_at=now(),completed_command_key=command_key,completed_command_type='FINALIZE' WHERE id=r.id;
 UPDATE public.payment_requests SET status='READY_FOR_PAYMENT',updated_at=now(),row_version=row_version+1 WHERE id=pr.id;
END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION complete_finance_control_pass(uuid,uuid) FROM PUBLIC,aims_app;
GRANT EXECUTE ON FUNCTION complete_finance_control_pass(uuid,uuid) TO aims_finance_executor;

CREATE OR REPLACE FUNCTION audit_finance_control_database_transition() RETURNS trigger
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;DECLARE source text;
BEGIN
 IF OLD.status IS DISTINCT FROM NEW.status THEN
  BEGIN actor:=public.aims_authenticated_finance_actor();source:='AUTHENTICATED_APPLICATION';
  EXCEPTION WHEN OTHERS THEN actor:=NULL;source:=CASE WHEN pg_trigger_depth()>1 THEN 'DATABASE_INVARIANT' ELSE 'SYSTEM' END; END;
  INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
   VALUES(gen_random_uuid(),actor,'FINANCE_CONTROL_DB_TRANSITION','PAYMENT_REQUEST',NEW.payment_request_id,
    OLD.status,NEW.status,COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text)::uuid,
    jsonb_build_object('financeControlRunId',NEW.id,'runVersion',NEW.run_version,'source',source));
 END IF;
 RETURN NEW;
END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION audit_finance_control_database_transition() FROM PUBLIC;

COMMIT;
