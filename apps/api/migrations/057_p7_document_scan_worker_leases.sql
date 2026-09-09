BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM aims_schema_version
  WHERE singleton=true AND version=56 AND migration_id='056_payment_slip_trust_transition'
 ) THEN
  RAISE EXCEPTION 'migration 057 requires schema version 56 (056_payment_slip_trust_transition)';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aims_document_worker_executor')
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aims_document_worker_runtime') THEN
  RAISE EXCEPTION 'migration 057 requires bootstrapped document worker roles';
 END IF;
END;
$$;

ALTER TABLE payment_documents
 ADD COLUMN scan_claim_token uuid,
 ADD COLUMN scan_claimed_by varchar(128),
 ADD COLUMN scan_claimed_at timestamptz,
 ADD COLUMN scan_lease_expires_at timestamptz,
 ADD COLUMN scan_next_attempt_at timestamptz,
 ADD COLUMN scan_failure_disposition varchar(16),
 ADD COLUMN scan_correlation_id uuid,
 ADD CONSTRAINT payment_documents_scan_claim_coherence_check CHECK(
  (scan_claim_token IS NULL AND scan_claimed_by IS NULL AND scan_claimed_at IS NULL AND scan_lease_expires_at IS NULL)
  OR
  (scan_claim_token IS NOT NULL AND scan_claimed_by IS NOT NULL AND scan_claimed_at IS NOT NULL
   AND scan_lease_expires_at IS NOT NULL AND scan_lease_expires_at>scan_claimed_at AND security_status='SCANNING')
 ),
 ADD CONSTRAINT payment_documents_scan_failure_disposition_check CHECK(
  scan_failure_disposition IS NULL OR scan_failure_disposition IN('RETRYABLE','TERMINAL')
 ),
 ADD CONSTRAINT payment_documents_scan_retry_semantics_check CHECK(
  (security_status='SCAN_FAILED' AND scan_failure_disposition IN('RETRYABLE','TERMINAL')
   AND ((scan_failure_disposition='RETRYABLE' AND scan_next_attempt_at IS NOT NULL)
        OR (scan_failure_disposition='TERMINAL' AND scan_next_attempt_at IS NULL)))
  OR
  (security_status<>'SCAN_FAILED' AND scan_failure_disposition IS NULL AND scan_next_attempt_at IS NULL)
 );

CREATE INDEX payment_documents_scan_claimable_idx
 ON payment_documents(security_status,scan_next_attempt_at,scan_lease_expires_at,uploaded_at,id)
 WHERE removed_at IS NULL AND security_status IN('QUARANTINED','SCAN_FAILED','SCANNING');

COMMENT ON INDEX payment_documents_scan_claimable_idx IS
 'Supports bounded worker polling for quarantined, retry-eligible failed, and expired scanning documents.';

CREATE OR REPLACE FUNCTION protect_document_security_transition() RETURNS trigger AS $$
DECLARE trusted_worker boolean:=current_user<>session_user AND pg_has_role(session_user,'aims_document_worker_executor','MEMBER');
BEGIN
  IF OLD.security_status<>NEW.security_status AND NEW.security_status='SCANNING' THEN
    NEW.scan_failure_disposition:=NULL;NEW.scan_next_attempt_at:=NULL;
  ELSIF OLD.security_status<>NEW.security_status AND NEW.security_status='SCAN_FAILED' AND NEW.scan_failure_disposition IS NULL THEN
    NEW.scan_failure_disposition:='RETRYABLE';NEW.scan_next_attempt_at:=clock_timestamp()+interval '5 minutes';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.payment_request_id IS DISTINCT FROM NEW.payment_request_id
     OR OLD.logical_document_id IS DISTINCT FROM NEW.logical_document_id OR OLD.original_filename IS DISTINCT FROM NEW.original_filename
     OR OLD.mime_type IS DISTINCT FROM NEW.mime_type OR OLD.size_bytes IS DISTINCT FROM NEW.size_bytes OR OLD.sha256 IS DISTINCT FROM NEW.sha256
     OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.version<>NEW.version
     OR OLD.uploaded_by IS DISTINCT FROM NEW.uploaded_by OR OLD.uploaded_at IS DISTINCT FROM NEW.uploaded_at
     OR OLD.storage_provider IS DISTINCT FROM NEW.storage_provider OR OLD.declared_mime_type IS DISTINCT FROM NEW.declared_mime_type
     OR OLD.detected_mime_type IS DISTINCT FROM NEW.detected_mime_type THEN
    RAISE EXCEPTION 'document identity and provenance are immutable';
  END IF;
  IF OLD.storage_object_key<>NEW.storage_object_key AND NOT(
    OLD.security_status='SCANNING' AND NEW.security_status='CLEAN'
    AND OLD.storage_object_key LIKE 'quarantine/%' AND NEW.storage_object_key LIKE 'active/%'
  ) THEN RAISE EXCEPTION 'invalid document storage promotion';END IF;
  IF OLD.security_status<>NEW.security_status AND NOT(
    (OLD.security_status='QUARANTINED' AND NEW.security_status='SCANNING')
    OR (OLD.security_status='SCAN_FAILED' AND NEW.security_status='SCANNING')
    OR (OLD.security_status='SCANNING' AND NEW.security_status IN('CLEAN','REJECTED','SCAN_FAILED'))
  ) THEN RAISE EXCEPTION 'invalid document security transition';END IF;
  IF OLD.security_status=NEW.security_status AND(
    OLD.scan_attempt<>NEW.scan_attempt OR OLD.scan_started_at IS DISTINCT FROM NEW.scan_started_at
    OR OLD.scan_completed_at IS DISTINCT FROM NEW.scan_completed_at
    OR OLD.scan_engine IS DISTINCT FROM NEW.scan_engine OR OLD.scan_reference IS DISTINCT FROM NEW.scan_reference
    OR OLD.scan_failure_code IS DISTINCT FROM NEW.scan_failure_code
  ) AND NOT(trusted_worker AND OLD.security_status='SCANNING') THEN
    RAISE EXCEPTION 'scan metadata may change only with a security transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path=pg_catalog,public;
REVOKE ALL ON FUNCTION protect_document_security_transition() FROM PUBLIC;

CREATE OR REPLACE FUNCTION guard_payment_slip_write() RETURNS trigger
SET search_path=pg_catalog,public AS $$
DECLARE trusted_worker boolean:=current_user<>session_user AND pg_has_role(session_user,'aims_document_worker_executor','MEMBER');
BEGIN
 IF COALESCE(NEW.document_type,OLD.document_type)='PAYMENT_SLIP' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment slip deletion is forbidden';END IF;
  IF NOT trusted_worker THEN PERFORM public.aims_authenticated_payment_actor();END IF;
  IF TG_OP='UPDATE' THEN
   IF current_user=session_user THEN RAISE EXCEPTION 'payment slip security transition requires a trusted function' USING ERRCODE='42501';END IF;
   IF OLD.id IS DISTINCT FROM NEW.id OR OLD.payment_request_id IS DISTINCT FROM NEW.payment_request_id
      OR OLD.logical_document_id IS DISTINCT FROM NEW.logical_document_id OR OLD.original_filename IS DISTINCT FROM NEW.original_filename
      OR OLD.storage_object_key IS DISTINCT FROM NEW.storage_object_key OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
      OR OLD.size_bytes IS DISTINCT FROM NEW.size_bytes OR OLD.sha256 IS DISTINCT FROM NEW.sha256
      OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.version IS DISTINCT FROM NEW.version
      OR OLD.uploaded_by IS DISTINCT FROM NEW.uploaded_by OR OLD.uploaded_at IS DISTINCT FROM NEW.uploaded_at
      OR OLD.removed_at IS DISTINCT FROM NEW.removed_at OR OLD.storage_provider IS DISTINCT FROM NEW.storage_provider
      OR OLD.declared_mime_type IS DISTINCT FROM NEW.declared_mime_type OR OLD.detected_mime_type IS DISTINCT FROM NEW.detected_mime_type THEN
    RAISE EXCEPTION 'payment slip business evidence is immutable';
   END IF;
  END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_payment_slip_write() FROM PUBLIC;

CREATE OR REPLACE FUNCTION claim_next_payment_document_scan(
 p_worker_id text,p_lease_seconds integer,p_max_attempts integer,p_correlation_id uuid
) RETURNS TABLE(
 document_id uuid,payment_request_id uuid,document_version integer,document_sha256 text,
 document_type text,storage_provider text,storage_object_key text,detected_mime_type text,scan_attempt integer,
 claim_token uuid,lease_expires_at timestamptz,correlation_id uuid
) SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE doc public.payment_documents%ROWTYPE;new_token uuid:=gen_random_uuid();now_at timestamptz:=clock_timestamp();
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
  doc.detected_mime_type::text,doc.scan_attempt+1,new_token,now_at+make_interval(secs=>p_lease_seconds),p_correlation_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION complete_payment_document_scan(
 p_document_id uuid,p_document_version integer,p_sha256 text,p_scan_attempt integer,p_claim_token uuid,
 p_result_status text,p_failure_disposition text,p_retry_delay_seconds integer,
 p_scanner_engine text,p_scan_reference text,p_failure_code text,p_active_object_key text
) RETURNS text SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE doc public.payment_documents%ROWTYPE;normalized_status text:=upper(p_result_status);normalized_disposition text:=upper(COALESCE(p_failure_disposition,''));
BEGIN
 SELECT * INTO doc FROM public.payment_documents d WHERE d.id=p_document_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'document scan work no longer exists';END IF;
 IF doc.version<>p_document_version OR doc.sha256<>lower(p_sha256) THEN RAISE EXCEPTION 'document scan identity mismatch';END IF;
 IF doc.scan_attempt<>p_scan_attempt THEN RAISE EXCEPTION 'document scan attempt is stale';END IF;
 IF doc.security_status<>'SCANNING' OR doc.scan_claim_token IS DISTINCT FROM p_claim_token OR doc.scan_claimed_by IS NULL THEN
  RAISE EXCEPTION 'document scan claim is stale' USING ERRCODE='40001';
 END IF;
 IF normalized_status NOT IN('CLEAN','REJECTED','SCAN_FAILED') THEN RAISE EXCEPTION 'invalid document scan result';END IF;
 IF normalized_status IN('CLEAN','REJECTED') THEN
  IF normalized_disposition<>'' OR p_failure_code IS NOT NULL OR p_scanner_engine IS NULL
    OR p_scanner_engine!~'^[A-Za-z0-9._:-]{1,80}$' OR p_scan_reference IS NULL OR length(p_scan_reference) NOT BETWEEN 1 AND 160
  THEN RAISE EXCEPTION 'completed document scan provenance is invalid';END IF;
  IF normalized_status='CLEAN' AND doc.document_type<>'PAYMENT_SLIP'
    AND (p_active_object_key IS NULL OR p_active_object_key NOT LIKE 'active/%') THEN RAISE EXCEPTION 'clean document promotion key is required';END IF;
 ELSE
  IF normalized_disposition NOT IN('RETRYABLE','TERMINAL') OR p_failure_code IS NULL OR p_failure_code!~'^[A-Z0-9_]{1,80}$'
  THEN RAISE EXCEPTION 'document scan failure metadata is invalid';END IF;
  IF normalized_disposition='RETRYABLE' AND p_retry_delay_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'document scan retry delay is invalid';END IF;
  IF normalized_disposition='TERMINAL' AND COALESCE(p_retry_delay_seconds,0)<>0 THEN RAISE EXCEPTION 'terminal document scan cannot have a retry delay';END IF;
 END IF;
 UPDATE public.payment_documents SET security_status=normalized_status,
  storage_object_key=CASE WHEN normalized_status='CLEAN' AND document_type<>'PAYMENT_SLIP' THEN p_active_object_key ELSE storage_object_key END,
  scan_completed_at=clock_timestamp(),scan_engine=p_scanner_engine,scan_reference=p_scan_reference,
  scan_failure_code=CASE WHEN normalized_status='SCAN_FAILED' THEN p_failure_code ELSE NULL END,
  scan_failure_disposition=CASE WHEN normalized_status='SCAN_FAILED' THEN normalized_disposition ELSE NULL END,
  scan_next_attempt_at=CASE WHEN normalized_status='SCAN_FAILED' AND normalized_disposition='RETRYABLE'
    THEN clock_timestamp()+make_interval(secs=>p_retry_delay_seconds) ELSE NULL END,
  scan_claim_token=NULL,scan_claimed_by=NULL,scan_claimed_at=NULL,scan_lease_expires_at=NULL
 WHERE id=p_document_id;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
 VALUES(gen_random_uuid(),NULL,CASE normalized_status WHEN 'CLEAN' THEN 'DOCUMENT_MARKED_CLEAN' WHEN 'REJECTED' THEN 'DOCUMENT_REJECTED'
  ELSE CASE normalized_disposition WHEN 'TERMINAL' THEN 'DOCUMENT_SCAN_FAILED_TERMINAL' ELSE 'DOCUMENT_SCAN_FAILED' END END,
  'PAYMENT_REQUEST',doc.payment_request_id,COALESCE(doc.scan_correlation_id,gen_random_uuid())::text,
  jsonb_build_object('documentId',doc.id,'attempt',p_scan_attempt,'status',normalized_status,'failureDisposition',NULLIF(normalized_disposition,'')));
 RETURN normalized_status;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION payment_document_scan_worker_health() RETURNS TABLE(
 backlog bigint,oldest_eligible_seconds bigint,scanning_leases bigint,expired_leases bigint,
 retryable_failures bigint,terminal_failures bigint,maximum_attempt integer
) SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT
  count(*) FILTER(WHERE removed_at IS NULL AND(security_status='QUARANTINED' OR(security_status='SCAN_FAILED' AND scan_failure_disposition='RETRYABLE' AND scan_next_attempt_at<=now()))),
  COALESCE(extract(epoch FROM now()-min(COALESCE(scan_next_attempt_at,uploaded_at)) FILTER(WHERE removed_at IS NULL AND(security_status='QUARANTINED' OR(security_status='SCAN_FAILED' AND scan_failure_disposition='RETRYABLE' AND scan_next_attempt_at<=now()))))::bigint,0),
  count(*) FILTER(WHERE removed_at IS NULL AND security_status='SCANNING' AND scan_claim_token IS NOT NULL),
  count(*) FILTER(WHERE removed_at IS NULL AND security_status='SCANNING' AND scan_lease_expires_at<=now()),
  count(*) FILTER(WHERE removed_at IS NULL AND security_status='SCAN_FAILED' AND scan_failure_disposition='RETRYABLE'),
  count(*) FILTER(WHERE removed_at IS NULL AND security_status='SCAN_FAILED' AND scan_failure_disposition='TERMINAL'),
  COALESCE(max(scan_attempt),0)
 FROM public.payment_documents;
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid) FROM PUBLIC,aims_app,aims_finance_executor,aims_payment_executor;
REVOKE ALL ON FUNCTION complete_payment_document_scan(uuid,integer,text,integer,uuid,text,text,integer,text,text,text,text) FROM PUBLIC,aims_app,aims_finance_executor,aims_payment_executor;
REVOKE ALL ON FUNCTION payment_document_scan_worker_health() FROM PUBLIC,aims_app,aims_finance_executor,aims_payment_executor;
GRANT EXECUTE ON FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid) TO aims_document_worker_executor;
GRANT EXECUTE ON FUNCTION complete_payment_document_scan(uuid,integer,text,integer,uuid,text,text,integer,text,text,text,text) TO aims_document_worker_executor;
GRANT EXECUTE ON FUNCTION payment_document_scan_worker_health() TO aims_document_worker_executor;

UPDATE aims_schema_version SET version=57,migration_id='057_p7_document_scan_worker_leases',applied_at=now()
WHERE singleton=true AND version=56;

COMMIT;
