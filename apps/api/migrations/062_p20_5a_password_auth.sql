BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=61 AND migration_id='061_p13_storage_object_version_binding') THEN
  RAISE EXCEPTION 'migration 062 requires schema version 61 (061_p13_storage_object_version_binding)';
 END IF;
END;
$$;

CREATE TABLE password_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  hash bytea NOT NULL,
  salt bytea NOT NULL,
  scrypt_params jsonb NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  force_reset boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX password_reset_tokens_user_idx
  ON password_reset_tokens (user_id, created_at DESC);

-- Audit enrichment (spec: every audited action must record IP + role snapshot).
-- Nullable/additive so existing rows and existing writers are unaffected;
-- new auth flows (this migration's application code) populate them immediately.
ALTER TABLE audit_events
  ADD COLUMN source_ip inet,
  ADD COLUMN actor_role_snapshot varchar(32)[];

ALTER TABLE authentication_audit_events
  ADD COLUMN source_ip inet,
  ADD COLUMN actor_role_snapshot varchar(32)[];

-- Self-registration is the only path by which application code may create a
-- user at runtime. It is a SECURITY DEFINER trusted entry point (matching the
-- existing convention used by create_corporate_auth_transaction /
-- attach_payment_slip) rather than a raw GRANT INSERT on users/user_roles,
-- so the "Requester-only" invariant is enforced in the database, not only in
-- application code that happens to always pass 'REQUESTER'.
CREATE FUNCTION self_register_requester(
  p_user_id uuid, p_department_id uuid, p_email varchar(320), p_display_name varchar(160),
  p_external_identity_id uuid, p_password_hash bytea, p_password_salt bytea, p_scrypt_params jsonb
) RETURNS TABLE(identity_id uuid, user_id uuid, department_id uuid, role varchar(32))
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_user_id IS NULL OR p_department_id IS NULL OR p_email IS NULL OR p_display_name IS NULL
     OR p_external_identity_id IS NULL OR p_password_hash IS NULL OR p_password_salt IS NULL OR p_scrypt_params IS NULL THEN
    RAISE EXCEPTION 'registration requires all identity fields';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM departments d WHERE d.id=p_department_id AND d.active) THEN
    RAISE EXCEPTION 'unknown or inactive department' USING ERRCODE='23503';
  END IF;
  IF EXISTS(SELECT 1 FROM users u WHERE u.email=p_email) THEN
    RAISE EXCEPTION 'email already registered' USING ERRCODE='23505';
  END IF;

  INSERT INTO users(id,external_subject,email,display_name,department_id)
  VALUES(p_user_id,p_email,p_email,p_display_name,p_department_id);

  INSERT INTO user_roles(user_id,role) VALUES(p_user_id,'REQUESTER');

  INSERT INTO user_external_identities(id,user_id,provider,issuer,subject)
  VALUES(p_external_identity_id,p_user_id,'password','aims-password',p_email);

  INSERT INTO password_credentials(user_id,hash,salt,scrypt_params)
  VALUES(p_user_id,p_password_hash,p_password_salt,p_scrypt_params);

  RETURN QUERY SELECT p_external_identity_id,p_user_id,p_department_id,'REQUESTER'::varchar(32);
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION self_register_requester(uuid,uuid,varchar(320),varchar(160),uuid,bytea,bytea,jsonb) OWNER TO aims_owner;
REVOKE ALL ON FUNCTION self_register_requester(uuid,uuid,varchar(320),varchar(160),uuid,bytea,bytea,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION self_register_requester(uuid,uuid,varchar(320),varchar(160),uuid,bytea,bytea,jsonb) TO aims_app;

GRANT SELECT ON password_credentials TO aims_app;
GRANT UPDATE(hash,salt,scrypt_params,failed_attempts,locked_until,force_reset,updated_at) ON password_credentials TO aims_app;
GRANT SELECT,INSERT ON password_reset_tokens TO aims_app;
GRANT UPDATE(used_at) ON password_reset_tokens TO aims_app;

UPDATE aims_schema_version SET version=62,migration_id='062_p20_5a_password_auth',applied_at=now() WHERE singleton=true AND version=61;
COMMIT;
