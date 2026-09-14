BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=67 AND migration_id='067_p20_5e_multi_claim_architecture') THEN
  RAISE EXCEPTION 'migration 068 requires schema version 67 (067_p20_5e_multi_claim_architecture)';
 END IF;
END;
$$;

-- P20.5F: Approval Matrix & Approval Delegation. Additive only: no existing
-- table is redesigned. The Approval Matrix follows the exact Draft ->
-- Validate -> Preview -> Publish -> Rollback -> Version History lifecycle as
-- Business Configuration (configuration_versions), storing the whole rule
-- set as one versioned JSON payload rather than normalized rule rows, so the
-- rule shape can evolve without further migrations. Approval Delegation is a
-- new, wholly independent table. The only touches to the existing Approval
-- engine schema are three nullable additive columns: approval_steps gets
-- parallel_group/required_approvals (NULL preserves today's strictly
-- sequential behaviour unchanged) and approval_cases gets
-- approval_matrix_version_id (NULL when a case was routed by Policy alone,
-- exactly as today; non-NULL pins the case to the matrix version active
-- when it entered Approval, so historical requests are never affected by a
-- later republish).
CREATE TABLE approval_matrix_versions (
  id uuid PRIMARY KEY,
  version integer,
  status varchar(16) NOT NULL DEFAULT 'draft',
  payload jsonb NOT NULL,
  reason varchar(500),
  changed_by uuid REFERENCES users(id),
  changed_by_display_name_snapshot varchar(160),
  changed_by_role_snapshot varchar(32)[],
  source_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT approval_matrix_versions_status_chk CHECK (status IN ('draft','published')),
  CONSTRAINT approval_matrix_versions_published_version_chk CHECK (status='draft' OR version IS NOT NULL)
);

-- At most one working draft at a time (single global matrix, not per-category).
CREATE UNIQUE INDEX approval_matrix_versions_one_draft_idx ON approval_matrix_versions ((1)) WHERE status='draft';
CREATE UNIQUE INDEX approval_matrix_versions_version_idx ON approval_matrix_versions (version) WHERE status='published';
CREATE INDEX approval_matrix_versions_status_idx ON approval_matrix_versions (status);

GRANT SELECT ON approval_matrix_versions TO aims_app;
GRANT INSERT ON approval_matrix_versions TO aims_app;
GRANT UPDATE(payload,status,version,reason,changed_by,changed_by_display_name_snapshot,changed_by_role_snapshot,source_ip,updated_at,published_at) ON approval_matrix_versions TO aims_app;
GRANT DELETE ON approval_matrix_versions TO aims_app;

-- Approval Delegation. Effective state (SCHEDULED/ACTIVE/EXPIRED/CANCELLED)
-- is derived at query time from start_date/end_date/status rather than
-- stored, so it can never drift out of sync with the calendar. Delegation
-- never rewrites history: approval_actions (unchanged table) already
-- records the acting actor_id, and resolution additionally records the
-- original approver in audit metadata (see ApprovalDelegationService /
-- ApprovalService integration) so audit always shows both identities.
CREATE TABLE approval_delegations (
  id uuid PRIMARY KEY,
  delegate_from uuid NOT NULL REFERENCES users(id),
  delegate_to uuid NOT NULL REFERENCES users(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason varchar(500) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_by uuid REFERENCES users(id),
  cancelled_at timestamptz,
  cancel_reason varchar(500),
  CHECK (delegate_from <> delegate_to),
  CHECK (start_date <= end_date),
  CHECK (status='ACTIVE' OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL))
);
CREATE INDEX approval_delegations_from_idx ON approval_delegations (delegate_from, status, start_date, end_date);
CREATE INDEX approval_delegations_to_idx ON approval_delegations (delegate_to, status, start_date, end_date);

GRANT SELECT ON approval_delegations TO aims_app;
GRANT INSERT ON approval_delegations TO aims_app;
GRANT UPDATE(status,cancelled_by,cancelled_at,cancel_reason,updated_at) ON approval_delegations TO aims_app;

-- Parallel approval support: NULL keeps every existing row's behaviour
-- (strictly sequential, one ACTIVE step at a time) exactly as before.
-- Non-NULL parallel_group marks a set of steps sharing the same `sequence`
-- that all activate together; required_approvals is how many of that
-- group's steps must reach APPROVED before the case advances past the
-- group (NULL/absent means "all of them").
ALTER TABLE approval_steps ADD COLUMN parallel_group integer;
ALTER TABLE approval_steps ADD COLUMN required_approvals integer CHECK (required_approvals IS NULL OR required_approvals > 0);
GRANT UPDATE(parallel_group,required_approvals) ON approval_steps TO aims_app;
-- The original UNIQUE(approval_case_id,sequence) assumed exactly one step
-- per sequence. Replace it with a partial index that still enforces that
-- for every sequential step (parallel_group IS NULL, i.e. every step ever
-- created before this migration and every non-parallel step created after
-- it) while allowing multiple rows to share one sequence when they belong
-- to the same parallel group.
ALTER TABLE approval_steps DROP CONSTRAINT approval_steps_approval_case_id_sequence_key;
CREATE UNIQUE INDEX approval_steps_case_sequence_sequential_idx ON approval_steps(approval_case_id,sequence) WHERE parallel_group IS NULL;

-- Historical pin: which Approval Matrix version (if any) produced this
-- case's step plan. NULL means the case was routed by Policy alone (matrix
-- had no published version, or matrix routing was disabled), exactly as
-- every case behaves today.
ALTER TABLE approval_cases ADD COLUMN approval_matrix_version_id uuid REFERENCES approval_matrix_versions(id);
GRANT UPDATE(approval_matrix_version_id) ON approval_cases TO aims_app;

UPDATE aims_schema_version SET version=68,migration_id='068_p20_5f_approval_matrix_and_delegation',applied_at=now() WHERE singleton=true AND version=67;
COMMIT;
