BEGIN;
ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_status_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_status_check CHECK(status IN ('DRAFT','SUBMITTED','VALIDATING','NEEDS_CLARIFICATION','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED'));

CREATE TABLE approval_authorities(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),authority_role varchar(64) NOT NULL,
 authority_scope varchar(24) NOT NULL CHECK(authority_scope IN('DEPARTMENT','ORGANIZATION')),
 department_id uuid REFERENCES departments(id),minimum_amount_minor bigint,maximum_amount_minor bigint,
 active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(minimum_amount_minor IS NULL OR minimum_amount_minor>=0),CHECK(maximum_amount_minor IS NULL OR maximum_amount_minor>=0),
 CHECK(minimum_amount_minor IS NULL OR maximum_amount_minor IS NULL OR minimum_amount_minor<=maximum_amount_minor),
 CHECK((authority_scope='DEPARTMENT' AND department_id IS NOT NULL) OR (authority_scope='ORGANIZATION' AND department_id IS NULL)),
 UNIQUE(user_id,authority_role,authority_scope,department_id)
);
CREATE TABLE approval_cases(
 id uuid PRIMARY KEY,payment_request_id uuid NOT NULL REFERENCES payment_requests(id),request_revision integer NOT NULL,
 validation_run_id uuid NOT NULL REFERENCES validation_runs(id),finance_context_snapshot_id uuid NOT NULL REFERENCES finance_context_snapshots(id),
 financial_analysis_run_id uuid NOT NULL REFERENCES financial_analysis_runs(id),policy_decision_run_id uuid NOT NULL REFERENCES policy_decision_runs(id),
 policy_version_id uuid REFERENCES policy_versions(id),evidence_fingerprint char(64) NOT NULL,approval_plan jsonb NOT NULL,
 source varchar(32) NOT NULL CHECK(source IN('HUMAN','POLICY_AUTO_APPROVAL')),
 status varchar(24) NOT NULL CHECK(status IN('PENDING','APPROVED','REJECTED','CLARIFICATION','SUPERSEDED')),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,is_current boolean NOT NULL DEFAULT true,
 UNIQUE(payment_request_id,request_revision,policy_decision_run_id)
);
CREATE UNIQUE INDEX approval_cases_one_current_idx ON approval_cases(payment_request_id) WHERE is_current;
CREATE TABLE approval_steps(
 id uuid PRIMARY KEY,approval_case_id uuid NOT NULL REFERENCES approval_cases(id),sequence integer NOT NULL CHECK(sequence>0),
 required_role varchar(64) NOT NULL,authority_scope varchar(24) NOT NULL CHECK(authority_scope IN('DEPARTMENT','ORGANIZATION')),
 department_scope uuid REFERENCES departments(id),minimum_amount_minor bigint,maximum_amount_minor bigint,mandatory boolean NOT NULL,reason varchar(500) NOT NULL,
 status varchar(24) NOT NULL CHECK(status IN('WAITING','ACTIVE','APPROVED','CLOSED')),activated_at timestamptz,completed_at timestamptz,
 UNIQUE(approval_case_id,sequence)
);
CREATE TABLE approval_actions(
 id uuid PRIMARY KEY,approval_case_id uuid NOT NULL REFERENCES approval_cases(id),approval_step_id uuid REFERENCES approval_steps(id),
 actor_id uuid REFERENCES users(id),action varchar(32) NOT NULL CHECK(action IN('APPROVE','REJECT','REQUEST_CLARIFICATION','POLICY_AUTO_APPROVE')),
 reason varchar(2000),channel varchar(24) NOT NULL CHECK(channel IN('WEB','TELEGRAM','POLICY_AUTO')),command_key uuid NOT NULL UNIQUE,acted_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX approval_actions_one_terminal_step_idx ON approval_actions(approval_step_id) WHERE action IN('APPROVE','REJECT','REQUEST_CLARIFICATION');
CREATE TABLE approval_clarifications(
 id uuid PRIMARY KEY,approval_case_id uuid NOT NULL REFERENCES approval_cases(id),approval_step_id uuid NOT NULL REFERENCES approval_steps(id),payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
 clarification_type varchar(32) NOT NULL CHECK(clarification_type='APPROVAL'),reason varchar(2000) NOT NULL,required_response varchar(2000) NOT NULL,
 requested_by uuid NOT NULL REFERENCES users(id),requested_at timestamptz NOT NULL DEFAULT now(),response varchar(4000),responded_by uuid REFERENCES users(id),responded_at timestamptz,
 status varchar(24) NOT NULL CHECK(status IN('OPEN','RESPONDED','CLOSED')) DEFAULT 'OPEN'
);
CREATE UNIQUE INDEX approval_clarifications_one_open_idx ON approval_clarifications(payment_request_id) WHERE status='OPEN';
CREATE TABLE telegram_identity_bindings(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),telegram_user_id bigint NOT NULL UNIQUE,telegram_chat_id bigint NOT NULL,
 status varchar(16) NOT NULL CHECK(status IN('ACTIVE','REVOKED')),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz
);
CREATE UNIQUE INDEX telegram_identity_one_active_user_idx ON telegram_identity_bindings(user_id) WHERE status='ACTIVE';
CREATE TABLE approval_action_tokens(
 id uuid PRIMARY KEY,token_hash char(64) NOT NULL UNIQUE,approval_case_id uuid NOT NULL REFERENCES approval_cases(id),approval_step_id uuid NOT NULL REFERENCES approval_steps(id),
 recipient_user_id uuid NOT NULL REFERENCES users(id),
 action varchar(32) NOT NULL CHECK(action IN('APPROVE','REJECT','REQUEST_CLARIFICATION')),expires_at timestamptz NOT NULL,used_at timestamptz,used_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_outbox(
 id uuid PRIMARY KEY,aggregate_type varchar(40) NOT NULL,aggregate_id uuid NOT NULL,event_type varchar(64) NOT NULL,channel varchar(24) NOT NULL,
 recipient_user_id uuid REFERENCES users(id),payload jsonb NOT NULL,status varchar(24) NOT NULL CHECK(status IN('PENDING','PROCESSING','SENT','FAILED')) DEFAULT 'PENDING',
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),last_error_code varchar(64),created_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,
 UNIQUE(aggregate_id,event_type,recipient_user_id)
);

CREATE OR REPLACE FUNCTION invalidate_approval_for_evidence_change() RETURNS trigger AS $$
DECLARE request_id uuid;DECLARE relevant boolean;DECLARE approval_invalidated boolean;
BEGIN request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 relevant:=TG_OP='INSERT' OR (OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL) OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL)
 OR (OLD.removed_at IS NULL AND NEW.removed_at IS NULL AND (OLD.version IS DISTINCT FROM NEW.version OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.sha256 IS DISTINCT FROM NEW.sha256));
 IF relevant THEN PERFORM id FROM payment_requests WHERE id=request_id FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM approval_cases WHERE payment_request_id=request_id AND is_current) INTO approval_invalidated;
  UPDATE approval_cases SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
  UPDATE approval_steps SET status='CLOSED',completed_at=now() WHERE approval_case_id IN(SELECT id FROM approval_cases WHERE payment_request_id=request_id AND status='SUPERSEDED') AND status IN('ACTIVE','WAITING');
  IF approval_invalidated THEN
   UPDATE validation_runs SET is_current=false,status='SUPERSEDED' WHERE payment_request_id=request_id AND is_current;
   UPDATE payment_requests SET status='SUBMITTED',updated_at=now(),row_version=row_version+1 WHERE id=request_id AND status='PENDING_APPROVAL';
  END IF;
 END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_documents_invalidate_approval AFTER INSERT OR UPDATE OF removed_at,version,document_type,sha256 ON payment_documents FOR EACH ROW EXECUTE FUNCTION invalidate_approval_for_evidence_change();

GRANT SELECT ON approval_authorities TO aims_app;
GRANT SELECT,INSERT ON telegram_identity_bindings TO aims_app;
GRANT UPDATE(status,revoked_at) ON telegram_identity_bindings TO aims_app;
GRANT SELECT,INSERT ON approval_cases,approval_steps,approval_actions,approval_clarifications,approval_action_tokens,notification_outbox TO aims_app;
GRANT UPDATE(status,completed_at,is_current) ON approval_cases TO aims_app;
GRANT UPDATE(status,activated_at,completed_at) ON approval_steps TO aims_app;
GRANT UPDATE(response,responded_by,responded_at,status) ON approval_clarifications TO aims_app;
GRANT UPDATE(used_at,used_by) ON approval_action_tokens TO aims_app;
GRANT UPDATE(status,attempts,next_attempt_at,last_error_code,sent_at) ON notification_outbox TO aims_app;
COMMIT;
