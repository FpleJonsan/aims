\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users(id uuid PRIMARY KEY,active boolean NOT NULL DEFAULT true);
CREATE TABLE payment_requests(
  id uuid PRIMARY KEY,status varchar(24) NOT NULL,department_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),amount numeric(18,2) NOT NULL,
  row_version integer NOT NULL DEFAULT 0
);
CREATE TABLE payment_authorities(
  user_id uuid NOT NULL REFERENCES users(id),active boolean NOT NULL,
  scope text NOT NULL,department_id uuid,allow_self_payment boolean NOT NULL,
  minimum_amount_minor bigint,maximum_amount_minor bigint
);
CREATE TABLE payment_documents(
  id uuid PRIMARY KEY,payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  logical_document_id uuid NOT NULL,original_filename varchar(255) NOT NULL,
  storage_object_key varchar(1024) NOT NULL UNIQUE,mime_type varchar(127) NOT NULL,
  size_bytes bigint NOT NULL CHECK(size_bytes>0),sha256 char(64) NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),
  document_type varchar(64),version integer NOT NULL CHECK(version>0),
  uploaded_by uuid NOT NULL REFERENCES users(id),uploaded_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,UNIQUE(logical_document_id,version)
);
CREATE TABLE payments(
  id uuid PRIMARY KEY,payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  slip_document_id uuid NOT NULL UNIQUE REFERENCES payment_documents(id)
);
CREATE TABLE aims_schema_version(
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),version integer NOT NULL,
  migration_id text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO aims_schema_version(singleton,version,migration_id) VALUES(true,54,'054_p1l_local_identity_sessions');

CREATE OR REPLACE FUNCTION aims_authenticated_payment_actor() RETURNS uuid
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'fixture does not execute trusted Payment commands' USING ERRCODE='42501';END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_paid_documents() RETURNS trigger
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request_id uuid;BEGIN request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 IF EXISTS(SELECT 1 FROM public.payment_requests WHERE id=request_id AND status='PAID') THEN RAISE EXCEPTION 'documents for PAID requests are immutable';END IF;RETURN COALESCE(NEW,OLD);END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_documents_paid_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_documents FOR EACH ROW EXECUTE FUNCTION guard_paid_documents();

CREATE OR REPLACE FUNCTION guard_payment_slip_write() RETURNS trigger
SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
 IF COALESCE(NEW.document_type,OLD.document_type)='PAYMENT_SLIP' THEN
  PERFORM public.aims_authenticated_payment_actor();
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'payment slip metadata is immutable';END IF;
 END IF;RETURN COALESCE(NEW,OLD);END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_documents_payment_slip_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_documents FOR EACH ROW EXECUTE FUNCTION guard_payment_slip_write();

INSERT INTO users(id) VALUES
 ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO payment_requests(id,status,department_id,created_by,amount,row_version) VALUES
 ('10000000-0000-4000-8000-000000000001','DRAFT','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',10,1),
 ('10000000-0000-4000-8000-000000000002','SUBMITTED','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',20,2),
 ('10000000-0000-4000-8000-000000000003','READY_FOR_PAYMENT','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',30,3),
 ('10000000-0000-4000-8000-000000000004','READY_FOR_PAYMENT','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',40,4);
INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','draft.pdf','quarantine/legacy/draft','application/pdf',10,repeat('1',64),'INVOICE',1,'00000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','submitted.jpg','quarantine/legacy/submitted','image/jpeg',11,repeat('2',64),'RECEIPT',1,'00000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000003','ready.png','quarantine/legacy/ready','image/png',12,repeat('3',64),'INVOICE',1,'00000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000004','paid.pdf','quarantine/legacy/paid','application/pdf',13,repeat('4',64),'RECEIPT',1,'00000000-0000-4000-8000-000000000002');
INSERT INTO payments(id,payment_request_id,slip_document_id) VALUES('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000004');
UPDATE payment_requests SET status='PAID' WHERE id='10000000-0000-4000-8000-000000000004';
