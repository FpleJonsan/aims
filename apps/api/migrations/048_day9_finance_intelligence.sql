BEGIN;

ALTER TABLE ai_feature_configuration DROP CONSTRAINT ai_feature_configuration_feature_check;
ALTER TABLE ai_feature_configuration ADD CONSTRAINT ai_feature_configuration_feature_check CHECK(feature IN(
 'AI_MASTER','DOCUMENT_EXTRACTION','DOCUMENT_VALIDATION','FINANCIAL_RISK_ANALYSIS','SPENDING_PATTERN_ANALYSIS','COMPLIANCE_ANALYSIS','FINANCE_WATCH','ASK_AIMS'));
INSERT INTO ai_feature_configuration(feature,enabled) VALUES('FINANCE_WATCH',false),('ASK_AIMS',false) ON CONFLICT DO NOTHING;

CREATE TABLE finance_reporting_authorities(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),scope varchar(24) NOT NULL CHECK(scope IN('DEPARTMENT','ORGANIZATION')),
 department_id uuid REFERENCES departments(id),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((scope='DEPARTMENT' AND department_id IS NOT NULL)OR(scope='ORGANIZATION' AND department_id IS NULL)));
CREATE UNIQUE INDEX finance_reporting_org_unique_idx ON finance_reporting_authorities(user_id) WHERE scope='ORGANIZATION' AND department_id IS NULL;
CREATE UNIQUE INDEX finance_reporting_department_unique_idx ON finance_reporting_authorities(user_id,department_id) WHERE scope='DEPARTMENT';

CREATE TABLE finance_insight_runs(
 id uuid PRIMARY KEY,run_version bigint GENERATED ALWAYS AS IDENTITY,requested_by uuid NOT NULL REFERENCES users(id),
 scope_department_id uuid REFERENCES departments(id),period_from date,period_to date,source_analytics_version varchar(32) NOT NULL,
 data_snapshot_as_of timestamptz NOT NULL,status varchar(24) NOT NULL CHECK(status IN('COMPLETED','FAILED','INSUFFICIENT_DATA')),
 provider varchar(100),model varchar(100),prompt_version varchar(64) NOT NULL,input_tokens integer,output_tokens integer,total_tokens integer,
 latency_ms integer,failure_code varchar(64),context jsonb NOT NULL,result jsonb,generated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX finance_insight_history_idx ON finance_insight_runs(requested_by,generated_at DESC);

CREATE TABLE finance_ask_runs(
 id uuid PRIMARY KEY,asked_by uuid NOT NULL REFERENCES users(id),scope_department_id uuid REFERENCES departments(id),question_class varchar(40) NOT NULL,
 period_from date,period_to date,tool_names jsonb NOT NULL,provider varchar(100),model varchar(100),prompt_version varchar(64) NOT NULL,
 input_tokens integer,output_tokens integer,total_tokens integer,latency_ms integer,status varchar(24) NOT NULL CHECK(status IN('COMPLETED','FAILED','DISABLED')),
 failure_code varchar(64),answer jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX finance_ask_history_idx ON finance_ask_runs(asked_by,created_at DESC);

ALTER TABLE ai_usage_events ALTER COLUMN payment_request_id DROP NOT NULL;
ALTER TABLE ai_usage_events ADD COLUMN finance_insight_run_id uuid REFERENCES finance_insight_runs(id),ADD COLUMN finance_ask_run_id uuid REFERENCES finance_ask_runs(id);

CREATE OR REPLACE FUNCTION reject_finance_intelligence_mutation() RETURNS trigger AS $$BEGIN RAISE EXCEPTION 'historical Finance Intelligence is immutable';END;$$ LANGUAGE plpgsql;
CREATE TRIGGER finance_insight_runs_immutable BEFORE UPDATE OR DELETE ON finance_insight_runs FOR EACH ROW EXECUTE FUNCTION reject_finance_intelligence_mutation();
CREATE TRIGGER finance_ask_runs_immutable BEFORE UPDATE OR DELETE ON finance_ask_runs FOR EACH ROW EXECUTE FUNCTION reject_finance_intelligence_mutation();

CREATE INDEX payment_requests_status_submitted_idx ON payment_requests(status,submitted_at);
CREATE INDEX payment_requests_department_category_idx ON payment_requests(department_id,category);
CREATE INDEX approval_actions_acted_idx ON approval_actions(acted_at,action);
CREATE INDEX finance_control_status_started_idx ON finance_control_runs(status,started_at);
CREATE INDEX ai_usage_created_idx ON ai_usage_events(created_at,agent);

GRANT SELECT ON finance_reporting_authorities TO aims_app;
GRANT SELECT,INSERT ON finance_insight_runs,finance_ask_runs TO aims_app;

INSERT INTO finance_reporting_authorities(id,user_id,scope,department_id,active) VALUES
 ('d9000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','ORGANIZATION',NULL,true),
 ('d9000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000009','ORGANIZATION',NULL,true),
 ('d9000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011','DEPARTMENT','00000000-0000-4000-8000-000000000002',true)
ON CONFLICT DO NOTHING;

COMMIT;
