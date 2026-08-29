BEGIN;

ALTER TABLE payment_documents
  ADD COLUMN storage_provider varchar(32),
  ADD COLUMN declared_mime_type varchar(127),
  ADD COLUMN detected_mime_type varchar(127),
  ADD COLUMN security_status varchar(24) NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN scan_attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN scan_started_at timestamptz,
  ADD COLUMN scan_completed_at timestamptz,
  ADD COLUMN scan_engine varchar(80),
  ADD COLUMN scan_reference varchar(160),
  ADD COLUMN scan_failure_code varchar(80),
  ADD CONSTRAINT payment_documents_storage_provider_check
    CHECK(storage_provider IS NULL OR storage_provider IN('LOCAL','OBJECT')),
  ADD CONSTRAINT payment_documents_security_status_check
    CHECK(security_status IN('UNVERIFIED','QUARANTINED','SCANNING','CLEAN','REJECTED','SCAN_FAILED')),
  ADD CONSTRAINT payment_documents_scan_attempt_check CHECK(scan_attempt>=0),
  ADD CONSTRAINT payment_documents_scan_metadata_check CHECK(
    (security_status='UNVERIFIED' AND scan_attempt=0 AND scan_started_at IS NULL AND scan_completed_at IS NULL AND scan_engine IS NULL AND scan_reference IS NULL AND scan_failure_code IS NULL)
    OR (security_status='QUARANTINED' AND scan_attempt=0 AND scan_started_at IS NULL AND scan_completed_at IS NULL AND scan_engine IS NULL AND scan_reference IS NULL AND scan_failure_code IS NULL AND storage_provider IS NOT NULL AND declared_mime_type IS NOT NULL AND detected_mime_type IS NOT NULL)
    OR (security_status='SCANNING' AND scan_attempt>0 AND scan_started_at IS NOT NULL AND scan_completed_at IS NULL AND scan_engine IS NULL AND scan_reference IS NULL AND scan_failure_code IS NULL AND storage_provider IS NOT NULL AND declared_mime_type IS NOT NULL AND detected_mime_type IS NOT NULL)
    OR (security_status IN('CLEAN','REJECTED') AND scan_attempt>0 AND scan_started_at IS NOT NULL AND scan_completed_at IS NOT NULL AND scan_engine IS NOT NULL AND scan_reference IS NOT NULL AND scan_failure_code IS NULL AND storage_provider IS NOT NULL AND declared_mime_type IS NOT NULL AND detected_mime_type IS NOT NULL)
    OR (security_status='SCAN_FAILED' AND scan_attempt>0 AND scan_started_at IS NOT NULL AND scan_completed_at IS NOT NULL AND scan_failure_code IS NOT NULL AND storage_provider IS NOT NULL AND declared_mime_type IS NOT NULL AND detected_mime_type IS NOT NULL)
  );

COMMENT ON COLUMN payment_documents.security_status IS
  'Only CLEAN rows are eligible for authoritative evidence. Pre-055 rows are additive-DDL initialized as UNVERIFIED without fabricated MIME or scan provenance.';

CREATE INDEX payment_documents_clean_request_idx
  ON payment_documents(payment_request_id,uploaded_at)
  WHERE removed_at IS NULL AND security_status='CLEAN';

CREATE OR REPLACE FUNCTION protect_document_security_transition() RETURNS trigger AS $$
BEGIN
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
  ) THEN RAISE EXCEPTION 'scan metadata may change only with a security transition';END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_documents_security_transition
BEFORE UPDATE ON payment_documents
FOR EACH ROW EXECUTE FUNCTION protect_document_security_transition();

CREATE OR REPLACE FUNCTION attach_payment_slip(request_id uuid,document_id uuid,logical_id uuid,filename text,object_key text,mime text,size_bytes bigint,sha text) RETURNS uuid
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;DECLARE pr public.payment_requests%ROWTYPE;BEGIN
 actor:=public.aims_authenticated_payment_actor();SELECT * INTO pr FROM public.payment_requests WHERE id=request_id FOR UPDATE;
 IF NOT FOUND OR pr.status<>'READY_FOR_PAYMENT' THEN RAISE EXCEPTION 'READY_FOR_PAYMENT request required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.payment_authorities a WHERE a.user_id=actor AND a.active AND(a.scope='ORGANIZATION' OR a.department_id=pr.department_id)AND(a.allow_self_payment OR actor<>pr.created_by)AND(a.minimum_amount_minor IS NULL OR (pr.amount*100)::bigint>=a.minimum_amount_minor)AND(a.maximum_amount_minor IS NULL OR (pr.amount*100)::bigint<=a.maximum_amount_minor)) THEN RAISE EXCEPTION 'Payment Operator authority required' USING ERRCODE='42501';END IF;
 INSERT INTO public.payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status)
 VALUES(document_id,request_id,logical_id,filename,object_key,mime,size_bytes,sha,'PAYMENT_SLIP',1,actor,'LOCAL',mime,mime,'QUARANTINED');
 RETURN document_id;END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION attach_payment_slip(uuid,uuid,uuid,text,text,text,bigint,text) FROM PUBLIC,aims_app;
GRANT EXECUTE ON FUNCTION attach_payment_slip(uuid,uuid,uuid,text,text,text,bigint,text) TO aims_payment_executor;

CREATE OR REPLACE FUNCTION require_clean_payment_slip() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM payment_documents d
    WHERE d.id=NEW.slip_document_id AND d.payment_request_id=NEW.payment_request_id
      AND d.document_type='PAYMENT_SLIP' AND d.removed_at IS NULL AND d.security_status='CLEAN'
  ) THEN RAISE EXCEPTION 'CLEAN current payment slip required';END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_require_clean_slip
BEFORE INSERT ON payments
FOR EACH ROW EXECUTE FUNCTION require_clean_payment_slip();

REVOKE UPDATE ON payment_documents FROM aims_app;
GRANT UPDATE(removed_at,security_status,storage_object_key,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference,scan_failure_code) ON payment_documents TO aims_app;

UPDATE aims_schema_version
SET version=55,migration_id='055_p3_p4_document_security',applied_at=now()
WHERE singleton=true AND version=54;

COMMIT;
