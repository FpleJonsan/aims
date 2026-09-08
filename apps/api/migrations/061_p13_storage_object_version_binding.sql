BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=60 AND migration_id='060_p13_corporate_auth_transactions') THEN
  RAISE EXCEPTION 'migration 061 requires schema version 60 (060_p13_corporate_auth_transactions)';
 END IF;
END;
$$;

ALTER TABLE payment_documents
 ADD COLUMN storage_binding_state varchar(24) NOT NULL DEFAULT 'LEGACY_UNBOUND',
 ADD COLUMN storage_backend_id varchar(128),
 ADD COLUMN storage_object_version varchar(512),
 ADD COLUMN trusted_storage_object_key varchar(1024),
 ADD COLUMN trusted_storage_object_version varchar(512),
 ADD CONSTRAINT payment_documents_storage_binding_state_check CHECK(storage_binding_state IN('LEGACY_UNBOUND','VERSION_BOUND')),
 ADD CONSTRAINT payment_documents_storage_backend_id_check CHECK(storage_backend_id IS NULL OR storage_backend_id~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
 ADD CONSTRAINT payment_documents_source_object_version_check CHECK(storage_object_version IS NULL OR(length(storage_object_version) BETWEEN 1 AND 512 AND storage_object_version!~'[[:cntrl:]]')),
 ADD CONSTRAINT payment_documents_trusted_object_key_check CHECK(trusted_storage_object_key IS NULL OR(length(trusted_storage_object_key) BETWEEN 1 AND 1024 AND trusted_storage_object_key!~'[[:cntrl:]]')),
 ADD CONSTRAINT payment_documents_trusted_object_version_check CHECK(trusted_storage_object_version IS NULL OR(length(trusted_storage_object_version) BETWEEN 1 AND 512 AND trusted_storage_object_version!~'[[:cntrl:]]')),
 ADD CONSTRAINT payment_documents_storage_binding_coherence_check CHECK(
  (storage_binding_state='LEGACY_UNBOUND' AND storage_backend_id IS NULL AND storage_object_version IS NULL AND trusted_storage_object_key IS NULL AND trusted_storage_object_version IS NULL)
  OR
  (storage_binding_state='VERSION_BOUND' AND storage_backend_id IS NOT NULL AND storage_object_version IS NOT NULL
   AND ((security_status='CLEAN' AND trusted_storage_object_key IS NOT NULL AND trusted_storage_object_version IS NOT NULL)
    OR (security_status<>'CLEAN' AND trusted_storage_object_key IS NULL AND trusted_storage_object_version IS NULL)))
 );

COMMENT ON COLUMN payment_documents.storage_binding_state IS 'LEGACY_UNBOUND preserves truthful pre-061 provenance; VERSION_BOUND identifies an exact immutable physical object.';
COMMENT ON COLUMN payment_documents.storage_object_key IS 'For VERSION_BOUND rows, immutable uploaded/quarantine source key; never reinterpreted as trusted promotion identity.';
COMMENT ON COLUMN payment_documents.storage_object_version IS 'Opaque provider-neutral immutable source-object version token with equality semantics only.';
COMMENT ON COLUMN payment_documents.trusted_storage_object_key IS 'Write-once trusted object key established only by trusted CLEAN completion.';
COMMENT ON COLUMN payment_documents.trusted_storage_object_version IS 'Write-once opaque trusted-object version token established only by trusted CLEAN completion.';

CREATE UNIQUE INDEX payment_documents_source_object_identity_idx
 ON payment_documents(storage_backend_id,storage_object_key,storage_object_version)
 WHERE storage_binding_state='VERSION_BOUND';
CREATE UNIQUE INDEX payment_documents_trusted_object_identity_idx
 ON payment_documents(storage_backend_id,trusted_storage_object_key,trusted_storage_object_version)
 WHERE storage_binding_state='VERSION_BOUND' AND trusted_storage_object_key IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_document_security_transition() RETURNS trigger AS $$
DECLARE trusted_worker boolean:=current_user<>session_user AND pg_has_role(session_user,'aims_document_worker_executor','MEMBER');
BEGIN
 IF OLD.id IS DISTINCT FROM NEW.id OR OLD.payment_request_id IS DISTINCT FROM NEW.payment_request_id
    OR OLD.logical_document_id IS DISTINCT FROM NEW.logical_document_id OR OLD.original_filename IS DISTINCT FROM NEW.original_filename
    OR OLD.storage_object_key IS DISTINCT FROM NEW.storage_object_key OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
    OR OLD.size_bytes IS DISTINCT FROM NEW.size_bytes OR OLD.sha256 IS DISTINCT FROM NEW.sha256
    OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.uploaded_by IS DISTINCT FROM NEW.uploaded_by OR OLD.uploaded_at IS DISTINCT FROM NEW.uploaded_at
    OR OLD.storage_provider IS DISTINCT FROM NEW.storage_provider OR OLD.declared_mime_type IS DISTINCT FROM NEW.declared_mime_type
    OR OLD.detected_mime_type IS DISTINCT FROM NEW.detected_mime_type OR OLD.storage_binding_state IS DISTINCT FROM NEW.storage_binding_state
    OR OLD.storage_backend_id IS DISTINCT FROM NEW.storage_backend_id OR OLD.storage_object_version IS DISTINCT FROM NEW.storage_object_version THEN
  RAISE EXCEPTION 'document identity and source provenance are immutable';
 END IF;
 IF OLD.trusted_storage_object_key IS DISTINCT FROM NEW.trusted_storage_object_key
    OR OLD.trusted_storage_object_version IS DISTINCT FROM NEW.trusted_storage_object_version THEN
  IF NOT(OLD.storage_binding_state='VERSION_BOUND' AND OLD.security_status='SCANNING' AND NEW.security_status='CLEAN'
    AND OLD.trusted_storage_object_key IS NULL AND OLD.trusted_storage_object_version IS NULL
    AND NEW.trusted_storage_object_key IS NOT NULL AND NEW.trusted_storage_object_version IS NOT NULL
    AND trusted_worker) THEN
   RAISE EXCEPTION 'trusted document identity is write-once through worker completion';
  END IF;
 END IF;
 IF OLD.security_status<>NEW.security_status AND NOT(
   (OLD.security_status='QUARANTINED' AND NEW.security_status='SCANNING')
   OR(OLD.security_status='SCAN_FAILED' AND NEW.security_status='SCANNING')
   OR(OLD.security_status='SCANNING' AND NEW.security_status IN('CLEAN','REJECTED','SCAN_FAILED'))
 ) THEN RAISE EXCEPTION 'invalid document security transition';END IF;
 IF OLD.security_status=NEW.security_status AND NOT trusted_worker AND(
   OLD.scan_attempt<>NEW.scan_attempt OR OLD.scan_started_at IS DISTINCT FROM NEW.scan_started_at
   OR OLD.scan_completed_at IS DISTINCT FROM NEW.scan_completed_at OR OLD.scan_engine IS DISTINCT FROM NEW.scan_engine
   OR OLD.scan_reference IS DISTINCT FROM NEW.scan_reference OR OLD.scan_failure_code IS DISTINCT FROM NEW.scan_failure_code
 ) THEN RAISE EXCEPTION 'scan metadata may change only with a security transition';END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_payment_slip_write() RETURNS trigger
SET search_path=pg_catalog,public AS $$
DECLARE trusted_worker boolean:=current_user<>session_user AND pg_has_role(session_user,'aims_document_worker_executor','MEMBER');
 trusted_recovery boolean:=current_user='aims_owner' AND current_setting('aims.recovery_advance',true)='true';
BEGIN
 IF COALESCE(NEW.document_type,OLD.document_type)='PAYMENT_SLIP' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment slip deletion is forbidden';END IF;
  IF NOT trusted_worker AND NOT trusted_recovery THEN PERFORM public.aims_authenticated_payment_actor();END IF;
  IF TG_OP='UPDATE' THEN
   IF current_user=session_user THEN RAISE EXCEPTION 'payment slip security transition requires a trusted function' USING ERRCODE='42501';END IF;
   IF OLD.id IS DISTINCT FROM NEW.id OR OLD.payment_request_id IS DISTINCT FROM NEW.payment_request_id
      OR OLD.logical_document_id IS DISTINCT FROM NEW.logical_document_id OR OLD.original_filename IS DISTINCT FROM NEW.original_filename
      OR OLD.storage_object_key IS DISTINCT FROM NEW.storage_object_key OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
      OR OLD.size_bytes IS DISTINCT FROM NEW.size_bytes OR OLD.sha256 IS DISTINCT FROM NEW.sha256
      OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.version IS DISTINCT FROM NEW.version
      OR OLD.uploaded_by IS DISTINCT FROM NEW.uploaded_by OR OLD.uploaded_at IS DISTINCT FROM NEW.uploaded_at
      OR OLD.removed_at IS DISTINCT FROM NEW.removed_at OR OLD.storage_provider IS DISTINCT FROM NEW.storage_provider
      OR OLD.declared_mime_type IS DISTINCT FROM NEW.declared_mime_type OR OLD.detected_mime_type IS DISTINCT FROM NEW.detected_mime_type
      OR OLD.storage_binding_state IS DISTINCT FROM NEW.storage_binding_state OR OLD.storage_backend_id IS DISTINCT FROM NEW.storage_backend_id
      OR OLD.storage_object_version IS DISTINCT FROM NEW.storage_object_version THEN RAISE EXCEPTION 'payment slip business evidence is immutable';END IF;
  END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION attach_payment_slip(uuid,uuid,uuid,text,text,text,bigint,text);
CREATE FUNCTION attach_payment_slip(request_id uuid,document_id uuid,logical_id uuid,filename text,object_key text,object_version text,backend_id text,mime text,size_bytes bigint,sha text,storage_provider text) RETURNS uuid
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;pr public.payment_requests%ROWTYPE;BEGIN
 actor:=public.aims_authenticated_payment_actor();
 IF storage_provider IS NULL OR storage_provider NOT IN('LOCAL','OBJECT') THEN RAISE EXCEPTION 'invalid storage provider';END IF;
 SELECT * INTO pr FROM public.payment_requests WHERE id=request_id FOR UPDATE;
 IF NOT FOUND OR pr.status<>'READY_FOR_PAYMENT' THEN RAISE EXCEPTION 'READY_FOR_PAYMENT request required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_authorities a WHERE a.user_id=actor AND a.active AND(a.scope='ORGANIZATION' OR a.department_id=pr.department_id)AND(a.allow_self_payment OR actor<>pr.created_by)AND(a.minimum_amount_minor IS NULL OR(pr.amount*100)::bigint>=a.minimum_amount_minor)AND(a.maximum_amount_minor IS NULL OR(pr.amount*100)::bigint<=a.maximum_amount_minor)) THEN RAISE EXCEPTION 'Payment Operator authority required' USING ERRCODE='42501';END IF;
 INSERT INTO public.payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,storage_binding_state,storage_backend_id,storage_object_version)
 VALUES(document_id,request_id,logical_id,filename,object_key,mime,size_bytes,lower(sha),'PAYMENT_SLIP',1,actor,storage_provider,mime,mime,'QUARANTINED','VERSION_BOUND',backend_id,object_version);
 RETURN document_id;END;
$$ LANGUAGE plpgsql;

DROP FUNCTION begin_payment_slip_security_scan(uuid,uuid,integer,text);
DROP FUNCTION complete_payment_slip_security_scan(uuid,uuid,integer,text,integer,text,text,text,text);

CREATE OR REPLACE FUNCTION require_clean_payment_slip() RETURNS trigger
SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.payment_documents d WHERE d.id=NEW.slip_document_id AND d.payment_request_id=NEW.payment_request_id
  AND d.document_type='PAYMENT_SLIP' AND d.removed_at IS NULL AND d.security_status='CLEAN'
  AND d.storage_binding_state='VERSION_BOUND' AND d.storage_backend_id IS NOT NULL
  AND d.storage_object_version IS NOT NULL AND d.trusted_storage_object_key IS NOT NULL
  AND d.trusted_storage_object_version IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.payment_documents newer WHERE newer.payment_request_id=d.payment_request_id AND newer.document_type='PAYMENT_SLIP'
   AND newer.removed_at IS NULL AND(newer.uploaded_at,newer.id)>(d.uploaded_at,d.id)))
 THEN RAISE EXCEPTION 'CLEAN current version-bound payment slip required';END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid);
CREATE FUNCTION claim_next_payment_document_scan(p_worker_id text,p_lease_seconds integer,p_max_attempts integer,p_correlation_id uuid)
RETURNS TABLE(document_id uuid,payment_request_id uuid,document_version integer,storage_backend_id text,source_object_key text,source_object_version text,document_sha256 text,document_size_bytes bigint,document_type text,storage_provider text,detected_mime_type text,scan_attempt integer,claim_token uuid,lease_expires_at timestamptz,correlation_id uuid,expired_lease_recovered boolean)
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE doc public.payment_documents%ROWTYPE;new_token uuid:=gen_random_uuid();now_at timestamptz:=clock_timestamp();recovered boolean:=false;current_generation uuid;
BEGIN
 SELECT generation INTO STRICT current_generation FROM public.aims_recovery_generation WHERE singleton FOR SHARE;
 IF p_worker_id IS NULL OR p_worker_id!~'^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'invalid document worker identity';END IF;
 IF p_lease_seconds IS NULL OR p_max_attempts IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 3600 OR p_max_attempts NOT BETWEEN 1 AND 20 OR p_correlation_id IS NULL THEN RAISE EXCEPTION 'invalid document worker claim parameters';END IF;
 WITH terminal_candidates AS(
  SELECT d.id,(d.scan_claim_token IS NULL AND d.scan_lease_expires_at IS NULL AND d.scan_claim_generation IS NULL) recovery_fenced
  FROM public.payment_documents d
  WHERE d.storage_binding_state='VERSION_BOUND' AND d.removed_at IS NULL AND d.security_status='SCANNING' AND d.scan_attempt>=p_max_attempts
   AND((d.scan_lease_expires_at IS NOT NULL AND d.scan_lease_expires_at<=now_at)
    OR(d.scan_claim_token IS NULL AND d.scan_lease_expires_at IS NULL AND d.scan_claim_generation IS NULL))
  FOR UPDATE SKIP LOCKED
 ),terminalized AS(
  UPDATE public.payment_documents d SET security_status='SCAN_FAILED',scan_completed_at=now_at,scan_failure_code='MAX_ATTEMPTS_EXHAUSTED',scan_failure_disposition='TERMINAL',scan_next_attempt_at=NULL,scan_claim_token=NULL,scan_claimed_by=NULL,scan_claimed_at=NULL,scan_lease_expires_at=NULL,scan_claim_generation=NULL
  FROM terminal_candidates c WHERE d.id=c.id
  RETURNING d.id,d.payment_request_id,d.scan_attempt,d.scan_correlation_id,c.recovery_fenced
 )
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
 SELECT gen_random_uuid(),NULL,'DOCUMENT_SCAN_FAILED_TERMINAL','PAYMENT_REQUEST',t.payment_request_id,COALESCE(t.scan_correlation_id,p_correlation_id)::text,
  jsonb_build_object('documentId',t.id,'attempt',t.scan_attempt,'status','SCAN_FAILED','failureDisposition','TERMINAL','failureCode','MAX_ATTEMPTS_EXHAUSTED','exhaustionCause',CASE WHEN t.recovery_fenced THEN 'RECOVERY_FENCED' ELSE 'LEASE_EXPIRED' END)
 FROM terminalized t;
 SELECT * INTO doc FROM public.payment_documents d WHERE d.storage_binding_state='VERSION_BOUND' AND d.removed_at IS NULL AND d.scan_attempt<p_max_attempts AND(
  d.security_status='QUARANTINED' OR(d.security_status='SCAN_FAILED' AND d.scan_failure_disposition='RETRYABLE' AND d.scan_next_attempt_at<=now_at)
  OR(d.security_status='SCANNING' AND(d.scan_claim_token IS NULL OR d.scan_lease_expires_at<=now_at)))
 ORDER BY COALESCE(d.scan_next_attempt_at,d.scan_lease_expires_at,d.uploaded_at),d.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;
 recovered:=doc.security_status='SCANNING';
 UPDATE public.payment_documents d SET security_status='SCANNING',scan_attempt=doc.scan_attempt+1,scan_started_at=now_at,scan_completed_at=NULL,scan_engine=NULL,scan_reference=NULL,scan_failure_code=NULL,scan_claim_token=new_token,scan_claimed_by=p_worker_id,scan_claimed_at=now_at,scan_lease_expires_at=now_at+make_interval(secs=>p_lease_seconds),scan_next_attempt_at=NULL,scan_failure_disposition=NULL,scan_correlation_id=p_correlation_id,scan_claim_generation=current_generation WHERE d.id=doc.id;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata) VALUES(gen_random_uuid(),NULL,'DOCUMENT_SCAN_WORKER_CLAIMED','PAYMENT_REQUEST',doc.payment_request_id,p_correlation_id::text,jsonb_build_object('documentId',doc.id,'attempt',doc.scan_attempt+1,'workerId',p_worker_id));
 RETURN QUERY SELECT doc.id,doc.payment_request_id,doc.version,doc.storage_backend_id::text,doc.storage_object_key::text,doc.storage_object_version::text,doc.sha256::text,doc.size_bytes,doc.document_type::text,doc.storage_provider::text,doc.detected_mime_type::text,doc.scan_attempt+1,new_token,now_at+make_interval(secs=>p_lease_seconds),p_correlation_id,recovered;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION complete_payment_document_scan(uuid,integer,text,integer,uuid,text,text,integer,text,text,text,text);
CREATE FUNCTION complete_payment_document_scan(p_document_id uuid,p_document_version integer,p_backend_id text,p_source_key text,p_source_version text,p_sha256 text,p_size_bytes bigint,p_scan_attempt integer,p_claim_token uuid,p_result_status text,p_failure_disposition text,p_retry_delay_seconds integer,p_scanner_engine text,p_scan_reference text,p_failure_code text,p_trusted_object_key text,p_trusted_object_version text)
RETURNS text SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE doc public.payment_documents%ROWTYPE;normalized_status text:=upper(p_result_status);normalized_disposition text:=upper(COALESCE(p_failure_disposition,''));current_generation uuid;
BEGIN
 SELECT generation INTO STRICT current_generation FROM public.aims_recovery_generation WHERE singleton FOR SHARE;
 IF p_document_id IS NULL OR p_document_version IS NULL OR p_backend_id IS NULL OR p_source_key IS NULL
    OR p_source_version IS NULL OR p_sha256 IS NULL OR p_size_bytes IS NULL OR p_scan_attempt IS NULL
    OR p_claim_token IS NULL OR p_result_status IS NULL OR p_retry_delay_seconds IS NULL THEN
  RAISE EXCEPTION 'required document scan completion identity is missing';
 END IF;
 SELECT * INTO doc FROM public.payment_documents WHERE id=p_document_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'document scan work no longer exists';END IF;
 IF doc.storage_binding_state IS DISTINCT FROM 'VERSION_BOUND' OR doc.version IS DISTINCT FROM p_document_version OR doc.storage_backend_id IS DISTINCT FROM p_backend_id OR doc.storage_object_key IS DISTINCT FROM p_source_key OR doc.storage_object_version IS DISTINCT FROM p_source_version OR doc.sha256 IS DISTINCT FROM lower(p_sha256) OR doc.size_bytes IS DISTINCT FROM p_size_bytes THEN RAISE EXCEPTION 'document scan physical identity mismatch';END IF;
 IF doc.scan_attempt IS DISTINCT FROM p_scan_attempt THEN RAISE EXCEPTION 'document scan attempt is stale';END IF;
 IF doc.security_status IS DISTINCT FROM 'SCANNING' OR doc.scan_claim_token IS DISTINCT FROM p_claim_token OR doc.scan_claimed_by IS NULL OR doc.scan_claim_generation IS DISTINCT FROM current_generation OR doc.scan_lease_expires_at IS NULL OR doc.scan_lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'document scan claim is stale' USING ERRCODE='40001';END IF;
 IF normalized_status NOT IN('CLEAN','REJECTED','SCAN_FAILED') THEN RAISE EXCEPTION 'invalid document scan result';END IF;
 IF normalized_status IN('CLEAN','REJECTED') THEN
  IF normalized_disposition<>'' OR p_failure_code IS NOT NULL OR p_scanner_engine IS NULL OR p_scanner_engine!~'^[A-Za-z0-9._:-]{1,80}$' OR p_scan_reference IS NULL OR length(p_scan_reference) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'completed document scan provenance is invalid';END IF;
  IF normalized_status='CLEAN' AND(p_trusted_object_key IS NULL OR length(p_trusted_object_key) NOT BETWEEN 1 AND 1024 OR p_trusted_object_version IS NULL OR length(p_trusted_object_version) NOT BETWEEN 1 AND 512) THEN RAISE EXCEPTION 'trusted object identity is required';END IF;
  IF normalized_status='REJECTED' AND(p_trusted_object_key IS NOT NULL OR p_trusted_object_version IS NOT NULL) THEN RAISE EXCEPTION 'rejected document cannot have trusted identity';END IF;
 ELSE
  IF normalized_disposition NOT IN('RETRYABLE','TERMINAL') OR p_failure_code IS NULL OR p_failure_code!~'^[A-Z0-9_]{1,80}$' THEN RAISE EXCEPTION 'document scan failure metadata is invalid';END IF;
  IF normalized_disposition='RETRYABLE' AND p_retry_delay_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'document scan retry delay is invalid';END IF;
  IF normalized_disposition='TERMINAL' AND COALESCE(p_retry_delay_seconds,0)<>0 THEN RAISE EXCEPTION 'terminal document scan cannot have a retry delay';END IF;
  IF p_trusted_object_key IS NOT NULL OR p_trusted_object_version IS NOT NULL THEN RAISE EXCEPTION 'failed document cannot have trusted identity';END IF;
 END IF;
 UPDATE public.payment_documents SET security_status=normalized_status,trusted_storage_object_key=CASE WHEN normalized_status='CLEAN' THEN p_trusted_object_key ELSE NULL END,trusted_storage_object_version=CASE WHEN normalized_status='CLEAN' THEN p_trusted_object_version ELSE NULL END,scan_completed_at=clock_timestamp(),scan_engine=p_scanner_engine,scan_reference=p_scan_reference,scan_failure_code=CASE WHEN normalized_status='SCAN_FAILED' THEN p_failure_code ELSE NULL END,scan_failure_disposition=CASE WHEN normalized_status='SCAN_FAILED' THEN normalized_disposition ELSE NULL END,scan_next_attempt_at=CASE WHEN normalized_status='SCAN_FAILED' AND normalized_disposition='RETRYABLE' THEN clock_timestamp()+make_interval(secs=>p_retry_delay_seconds) ELSE NULL END,scan_claim_token=NULL,scan_claimed_by=NULL,scan_claimed_at=NULL,scan_lease_expires_at=NULL,scan_claim_generation=NULL WHERE id=p_document_id;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata) VALUES(gen_random_uuid(),NULL,CASE normalized_status WHEN 'CLEAN' THEN 'DOCUMENT_MARKED_CLEAN' WHEN 'REJECTED' THEN 'DOCUMENT_REJECTED' ELSE CASE normalized_disposition WHEN 'TERMINAL' THEN 'DOCUMENT_SCAN_FAILED_TERMINAL' ELSE 'DOCUMENT_SCAN_FAILED' END END,'PAYMENT_REQUEST',doc.payment_request_id,COALESCE(doc.scan_correlation_id,gen_random_uuid())::text,jsonb_build_object('documentId',doc.id,'attempt',p_scan_attempt,'status',normalized_status,'failureDisposition',NULLIF(normalized_disposition,'')));
 RETURN normalized_status;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION protect_document_security_transition() OWNER TO aims_owner;
ALTER FUNCTION guard_payment_slip_write() OWNER TO aims_owner;
ALTER FUNCTION require_clean_payment_slip() OWNER TO aims_owner;
ALTER FUNCTION attach_payment_slip(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text) OWNER TO aims_owner;
ALTER FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid) OWNER TO aims_owner;
ALTER FUNCTION complete_payment_document_scan(uuid,integer,text,text,text,text,bigint,integer,uuid,text,text,integer,text,text,text,text,text) OWNER TO aims_owner;

REVOKE ALL ON FUNCTION attach_payment_slip(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text) FROM PUBLIC,aims_app,aims_finance_executor,aims_document_worker_executor;
GRANT EXECUTE ON FUNCTION attach_payment_slip(uuid,uuid,uuid,text,text,text,text,text,bigint,text,text) TO aims_payment_executor;
REVOKE ALL ON FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid),complete_payment_document_scan(uuid,integer,text,text,text,text,bigint,integer,uuid,text,text,integer,text,text,text,text,text) FROM PUBLIC,aims_app,aims_finance_executor,aims_payment_executor;
GRANT EXECUTE ON FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid),complete_payment_document_scan(uuid,integer,text,text,text,text,bigint,integer,uuid,text,text,integer,text,text,text,text,text) TO aims_document_worker_executor;
REVOKE UPDATE(storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key,trusted_storage_object_version) ON payment_documents FROM aims_app,aims_finance_executor,aims_payment_executor,aims_document_worker_executor;

UPDATE aims_schema_version SET version=61,migration_id='061_p13_storage_object_version_binding',applied_at=now() WHERE singleton=true AND version=60;
COMMIT;
