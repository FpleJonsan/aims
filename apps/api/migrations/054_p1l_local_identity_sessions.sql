BEGIN;

CREATE TABLE user_external_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  provider varchar(64) NOT NULL,
  issuer varchar(255) NOT NULL,
  subject varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject),
  UNIQUE (user_id, provider, issuer)
);

CREATE INDEX user_external_identities_user_idx
  ON user_external_identities (user_id);

INSERT INTO user_external_identities(id,user_id,provider,issuer,subject)
SELECT gen_random_uuid(),id,'local','aims-local',external_subject
FROM users
WHERE external_subject LIKE 'demo.%'
ON CONFLICT (issuer,subject) DO NOTHING;

INSERT INTO user_external_identities(id,user_id,provider,issuer,subject)
SELECT gen_random_uuid(),id,'competition','aims-competition',external_subject
FROM users
WHERE external_subject LIKE 'competition.%'
ON CONFLICT (issuer,subject) DO NOTHING;

CREATE TABLE aims_sessions (
  id uuid PRIMARY KEY,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_token_hash char(64) NOT NULL CHECK (csrf_token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id),
  external_identity_id uuid NOT NULL REFERENCES user_external_identities(id),
  authentication_method varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX aims_sessions_user_active_idx
  ON aims_sessions (user_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE authentication_audit_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  external_identity_id uuid REFERENCES user_external_identities(id),
  authentication_method varchar(64),
  source_channel varchar(64) NOT NULL,
  event_type varchar(80) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id varchar(128) NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX authentication_audit_events_user_idx
  ON authentication_audit_events (user_id,occurred_at DESC);

CREATE TRIGGER authentication_audit_events_append_only
BEFORE UPDATE OR DELETE ON authentication_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

GRANT SELECT ON user_external_identities TO aims_app;
GRANT SELECT,INSERT ON aims_sessions TO aims_app;
GRANT UPDATE (revoked_at) ON aims_sessions TO aims_app;
GRANT SELECT,INSERT ON authentication_audit_events TO aims_app;

UPDATE aims_schema_version
SET version=54,migration_id='054_p1l_local_identity_sessions',applied_at=now()
WHERE singleton=true AND version=53;

COMMIT;
