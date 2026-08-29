\set ON_ERROR_STOP on

DROP TRIGGER payment_documents_payment_slip_guard ON payment_documents;

CREATE TABLE audit_events(
 id uuid PRIMARY KEY,actor_id uuid REFERENCES users(id),action varchar(80) NOT NULL,entity_type varchar(80) NOT NULL,
 entity_id uuid NOT NULL,previous_state varchar(24),new_state varchar(24),occurred_at timestamptz NOT NULL DEFAULT now(),
 correlation_id varchar(128) NOT NULL,safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION aims_authenticated_payment_actor() RETURNS uuid SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;BEGIN
 IF NOT pg_has_role(session_user,'aims_payment_executor','MEMBER') THEN RAISE EXCEPTION 'trusted Payment executor is required' USING ERRCODE='42501';END IF;
 BEGIN actor:=current_setting('aims.user_id',true)::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'authenticated Payment identity required' USING ERRCODE='42501';END;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND active) THEN RAISE EXCEPTION 'active authenticated Payment identity required' USING ERRCODE='42501';END IF;
 RETURN actor;END;$$ LANGUAGE plpgsql STABLE;
REVOKE ALL ON FUNCTION aims_authenticated_payment_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aims_authenticated_payment_actor() TO aims_payment_executor;

INSERT INTO payment_authorities(user_id,active,scope,department_id,allow_self_payment,minimum_amount_minor,maximum_amount_minor)
VALUES('00000000-0000-4000-8000-000000000002',true,'ORGANIZATION',NULL,true,NULL,NULL);

INSERT INTO payment_requests(id,status,department_id,created_by,amount,row_version) VALUES
 ('11000000-0000-4000-8000-000000000001','READY_FOR_PAYMENT','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',10,1),
 ('11000000-0000-4000-8000-000000000002','READY_FOR_PAYMENT','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',20,1),
 ('11000000-0000-4000-8000-000000000003','READY_FOR_PAYMENT','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',30,1),
 ('11000000-0000-4000-8000-000000000004','READY_FOR_PAYMENT','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',40,1),
 ('11000000-0000-4000-8000-000000000005','READY_FOR_PAYMENT','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',50,1),
 ('11000000-0000-4000-8000-000000000006','READY_FOR_PAYMENT','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',60,1),
 ('11000000-0000-4000-8000-000000000007','READY_FOR_PAYMENT','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',70,1);

INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference,scan_failure_code) VALUES
 ('31000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','q.pdf','quarantine/slip/q','application/pdf',10,repeat('1',64),'PAYMENT_SLIP',1,'00000000-0000-4000-8000-000000000002','LOCAL','application/pdf','application/pdf','QUARANTINED',0,NULL,NULL,NULL,NULL,NULL),
 ('31000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002','s.pdf','quarantine/slip/s','application/pdf',10,repeat('2',64),'PAYMENT_SLIP',1,'00000000-0000-4000-8000-000000000002','LOCAL','application/pdf','application/pdf','SCANNING',1,now(),NULL,NULL,NULL,NULL),
 ('31000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000003','c.pdf','quarantine/slip/c','application/pdf',10,repeat('3',64),'PAYMENT_SLIP',1,'00000000-0000-4000-8000-000000000002','LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'fixture-scanner','clean-3',NULL),
 ('31000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000004','41000000-0000-4000-8000-000000000004','r.pdf','quarantine/slip/r','application/pdf',10,repeat('4',64),'PAYMENT_SLIP',1,'00000000-0000-4000-8000-000000000002','LOCAL','application/pdf','application/pdf','REJECTED',1,now(),now(),'fixture-scanner','reject-4',NULL),
 ('31000000-0000-4000-8000-000000000005','11000000-0000-4000-8000-000000000005','41000000-0000-4000-8000-000000000005','f.pdf','quarantine/slip/f','application/pdf',10,repeat('5',64),'PAYMENT_SLIP',1,'00000000-0000-4000-8000-000000000002','LOCAL','application/pdf','application/pdf','SCAN_FAILED',1,now(),now(),NULL,NULL,'SCANNER_UNAVAILABLE'),
 ('31000000-0000-4000-8000-000000000006','11000000-0000-4000-8000-000000000006','41000000-0000-4000-8000-000000000006','old.pdf','quarantine/slip/old','application/pdf',10,repeat('6',64),'PAYMENT_SLIP',1,'00000000-0000-4000-8000-000000000002','LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'fixture-scanner','clean-old',NULL),
 ('31000000-0000-4000-8000-000000000007','11000000-0000-4000-8000-000000000006','41000000-0000-4000-8000-000000000007','new.pdf','quarantine/slip/new','application/pdf',10,repeat('7',64),'PAYMENT_SLIP',1,'00000000-0000-4000-8000-000000000002','LOCAL','application/pdf','application/pdf','QUARANTINED',0,NULL,NULL,NULL,NULL,NULL),
 ('31000000-0000-4000-8000-000000000008','11000000-0000-4000-8000-000000000007','41000000-0000-4000-8000-000000000008','paid.pdf','quarantine/slip/paid','application/pdf',10,repeat('8',64),'PAYMENT_SLIP',1,'00000000-0000-4000-8000-000000000002','LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'fixture-scanner','clean-paid',NULL);
INSERT INTO payments(id,payment_request_id,slip_document_id) VALUES('51000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000007','31000000-0000-4000-8000-000000000008');
UPDATE payment_requests SET status='PAID' WHERE id='11000000-0000-4000-8000-000000000007';

CREATE OR REPLACE FUNCTION guard_payment_slip_write() RETURNS trigger SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
 IF COALESCE(NEW.document_type,OLD.document_type)='PAYMENT_SLIP' THEN
  PERFORM public.aims_authenticated_payment_actor();
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'payment slip metadata is immutable';END IF;
 END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_payment_slip_write() FROM PUBLIC;
CREATE TRIGGER payment_documents_payment_slip_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_documents FOR EACH ROW EXECUTE FUNCTION guard_payment_slip_write();
