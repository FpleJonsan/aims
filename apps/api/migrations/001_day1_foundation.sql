BEGIN;

CREATE TABLE departments (
  id uuid PRIMARY KEY,
  code varchar(32) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  external_subject varchar(255) NOT NULL UNIQUE,
  email varchar(320) NOT NULL UNIQUE,
  display_name varchar(160) NOT NULL,
  department_id uuid NOT NULL REFERENCES departments(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id),
  role varchar(32) NOT NULL CHECK (role IN ('REQUESTER', 'FINANCE', 'ADMIN')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE payment_requests (
  id uuid PRIMARY KEY,
  ticket_number varchar(32) UNIQUE,
  status varchar(24) NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'CANCELLED')),
  payee varchar(200),
  purpose varchar(1000),
  category varchar(100),
  amount numeric(19,4) CHECK (amount IS NULL OR amount > 0),
  currency char(3),
  department_id uuid NOT NULL REFERENCES departments(id),
  due_date date,
  payment_method varchar(64),
  payment_details varchar(2000),
  remark varchar(2000),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT submitted_snapshot_complete CHECK (
    status <> 'SUBMITTED' OR (
      ticket_number IS NOT NULL AND submitted_at IS NOT NULL AND payee IS NOT NULL
      AND purpose IS NOT NULL AND category IS NOT NULL AND amount IS NOT NULL
      AND currency IS NOT NULL AND due_date IS NOT NULL AND payment_method IS NOT NULL
      AND payment_details IS NOT NULL
    )
  )
);

CREATE INDEX payment_requests_department_created_idx
  ON payment_requests (department_id, created_at DESC);
CREATE INDEX payment_requests_creator_created_idx
  ON payment_requests (created_by, created_at DESC);

CREATE TABLE ticket_counters (
  business_year integer PRIMARY KEY,
  last_value bigint NOT NULL CHECK (last_value >= 0)
);

CREATE TABLE payment_documents (
  id uuid PRIMARY KEY,
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  logical_document_id uuid NOT NULL,
  original_filename varchar(255) NOT NULL,
  storage_object_key varchar(1024) NOT NULL UNIQUE,
  mime_type varchar(127) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  document_type varchar(64),
  version integer NOT NULL CHECK (version > 0),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  UNIQUE (logical_document_id, version)
);

CREATE INDEX payment_documents_request_idx
  ON payment_documents (payment_request_id, uploaded_at);
CREATE UNIQUE INDEX payment_documents_active_hash_idx
  ON payment_documents (payment_request_id, sha256) WHERE removed_at IS NULL;

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  action varchar(80) NOT NULL,
  entity_type varchar(80) NOT NULL,
  entity_id uuid NOT NULL,
  previous_state varchar(24),
  new_state varchar(24),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id varchar(128) NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_events_entity_idx
  ON audit_events (entity_type, entity_id, occurred_at);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

COMMIT;
