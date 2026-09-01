BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM aims_schema_version
  WHERE singleton=true AND version=57 AND migration_id='057_p7_document_scan_worker_leases'
 ) THEN
  RAISE EXCEPTION 'migration 058 requires schema version 57 (057_p7_document_scan_worker_leases)';
 END IF;
END;
$$;

-- PostgreSQL cannot change a TABLE return shape with CREATE OR REPLACE. The
-- function has no dependent database objects; recreate the exact trusted
-- capability without CASCADE and restore its narrow ownership/grant contract.
DROP FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid);

CREATE FUNCTION claim_next_payment_document_scan(
 p_worker_id text,p_lease_seconds integer,p_max_attempts integer,p_correlation_id uuid
) RETURNS TABLE(
 document_id uuid,payment_request_id uuid,document_version integer,document_sha256 text,
 document_type text,storage_provider text,storage_object_key text,detected_mime_type text,scan_attempt integer,
 claim_token uuid,lease_expires_at timestamptz,correlation_id uuid,expired_lease_recovered boolean
) SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 doc public.payment_documents%ROWTYPE;new_token uuid:=gen_random_uuid();now_at timestamptz:=clock_timestamp();
 recovered boolean:=false;
BEGIN
 IF p_worker_id IS NULL OR p_worker_id!~'^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'invalid document worker identity';END IF;
 IF p_lease_seconds NOT BETWEEN 5 AND 3600 THEN RAISE EXCEPTION 'document scan lease must be between 5 and 3600 seconds';END IF;
 IF p_max_attempts NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'document scan maximum attempts must be between 1 and 20';END IF;
 IF p_correlation_id IS NULL THEN RAISE EXCEPTION 'document scan correlation is required';END IF;

 UPDATE public.payment_documents d SET
  security_status='SCAN_FAILED',scan_completed_at=now_at,scan_failure_code='MAX_ATTEMPTS_EXHAUSTED',
  scan_failure_disposition='TERMINAL',scan_next_attempt_at=NULL,
  scan_claim_token=NULL,scan_claimed_by=NULL,scan_claimed_at=NULL,scan_lease_expires_at=NULL
 WHERE d.removed_at IS NULL AND d.security_status='SCANNING' AND d.scan_attempt>=p_max_attempts
  AND ((d.scan_lease_expires_at IS NOT NULL AND d.scan_lease_expires_at<=now_at)
    OR (d.scan_claim_token IS NULL AND d.scan_started_at<=now_at-make_interval(secs=>p_lease_seconds)));

 SELECT * INTO doc FROM public.payment_documents d
 WHERE d.removed_at IS NULL AND d.security_status<>'UNVERIFIED' AND d.scan_attempt<p_max_attempts AND(
  d.security_status='QUARANTINED'
  OR (d.security_status='SCAN_FAILED' AND d.scan_failure_disposition='RETRYABLE' AND d.scan_next_attempt_at<=now_at)
  OR (d.security_status='SCANNING' AND(
    (d.scan_lease_expires_at IS NOT NULL AND d.scan_lease_expires_at<=now_at)
    OR (d.scan_claim_token IS NULL AND d.scan_started_at<=now_at-make_interval(secs=>p_lease_seconds))
  ))
 )
 ORDER BY COALESCE(d.scan_next_attempt_at,d.scan_lease_expires_at,d.uploaded_at),d.id
 FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;

 recovered:=doc.security_status='SCANNING' AND(
  (doc.scan_lease_expires_at IS NOT NULL AND doc.scan_lease_expires_at<=now_at)
  OR (doc.scan_claim_token IS NULL AND doc.scan_started_at<=now_at-make_interval(secs=>p_lease_seconds))
 );

 UPDATE public.payment_documents d SET security_status='SCANNING',scan_attempt=doc.scan_attempt+1,
  scan_started_at=now_at,scan_completed_at=NULL,scan_engine=NULL,scan_reference=NULL,scan_failure_code=NULL,
  scan_claim_token=new_token,scan_claimed_by=p_worker_id,scan_claimed_at=now_at,
  scan_lease_expires_at=now_at+make_interval(secs=>p_lease_seconds),scan_next_attempt_at=NULL,
  scan_failure_disposition=NULL,scan_correlation_id=p_correlation_id
 WHERE d.id=doc.id;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
 VALUES(gen_random_uuid(),NULL,'DOCUMENT_SCAN_WORKER_CLAIMED','PAYMENT_REQUEST',doc.payment_request_id,p_correlation_id::text,
  jsonb_build_object('documentId',doc.id,'attempt',doc.scan_attempt+1,'workerId',p_worker_id));
 RETURN QUERY SELECT doc.id,doc.payment_request_id,doc.version,doc.sha256::text,doc.document_type::text,doc.storage_provider::text,doc.storage_object_key::text,
  doc.detected_mime_type::text,doc.scan_attempt+1,new_token,now_at+make_interval(secs=>p_lease_seconds),p_correlation_id,recovered;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid) OWNER TO aims_owner;
REVOKE ALL ON FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid) FROM PUBLIC,aims_app,aims_finance_executor,aims_payment_executor;
GRANT EXECUTE ON FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid) TO aims_document_worker_executor;

CREATE INDEX notification_outbox_failed_terminal_idx
 ON notification_outbox(id)
 WHERE status='FAILED_TERMINAL';
ALTER INDEX notification_outbox_failed_terminal_idx OWNER TO aims_owner;
COMMENT ON INDEX notification_outbox_failed_terminal_idx IS
 'Supports the bounded P10 current terminal Telegram backlog count without scanning historical SENT rows.';

UPDATE aims_schema_version SET version=58,migration_id='058_p10_observability_claim_recovery_and_outbox_index',applied_at=now()
WHERE singleton=true AND version=57;

COMMIT;
