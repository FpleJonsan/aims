BEGIN;
ALTER TABLE ai_feature_configuration DROP CONSTRAINT ai_feature_configuration_feature_check;
ALTER TABLE ai_feature_configuration ADD CONSTRAINT ai_feature_configuration_feature_check CHECK(feature IN ('AI_MASTER','DOCUMENT_EXTRACTION','DOCUMENT_VALIDATION','FINANCIAL_RISK_ANALYSIS','SPENDING_PATTERN_ANALYSIS','COMPLIANCE_ANALYSIS'));
INSERT INTO ai_feature_configuration(feature,enabled) VALUES ('FINANCIAL_RISK_ANALYSIS',false),('SPENDING_PATTERN_ANALYSIS',false),('COMPLIANCE_ANALYSIS',false) ON CONFLICT DO NOTHING;

CREATE TABLE financial_analysis_runs(
 id uuid PRIMARY KEY,payment_request_id uuid NOT NULL REFERENCES payment_requests(id),request_revision integer NOT NULL,
 finance_context_snapshot_id uuid NOT NULL REFERENCES finance_context_snapshots(id),finance_context_version integer NOT NULL,
 analysis_version integer NOT NULL,source varchar(24) NOT NULL CHECK(source IN('AI_ASSISTED','MANUAL','AI_UNAVAILABLE_FALLBACK')),
 status varchar(32) NOT NULL CHECK(status IN('PROCESSING','AWAITING_HUMAN_REVIEW','FINALIZED','FAILED','SUPERSEDED')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),finalized_by uuid REFERENCES users(id),finalized_at timestamptz,is_current boolean NOT NULL DEFAULT true,
 UNIQUE(payment_request_id,request_revision,finance_context_snapshot_id,analysis_version)
);
CREATE UNIQUE INDEX financial_analysis_one_current_idx ON financial_analysis_runs(payment_request_id) WHERE is_current;

CREATE TABLE financial_agent_results(
 id uuid PRIMARY KEY,analysis_run_id uuid NOT NULL REFERENCES financial_analysis_runs(id),agent varchar(40) NOT NULL CHECK(agent IN('FINANCIAL_RISK','SPENDING_PATTERN','COMPLIANCE','AGGREGATOR')),
 status varchar(24) NOT NULL CHECK(status IN('COMPLETED','SKIPPED','FAILED')),prompt_version varchar(64) NOT NULL,
 result jsonb,provider varchar(100),model varchar(100),input_tokens integer,output_tokens integer,total_tokens integer,latency_ms integer,failure_code varchar(64),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(analysis_run_id,agent)
);
CREATE TABLE financial_risk_assessments(
 id uuid PRIMARY KEY,analysis_run_id uuid NOT NULL UNIQUE REFERENCES financial_analysis_runs(id),ai_assessment jsonb,
 final_risk varchar(16) CHECK(final_risk IN('LOW','MEDIUM','HIGH','CRITICAL')),final_priority varchar(16) CHECK(final_priority IN('LOW','NORMAL','HIGH','URGENT')),
 final_urgency varchar(16) CHECK(final_urgency IN('LOW','NORMAL','HIGH','URGENT')),suggested_deadline date,risk_flags jsonb NOT NULL DEFAULT '[]',
 financial_assessment varchar(4000),spending_assessment varchar(4000),compliance_remarks varchar(4000),evidence_references jsonb NOT NULL DEFAULT '[]',remarks varchar(4000),override_reason varchar(2000),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_usage_events ADD COLUMN financial_analysis_run_id uuid REFERENCES financial_analysis_runs(id);
GRANT SELECT,INSERT ON financial_analysis_runs,financial_agent_results,financial_risk_assessments TO aims_app;
GRANT UPDATE(status,finalized_by,finalized_at,is_current) ON financial_analysis_runs TO aims_app;
GRANT UPDATE(final_risk,final_priority,final_urgency,suggested_deadline,risk_flags,financial_assessment,spending_assessment,compliance_remarks,evidence_references,remarks,override_reason) ON financial_risk_assessments TO aims_app;
COMMIT;
