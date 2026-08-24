BEGIN;

ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_status_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_status_check
  CHECK (status IN ('DRAFT','SUBMITTED','VALIDATING','NEEDS_CLARIFICATION','CANCELLED'));

CREATE TABLE payment_request_revisions (
  id uuid PRIMARY KEY,
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  revision integer NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL,
  reason varchar(500) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payment_request_id, revision)
);

CREATE TABLE ai_feature_configuration (
  feature varchar(64) PRIMARY KEY CHECK (feature IN ('AI_MASTER','DOCUMENT_EXTRACTION','DOCUMENT_VALIDATION')),
  enabled boolean NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ai_feature_configuration(feature,enabled) VALUES
 ('AI_MASTER',false),('DOCUMENT_EXTRACTION',false),('DOCUMENT_VALIDATION',false);

CREATE TABLE validation_runs (
  id uuid PRIMARY KEY,
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  request_revision integer NOT NULL,
  source varchar(32) NOT NULL CHECK (source IN ('AI_ASSISTED','MANUAL','AI_UNAVAILABLE_FALLBACK')),
  status varchar(32) NOT NULL CHECK (status IN ('PENDING','PROCESSING','AWAITING_HUMAN_REVIEW','COMPLETED','FAILED','SUPERSEDED')),
  overall_result varchar(32) CHECK (overall_result IN ('PASS','CLARIFICATION_REQUIRED')),
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  remarks varchar(2000),
  provider varchar(100), model varchar(100), prompt_version varchar(64),
  schema_valid boolean, failure_code varchar(100),
  created_by uuid REFERENCES users(id), reviewed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  is_current boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX validation_runs_one_current_idx ON validation_runs(payment_request_id) WHERE is_current;
CREATE INDEX validation_runs_history_idx ON validation_runs(payment_request_id,created_at DESC);

CREATE TABLE document_extractions (
  id uuid PRIMARY KEY,
  validation_run_id uuid NOT NULL REFERENCES validation_runs(id),
  document_id uuid NOT NULL REFERENCES payment_documents(id),
  document_version integer NOT NULL,
  extraction jsonb NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  UNIQUE(validation_run_id,document_id,document_version)
);

CREATE TABLE validation_findings (
  id uuid PRIMARY KEY,
  validation_run_id uuid NOT NULL REFERENCES validation_runs(id),
  code varchar(64) NOT NULL,
  check_status varchar(16) NOT NULL CHECK (check_status IN ('PASS','FAIL','WARNING','UNKNOWN')),
  severity varchar(16) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  explanation varchar(2000) NOT NULL,
  request_value varchar(1000), document_value varchar(1000)
);
CREATE TABLE validation_evidence (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL REFERENCES validation_findings(id),
  document_id uuid REFERENCES payment_documents(id),
  document_version integer,
  field_name varchar(100) NOT NULL,
  safe_reference varchar(500) NOT NULL
);

CREATE TABLE validation_clarifications (
  id uuid PRIMARY KEY,
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  validation_run_id uuid NOT NULL REFERENCES validation_runs(id),
  clarification_type varchar(32) NOT NULL CHECK (clarification_type='VALIDATION'),
  reason varchar(2000) NOT NULL,
  required_response varchar(2000),
  requested_by uuid NOT NULL REFERENCES users(id), requested_at timestamptz NOT NULL DEFAULT now(),
  response varchar(2000), responded_by uuid REFERENCES users(id), responded_at timestamptz,
  status varchar(16) NOT NULL CHECK (status IN ('OPEN','RESPONDED','CLOSED')) DEFAULT 'OPEN'
);
CREATE UNIQUE INDEX validation_clarifications_one_open_idx ON validation_clarifications(payment_request_id) WHERE status='OPEN';

CREATE TABLE ai_usage_events (
  id uuid PRIMARY KEY,
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id), validation_run_id uuid REFERENCES validation_runs(id),
  agent varchar(64) NOT NULL, provider varchar(100) NOT NULL, model varchar(100) NOT NULL, prompt_version varchar(64) NOT NULL,
  input_tokens integer, output_tokens integer, total_tokens integer, latency_ms integer,
  estimated_cost numeric(18,8), status varchar(32) NOT NULL, retry_count integer NOT NULL DEFAULT 0,
  schema_valid boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT,INSERT ON payment_request_revisions, validation_findings, validation_evidence, document_extractions, ai_usage_events TO aims_app;
GRANT SELECT,INSERT,UPDATE ON validation_runs, validation_clarifications TO aims_app;
GRANT SELECT ON ai_feature_configuration TO aims_app;

COMMIT;
