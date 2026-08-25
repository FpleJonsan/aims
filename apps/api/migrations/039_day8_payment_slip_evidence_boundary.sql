BEGIN;
CREATE OR REPLACE FUNCTION invalidate_approval_for_evidence_change() RETURNS trigger SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request_id uuid;DECLARE relevant boolean;DECLARE prior_case_id uuid;DECLARE prior_run_id uuid;DECLARE old_state varchar(32);DECLARE released_ids uuid[];
BEGIN
 IF COALESCE(NEW.document_type,OLD.document_type)='PAYMENT_SLIP' THEN RETURN COALESCE(NEW,OLD);END IF;
 request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 relevant:=TG_OP='INSERT' OR(OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL)OR(OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL)OR(OLD.removed_at IS NULL AND NEW.removed_at IS NULL AND(OLD.version IS DISTINCT FROM NEW.version OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.sha256 IS DISTINCT FROM NEW.sha256));
 IF relevant THEN
  SELECT status INTO old_state FROM public.payment_requests WHERE id=request_id FOR UPDATE;
  SELECT id INTO prior_run_id FROM public.finance_control_runs WHERE payment_request_id=request_id AND is_current FOR UPDATE;
  IF prior_run_id IS NOT NULL THEN UPDATE public.finance_control_runs SET status='SUPERSEDED',is_current=false WHERE id=prior_run_id;UPDATE public.finance_control_exceptions SET status='SUPERSEDED' WHERE finance_control_run_id=prior_run_id AND status='OPEN';END IF;
  SELECT id INTO prior_case_id FROM public.approval_cases WHERE payment_request_id=request_id AND is_current FOR UPDATE;
  IF prior_case_id IS NOT NULL AND old_state IN('PENDING_APPROVAL','APPROVED','FINANCE_CHECK','FINANCE_HOLD','READY_FOR_PAYMENT') THEN
   UPDATE public.approval_cases SET status='SUPERSEDED',is_current=false,completed_at=COALESCE(completed_at,now()) WHERE id=prior_case_id;
   UPDATE public.approval_steps SET status='CLOSED',completed_at=COALESCE(completed_at,now()) WHERE approval_case_id=prior_case_id AND status IN('ACTIVE','WAITING');
   UPDATE public.approval_action_tokens SET status='REVOKED' WHERE approval_case_id=prior_case_id AND status='ACTIVE';UPDATE public.telegram_pending_interactions SET status='CANCELLED' WHERE approval_case_id=prior_case_id AND status='PENDING';
   WITH released AS(UPDATE public.budget_commitments SET status='RELEASED',released_at=now(),release_reason='UPSTREAM_EVIDENCE_CHANGED',release_reference_type='PAYMENT_DOCUMENT',release_reference_id=COALESCE(NEW.id,OLD.id) WHERE payment_request_id=request_id AND source='APPROVAL' AND status='ACTIVE' RETURNING id)SELECT array_agg(id)INTO released_ids FROM released;
   UPDATE public.policy_decision_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;UPDATE public.policy_exceptions SET status='SUPERSEDED' WHERE payment_request_id=request_id AND status='OPEN';UPDATE public.financial_analysis_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;UPDATE public.finance_context_snapshots SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;UPDATE public.validation_runs SET is_current=false,status='SUPERSEDED' WHERE payment_request_id=request_id AND is_current;
   UPDATE public.payment_requests SET status='SUBMITTED',updated_at=now(),row_version=row_version+1 WHERE id=request_id;
   INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)VALUES(gen_random_uuid(),NULL,CASE WHEN old_state='READY_FOR_PAYMENT'THEN'READY_FOR_PAYMENT_INVALIDATED'ELSE'APPROVAL_INVALIDATED_BY_UPSTREAM_CHANGE'END,'PAYMENT_REQUEST',request_id,old_state,'SUBMITTED',gen_random_uuid(),jsonb_build_object('financeControlRunId',prior_run_id,'documentId',COALESCE(NEW.id,OLD.id),'reason','UPSTREAM_EVIDENCE_CHANGED','approvalCaseId',prior_case_id,'releasedCommitmentIds',COALESCE(released_ids,ARRAY[]::uuid[])));
  END IF;
 END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION invalidate_approval_for_evidence_change() FROM PUBLIC;

CREATE OR REPLACE FUNCTION invalidate_ready_for_new_duplicate() RETURNS trigger SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source_request_id uuid;DECLARE target record;
BEGIN
 IF pg_trigger_depth()>1 OR(TG_TABLE_NAME='payment_documents' AND NEW.document_type='PAYMENT_SLIP')THEN RETURN COALESCE(NEW,OLD);END IF;
 IF TG_TABLE_NAME='payment_requests'THEN source_request_id:=NEW.id;ELSE source_request_id:=NEW.payment_request_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_requests WHERE id=source_request_id AND status NOT IN('DRAFT','REJECTED','CANCELLED'))THEN RETURN COALESCE(NEW,OLD);END IF;
 FOR target IN SELECT DISTINCT pr.id,f.id run_id FROM public.payment_requests pr JOIN public.finance_control_runs f ON f.payment_request_id=pr.id AND f.is_current AND f.status='PASSED' WHERE pr.id<>source_request_id AND pr.status='READY_FOR_PAYMENT' AND(EXISTS(SELECT 1 FROM public.payment_requests source WHERE source.id=source_request_id AND source.payee=pr.payee AND source.amount=pr.amount AND source.currency=pr.currency)OR EXISTS(SELECT 1 FROM public.payment_documents source_doc JOIN public.payment_documents target_doc ON target_doc.payment_request_id=pr.id AND target_doc.removed_at IS NULL AND target_doc.sha256=source_doc.sha256 WHERE source_doc.payment_request_id=source_request_id AND source_doc.removed_at IS NULL AND source_doc.document_type<>'PAYMENT_SLIP' AND target_doc.document_type<>'PAYMENT_SLIP'))
 LOOP PERFORM public.aims_require_request_serialization(target.id);UPDATE public.finance_control_runs SET status='SUPERSEDED',is_current=false WHERE id=target.run_id;UPDATE public.payment_requests SET status='APPROVED',updated_at=now(),row_version=row_version+1 WHERE id=target.id AND status='READY_FOR_PAYMENT';INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)VALUES(gen_random_uuid(),NULL,'READY_FOR_PAYMENT_INVALIDATED','PAYMENT_REQUEST',target.id,'READY_FOR_PAYMENT','APPROVED',gen_random_uuid(),jsonb_build_object('reason','NEW_DUPLICATE_CANDIDATE','financeControlRunId',target.run_id));END LOOP;
 RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION invalidate_ready_for_new_duplicate() FROM PUBLIC;
COMMIT;
