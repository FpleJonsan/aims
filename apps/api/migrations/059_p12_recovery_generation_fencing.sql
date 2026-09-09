BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM aims_schema_version
  WHERE singleton=true AND version=58 AND migration_id='058_p10_observability_claim_recovery_and_outbox_index'
 ) THEN
  RAISE EXCEPTION 'migration 059 requires schema version 58 (058_p10_observability_claim_recovery_and_outbox_index)';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aims_migrator') THEN
  RAISE EXCEPTION 'migration 059 requires the P6 aims_migrator role';
 END IF;
END;
$$;

CREATE TABLE aims_recovery_generation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 generation uuid NOT NULL UNIQUE,
 generation_sequence bigint NOT NULL UNIQUE CHECK(generation_sequence>0),
 advanced_at timestamptz NOT NULL,
 reason varchar(160) NOT NULL CHECK(reason~'^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,159}$'),
 correlation_id uuid NOT NULL
);

CREATE TABLE aims_recovery_generation_events (
 generation_sequence bigint PRIMARY KEY CHECK(generation_sequence>0),
 generation uuid NOT NULL UNIQUE,
 advanced_at timestamptz NOT NULL,
 reason varchar(160) NOT NULL CHECK(reason~'^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,159}$'),
 correlation_id uuid NOT NULL UNIQUE
);

WITH initial AS(SELECT gen_random_uuid() generation,gen_random_uuid() correlation_id,clock_timestamp() advanced_at)
INSERT INTO aims_recovery_generation(singleton,generation,generation_sequence,advanced_at,reason,correlation_id)
SELECT true,generation,1,advanced_at,'MIGRATION_059_INITIAL_GENERATION',correlation_id FROM initial;
INSERT INTO aims_recovery_generation_events
SELECT generation_sequence,generation,advanced_at,reason,correlation_id FROM aims_recovery_generation;

CREATE TRIGGER aims_recovery_generation_events_append_only
BEFORE UPDATE OR DELETE ON aims_recovery_generation_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

ALTER TABLE aims_sessions ADD COLUMN issued_generation uuid;
ALTER TABLE approval_action_tokens ADD COLUMN issued_generation uuid;
ALTER TABLE telegram_pending_interactions ADD COLUMN issued_generation uuid;
ALTER TABLE notification_outbox ADD COLUMN claim_generation uuid;
ALTER TABLE payment_documents ADD COLUMN scan_claim_generation uuid;

UPDATE aims_sessions SET issued_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton);
UPDATE approval_action_tokens SET issued_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton);
UPDATE telegram_pending_interactions SET issued_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton);

-- Deployment establishes a safe baseline without pretending that deployment is
-- a recovery incident: all pre-059 ephemeral authority is invalidated.
UPDATE aims_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE revoked_at IS NULL;
UPDATE approval_action_tokens SET status='REVOKED' WHERE status='ACTIVE';
UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE status='PENDING';
UPDATE notification_outbox SET status='FAILED_RETRYABLE',next_attempt_at=clock_timestamp(),
 claimed_at=NULL,claim_token=NULL,claimed_by=NULL,last_error_code='RECOVERY_GENERATION_ADVANCED'
 WHERE status='PROCESSING';
UPDATE payment_documents SET scan_claim_token=NULL,scan_claimed_by=NULL,scan_claimed_at=NULL,
 scan_lease_expires_at=NULL,scan_claim_generation=NULL
 WHERE scan_claim_token IS NOT NULL AND document_type<>'PAYMENT_SLIP';

ALTER TABLE aims_sessions ALTER COLUMN issued_generation SET NOT NULL;
ALTER TABLE approval_action_tokens ALTER COLUMN issued_generation SET NOT NULL;
ALTER TABLE telegram_pending_interactions ALTER COLUMN issued_generation SET NOT NULL;

ALTER TABLE payment_documents DROP CONSTRAINT payment_documents_scan_claim_coherence_check;
ALTER TABLE payment_documents ADD CONSTRAINT payment_documents_scan_claim_coherence_check CHECK(
 (scan_claim_token IS NULL AND scan_claimed_by IS NULL AND scan_claimed_at IS NULL AND scan_lease_expires_at IS NULL AND scan_claim_generation IS NULL)
 OR
 (scan_claim_token IS NOT NULL AND scan_claimed_by IS NOT NULL AND scan_claimed_at IS NOT NULL
  AND scan_lease_expires_at IS NOT NULL AND scan_claim_generation IS NOT NULL
  AND scan_lease_expires_at>scan_claimed_at AND security_status='SCANNING')
);
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_claim_generation_check CHECK(
 (claim_token IS NULL AND claim_generation IS NULL) OR (claim_token IS NOT NULL AND claim_generation IS NOT NULL)
);

CREATE FUNCTION bind_recovery_generation() RETURNS trigger
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_generation uuid;
BEGIN
 SELECT generation INTO STRICT current_generation FROM public.aims_recovery_generation WHERE singleton FOR SHARE;
 IF TG_OP='INSERT' THEN
  NEW.issued_generation:=current_generation;
 ELSIF OLD.issued_generation IS DISTINCT FROM current_generation
       AND NOT(current_user='aims_owner' AND current_setting('aims.recovery_advance',true)='true') THEN
  RAISE EXCEPTION 'stale recovery generation authority' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER aims_sessions_recovery_generation
BEFORE INSERT OR UPDATE ON aims_sessions FOR EACH ROW EXECUTE FUNCTION bind_recovery_generation();
CREATE TRIGGER approval_action_tokens_recovery_generation
BEFORE INSERT OR UPDATE ON approval_action_tokens FOR EACH ROW EXECUTE FUNCTION bind_recovery_generation();
CREATE TRIGGER telegram_pending_interactions_recovery_generation
BEFORE INSERT OR UPDATE ON telegram_pending_interactions FOR EACH ROW EXECUTE FUNCTION bind_recovery_generation();

CREATE FUNCTION fence_notification_outbox_claim() RETURNS trigger
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE current_generation uuid;
BEGIN
 SELECT generation INTO STRICT current_generation FROM public.aims_recovery_generation WHERE singleton FOR SHARE;
 IF NEW.claim_token IS NOT NULL AND OLD.claim_token IS NULL THEN
  NEW.claim_generation:=current_generation;
 ELSIF OLD.claim_token IS NOT NULL AND OLD.claim_generation IS DISTINCT FROM current_generation
       AND NOT(current_user='aims_owner' AND current_setting('aims.recovery_advance',true)='true') THEN
  RAISE EXCEPTION 'stale outbox recovery generation claim' USING ERRCODE='40001';
 ELSIF NEW.claim_token IS NULL THEN
  NEW.claim_generation:=NULL;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER notification_outbox_recovery_generation
BEFORE UPDATE ON notification_outbox FOR EACH ROW EXECUTE FUNCTION fence_notification_outbox_claim();

CREATE OR REPLACE FUNCTION guard_payment_slip_write() RETURNS trigger
SET search_path=pg_catalog,public AS $$
DECLARE
 trusted_worker boolean:=current_user<>session_user AND pg_has_role(session_user,'aims_document_worker_executor','MEMBER');
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
      OR OLD.declared_mime_type IS DISTINCT FROM NEW.declared_mime_type OR OLD.detected_mime_type IS DISTINCT FROM NEW.detected_mime_type THEN
    RAISE EXCEPTION 'payment slip business evidence is immutable';
   END IF;
  END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);
END;
$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_payment_slip_write() FROM PUBLIC;
SELECT set_config('aims.recovery_advance','true',true);
UPDATE payment_documents SET scan_claim_token=NULL,scan_claimed_by=NULL,scan_claimed_at=NULL,
 scan_lease_expires_at=NULL,scan_claim_generation=NULL
 WHERE scan_claim_token IS NOT NULL AND document_type='PAYMENT_SLIP';

CREATE FUNCTION advance_aims_recovery_generation(p_reason text,p_correlation_id uuid)
RETURNS TABLE(generation uuid,generation_sequence bigint,advanced_at timestamptz)
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE next_generation uuid:=gen_random_uuid();next_sequence bigint;advanced timestamptz:=clock_timestamp();
BEGIN
 IF p_reason IS NULL OR p_reason!~'^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,159}$' THEN RAISE EXCEPTION 'bounded recovery reason is required';END IF;
 IF p_correlation_id IS NULL THEN RAISE EXCEPTION 'recovery correlation is required';END IF;
 IF EXISTS(SELECT 1 FROM public.aims_recovery_generation_events WHERE correlation_id=p_correlation_id) THEN
  RAISE EXCEPTION 'recovery correlation was already used';
 END IF;
 PERFORM set_config('aims.recovery_advance','true',true);
 PERFORM pg_advisory_xact_lock(hashtext('aims:recovery-generation'));
 SELECT g.generation_sequence+1 INTO STRICT next_sequence FROM public.aims_recovery_generation g WHERE singleton FOR UPDATE;

 UPDATE public.aims_sessions SET revoked_at=COALESCE(revoked_at,advanced) WHERE revoked_at IS NULL;
 UPDATE public.approval_action_tokens SET status='REVOKED' WHERE status='ACTIVE';
 UPDATE public.telegram_pending_interactions SET status='CANCELLED' WHERE status='PENDING';
 UPDATE public.notification_outbox SET status='FAILED_RETRYABLE',next_attempt_at=advanced,
  claimed_at=NULL,claim_token=NULL,claimed_by=NULL,last_error_code='RECOVERY_GENERATION_ADVANCED'
  WHERE status='PROCESSING';
 UPDATE public.payment_documents SET scan_claim_token=NULL,scan_claimed_by=NULL,scan_claimed_at=NULL,
  scan_lease_expires_at=NULL,scan_claim_generation=NULL WHERE scan_claim_token IS NOT NULL;

 UPDATE public.aims_recovery_generation SET generation=next_generation,generation_sequence=next_sequence,
  advanced_at=advanced,reason=p_reason,correlation_id=p_correlation_id WHERE singleton;
 INSERT INTO public.aims_recovery_generation_events VALUES(next_sequence,next_generation,advanced,p_reason,p_correlation_id);
 RETURN QUERY SELECT next_generation,next_sequence,advanced;
END;
$$ LANGUAGE plpgsql;

-- Restore the document-worker capability with generation as an additional,
-- transactionally locked claim/finalization fence.
DROP FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid);
CREATE FUNCTION claim_next_payment_document_scan(
 p_worker_id text,p_lease_seconds integer,p_max_attempts integer,p_correlation_id uuid
) RETURNS TABLE(
 document_id uuid,payment_request_id uuid,document_version integer,document_sha256 text,
 document_type text,storage_provider text,storage_object_key text,detected_mime_type text,scan_attempt integer,
 claim_token uuid,lease_expires_at timestamptz,correlation_id uuid,expired_lease_recovered boolean
) SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE doc public.payment_documents%ROWTYPE;new_token uuid:=gen_random_uuid();now_at timestamptz:=clock_timestamp();
 recovered boolean:=false;current_generation uuid;
BEGIN
 SELECT generation INTO STRICT current_generation FROM public.aims_recovery_generation WHERE singleton FOR SHARE;
 IF p_worker_id IS NULL OR p_worker_id!~'^[A-Za-z0-9._:-]{1,128}$' THEN RAISE EXCEPTION 'invalid document worker identity';END IF;
 IF p_lease_seconds NOT BETWEEN 5 AND 3600 THEN RAISE EXCEPTION 'document scan lease must be between 5 and 3600 seconds';END IF;
 IF p_max_attempts NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'document scan maximum attempts must be between 1 and 20';END IF;
 IF p_correlation_id IS NULL THEN RAISE EXCEPTION 'document scan correlation is required';END IF;
 UPDATE public.payment_documents d SET security_status='SCAN_FAILED',scan_completed_at=now_at,scan_failure_code='MAX_ATTEMPTS_EXHAUSTED',
  scan_failure_disposition='TERMINAL',scan_next_attempt_at=NULL,scan_claim_token=NULL,scan_claimed_by=NULL,scan_claimed_at=NULL,
  scan_lease_expires_at=NULL,scan_claim_generation=NULL
 WHERE d.removed_at IS NULL AND d.security_status='SCANNING' AND d.scan_attempt>=p_max_attempts
  AND ((d.scan_lease_expires_at IS NOT NULL AND d.scan_lease_expires_at<=now_at) OR(d.scan_claim_token IS NULL AND(d.scan_claim_generation IS NULL OR d.scan_started_at<=now_at-make_interval(secs=>p_lease_seconds))));
 SELECT * INTO doc FROM public.payment_documents d WHERE d.removed_at IS NULL AND d.security_status<>'UNVERIFIED' AND d.scan_attempt<p_max_attempts AND(
  d.security_status='QUARANTINED' OR(d.security_status='SCAN_FAILED' AND d.scan_failure_disposition='RETRYABLE' AND d.scan_next_attempt_at<=now_at)
  OR(d.security_status='SCANNING' AND((d.scan_lease_expires_at IS NOT NULL AND d.scan_lease_expires_at<=now_at) OR(d.scan_claim_token IS NULL AND(d.scan_claim_generation IS NULL OR d.scan_started_at<=now_at-make_interval(secs=>p_lease_seconds))))))
 ORDER BY COALESCE(d.scan_next_attempt_at,d.scan_lease_expires_at,d.uploaded_at),d.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;
 recovered:=doc.security_status='SCANNING' AND((doc.scan_lease_expires_at IS NOT NULL AND doc.scan_lease_expires_at<=now_at) OR(doc.scan_claim_token IS NULL AND(doc.scan_claim_generation IS NULL OR doc.scan_started_at<=now_at-make_interval(secs=>p_lease_seconds))));
 UPDATE public.payment_documents d SET security_status='SCANNING',scan_attempt=doc.scan_attempt+1,scan_started_at=now_at,scan_completed_at=NULL,
  scan_engine=NULL,scan_reference=NULL,scan_failure_code=NULL,scan_claim_token=new_token,scan_claimed_by=p_worker_id,scan_claimed_at=now_at,
  scan_lease_expires_at=now_at+make_interval(secs=>p_lease_seconds),scan_next_attempt_at=NULL,scan_failure_disposition=NULL,
  scan_correlation_id=p_correlation_id,scan_claim_generation=current_generation WHERE d.id=doc.id;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
 VALUES(gen_random_uuid(),NULL,'DOCUMENT_SCAN_WORKER_CLAIMED','PAYMENT_REQUEST',doc.payment_request_id,p_correlation_id::text,jsonb_build_object('documentId',doc.id,'attempt',doc.scan_attempt+1,'workerId',p_worker_id));
 RETURN QUERY SELECT doc.id,doc.payment_request_id,doc.version,doc.sha256::text,doc.document_type::text,doc.storage_provider::text,doc.storage_object_key::text,
  doc.detected_mime_type::text,doc.scan_attempt+1,new_token,now_at+make_interval(secs=>p_lease_seconds),p_correlation_id,recovered;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION complete_payment_document_scan(
 p_document_id uuid,p_document_version integer,p_sha256 text,p_scan_attempt integer,p_claim_token uuid,
 p_result_status text,p_failure_disposition text,p_retry_delay_seconds integer,
 p_scanner_engine text,p_scan_reference text,p_failure_code text,p_active_object_key text
) RETURNS text SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE doc public.payment_documents%ROWTYPE;normalized_status text:=upper(p_result_status);normalized_disposition text:=upper(COALESCE(p_failure_disposition,''));current_generation uuid;
BEGIN
 SELECT generation INTO STRICT current_generation FROM public.aims_recovery_generation WHERE singleton FOR SHARE;
 SELECT * INTO doc FROM public.payment_documents d WHERE d.id=p_document_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'document scan work no longer exists';END IF;
 IF doc.version<>p_document_version OR doc.sha256<>lower(p_sha256) THEN RAISE EXCEPTION 'document scan identity mismatch';END IF;
 IF doc.scan_attempt<>p_scan_attempt THEN RAISE EXCEPTION 'document scan attempt is stale';END IF;
 IF doc.security_status<>'SCANNING' OR doc.scan_claim_token IS DISTINCT FROM p_claim_token OR doc.scan_claimed_by IS NULL
    OR doc.scan_claim_generation IS DISTINCT FROM current_generation THEN RAISE EXCEPTION 'document scan claim is stale' USING ERRCODE='40001';END IF;
 IF normalized_status NOT IN('CLEAN','REJECTED','SCAN_FAILED') THEN RAISE EXCEPTION 'invalid document scan result';END IF;
 IF normalized_status IN('CLEAN','REJECTED') THEN
  IF normalized_disposition<>'' OR p_failure_code IS NOT NULL OR p_scanner_engine IS NULL OR p_scanner_engine!~'^[A-Za-z0-9._:-]{1,80}$'
    OR p_scan_reference IS NULL OR length(p_scan_reference) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'completed document scan provenance is invalid';END IF;
  IF normalized_status='CLEAN' AND doc.document_type<>'PAYMENT_SLIP' AND(p_active_object_key IS NULL OR p_active_object_key NOT LIKE 'active/%') THEN RAISE EXCEPTION 'clean document promotion key is required';END IF;
 ELSE
  IF normalized_disposition NOT IN('RETRYABLE','TERMINAL') OR p_failure_code IS NULL OR p_failure_code!~'^[A-Z0-9_]{1,80}$' THEN RAISE EXCEPTION 'document scan failure metadata is invalid';END IF;
  IF normalized_disposition='RETRYABLE' AND p_retry_delay_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'document scan retry delay is invalid';END IF;
  IF normalized_disposition='TERMINAL' AND COALESCE(p_retry_delay_seconds,0)<>0 THEN RAISE EXCEPTION 'terminal document scan cannot have a retry delay';END IF;
 END IF;
 UPDATE public.payment_documents SET security_status=normalized_status,
  storage_object_key=CASE WHEN normalized_status='CLEAN' AND document_type<>'PAYMENT_SLIP' THEN p_active_object_key ELSE storage_object_key END,
  scan_completed_at=clock_timestamp(),scan_engine=p_scanner_engine,scan_reference=p_scan_reference,
  scan_failure_code=CASE WHEN normalized_status='SCAN_FAILED' THEN p_failure_code ELSE NULL END,
  scan_failure_disposition=CASE WHEN normalized_status='SCAN_FAILED' THEN normalized_disposition ELSE NULL END,
  scan_next_attempt_at=CASE WHEN normalized_status='SCAN_FAILED' AND normalized_disposition='RETRYABLE' THEN clock_timestamp()+make_interval(secs=>p_retry_delay_seconds) ELSE NULL END,
  scan_claim_token=NULL,scan_claimed_by=NULL,scan_claimed_at=NULL,scan_lease_expires_at=NULL,scan_claim_generation=NULL WHERE id=p_document_id;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
 VALUES(gen_random_uuid(),NULL,CASE normalized_status WHEN 'CLEAN' THEN 'DOCUMENT_MARKED_CLEAN' WHEN 'REJECTED' THEN 'DOCUMENT_REJECTED' ELSE CASE normalized_disposition WHEN 'TERMINAL' THEN 'DOCUMENT_SCAN_FAILED_TERMINAL' ELSE 'DOCUMENT_SCAN_FAILED' END END,
  'PAYMENT_REQUEST',doc.payment_request_id,COALESCE(doc.scan_correlation_id,gen_random_uuid())::text,jsonb_build_object('documentId',doc.id,'attempt',p_scan_attempt,'status',normalized_status,'failureDisposition',NULLIF(normalized_disposition,'')));
 RETURN normalized_status;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE aims_recovery_generation OWNER TO aims_owner;
ALTER TABLE aims_recovery_generation_events OWNER TO aims_owner;
ALTER FUNCTION bind_recovery_generation() OWNER TO aims_owner;
ALTER FUNCTION fence_notification_outbox_claim() OWNER TO aims_owner;
ALTER FUNCTION guard_payment_slip_write() OWNER TO aims_owner;
ALTER FUNCTION advance_aims_recovery_generation(text,uuid) OWNER TO aims_owner;
ALTER FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid) OWNER TO aims_owner;
ALTER FUNCTION complete_payment_document_scan(uuid,integer,text,integer,uuid,text,text,integer,text,text,text,text) OWNER TO aims_owner;

REVOKE ALL ON TABLE aims_recovery_generation,aims_recovery_generation_events FROM PUBLIC;
GRANT SELECT ON TABLE aims_recovery_generation TO aims_app;
GRANT SELECT ON TABLE aims_recovery_generation_events TO aims_migrator;
REVOKE ALL ON FUNCTION bind_recovery_generation(),fence_notification_outbox_claim(),advance_aims_recovery_generation(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION advance_aims_recovery_generation(text,uuid) FROM aims_app,aims_finance_executor,aims_payment_executor,aims_document_worker_executor;
GRANT EXECUTE ON FUNCTION advance_aims_recovery_generation(text,uuid) TO aims_migrator;
REVOKE ALL ON FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid),complete_payment_document_scan(uuid,integer,text,integer,uuid,text,text,integer,text,text,text,text) FROM PUBLIC,aims_app,aims_finance_executor,aims_payment_executor;
GRANT EXECUTE ON FUNCTION claim_next_payment_document_scan(text,integer,integer,uuid),complete_payment_document_scan(uuid,integer,text,integer,uuid,text,text,integer,text,text,text,text) TO aims_document_worker_executor;

UPDATE aims_schema_version SET version=59,migration_id='059_p12_recovery_generation_fencing',applied_at=now()
WHERE singleton=true AND version=58;

COMMIT;
