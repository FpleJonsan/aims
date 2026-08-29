BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM aims_schema_version
  WHERE singleton=true AND version=55 AND migration_id='055_p3_p4_document_security'
 ) THEN
  RAISE EXCEPTION 'migration 056 requires schema version 55 (055_p3_p4_document_security)';
 END IF;
END;
$$;

CREATE OR REPLACE FUNCTION guard_payment_slip_write() RETURNS trigger
SET search_path=pg_catalog,public AS $$
BEGIN
 IF COALESCE(NEW.document_type,OLD.document_type)='PAYMENT_SLIP' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment slip deletion is forbidden';END IF;
  PERFORM public.aims_authenticated_payment_actor();
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

CREATE OR REPLACE FUNCTION begin_payment_slip_security_scan(
 request_id uuid,document_id uuid,expected_version integer,expected_sha256 text
) RETURNS integer SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;pr public.payment_requests%ROWTYPE;doc public.payment_documents%ROWTYPE;attempt integer;
BEGIN
 actor:=public.aims_authenticated_payment_actor();
 SELECT * INTO pr FROM public.payment_requests WHERE id=request_id FOR UPDATE;
 IF NOT FOUND OR pr.status<>'READY_FOR_PAYMENT' THEN RAISE EXCEPTION 'READY_FOR_PAYMENT request required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_authorities a JOIN public.users u ON u.id=a.user_id AND u.active
  WHERE a.user_id=actor AND a.active AND(a.scope='ORGANIZATION' OR a.department_id=pr.department_id)
  AND(a.allow_self_payment OR actor<>pr.created_by)
  AND(a.minimum_amount_minor IS NULL OR (pr.amount*100)::bigint>=a.minimum_amount_minor)
  AND(a.maximum_amount_minor IS NULL OR (pr.amount*100)::bigint<=a.maximum_amount_minor))
 THEN RAISE EXCEPTION 'Payment Operator authority required' USING ERRCODE='42501';END IF;
 SELECT * INTO doc FROM public.payment_documents d WHERE d.id=document_id AND d.payment_request_id=request_id
  AND d.document_type='PAYMENT_SLIP' AND d.removed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'current payment slip required';END IF;
 IF doc.version<>expected_version OR doc.sha256<>lower(expected_sha256) THEN RAISE EXCEPTION 'payment slip scan identity mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.payment_documents newer WHERE newer.payment_request_id=request_id AND newer.document_type='PAYMENT_SLIP'
  AND newer.removed_at IS NULL AND(newer.uploaded_at,newer.id)>(doc.uploaded_at,doc.id)) THEN RAISE EXCEPTION 'stale payment slip scan denied';END IF;
 IF doc.security_status NOT IN('QUARANTINED','SCAN_FAILED') THEN RAISE EXCEPTION 'payment slip scan cannot start from %',doc.security_status;END IF;
 attempt:=doc.scan_attempt+1;
 UPDATE public.payment_documents SET security_status='SCANNING',scan_attempt=attempt,scan_started_at=now(),scan_completed_at=NULL,
  scan_engine=NULL,scan_reference=NULL,scan_failure_code=NULL WHERE id=document_id;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
 VALUES(gen_random_uuid(),actor,'PAYMENT_SLIP_SCAN_STARTED','PAYMENT_REQUEST',request_id,pr.status,pr.status,
  COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),jsonb_build_object('documentId',document_id,'attempt',attempt));
 RETURN attempt;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION complete_payment_slip_security_scan(
 request_id uuid,document_id uuid,expected_version integer,expected_sha256 text,expected_attempt integer,
 p_result_status text,p_scanner_engine text,p_scan_reference text,p_failure_code text
) RETURNS text SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;pr public.payment_requests%ROWTYPE;doc public.payment_documents%ROWTYPE;normalized_status text:=upper(p_result_status);
BEGIN
 actor:=public.aims_authenticated_payment_actor();
 SELECT * INTO pr FROM public.payment_requests WHERE id=request_id FOR UPDATE;
 IF NOT FOUND OR pr.status<>'READY_FOR_PAYMENT' THEN RAISE EXCEPTION 'READY_FOR_PAYMENT request required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_authorities a JOIN public.users u ON u.id=a.user_id AND u.active
  WHERE a.user_id=actor AND a.active AND(a.scope='ORGANIZATION' OR a.department_id=pr.department_id)
  AND(a.allow_self_payment OR actor<>pr.created_by)
  AND(a.minimum_amount_minor IS NULL OR (pr.amount*100)::bigint>=a.minimum_amount_minor)
  AND(a.maximum_amount_minor IS NULL OR (pr.amount*100)::bigint<=a.maximum_amount_minor))
 THEN RAISE EXCEPTION 'Payment Operator authority required' USING ERRCODE='42501';END IF;
 SELECT * INTO doc FROM public.payment_documents d WHERE d.id=document_id AND d.payment_request_id=request_id
  AND d.document_type='PAYMENT_SLIP' AND d.removed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'current payment slip required';END IF;
 IF doc.version<>expected_version OR doc.sha256<>lower(expected_sha256) OR doc.scan_attempt<>expected_attempt THEN RAISE EXCEPTION 'payment slip scan identity mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.payment_documents newer WHERE newer.payment_request_id=request_id AND newer.document_type='PAYMENT_SLIP'
  AND newer.removed_at IS NULL AND(newer.uploaded_at,newer.id)>(doc.uploaded_at,doc.id)) THEN RAISE EXCEPTION 'stale payment slip scan denied';END IF;
 IF doc.security_status<>'SCANNING' THEN RAISE EXCEPTION 'payment slip scan completion requires SCANNING';END IF;
 IF normalized_status NOT IN('CLEAN','REJECTED','SCAN_FAILED') THEN RAISE EXCEPTION 'invalid payment slip scan result';END IF;
 IF normalized_status IN('CLEAN','REJECTED') AND(
   p_scanner_engine IS NULL OR p_scanner_engine!~'^[A-Za-z0-9._:-]{1,80}$' OR p_scan_reference IS NULL OR length(p_scan_reference) NOT BETWEEN 1 AND 160 OR p_failure_code IS NOT NULL
  ) THEN RAISE EXCEPTION 'completed payment slip scan provenance is invalid';END IF;
 IF normalized_status='SCAN_FAILED' AND(p_failure_code IS NULL OR p_failure_code!~'^[A-Z0-9_]{1,80}$') THEN RAISE EXCEPTION 'payment slip scan failure code is invalid';END IF;
 UPDATE public.payment_documents SET security_status=normalized_status,scan_completed_at=now(),scan_engine=p_scanner_engine,
  scan_reference=p_scan_reference,scan_failure_code=CASE WHEN normalized_status='SCAN_FAILED' THEN p_failure_code ELSE NULL END WHERE id=document_id;
 INSERT INTO public.audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
 VALUES(gen_random_uuid(),actor,CASE normalized_status WHEN 'CLEAN' THEN 'PAYMENT_SLIP_MARKED_CLEAN' WHEN 'REJECTED' THEN 'PAYMENT_SLIP_REJECTED' ELSE 'PAYMENT_SLIP_SCAN_FAILED' END,
  'PAYMENT_REQUEST',request_id,pr.status,pr.status,COALESCE(NULLIF(current_setting('aims.correlation_id',true),''),gen_random_uuid()::text),
  jsonb_build_object('documentId',document_id,'attempt',expected_attempt,'status',normalized_status));
 RETURN normalized_status;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION begin_payment_slip_security_scan(uuid,uuid,integer,text) FROM PUBLIC,aims_app;
REVOKE ALL ON FUNCTION complete_payment_slip_security_scan(uuid,uuid,integer,text,integer,text,text,text,text) FROM PUBLIC,aims_app;
GRANT EXECUTE ON FUNCTION begin_payment_slip_security_scan(uuid,uuid,integer,text) TO aims_payment_executor;
GRANT EXECUTE ON FUNCTION complete_payment_slip_security_scan(uuid,uuid,integer,text,integer,text,text,text,text) TO aims_payment_executor;

CREATE OR REPLACE FUNCTION require_clean_payment_slip() RETURNS trigger AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.payment_documents d WHERE d.id=NEW.slip_document_id AND d.payment_request_id=NEW.payment_request_id
  AND d.document_type='PAYMENT_SLIP' AND d.removed_at IS NULL AND d.security_status='CLEAN'
  AND NOT EXISTS(SELECT 1 FROM public.payment_documents newer WHERE newer.payment_request_id=d.payment_request_id AND newer.document_type='PAYMENT_SLIP'
   AND newer.removed_at IS NULL AND(newer.uploaded_at,newer.id)>(d.uploaded_at,d.id)))
 THEN RAISE EXCEPTION 'CLEAN current payment slip required';END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE aims_schema_version SET version=56,migration_id='056_payment_slip_trust_transition',applied_at=now()
WHERE singleton=true AND version=55;

COMMIT;
