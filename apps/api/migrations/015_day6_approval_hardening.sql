BEGIN;
CREATE OR REPLACE FUNCTION invalidate_approval_for_evidence_change() RETURNS trigger AS $$
DECLARE request_id uuid;DECLARE relevant boolean;DECLARE approval_invalidated boolean;
BEGIN request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 relevant:=TG_OP='INSERT' OR (OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL) OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL)
 OR (OLD.removed_at IS NULL AND NEW.removed_at IS NULL AND (OLD.version IS DISTINCT FROM NEW.version OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.sha256 IS DISTINCT FROM NEW.sha256));
 IF relevant THEN PERFORM id FROM payment_requests WHERE id=request_id FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM approval_cases WHERE payment_request_id=request_id AND is_current) INTO approval_invalidated;
  UPDATE approval_cases SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
  UPDATE approval_steps SET status='CLOSED',completed_at=now() WHERE approval_case_id IN(SELECT id FROM approval_cases WHERE payment_request_id=request_id AND status='SUPERSEDED') AND status IN('ACTIVE','WAITING');
  IF approval_invalidated THEN
   UPDATE validation_runs SET is_current=false,status='SUPERSEDED' WHERE payment_request_id=request_id AND is_current;
   UPDATE payment_requests SET status='SUBMITTED',updated_at=now(),row_version=row_version+1 WHERE id=request_id AND status='PENDING_APPROVAL';
  END IF;
 END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;
COMMIT;
