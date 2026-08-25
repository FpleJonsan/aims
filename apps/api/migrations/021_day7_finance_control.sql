BEGIN;

ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_status_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_status_check CHECK(status IN (
  'DRAFT','SUBMITTED','VALIDATING','NEEDS_CLARIFICATION','PENDING_APPROVAL','APPROVED','FINANCE_CHECK','FINANCE_HOLD','READY_FOR_PAYMENT','REJECTED','CANCELLED'
));

CREATE TABLE finance_control_authorities(
  id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),scope varchar(24) NOT NULL CHECK(scope IN('DEPARTMENT','ORGANIZATION')),
  department_id uuid REFERENCES departments(id),active boolean NOT NULL DEFAULT true,allow_self_control boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((scope='DEPARTMENT' AND department_id IS NOT NULL) OR (scope='ORGANIZATION' AND department_id IS NULL)),
  UNIQUE(user_id,scope,department_id)
);

CREATE TABLE finance_control_runs(
  id uuid PRIMARY KEY,payment_request_id uuid NOT NULL REFERENCES payment_requests(id),run_version integer NOT NULL,
  request_revision integer NOT NULL,validation_run_id uuid NOT NULL REFERENCES validation_runs(id),
  finance_context_snapshot_id uuid NOT NULL REFERENCES finance_context_snapshots(id),
  financial_analysis_run_id uuid NOT NULL REFERENCES financial_analysis_runs(id),
  policy_decision_run_id uuid NOT NULL REFERENCES policy_decision_runs(id),approval_case_id uuid NOT NULL REFERENCES approval_cases(id),
  commitment_id uuid NOT NULL REFERENCES budget_commitments(id),evidence_fingerprint char(64) NOT NULL,
  approved_payee varchar(200) NOT NULL,approved_amount numeric(19,4) NOT NULL,approved_currency char(3) NOT NULL,
  approved_department_id uuid NOT NULL REFERENCES departments(id),approved_category varchar(100) NOT NULL,
  approved_payment_method varchar(64) NOT NULL,approved_payment_details_hash char(64) NOT NULL,
  duplicate_status varchar(24) NOT NULL CHECK(duplicate_status IN('NO_DUPLICATE','POSSIBLE_DUPLICATE','CONFIRMED_DUPLICATE')),
  status varchar(24) NOT NULL CHECK(status IN('CHECKING','HOLD','PASSED','SUPERSEDED')),
  is_current boolean NOT NULL DEFAULT true,started_by uuid NOT NULL REFERENCES users(id),started_at timestamptz NOT NULL DEFAULT now(),
  finalized_by uuid REFERENCES users(id),finalized_at timestamptz,completed_command_key uuid UNIQUE,
  UNIQUE(payment_request_id,run_version)
);
CREATE UNIQUE INDEX finance_control_one_current_idx ON finance_control_runs(payment_request_id) WHERE is_current;

CREATE TABLE finance_control_checks(
  id uuid PRIMARY KEY,finance_control_run_id uuid NOT NULL REFERENCES finance_control_runs(id),code varchar(64) NOT NULL,
  source varchar(24) NOT NULL CHECK(source IN('SYSTEM','FINANCE_USER')),result varchar(24) NOT NULL CHECK(result IN('PASS','FAIL','REVIEW_REQUIRED')),
  safe_detail jsonb NOT NULL DEFAULT '{}',checked_by uuid REFERENCES users(id),checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(finance_control_run_id,code)
);
CREATE TABLE finance_control_confirmations(
  id uuid PRIMARY KEY,finance_control_run_id uuid NOT NULL REFERENCES finance_control_runs(id),code varchar(64) NOT NULL,
  confirmed boolean NOT NULL,confirmed_by uuid NOT NULL REFERENCES users(id),confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(finance_control_run_id,code)
);
CREATE TABLE finance_control_exceptions(
  id uuid PRIMARY KEY,finance_control_run_id uuid NOT NULL REFERENCES finance_control_runs(id),
  failed_check_codes jsonb NOT NULL,reason varchar(2000) NOT NULL,required_resolution varchar(64) NOT NULL CHECK(required_resolution IN('RECHECK','RETURN_UPSTREAM')),
  status varchar(24) NOT NULL CHECK(status IN('OPEN','RESOLVED','SUPERSEDED')) DEFAULT 'OPEN',created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),resolved_by uuid REFERENCES users(id),resolved_at timestamptz,resolution_note varchar(2000),
  UNIQUE(finance_control_run_id)
);

CREATE OR REPLACE FUNCTION enforce_ready_for_payment() RETURNS trigger AS $$
BEGIN
  IF NEW.status='READY_FOR_PAYMENT' AND NOT EXISTS(
    SELECT 1 FROM finance_control_runs f WHERE f.payment_request_id=NEW.id AND f.is_current AND f.status='PASSED'
  ) THEN RAISE EXCEPTION 'READY_FOR_PAYMENT requires a current passed Finance Control run'; END IF;
  RETURN NEW;
END;$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_requests_ready_requires_finance_control
BEFORE INSERT OR UPDATE OF status ON payment_requests FOR EACH ROW EXECUTE FUNCTION enforce_ready_for_payment();

CREATE OR REPLACE FUNCTION invalidate_finance_control_for_authority_change() RETURNS trigger AS $$
DECLARE request_id uuid;DECLARE previous_state varchar(32);
BEGIN
 IF pg_trigger_depth()>1 THEN RETURN COALESCE(NEW,OLD); END IF;
 request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 SELECT status INTO previous_state FROM payment_requests WHERE id=request_id FOR UPDATE;
 IF previous_state IN('FINANCE_CHECK','FINANCE_HOLD','READY_FOR_PAYMENT') THEN
  UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
  UPDATE finance_control_exceptions SET status='SUPERSEDED' WHERE finance_control_run_id IN(SELECT id FROM finance_control_runs WHERE payment_request_id=request_id) AND status='OPEN';
  UPDATE payment_requests SET status=CASE WHEN EXISTS(SELECT 1 FROM approval_cases WHERE payment_request_id=request_id AND is_current AND status='APPROVED') THEN 'APPROVED' ELSE 'SUBMITTED' END,
    updated_at=now(),row_version=row_version+1 WHERE id=request_id;
  INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
   VALUES(gen_random_uuid(),NULL,'READY_FOR_PAYMENT_INVALIDATED','PAYMENT_REQUEST',request_id,previous_state,
    CASE WHEN EXISTS(SELECT 1 FROM approval_cases WHERE payment_request_id=request_id AND is_current AND status='APPROVED') THEN 'APPROVED' ELSE 'SUBMITTED' END,
    gen_random_uuid(),jsonb_build_object('sourceTable',TG_TABLE_NAME));
 END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;
CREATE TRIGGER approval_case_invalidates_finance_control AFTER UPDATE OF status,is_current ON approval_cases
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_current IS DISTINCT FROM NEW.is_current)
 EXECUTE FUNCTION invalidate_finance_control_for_authority_change();
CREATE TRIGGER commitment_invalidates_finance_control AFTER UPDATE OF status,amount_minor,currency,budget_id,budget_version_id ON budget_commitments
 FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.amount_minor IS DISTINCT FROM NEW.amount_minor OR OLD.currency IS DISTINCT FROM NEW.currency OR OLD.budget_id IS DISTINCT FROM NEW.budget_id OR OLD.budget_version_id IS DISTINCT FROM NEW.budget_version_id)
 EXECUTE FUNCTION invalidate_finance_control_for_authority_change();

CREATE OR REPLACE FUNCTION invalidate_day7_for_material_request_change() RETURNS trigger AS $$
DECLARE changed boolean;DECLARE prior_case_id uuid;DECLARE prior_run_id uuid;DECLARE released_ids uuid[];
BEGIN
 changed:=OLD.payee IS DISTINCT FROM NEW.payee OR OLD.purpose IS DISTINCT FROM NEW.purpose OR OLD.category IS DISTINCT FROM NEW.category
  OR OLD.amount IS DISTINCT FROM NEW.amount OR OLD.currency IS DISTINCT FROM NEW.currency OR OLD.department_id IS DISTINCT FROM NEW.department_id
  OR OLD.due_date IS DISTINCT FROM NEW.due_date OR OLD.payment_method IS DISTINCT FROM NEW.payment_method OR OLD.payment_details IS DISTINCT FROM NEW.payment_details;
 IF changed AND OLD.status IN('FINANCE_CHECK','FINANCE_HOLD','READY_FOR_PAYMENT') THEN
  SELECT id INTO prior_run_id FROM finance_control_runs WHERE payment_request_id=OLD.id AND is_current FOR UPDATE;
  UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false WHERE id=prior_run_id;
  UPDATE finance_control_exceptions SET status='SUPERSEDED' WHERE finance_control_run_id=prior_run_id AND status='OPEN';
  SELECT id INTO prior_case_id FROM approval_cases WHERE payment_request_id=OLD.id AND is_current FOR UPDATE;
  UPDATE approval_cases SET status='SUPERSEDED',is_current=false,completed_at=COALESCE(completed_at,now()) WHERE id=prior_case_id;
  UPDATE approval_steps SET status='CLOSED',completed_at=COALESCE(completed_at,now()) WHERE approval_case_id=prior_case_id AND status IN('ACTIVE','WAITING');
  UPDATE approval_action_tokens SET status='REVOKED' WHERE approval_case_id=prior_case_id AND status='ACTIVE';
  UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE approval_case_id=prior_case_id AND status='PENDING';
  WITH released AS (UPDATE budget_commitments SET status='RELEASED',released_at=now(),release_reason='REQUEST_MATERIAL_CHANGED',release_reference_type='PAYMENT_REQUEST',release_reference_id=OLD.id
   WHERE payment_request_id=OLD.id AND source='APPROVAL' AND status='ACTIVE' RETURNING id) SELECT array_agg(id) INTO released_ids FROM released;
  UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=OLD.id AND is_current;
  UPDATE policy_exceptions SET status='SUPERSEDED' WHERE payment_request_id=OLD.id AND status='OPEN';
  UPDATE financial_analysis_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=OLD.id AND is_current;
  UPDATE finance_context_snapshots SET status='SUPERSEDED',is_current=false WHERE payment_request_id=OLD.id AND is_current;
  UPDATE validation_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=OLD.id AND is_current;
  NEW.status:='SUBMITTED';NEW.row_version:=OLD.row_version+1;NEW.updated_at:=now();
  INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
   VALUES(gen_random_uuid(),NULL,'READY_FOR_PAYMENT_INVALIDATED','PAYMENT_REQUEST',OLD.id,OLD.status,'SUBMITTED',gen_random_uuid(),
    jsonb_build_object('financeControlRunId',prior_run_id,'approvalCaseId',prior_case_id,'reason','REQUEST_MATERIAL_CHANGED','releasedCommitmentIds',COALESCE(released_ids,ARRAY[]::uuid[])));
 END IF;RETURN NEW;END;$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_requests_day7_material_invalidation
 BEFORE UPDATE OF payee,purpose,category,amount,currency,department_id,due_date,payment_method,payment_details ON payment_requests
 FOR EACH ROW EXECUTE FUNCTION invalidate_day7_for_material_request_change();

CREATE OR REPLACE FUNCTION invalidate_approval_for_evidence_change() RETURNS trigger AS $$
DECLARE request_id uuid;DECLARE relevant boolean;DECLARE prior_case_id uuid;DECLARE prior_run_id uuid;DECLARE old_state varchar(32);DECLARE released_ids uuid[];
BEGIN request_id:=COALESCE(NEW.payment_request_id,OLD.payment_request_id);
 relevant:=TG_OP='INSERT' OR (OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL) OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL)
 OR (OLD.removed_at IS NULL AND NEW.removed_at IS NULL AND (OLD.version IS DISTINCT FROM NEW.version OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.sha256 IS DISTINCT FROM NEW.sha256));
 IF relevant THEN
  SELECT status INTO old_state FROM payment_requests WHERE id=request_id FOR UPDATE;
  SELECT id INTO prior_run_id FROM finance_control_runs WHERE payment_request_id=request_id AND is_current FOR UPDATE;
  IF prior_run_id IS NOT NULL THEN
   UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false WHERE id=prior_run_id;
   UPDATE finance_control_exceptions SET status='SUPERSEDED' WHERE finance_control_run_id=prior_run_id AND status='OPEN';
  END IF;
  SELECT id INTO prior_case_id FROM approval_cases WHERE payment_request_id=request_id AND is_current FOR UPDATE;
  IF prior_case_id IS NOT NULL AND old_state IN('PENDING_APPROVAL','APPROVED','FINANCE_CHECK','FINANCE_HOLD','READY_FOR_PAYMENT') THEN
   UPDATE approval_cases SET status='SUPERSEDED',is_current=false,completed_at=COALESCE(completed_at,now()) WHERE id=prior_case_id;
   UPDATE approval_steps SET status='CLOSED',completed_at=COALESCE(completed_at,now()) WHERE approval_case_id=prior_case_id AND status IN('ACTIVE','WAITING');
   UPDATE approval_action_tokens SET status='REVOKED' WHERE approval_case_id=prior_case_id AND status='ACTIVE';
   UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE approval_case_id=prior_case_id AND status='PENDING';
   WITH released AS (UPDATE budget_commitments SET status='RELEASED',released_at=now(),release_reason='UPSTREAM_EVIDENCE_CHANGED',release_reference_type='PAYMENT_DOCUMENT',release_reference_id=COALESCE(NEW.id,OLD.id)
    WHERE payment_request_id=request_id AND source='APPROVAL' AND status='ACTIVE' RETURNING id) SELECT array_agg(id) INTO released_ids FROM released;
   UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
   UPDATE policy_exceptions SET status='SUPERSEDED' WHERE payment_request_id=request_id AND status='OPEN';
   UPDATE financial_analysis_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
   UPDATE finance_context_snapshots SET status='SUPERSEDED',is_current=false WHERE payment_request_id=request_id AND is_current;
   UPDATE validation_runs SET is_current=false,status='SUPERSEDED' WHERE payment_request_id=request_id AND is_current;
   UPDATE payment_requests SET status='SUBMITTED',updated_at=now(),row_version=row_version+1 WHERE id=request_id;
   INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,previous_state,new_state,correlation_id,safe_metadata)
    VALUES(gen_random_uuid(),NULL,CASE WHEN old_state='READY_FOR_PAYMENT' THEN 'READY_FOR_PAYMENT_INVALIDATED' ELSE 'APPROVAL_INVALIDATED_BY_UPSTREAM_CHANGE' END,
     'PAYMENT_REQUEST',request_id,old_state,'SUBMITTED',gen_random_uuid(),jsonb_build_object('financeControlRunId',prior_run_id,'documentId',COALESCE(NEW.id,OLD.id),'reason','UPSTREAM_EVIDENCE_CHANGED','approvalCaseId',prior_case_id,'releasedCommitmentIds',COALESCE(released_ids,ARRAY[]::uuid[])));
  END IF;
 END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;

GRANT SELECT ON finance_control_authorities TO aims_app;
GRANT SELECT,INSERT ON finance_control_runs,finance_control_checks,finance_control_confirmations,finance_control_exceptions TO aims_app;
GRANT UPDATE(status,is_current,finalized_by,finalized_at,completed_command_key) ON finance_control_runs TO aims_app;
GRANT UPDATE(confirmed,confirmed_by,confirmed_at) ON finance_control_confirmations TO aims_app;
GRANT UPDATE(status,resolved_by,resolved_at,resolution_note) ON finance_control_exceptions TO aims_app;
COMMIT;
