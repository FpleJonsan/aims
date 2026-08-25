BEGIN;
CREATE OR REPLACE FUNCTION aims_dependent_request_serialization() RETURNS trigger AS $$
DECLARE request_id uuid;
BEGIN
  IF TG_TABLE_NAME='payment_requests' THEN request_id:=COALESCE(NEW.id,OLD.id);
  ELSE request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id); END IF;
  PERFORM aims_require_request_serialization(request_id);
  RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION invalidate_ready_for_new_duplicate() RETURNS trigger AS $$
DECLARE source_request_id uuid;DECLARE target record;
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN COALESCE(NEW,OLD); END IF;
 IF TG_TABLE_NAME='payment_requests' THEN source_request_id:=NEW.id;
 ELSE source_request_id:=NEW.payment_request_id; END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_requests WHERE id=source_request_id AND status NOT IN('DRAFT','REJECTED','CANCELLED')) THEN RETURN COALESCE(NEW,OLD); END IF;
 FOR target IN SELECT DISTINCT pr.id,f.id run_id FROM payment_requests pr
   JOIN finance_control_runs f ON f.payment_request_id=pr.id AND f.is_current AND f.status='PASSED'
   WHERE pr.id<>source_request_id AND pr.status='READY_FOR_PAYMENT' AND (
     EXISTS(SELECT 1 FROM payment_requests source WHERE source.id=source_request_id AND source.payee=pr.payee AND source.amount=pr.amount AND source.currency=pr.currency)
     OR EXISTS(SELECT 1 FROM payment_documents source_doc JOIN payment_documents target_doc ON target_doc.payment_request_id=pr.id
       AND target_doc.removed_at IS NULL AND target_doc.sha256=source_doc.sha256
       WHERE source_doc.payment_request_id=source_request_id AND source_doc.removed_at IS NULL))
 LOOP
   PERFORM aims_require_request_serialization(target.id);
   UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false WHERE id=target.run_id;
   UPDATE payment_requests SET status='APPROVED',updated_at=now(),row_version=row_version+1 WHERE id=target.id AND status='READY_FOR_PAYMENT';
   INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
    VALUES(gen_random_uuid(),NULL,'READY_FOR_PAYMENT_INVALIDATED','PAYMENT_REQUEST',target.id,'READY_FOR_PAYMENT','APPROVED',gen_random_uuid(),
      jsonb_build_object('reason','NEW_DUPLICATE_CANDIDATE','financeControlRunId',target.run_id));
 END LOOP;
 RETURN COALESCE(NEW,OLD);
END;$$ LANGUAGE plpgsql;
COMMIT;
