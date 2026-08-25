BEGIN;
ALTER TABLE budget_commitments ADD COLUMN finance_context_snapshot_id uuid REFERENCES finance_context_snapshots(id);
ALTER TABLE budget_commitments ADD COLUMN budget_version_id uuid REFERENCES budget_versions(id);
ALTER TABLE budget_commitments ADD COLUMN approval_case_id uuid REFERENCES approval_cases(id);
ALTER TABLE budget_commitments ADD COLUMN source varchar(24) CHECK(source='APPROVAL');
CREATE UNIQUE INDEX budget_commitments_one_approval_case_idx ON budget_commitments(approval_case_id) WHERE source='APPROVAL';

CREATE TABLE telegram_pending_interactions(
 id uuid PRIMARY KEY,telegram_binding_id uuid NOT NULL REFERENCES telegram_identity_bindings(id),recipient_user_id uuid NOT NULL REFERENCES users(id),
 approval_case_id uuid NOT NULL REFERENCES approval_cases(id),approval_step_id uuid NOT NULL REFERENCES approval_steps(id),
 action varchar(32) NOT NULL CHECK(action IN('REJECT','REQUEST_CLARIFICATION')),status varchar(16) NOT NULL CHECK(status IN('PENDING','CONSUMED','EXPIRED','CANCELLED')),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),consumed_at timestamptz,
 UNIQUE(telegram_binding_id,status)
);
CREATE TABLE telegram_webhook_updates(
 update_id bigint PRIMARY KEY,received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX approval_action_tokens_one_live_action_idx ON approval_action_tokens(approval_step_id,recipient_user_id,action) WHERE used_at IS NULL;

GRANT INSERT ON budget_commitments TO aims_app;
GRANT SELECT,INSERT ON telegram_pending_interactions,telegram_webhook_updates TO aims_app;
GRANT UPDATE(status,consumed_at) ON telegram_pending_interactions TO aims_app;
COMMIT;
