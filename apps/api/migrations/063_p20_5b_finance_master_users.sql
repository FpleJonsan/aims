BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=62 AND migration_id='062_p20_5a_password_auth') THEN
  RAISE EXCEPTION 'migration 063 requires schema version 62 (062_p20_5a_password_auth)';
 END IF;
END;
$$;

-- Finance Master is a new, additional coarse role — ADMIN (Technical Admin,
-- developer-only) is untouched and stays out of business-facing User
-- Management entirely.
ALTER TABLE user_roles DROP CONSTRAINT user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check CHECK (role IN ('REQUESTER','FINANCE','ADMIN','FINANCE_MASTER'));

ALTER TABLE users ADD COLUMN last_login_at timestamptz;

-- Audit enrichment: administrative actions must also carry the acting
-- Finance Master's display name at the time of the action (role snapshot
-- and IP were already added to audit_events in migration 062).
ALTER TABLE audit_events ADD COLUMN actor_display_name_snapshot varchar(160);

-- User Management is an authenticated, Finance-Master-only surface (unlike
-- Phase A's self-registration, which is unauthenticated and therefore uses a
-- SECURITY DEFINER trusted entry point to keep 'REQUESTER' hard-coded at the
-- database layer). Here the caller is already an authenticated Finance
-- Master verified at the application layer, so ordinary narrow GRANTs are
-- consistent with how the rest of the schema is governed.
GRANT INSERT ON users TO aims_app;
GRANT UPDATE(active,last_login_at) ON users TO aims_app;
GRANT INSERT ON user_external_identities TO aims_app;
GRANT INSERT ON password_credentials TO aims_app;
GRANT INSERT,DELETE ON user_roles TO aims_app;
GRANT INSERT ON approval_authorities TO aims_app;
GRANT UPDATE(active) ON approval_authorities TO aims_app;

UPDATE aims_schema_version SET version=63,migration_id='063_p20_5b_finance_master_users',applied_at=now() WHERE singleton=true AND version=62;
COMMIT;
