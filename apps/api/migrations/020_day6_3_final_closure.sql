BEGIN;

ALTER TABLE notification_outbox ADD COLUMN claimed_at timestamptz;
ALTER TABLE notification_outbox ADD COLUMN claim_token uuid;
ALTER TABLE notification_outbox ADD COLUMN claimed_by varchar(128);
UPDATE notification_outbox SET status='FAILED' WHERE status='PROCESSING';
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_status_check;
UPDATE notification_outbox SET status='FAILED_RETRYABLE' WHERE status='FAILED';
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_status_check
  CHECK(status IN('PENDING','PROCESSING','SENT','FAILED_RETRYABLE','FAILED_TERMINAL'));
CREATE INDEX notification_outbox_claimable_idx
  ON notification_outbox(status,next_attempt_at,claimed_at,created_at)
  WHERE status IN('PENDING','PROCESSING','FAILED_RETRYABLE');

ALTER TABLE telegram_identity_bindings
  DROP CONSTRAINT telegram_identity_bindings_telegram_user_id_key;
CREATE UNIQUE INDEX telegram_identity_one_active_telegram_user_idx
  ON telegram_identity_bindings(telegram_user_id) WHERE status='ACTIVE';

CREATE OR REPLACE FUNCTION invalidate_downstream_for_material_request_change()
RETURNS trigger AS $$
DECLARE
  changed_fields text[] := ARRAY[]::text[];
  prior_case_id uuid;
  released_ids uuid[];
BEGIN
  IF OLD.payee IS DISTINCT FROM NEW.payee THEN changed_fields:=array_append(changed_fields,'payee'); END IF;
  IF OLD.purpose IS DISTINCT FROM NEW.purpose THEN changed_fields:=array_append(changed_fields,'purpose'); END IF;
  IF OLD.category IS DISTINCT FROM NEW.category THEN changed_fields:=array_append(changed_fields,'category'); END IF;
  IF OLD.amount IS DISTINCT FROM NEW.amount THEN changed_fields:=array_append(changed_fields,'amount'); END IF;
  IF OLD.currency IS DISTINCT FROM NEW.currency THEN changed_fields:=array_append(changed_fields,'currency'); END IF;
  IF OLD.department_id IS DISTINCT FROM NEW.department_id THEN changed_fields:=array_append(changed_fields,'department_id'); END IF;
  IF OLD.due_date IS DISTINCT FROM NEW.due_date THEN changed_fields:=array_append(changed_fields,'due_date'); END IF;
  IF OLD.payment_method IS DISTINCT FROM NEW.payment_method THEN changed_fields:=array_append(changed_fields,'payment_method'); END IF;
  IF OLD.payment_details IS DISTINCT FROM NEW.payment_details THEN changed_fields:=array_append(changed_fields,'payment_details'); END IF;

  IF cardinality(changed_fields)>0 AND OLD.status IN('PENDING_APPROVAL','APPROVED') THEN
    SELECT id INTO prior_case_id FROM approval_cases
      WHERE payment_request_id=OLD.id AND is_current FOR UPDATE;
    IF prior_case_id IS NOT NULL THEN
      UPDATE approval_cases SET status='SUPERSEDED',is_current=false,completed_at=COALESCE(completed_at,now())
        WHERE id=prior_case_id;
      UPDATE approval_steps SET status='CLOSED',completed_at=COALESCE(completed_at,now())
        WHERE approval_case_id=prior_case_id AND status IN('ACTIVE','WAITING');
      UPDATE approval_action_tokens SET status='REVOKED'
        WHERE approval_case_id=prior_case_id AND status='ACTIVE';
      UPDATE telegram_pending_interactions SET status='CANCELLED'
        WHERE approval_case_id=prior_case_id AND status='PENDING';
      WITH released AS (
        UPDATE budget_commitments SET status='RELEASED',released_at=now(),
          release_reason='REQUEST_MATERIAL_CHANGED',release_reference_type='PAYMENT_REQUEST',release_reference_id=OLD.id
        WHERE payment_request_id=OLD.id AND source='APPROVAL' AND status='ACTIVE'
        RETURNING id
      ) SELECT array_agg(id) INTO released_ids FROM released;
      UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false
        WHERE payment_request_id=OLD.id AND is_current;
      UPDATE policy_exceptions SET status='SUPERSEDED'
        WHERE payment_request_id=OLD.id AND status='OPEN';
      UPDATE financial_analysis_runs SET status='SUPERSEDED',is_current=false
        WHERE payment_request_id=OLD.id AND is_current;
      UPDATE finance_context_snapshots SET status='SUPERSEDED',is_current=false
        WHERE payment_request_id=OLD.id AND is_current;
      UPDATE validation_runs SET status='SUPERSEDED',is_current=false
        WHERE payment_request_id=OLD.id AND is_current;
      NEW.status := 'SUBMITTED';
      NEW.row_version := OLD.row_version + 1;
      NEW.updated_at := now();
      INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
      VALUES(gen_random_uuid(),NULL,'REQUEST_MATERIAL_CHANGE_INVALIDATED_DOWNSTREAM','PAYMENT_REQUEST',OLD.id,
        OLD.status,'SUBMITTED',gen_random_uuid(),jsonb_build_object(
          'changedFields',changed_fields,'priorRevision',OLD.row_version,'newRevision',NEW.row_version,
          'approvalCaseId',prior_case_id,'releasedCommitmentIds',COALESCE(released_ids,ARRAY[]::uuid[])));
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_requests_material_change_invalidation
BEFORE UPDATE OF payee,purpose,category,amount,currency,department_id,due_date,payment_method,payment_details
ON payment_requests FOR EACH ROW
EXECUTE FUNCTION invalidate_downstream_for_material_request_change();

CREATE OR REPLACE FUNCTION invalidate_approval_for_evidence_change() RETURNS trigger AS $$
DECLARE request_id uuid;DECLARE relevant boolean;DECLARE prior_case_id uuid;DECLARE old_state varchar(32);DECLARE released_ids uuid[];
BEGIN request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 relevant:=TG_OP='INSERT' OR (OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL) OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL)
 OR (OLD.removed_at IS NULL AND NEW.removed_at IS NULL AND (OLD.version IS DISTINCT FROM NEW.version OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.sha256 IS DISTINCT FROM NEW.sha256));
 IF relevant THEN
  SELECT status INTO old_state FROM payment_requests WHERE id=request_id FOR UPDATE;
  SELECT id INTO prior_case_id FROM approval_cases WHERE payment_request_id=request_id AND is_current FOR UPDATE;
  IF prior_case_id IS NOT NULL AND old_state IN('PENDING_APPROVAL','APPROVED') THEN
   UPDATE approval_cases SET status='SUPERSEDED',is_current=false,completed_at=COALESCE(completed_at,now()) WHERE id=prior_case_id;
   UPDATE approval_steps SET status='CLOSED',completed_at=COALESCE(completed_at,now()) WHERE approval_case_id=prior_case_id AND status IN('ACTIVE','WAITING');
   UPDATE approval_action_tokens SET status='REVOKED' WHERE approval_case_id=prior_case_id AND status='ACTIVE';
   UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE approval_case_id=prior_case_id AND status='PENDING';
   WITH released AS (UPDATE budget_commitments SET status='RELEASED',released_at=now(),release_reason='UPSTREAM_EVIDENCE_CHANGED',release_reference_type='PAYMENT_DOCUMENT',release_reference_id=COALESCE(NEW.id,OLD.id)
    WHERE payment_request_id=request_id AND source='APPROVAL' AND status='ACTIVE' RETURNING id)
    SELECT array_agg(id) INTO released_ids FROM released;
   UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
   UPDATE policy_exceptions SET status='SUPERSEDED' WHERE payment_request_id=request_id AND status='OPEN';
   UPDATE financial_analysis_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
   UPDATE finance_context_snapshots SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
   UPDATE validation_runs SET is_current=false,status='SUPERSEDED' WHERE payment_request_id=request_id AND is_current;
   UPDATE payment_requests SET status='SUBMITTED',updated_at=now(),row_version=row_version+1 WHERE id=request_id;
   INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
    VALUES(gen_random_uuid(),NULL,'APPROVAL_INVALIDATED_BY_UPSTREAM_CHANGE','PAYMENT_REQUEST',request_id,old_state,'SUBMITTED',gen_random_uuid(),jsonb_build_object(
      'documentId',COALESCE(NEW.id,OLD.id),'reason','UPSTREAM_EVIDENCE_CHANGED','approvalCaseId',prior_case_id,
      'releasedCommitmentIds',COALESCE(released_ids,ARRAY[]::uuid[])));
  END IF;
 END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;

GRANT UPDATE(status,attempts,next_attempt_at,last_error_code,sent_at,claimed_at,claim_token,claimed_by)
  ON notification_outbox TO aims_app;
COMMIT;
