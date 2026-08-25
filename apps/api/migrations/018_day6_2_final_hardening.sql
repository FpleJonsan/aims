BEGIN;

ALTER TABLE approval_action_tokens ADD COLUMN status varchar(16);
UPDATE approval_action_tokens SET status=CASE WHEN used_at IS NOT NULL THEN 'CONSUMED' WHEN expires_at<=now() THEN 'EXPIRED' ELSE 'ACTIVE' END;
ALTER TABLE approval_action_tokens ALTER COLUMN status SET NOT NULL;
ALTER TABLE approval_action_tokens ADD CONSTRAINT approval_action_tokens_status_check CHECK(status IN('ACTIVE','CONSUMED','EXPIRED','REVOKED'));
DROP INDEX approval_action_tokens_one_live_action_idx;
CREATE UNIQUE INDEX approval_action_tokens_one_active_action_idx ON approval_action_tokens(approval_step_id,recipient_user_id,action) WHERE status='ACTIVE';

ALTER TABLE telegram_pending_interactions DROP CONSTRAINT telegram_pending_interactions_telegram_binding_id_status_key;
CREATE UNIQUE INDEX telegram_pending_interactions_one_pending_idx ON telegram_pending_interactions(telegram_binding_id) WHERE status='PENDING';

ALTER TABLE telegram_webhook_updates ADD COLUMN status varchar(24) NOT NULL DEFAULT 'COMPLETED' CHECK(status IN('PROCESSING','COMPLETED','FAILED_RETRYABLE','FAILED_TERMINAL'));
ALTER TABLE telegram_webhook_updates ADD COLUMN attempts integer NOT NULL DEFAULT 1;
ALTER TABLE telegram_webhook_updates ADD COLUMN locked_at timestamptz;
ALTER TABLE telegram_webhook_updates ADD COLUMN completed_at timestamptz;
ALTER TABLE telegram_webhook_updates ADD COLUMN last_error_code varchar(64);
UPDATE telegram_webhook_updates SET completed_at=received_at WHERE status='COMPLETED';

ALTER TABLE budget_commitments ADD COLUMN release_reason varchar(64);
ALTER TABLE budget_commitments ADD COLUMN release_reference_type varchar(40);
ALTER TABLE budget_commitments ADD COLUMN release_reference_id uuid;

CREATE OR REPLACE FUNCTION invalidate_approval_for_evidence_change() RETURNS trigger AS $$
DECLARE request_id uuid;DECLARE relevant boolean;DECLARE approval_invalidated boolean;DECLARE old_state varchar(32);
BEGIN request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 relevant:=TG_OP='INSERT' OR (OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL) OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL)
 OR (OLD.removed_at IS NULL AND NEW.removed_at IS NULL AND (OLD.version IS DISTINCT FROM NEW.version OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.sha256 IS DISTINCT FROM NEW.sha256));
 IF relevant THEN
  SELECT status INTO old_state FROM payment_requests WHERE id=request_id FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM approval_cases WHERE payment_request_id=request_id AND is_current) INTO approval_invalidated;
  IF approval_invalidated THEN
   UPDATE approval_cases SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
   UPDATE approval_steps SET status='CLOSED',completed_at=now() WHERE approval_case_id IN(SELECT id FROM approval_cases WHERE payment_request_id=request_id AND status='SUPERSEDED') AND status IN('ACTIVE','WAITING');
   UPDATE approval_action_tokens SET status='REVOKED' WHERE approval_case_id IN(SELECT id FROM approval_cases WHERE payment_request_id=request_id AND status='SUPERSEDED') AND status='ACTIVE';
   UPDATE budget_commitments SET status='RELEASED',released_at=now(),release_reason='UPSTREAM_EVIDENCE_CHANGED',release_reference_type='PAYMENT_DOCUMENT',release_reference_id=COALESCE(NEW.id,OLD.id)
    WHERE payment_request_id=request_id AND source='APPROVAL' AND status='ACTIVE';
   UPDATE validation_runs SET is_current=false,status='SUPERSEDED' WHERE payment_request_id=request_id AND is_current;
   UPDATE payment_requests SET status='SUBMITTED',updated_at=now(),row_version=row_version+1 WHERE id=request_id AND status IN('PENDING_APPROVAL','APPROVED');
   INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
    VALUES(gen_random_uuid(),NULL,'APPROVAL_INVALIDATED_BY_UPSTREAM_CHANGE','PAYMENT_REQUEST',request_id,old_state,'SUBMITTED',gen_random_uuid(),jsonb_build_object('documentId',COALESCE(NEW.id,OLD.id),'reason','UPSTREAM_EVIDENCE_CHANGED'));
  END IF;
 END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;

GRANT UPDATE(status) ON approval_action_tokens TO aims_app;
GRANT UPDATE(status,attempts,locked_at,completed_at,last_error_code) ON telegram_webhook_updates TO aims_app;
GRANT UPDATE(status,released_at,release_reason,release_reference_type,release_reference_id) ON budget_commitments TO aims_app;
COMMIT;
