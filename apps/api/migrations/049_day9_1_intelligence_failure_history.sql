BEGIN;

ALTER TABLE finance_insight_runs
  ADD COLUMN scope_department_ids uuid[],
  ADD COLUMN schema_valid boolean NOT NULL DEFAULT true,
  ADD COLUMN evidence_valid boolean NOT NULL DEFAULT true,
  ADD COLUMN failure_classification varchar(64),
  ADD COLUMN completed_at timestamptz NOT NULL DEFAULT now();
UPDATE finance_insight_runs SET scope_department_ids=ARRAY[scope_department_id] WHERE scope_department_id IS NOT NULL;

ALTER TABLE finance_ask_runs
  ADD COLUMN scope_department_ids uuid[],
  ADD COLUMN question_hash varchar(64),
  ADD COLUMN schema_valid boolean NOT NULL DEFAULT true,
  ADD COLUMN evidence_valid boolean NOT NULL DEFAULT true,
  ADD COLUMN failure_classification varchar(64),
  ADD COLUMN completed_at timestamptz NOT NULL DEFAULT now();
UPDATE finance_ask_runs SET scope_department_ids=ARRAY[scope_department_id] WHERE scope_department_id IS NOT NULL;

ALTER TABLE ai_usage_events ADD COLUMN failure_classification varchar(64);
CREATE INDEX finance_insight_scope_history_idx ON finance_insight_runs USING gin(scope_department_ids);
CREATE INDEX finance_ask_scope_history_idx ON finance_ask_runs USING gin(scope_department_ids);

COMMENT ON COLUMN finance_insight_runs.scope_department_ids IS 'NULL means authorized organization-wide scope; otherwise the exact authorized department union.';
COMMENT ON COLUMN finance_ask_runs.question_hash IS 'SHA-256 of the bounded question; raw Ask AIMS questions are not retained.';

COMMIT;
