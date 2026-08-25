BEGIN;

ALTER TABLE validation_clarifications DROP CONSTRAINT validation_clarifications_clarification_type_check;
ALTER TABLE validation_clarifications ADD CONSTRAINT validation_clarifications_clarification_type_check
  CHECK (clarification_type IN ('VALIDATION','POLICY','APPROVAL','FINANCE_CONTROL'));

CREATE TABLE policy_sets (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  description varchar(1000),
  status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','RETIRED')) DEFAULT 'ACTIVE',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_versions (
  id uuid PRIMARY KEY,
  policy_set_id uuid NOT NULL REFERENCES policy_sets(id),
  version integer NOT NULL CHECK (version > 0),
  status varchar(16) NOT NULL CHECK (status IN ('DRAFT','ACTIVE','RETIRED')) DEFAULT 'DRAFT',
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  evaluation_version varchar(32) NOT NULL DEFAULT 'policy-evaluator:v1',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_by uuid REFERENCES users(id),
  activated_at timestamptz,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE(policy_set_id,version)
);
CREATE UNIQUE INDEX policy_versions_one_active_idx ON policy_versions(policy_set_id) WHERE status='ACTIVE';

CREATE TABLE policy_rules (
  id uuid PRIMARY KEY,
  policy_version_id uuid NOT NULL REFERENCES policy_versions(id),
  code varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  priority integer NOT NULL CHECK (priority BETWEEN 1 AND 10000),
  effect varchar(32) NOT NULL CHECK (effect IN ('REQUIRE_APPROVAL','ALLOW_NO_APPROVAL','REQUIRE_JUSTIFICATION')),
  conditions jsonb NOT NULL,
  approval_steps jsonb NOT NULL DEFAULT '[]',
  required_evidence jsonb NOT NULL DEFAULT '[]',
  escalation varchar(500),
  notification_metadata jsonb NOT NULL DEFAULT '{}',
  auto_approval_eligible boolean NOT NULL DEFAULT false,
  exception_code varchar(64),
  exception_reason varchar(1000),
  justification_role varchar(32) CHECK (justification_role IN ('REQUESTER','FINANCE','ADMIN')),
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE(policy_version_id,code),
  CHECK ((effect='REQUIRE_JUSTIFICATION' AND exception_code IS NOT NULL AND exception_reason IS NOT NULL AND justification_role IS NOT NULL) OR effect<>'REQUIRE_JUSTIFICATION')
);

CREATE TABLE policy_decision_runs (
  id uuid PRIMARY KEY,
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  request_revision integer NOT NULL,
  validation_run_id uuid NOT NULL REFERENCES validation_runs(id),
  finance_context_snapshot_id uuid NOT NULL REFERENCES finance_context_snapshots(id),
  financial_analysis_run_id uuid NOT NULL REFERENCES financial_analysis_runs(id),
  policy_set_id uuid REFERENCES policy_sets(id),
  policy_version_id uuid REFERENCES policy_versions(id),
  policy_effective_from timestamptz,
  policy_effective_to timestamptz,
  evaluation_version varchar(32) NOT NULL,
  evaluated_input jsonb NOT NULL,
  matched_rule_ids jsonb NOT NULL DEFAULT '[]',
  result varchar(32) NOT NULL CHECK (result IN ('PASS','JUSTIFICATION_REQUIRED','NO_APPLICABLE_POLICY')),
  approval_required boolean NOT NULL,
  approval_plan jsonb NOT NULL DEFAULT '[]',
  required_evidence jsonb NOT NULL DEFAULT '[]',
  escalation varchar(500),
  notification_metadata jsonb NOT NULL DEFAULT '{}',
  auto_approval_eligible boolean NOT NULL DEFAULT false,
  ready_for_approval boolean NOT NULL DEFAULT false,
  status varchar(24) NOT NULL CHECK (status IN ('CURRENT','SUPERSEDED')) DEFAULT 'CURRENT',
  evaluated_by uuid NOT NULL REFERENCES users(id),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX policy_decision_one_current_idx ON policy_decision_runs(payment_request_id) WHERE is_current;

CREATE TABLE policy_exceptions (
  id uuid PRIMARY KEY,
  policy_decision_run_id uuid NOT NULL UNIQUE REFERENCES policy_decision_runs(id),
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  clarification_type varchar(32) NOT NULL CHECK (clarification_type='POLICY'),
  exception_code varchar(64) NOT NULL,
  reason varchar(2000) NOT NULL,
  required_justification varchar(2000) NOT NULL,
  requested_role varchar(32) NOT NULL CHECK (requested_role IN ('REQUESTER','FINANCE','ADMIN')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  justification varchar(4000),
  supplied_by uuid REFERENCES users(id),
  supplied_at timestamptz,
  status varchar(24) NOT NULL CHECK (status IN ('OPEN','JUSTIFIED','SUPERSEDED')) DEFAULT 'OPEN',
  reevaluation_required boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX policy_exception_one_open_idx ON policy_exceptions(payment_request_id) WHERE status='OPEN';

CREATE OR REPLACE FUNCTION reject_policy_decision_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.is_current AND NEW.is_current=false AND NEW.status='SUPERSEDED' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'policy decisions are immutable except supersession';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER policy_decisions_immutable BEFORE UPDATE OR DELETE ON policy_decision_runs
FOR EACH ROW EXECUTE FUNCTION reject_policy_decision_mutation();

GRANT SELECT,INSERT ON policy_sets,policy_versions,policy_rules TO aims_app;
GRANT UPDATE(status) ON policy_sets TO aims_app;
GRANT UPDATE(status,activated_by,activated_at) ON policy_versions TO aims_app;
GRANT SELECT,INSERT ON policy_decision_runs,policy_exceptions TO aims_app;
GRANT UPDATE(status,is_current) ON policy_decision_runs TO aims_app;
GRANT UPDATE(justification,supplied_by,supplied_at,status) ON policy_exceptions TO aims_app;
COMMIT;
