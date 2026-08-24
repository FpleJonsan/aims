BEGIN;

CREATE TABLE fiscal_periods (
  id uuid PRIMARY KEY,
  fiscal_year integer NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_on <= ends_on),
  UNIQUE (fiscal_year)
);

CREATE TABLE budgets (
  id uuid PRIMARY KEY,
  fiscal_period_id uuid NOT NULL REFERENCES fiscal_periods(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  category varchar(100) NOT NULL,
  cost_centre varchar(64),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX budgets_unique_active_mapping_idx
  ON budgets (fiscal_period_id,department_id,category,COALESCE(cost_centre,''),currency)
  WHERE status='ACTIVE';

CREATE TABLE budget_versions (
  id uuid PRIMARY KEY,
  budget_id uuid NOT NULL REFERENCES budgets(id),
  version integer NOT NULL CHECK (version > 0),
  original_amount_minor bigint NOT NULL CHECK (original_amount_minor >= 0),
  revised_amount_minor bigint NOT NULL CHECK (revised_amount_minor >= 0),
  effective_from timestamptz NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id,version)
);
CREATE UNIQUE INDEX budget_versions_one_active_idx ON budget_versions(budget_id) WHERE status='ACTIVE';

CREATE TABLE financial_ledger_entries (
  id uuid PRIMARY KEY,
  budget_id uuid NOT NULL REFERENCES budgets(id),
  entry_type varchar(16) NOT NULL CHECK (entry_type='ACTUAL'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reference_type varchar(40) NOT NULL,
  reference_id uuid,
  posted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reference_type,reference_id,entry_type)
);
CREATE INDEX financial_ledger_budget_posted_idx ON financial_ledger_entries(budget_id,posted_at);

CREATE TABLE budget_commitments (
  id uuid PRIMARY KEY,
  budget_id uuid NOT NULL REFERENCES budgets(id),
  payment_request_id uuid REFERENCES payment_requests(id),
  request_revision integer,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','RELEASED','CONSUMED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE UNIQUE INDEX budget_commitments_one_active_request_idx
  ON budget_commitments(payment_request_id,request_revision,budget_id) WHERE status='ACTIVE';
CREATE INDEX budget_commitments_budget_status_idx ON budget_commitments(budget_id,status);

CREATE TABLE finance_context_snapshots (
  id uuid PRIMARY KEY,
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  request_revision integer NOT NULL CHECK (request_revision > 0),
  finance_context_version integer NOT NULL CHECK (finance_context_version > 0),
  status varchar(24) NOT NULL CHECK (status IN ('COMPLETED','EXCEPTION','SUPERSEDED')),
  exception_code varchar(64) CHECK (exception_code IN ('MISSING_APPLICABLE_BUDGET','INACTIVE_BUDGET','AMBIGUOUS_BUDGET_MAPPING','CURRENCY_CONTEXT_UNSUPPORTED','STALE_VALIDATION','INVALID_REQUEST_AMOUNT','INCONSISTENT_BUDGET_DATA')),
  fiscal_period_id uuid REFERENCES fiscal_periods(id),
  fiscal_year integer,
  budget_id uuid REFERENCES budgets(id),
  budget_version_id uuid REFERENCES budget_versions(id),
  budget_version integer,
  department_id uuid NOT NULL REFERENCES departments(id),
  category varchar(100) NOT NULL,
  cost_centre varchar(64),
  request_currency char(3) NOT NULL,
  budget_currency char(3),
  original_amount_minor bigint,
  revised_amount_minor bigint,
  actual_amount_minor bigint,
  committed_amount_minor bigint,
  available_amount_minor bigint,
  request_amount_minor bigint NOT NULL,
  projected_available_amount_minor bigint,
  category_original_amount_minor bigint,
  category_revised_amount_minor bigint,
  category_actual_amount_minor bigint,
  category_committed_amount_minor bigint,
  category_available_amount_minor bigint,
  historical_summary jsonb NOT NULL DEFAULT '{"hasData":false,"currentMonthActualMinor":0,"previousMonthActualMinor":0,"rolling3MonthAverageMinor":0,"rolling6MonthAverageMinor":0,"yearToDateActualMinor":0}'::jsonb,
  calculation_version varchar(32) NOT NULL,
  calculated_by uuid NOT NULL REFERENCES users(id),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT true,
  CHECK ((status='EXCEPTION' AND exception_code IS NOT NULL) OR (status='COMPLETED' AND exception_code IS NULL) OR status='SUPERSEDED'),
  UNIQUE(payment_request_id,request_revision,finance_context_version)
);
CREATE UNIQUE INDEX finance_context_one_current_idx ON finance_context_snapshots(payment_request_id) WHERE is_current;
CREATE INDEX finance_context_history_idx ON finance_context_snapshots(payment_request_id,calculated_at DESC);

CREATE OR REPLACE FUNCTION reject_finance_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.is_current AND NEW.is_current = false AND NEW.status = 'SUPERSEDED' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'finance context snapshots are immutable except supersession';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER finance_context_snapshots_immutable
BEFORE UPDATE OR DELETE ON finance_context_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_finance_snapshot_mutation();

CREATE OR REPLACE FUNCTION reject_financial_ledger_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'financial ledger entries are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER financial_ledger_entries_append_only
BEFORE UPDATE OR DELETE ON financial_ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_financial_ledger_mutation();

GRANT SELECT ON fiscal_periods,budgets,budget_versions,financial_ledger_entries,budget_commitments TO aims_app;
GRANT SELECT,INSERT ON finance_context_snapshots TO aims_app;
GRANT UPDATE(status,is_current) ON finance_context_snapshots TO aims_app;

COMMIT;
