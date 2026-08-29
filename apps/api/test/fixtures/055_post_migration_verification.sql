\set ON_ERROR_STOP on

DO $$DECLARE legacy_count integer;clean_count integer;BEGIN
 SELECT count(*) INTO legacy_count FROM payment_documents WHERE security_status='UNVERIFIED' AND storage_provider IS NULL AND declared_mime_type IS NULL AND detected_mime_type IS NULL AND scan_attempt=0 AND scan_started_at IS NULL AND scan_completed_at IS NULL;
 SELECT count(*) INTO clean_count FROM payment_documents WHERE security_status='CLEAN';
 IF legacy_count<>4 OR clean_count<>0 THEN RAISE EXCEPTION 'legacy document trust initialization is unsafe';END IF;
END$$;

INSERT INTO payment_documents(
 id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,
 storage_provider,declared_mime_type,detected_mime_type,security_status
) VALUES(
 '30000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000005','new.pdf','quarantine/new/document','application/pdf',14,repeat('5',64),'INVOICE',1,'00000000-0000-4000-8000-000000000001',
 'LOCAL','application/pdf','application/pdf','QUARANTINED'
);
UPDATE payment_documents SET security_status='SCANNING',scan_attempt=1,scan_started_at=now()
WHERE id='30000000-0000-4000-8000-000000000005';
UPDATE payment_documents SET security_status='CLEAN',storage_object_key='active/new/document',scan_completed_at=now(),scan_engine='fixture-scanner',scan_reference='fixture-clean'
WHERE id='30000000-0000-4000-8000-000000000005';

DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM payment_documents WHERE id='30000000-0000-4000-8000-000000000005' AND security_status='CLEAN') THEN RAISE EXCEPTION 'future CLEAN lifecycle failed';END IF;
 BEGIN
  UPDATE payment_documents SET original_filename='forbidden.pdf' WHERE id='30000000-0000-4000-8000-000000000004';
  RAISE EXCEPTION 'PAID metadata mutation was allowed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'documents for PAID requests are immutable' THEN RAISE;END IF;
 END;
 BEGIN
  DELETE FROM payment_documents WHERE id='30000000-0000-4000-8000-000000000004';
  RAISE EXCEPTION 'PAID document deletion was allowed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'documents for PAID requests are immutable' THEN RAISE;END IF;
 END;
 BEGIN
  INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,version,uploaded_by)
  VALUES(gen_random_uuid(),'10000000-0000-4000-8000-000000000004',gen_random_uuid(),'replacement.pdf','quarantine/forbidden/replacement','application/pdf',10,repeat('6',64),1,'00000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'PAID replacement was allowed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'documents for PAID requests are immutable' THEN RAISE;END IF;
 END;
END$$;

SELECT version,migration_id FROM aims_schema_version WHERE singleton=true;
SELECT id,payment_request_id,sha256,storage_object_key,original_filename,mime_type,security_status,storage_provider,declared_mime_type,detected_mime_type
FROM payment_documents WHERE id='30000000-0000-4000-8000-000000000004';

