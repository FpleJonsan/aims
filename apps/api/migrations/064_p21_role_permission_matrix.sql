BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=63 AND migration_id='063_p20_5b_finance_master_users') THEN
  RAISE EXCEPTION 'migration 064 requires schema version 63 (063_p20_5b_finance_master_users)';
 END IF;
END;
$$;

-- P21: Enterprise Role & Permission Matrix. This is purely a reusable
-- authorization layer (roles / permissions / role_permissions). It does not
-- touch user_roles, approval_authorities, or any workflow/payment/master-data
-- table: the coarse 'role' a user actually holds keeps being decided exactly
-- as before by user_roles (and, for Approver, by approval_authorities).
-- 'roles' below is a configurable catalogue of fine-grained permission sets
-- that Finance Master can shape; the five system-seeded rows correspond 1:1
-- to the coarse identities already in use (REQUESTER/FINANCE/ADMIN/
-- FINANCE_MASTER plus the previously-implicit APPROVER) so effective
-- permissions can be computed today, while a Finance Master can also define
-- further roles for future phases to assign.
CREATE TABLE roles (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  description varchar(500),
  is_system boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY,
  code varchar(80) NOT NULL UNIQUE,
  group_name varchar(80) NOT NULL,
  name varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id),
  permission_id uuid NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_idx ON role_permissions(permission_id);

INSERT INTO roles(id,code,name,description,is_system,disabled) VALUES
  (gen_random_uuid(),'REQUESTER','Requester','Raises and manages own payment requests.',false,false),
  (gen_random_uuid(),'APPROVER','Approver','Reviews and decides on submitted payment requests.',false,false),
  (gen_random_uuid(),'FINANCE','Finance Analyst','Runs finance context, analysis, validation, and payment execution.',false,false),
  (gen_random_uuid(),'FINANCE_MASTER','Finance Master','Business administrator: users, roles, permissions, and settings.',false,false),
  (gen_random_uuid(),'ADMIN','Technical Admin','Developer-only role. Finance Master cannot edit its permissions.',true,false);

INSERT INTO permissions(id,code,group_name,name) VALUES
  (gen_random_uuid(),'DASHBOARD_VIEW','Dashboard','View Dashboard'),
  (gen_random_uuid(),'DASHBOARD_VIEW_REQUESTER','Dashboard','View Requester Dashboard'),
  (gen_random_uuid(),'DASHBOARD_VIEW_FINANCE','Dashboard','View Finance Dashboard'),
  (gen_random_uuid(),'DASHBOARD_VIEW_REPORTS','Dashboard','View Reports'),

  (gen_random_uuid(),'REQUEST_CREATE','Payment Request','Create Request'),
  (gen_random_uuid(),'REQUEST_EDIT','Payment Request','Edit Request'),
  (gen_random_uuid(),'REQUEST_DELETE_DRAFT','Payment Request','Delete Draft'),
  (gen_random_uuid(),'REQUEST_SUBMIT','Payment Request','Submit Request'),
  (gen_random_uuid(),'REQUEST_CANCEL','Payment Request','Cancel Request'),
  (gen_random_uuid(),'REQUEST_VIEW_OWN','Payment Request','View Own Request'),
  (gen_random_uuid(),'REQUEST_VIEW_ALL','Payment Request','View All Requests'),
  (gen_random_uuid(),'REQUEST_EXPORT','Payment Request','Export Requests'),

  (gen_random_uuid(),'VALIDATION_VIEW','Validation','View Validation'),
  (gen_random_uuid(),'VALIDATION_RUN','Validation','Run Validation'),
  (gen_random_uuid(),'VALIDATION_OVERRIDE','Validation','Override Validation'),

  (gen_random_uuid(),'FINANCE_CONTEXT_VIEW','Finance Context','View'),
  (gen_random_uuid(),'FINANCE_CONTEXT_RECALCULATE','Finance Context','Recalculate'),

  (gen_random_uuid(),'FINANCIAL_ANALYSIS_VIEW','Financial Analysis','View'),
  (gen_random_uuid(),'FINANCIAL_ANALYSIS_RUN','Financial Analysis','Run Analysis'),
  (gen_random_uuid(),'FINANCIAL_ANALYSIS_HUMAN_REVIEW','Financial Analysis','Human Review'),
  (gen_random_uuid(),'FINANCIAL_ANALYSIS_OVERRIDE_RESULT','Financial Analysis','Override Result'),

  (gen_random_uuid(),'POLICY_VIEW','Policy','View'),
  (gen_random_uuid(),'POLICY_EVALUATE','Policy','Evaluate'),
  (gen_random_uuid(),'POLICY_OVERRIDE','Policy','Override'),

  (gen_random_uuid(),'APPROVAL_VIEW','Approval','View'),
  (gen_random_uuid(),'APPROVAL_APPROVE','Approval','Approve'),
  (gen_random_uuid(),'APPROVAL_REJECT','Approval','Reject'),
  (gen_random_uuid(),'APPROVAL_REQUEST_CLARIFICATION','Approval','Request Clarification'),
  (gen_random_uuid(),'APPROVAL_DELEGATE','Approval','Delegate'),

  (gen_random_uuid(),'FINANCE_CONTROL_VIEW','Finance Control','View'),
  (gen_random_uuid(),'FINANCE_CONTROL_APPROVE','Finance Control','Approve Finance Control'),
  (gen_random_uuid(),'FINANCE_CONTROL_REJECT','Finance Control','Reject Finance Control'),
  (gen_random_uuid(),'FINANCE_CONTROL_HOLD_PAYMENT','Finance Control','Hold Payment'),
  (gen_random_uuid(),'FINANCE_CONTROL_RELEASE_PAYMENT','Finance Control','Release Payment'),

  (gen_random_uuid(),'PAYMENT_VIEW','Payment','View'),
  (gen_random_uuid(),'PAYMENT_CREATE','Payment','Create Payment'),
  (gen_random_uuid(),'PAYMENT_COMPLETE','Payment','Complete Payment'),
  (gen_random_uuid(),'PAYMENT_UPLOAD_SLIP','Payment','Upload Payment Slip'),
  (gen_random_uuid(),'PAYMENT_EXPORT','Payment','Export Payment'),

  (gen_random_uuid(),'REPORTING_VIEW','Reporting','View Reports'),
  (gen_random_uuid(),'REPORTING_EXPORT','Reporting','Export Reports'),
  (gen_random_uuid(),'REPORTING_VIEW_DASHBOARD_ANALYTICS','Reporting','View Dashboard Analytics'),

  (gen_random_uuid(),'MASTER_DATA_VIEW','Master Data','View'),
  (gen_random_uuid(),'MASTER_DATA_CREATE','Master Data','Create'),
  (gen_random_uuid(),'MASTER_DATA_EDIT','Master Data','Edit'),
  (gen_random_uuid(),'MASTER_DATA_ENABLE','Master Data','Enable'),
  (gen_random_uuid(),'MASTER_DATA_DISABLE','Master Data','Disable'),
  (gen_random_uuid(),'MASTER_DATA_DELETE','Master Data','Delete'),

  (gen_random_uuid(),'USER_VIEW','User Management','View Users'),
  (gen_random_uuid(),'USER_CREATE','User Management','Create User'),
  (gen_random_uuid(),'USER_EDIT','User Management','Edit User'),
  (gen_random_uuid(),'USER_RESET_PASSWORD','User Management','Reset Password'),
  (gen_random_uuid(),'USER_FORCE_PASSWORD_RESET','User Management','Force Password Reset'),
  (gen_random_uuid(),'USER_ENABLE','User Management','Enable User'),
  (gen_random_uuid(),'USER_DISABLE','User Management','Disable User'),
  (gen_random_uuid(),'USER_LOCK','User Management','Lock User'),
  (gen_random_uuid(),'USER_UNLOCK','User Management','Unlock User'),
  (gen_random_uuid(),'USER_ASSIGN_ROLE','User Management','Assign Role'),
  (gen_random_uuid(),'USER_ASSIGN_PERMISSION','User Management','Assign Permission'),

  (gen_random_uuid(),'SETTINGS_COMPANY','Settings','Company Settings'),
  (gen_random_uuid(),'SETTINGS_FINANCE','Settings','Finance Settings'),
  (gen_random_uuid(),'SETTINGS_WORKFLOW','Settings','Workflow Settings'),
  (gen_random_uuid(),'SETTINGS_AI','Settings','AI Settings'),
  (gen_random_uuid(),'SETTINGS_NOTIFICATION','Settings','Notification Settings'),
  (gen_random_uuid(),'SETTINGS_TELEGRAM','Settings','Telegram Settings'),
  (gen_random_uuid(),'SETTINGS_BUSINESS_NUMBERING','Settings','Business Numbering'),
  (gen_random_uuid(),'SETTINGS_APPROVAL_MATRIX','Settings','Approval Matrix'),
  (gen_random_uuid(),'SETTINGS_APPROVAL_DELEGATION','Settings','Approval Delegation'),
  (gen_random_uuid(),'SETTINGS_SYSTEM_PARAMETERS','Settings','System Parameters');

-- Default grants so the matrix is immediately usable; every cell remains
-- editable afterwards (except Technical Admin, enforced at the application
-- layer) with no further deployment required.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('REQUESTER', ARRAY['DASHBOARD_VIEW','DASHBOARD_VIEW_REQUESTER','REQUEST_CREATE','REQUEST_EDIT','REQUEST_DELETE_DRAFT',
    'REQUEST_SUBMIT','REQUEST_CANCEL','REQUEST_VIEW_OWN','VALIDATION_VIEW','FINANCE_CONTEXT_VIEW','FINANCIAL_ANALYSIS_VIEW',
    'POLICY_VIEW','APPROVAL_VIEW','PAYMENT_VIEW']::text[]),
  ('APPROVER', ARRAY['DASHBOARD_VIEW','REQUEST_VIEW_ALL','VALIDATION_VIEW','FINANCE_CONTEXT_VIEW','FINANCIAL_ANALYSIS_VIEW',
    'POLICY_VIEW','APPROVAL_VIEW','APPROVAL_APPROVE','APPROVAL_REJECT','APPROVAL_REQUEST_CLARIFICATION','APPROVAL_DELEGATE']::text[]),
  ('FINANCE', ARRAY['DASHBOARD_VIEW','DASHBOARD_VIEW_FINANCE','REQUEST_VIEW_ALL','REQUEST_EXPORT','VALIDATION_VIEW','VALIDATION_RUN',
    'FINANCE_CONTEXT_VIEW','FINANCE_CONTEXT_RECALCULATE','FINANCIAL_ANALYSIS_VIEW','FINANCIAL_ANALYSIS_RUN','FINANCIAL_ANALYSIS_HUMAN_REVIEW',
    'POLICY_VIEW','POLICY_EVALUATE','FINANCE_CONTROL_VIEW','FINANCE_CONTROL_APPROVE','FINANCE_CONTROL_REJECT','FINANCE_CONTROL_HOLD_PAYMENT',
    'FINANCE_CONTROL_RELEASE_PAYMENT','PAYMENT_VIEW','PAYMENT_CREATE','PAYMENT_COMPLETE','PAYMENT_UPLOAD_SLIP','PAYMENT_EXPORT',
    'REPORTING_VIEW','REPORTING_EXPORT','REPORTING_VIEW_DASHBOARD_ANALYTICS','MASTER_DATA_VIEW']::text[]),
  ('FINANCE_MASTER', ARRAY['DASHBOARD_VIEW','DASHBOARD_VIEW_REQUESTER','DASHBOARD_VIEW_FINANCE','DASHBOARD_VIEW_REPORTS',
    'REQUEST_VIEW_ALL','REQUEST_EXPORT','VALIDATION_VIEW','VALIDATION_RUN','VALIDATION_OVERRIDE','FINANCE_CONTEXT_VIEW',
    'FINANCE_CONTEXT_RECALCULATE','FINANCIAL_ANALYSIS_VIEW','FINANCIAL_ANALYSIS_RUN','FINANCIAL_ANALYSIS_HUMAN_REVIEW',
    'FINANCIAL_ANALYSIS_OVERRIDE_RESULT','POLICY_VIEW','POLICY_EVALUATE','POLICY_OVERRIDE','APPROVAL_VIEW','FINANCE_CONTROL_VIEW',
    'FINANCE_CONTROL_APPROVE','FINANCE_CONTROL_REJECT','FINANCE_CONTROL_HOLD_PAYMENT','FINANCE_CONTROL_RELEASE_PAYMENT',
    'PAYMENT_VIEW','PAYMENT_CREATE','PAYMENT_COMPLETE','PAYMENT_UPLOAD_SLIP','PAYMENT_EXPORT','REPORTING_VIEW','REPORTING_EXPORT',
    'REPORTING_VIEW_DASHBOARD_ANALYTICS','MASTER_DATA_VIEW','MASTER_DATA_CREATE','MASTER_DATA_EDIT','MASTER_DATA_ENABLE',
    'MASTER_DATA_DISABLE','MASTER_DATA_DELETE','USER_VIEW','USER_CREATE','USER_EDIT','USER_RESET_PASSWORD',
    'USER_FORCE_PASSWORD_RESET','USER_ENABLE','USER_DISABLE','USER_LOCK','USER_UNLOCK','USER_ASSIGN_ROLE','USER_ASSIGN_PERMISSION',
    'SETTINGS_COMPANY','SETTINGS_FINANCE','SETTINGS_WORKFLOW','SETTINGS_AI','SETTINGS_NOTIFICATION','SETTINGS_TELEGRAM',
    'SETTINGS_BUSINESS_NUMBERING','SETTINGS_APPROVAL_MATRIX','SETTINGS_APPROVAL_DELEGATION','SETTINGS_SYSTEM_PARAMETERS']::text[])
) AS codes(role_code,list)
JOIN roles r ON r.code = codes.role_code
JOIN permissions p ON p.code = ANY(codes.list);

-- Technical Admin starts with the full permission catalogue; Finance Master
-- cannot alter it (enforced at the application layer via roles.is_system).
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'ADMIN';

REVOKE ALL ON roles,permissions,role_permissions FROM PUBLIC;
GRANT SELECT ON roles,permissions,role_permissions TO aims_app;
GRANT INSERT,UPDATE(name,description,disabled,updated_at) ON roles TO aims_app;
GRANT INSERT,DELETE ON role_permissions TO aims_app;

UPDATE aims_schema_version SET version=64,migration_id='064_p21_role_permission_matrix',applied_at=now() WHERE singleton=true AND version=63;
COMMIT;
