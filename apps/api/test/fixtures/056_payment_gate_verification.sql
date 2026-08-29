\set ON_ERROR_STOP on

DO $$
DECLARE
 denied_states uuid[] := ARRAY[
  '31000000-0000-4000-8000-000000000001'::uuid,
  '31000000-0000-4000-8000-000000000002'::uuid,
  '31000000-0000-4000-8000-000000000004'::uuid,
  '31000000-0000-4000-8000-000000000005'::uuid,
  '31000000-0000-4000-8000-000000000006'::uuid
 ];
 document_id uuid;
 request_id uuid;
BEGIN
 FOREACH document_id IN ARRAY denied_states LOOP
  SELECT payment_request_id INTO request_id FROM payment_documents WHERE id=document_id;
  BEGIN
   INSERT INTO payments(id,payment_request_id,slip_document_id)
   VALUES(gen_random_uuid(),request_id,document_id);
   RAISE EXCEPTION 'payment gate unexpectedly accepted document %',document_id;
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM LIKE 'payment gate unexpectedly accepted%' THEN RAISE;END IF;
   IF SQLERRM NOT LIKE '%CLEAN current payment slip required%' THEN RAISE;END IF;
  END;
 END LOOP;

 INSERT INTO payments(id,payment_request_id,slip_document_id)
 VALUES(gen_random_uuid(),'11000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000003');
END;
$$;

DO $$
DECLARE before_row payment_documents%ROWTYPE;after_row payment_documents%ROWTYPE;
BEGIN
 SELECT * INTO before_row FROM payment_documents WHERE id='31000000-0000-4000-8000-000000000008';
 BEGIN
  UPDATE payment_documents SET security_status='SCANNING'
  WHERE id='31000000-0000-4000-8000-000000000008';
  RAISE EXCEPTION 'PAID evidence mutation unexpectedly succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='PAID evidence mutation unexpectedly succeeded' THEN RAISE;END IF;
  IF SQLERRM NOT LIKE '%documents for PAID requests are immutable%' THEN RAISE;END IF;
 END;
 SELECT * INTO after_row FROM payment_documents WHERE id='31000000-0000-4000-8000-000000000008';
 IF before_row IS DISTINCT FROM after_row THEN RAISE EXCEPTION 'PAID evidence changed';END IF;

 BEGIN
  DELETE FROM payment_documents WHERE id='31000000-0000-4000-8000-000000000008';
  RAISE EXCEPTION 'PAID evidence delete unexpectedly succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='PAID evidence delete unexpectedly succeeded' THEN RAISE;END IF;
  IF SQLERRM NOT LIKE '%documents for PAID requests are immutable%' THEN RAISE;END IF;
 END;

 BEGIN
  INSERT INTO payment_documents(
   id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,
   size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,
   detected_mime_type,security_status
  ) VALUES(
   gen_random_uuid(),'11000000-0000-4000-8000-000000000007',gen_random_uuid(),'replacement.pdf',
   'quarantine/slip/paid-replacement','application/pdf',10,repeat('9',64),'PAYMENT_SLIP',2,
   '00000000-0000-4000-8000-000000000002','LOCAL','application/pdf','application/pdf','QUARANTINED'
  );
  RAISE EXCEPTION 'PAID evidence replacement unexpectedly succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='PAID evidence replacement unexpectedly succeeded' THEN RAISE;END IF;
  IF SQLERRM NOT LIKE '%documents for PAID requests are immutable%' THEN RAISE;END IF;
 END;
END;
$$;

SELECT 'MIGRATION_056_PAYMENT_GATE_PROOF: PASS' AS result;
