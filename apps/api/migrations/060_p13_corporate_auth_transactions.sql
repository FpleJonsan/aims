BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=59 AND migration_id='059_p12_recovery_generation_fencing') THEN
  RAISE EXCEPTION 'migration 060 requires schema version 59 (059_p12_recovery_generation_fencing)';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aims_owner') THEN RAISE EXCEPTION 'migration 060 requires the P6 aims_owner role';END IF;
END;
$$;

-- Ephemeral, provider-neutral pre-authentication state; never an authenticated
-- AIMS session, identity, token vault, or business authority.
CREATE TABLE corporate_auth_transactions (
 id uuid PRIMARY KEY,
 state_digest char(64) NOT NULL UNIQUE CHECK(state_digest~'^[0-9a-f]{64}$'),
 pkce_verifier varchar(128) NOT NULL CHECK(length(pkce_verifier) BETWEEN 43 AND 128 AND pkce_verifier~'^[A-Za-z0-9._~-]+$'),
 nonce_digest char(64) NOT NULL CHECK(nonce_digest~'^[0-9a-f]{64}$'),
 return_path varchar(512) NOT NULL CHECK(return_path~'^/[^/][A-Za-z0-9/_?&=.%+~-]*$' OR return_path='/'),
 provider_adapter varchar(64) NOT NULL CHECK(provider_adapter~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
 expected_issuer varchar(512) NOT NULL CHECK(length(expected_issuer) BETWEEN 1 AND 512 AND expected_issuer!~'[[:cntrl:]]'),
 correlation_id uuid NOT NULL,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 issued_generation uuid NOT NULL,
 CHECK(expires_at>created_at),CHECK(expires_at<=created_at+interval '15 minutes'),
 CHECK(consumed_at IS NULL OR consumed_at>=created_at)
);
CREATE INDEX corporate_auth_transactions_expiry_idx ON corporate_auth_transactions(expires_at);

CREATE FUNCTION create_corporate_auth_transaction(
 p_id uuid,p_state_digest text,p_pkce_verifier text,p_nonce_digest text,p_return_path text,
 p_provider_adapter text,p_expected_issuer text,p_lifetime_seconds integer,p_correlation_id uuid
) RETURNS TABLE(transaction_id uuid,expires_at timestamptz)
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE now_at timestamptz:=clock_timestamp();current_generation uuid;
BEGIN
 IF session_user<>'aims_app' THEN RAISE EXCEPTION 'permission denied for corporate auth transactions' USING ERRCODE='42501';END IF;
 IF p_id IS NULL OR p_correlation_id IS NULL THEN RAISE EXCEPTION 'transaction and correlation identifiers are required';END IF;
 IF p_state_digest IS NULL OR p_state_digest!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid state digest';END IF;
 IF p_pkce_verifier IS NULL OR length(p_pkce_verifier) NOT BETWEEN 43 AND 128 OR p_pkce_verifier!~'^[A-Za-z0-9._~-]+$' THEN RAISE EXCEPTION 'invalid PKCE verifier';END IF;
 IF p_nonce_digest IS NULL OR p_nonce_digest!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid nonce digest';END IF;
 IF p_return_path IS NULL OR length(p_return_path)>512 OR NOT(p_return_path~'^/[^/][A-Za-z0-9/_?&=.%+~-]*$' OR p_return_path='/') THEN RAISE EXCEPTION 'invalid return path';END IF;
 IF p_provider_adapter IS NULL OR p_provider_adapter!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' THEN RAISE EXCEPTION 'invalid provider adapter';END IF;
 IF p_expected_issuer IS NULL OR length(p_expected_issuer) NOT BETWEEN 1 AND 512 OR p_expected_issuer~'[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid expected issuer';END IF;
 IF p_lifetime_seconds NOT BETWEEN 60 AND 900 THEN RAISE EXCEPTION 'transaction lifetime must be between 60 and 900 seconds';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('aims:recovery-generation'));
 SELECT generation INTO STRICT current_generation FROM public.aims_recovery_generation WHERE singleton FOR SHARE;
 INSERT INTO public.corporate_auth_transactions(id,state_digest,pkce_verifier,nonce_digest,return_path,provider_adapter,expected_issuer,correlation_id,created_at,expires_at,issued_generation)
 VALUES(p_id,p_state_digest,p_pkce_verifier,p_nonce_digest,p_return_path,p_provider_adapter,p_expected_issuer,p_correlation_id,now_at,now_at+make_interval(secs=>p_lifetime_seconds),current_generation);
 RETURN QUERY SELECT p_id,now_at+make_interval(secs=>p_lifetime_seconds);
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION consume_corporate_auth_transaction(p_state_digest text)
RETURNS TABLE(transaction_id uuid,pkce_verifier text,nonce_digest text,return_path text,provider_adapter text,expected_issuer text,correlation_id uuid)
SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF session_user<>'aims_app' THEN RAISE EXCEPTION 'permission denied for corporate auth transactions' USING ERRCODE='42501';END IF;
 IF p_state_digest IS NULL OR p_state_digest!~'^[0-9a-f]{64}$' THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('aims:recovery-generation'));
 RETURN QUERY UPDATE public.corporate_auth_transactions t SET consumed_at=clock_timestamp()
 FROM public.aims_recovery_generation g
 WHERE g.singleton AND t.state_digest=p_state_digest AND t.consumed_at IS NULL
  AND t.expires_at>clock_timestamp() AND t.issued_generation=g.generation
 RETURNING t.id,t.pkce_verifier::text,t.nonce_digest::text,t.return_path::text,t.provider_adapter::text,t.expected_issuer::text,t.correlation_id;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE corporate_auth_transactions OWNER TO aims_owner;
ALTER FUNCTION create_corporate_auth_transaction(uuid,text,text,text,text,text,text,integer,uuid) OWNER TO aims_owner;
ALTER FUNCTION consume_corporate_auth_transaction(text) OWNER TO aims_owner;
REVOKE ALL ON TABLE corporate_auth_transactions FROM PUBLIC,aims_app,aims_finance_executor,aims_finance_runtime,aims_payment_executor,aims_payment_runtime,aims_document_worker_executor,aims_document_worker_runtime;
REVOKE ALL ON FUNCTION create_corporate_auth_transaction(uuid,text,text,text,text,text,text,integer,uuid),consume_corporate_auth_transaction(text) FROM PUBLIC,aims_finance_executor,aims_finance_runtime,aims_payment_executor,aims_payment_runtime,aims_document_worker_executor,aims_document_worker_runtime;
GRANT EXECUTE ON FUNCTION create_corporate_auth_transaction(uuid,text,text,text,text,text,text,integer,uuid),consume_corporate_auth_transaction(text) TO aims_app;

UPDATE aims_schema_version SET version=60,migration_id='060_p13_corporate_auth_transactions',applied_at=now() WHERE singleton=true AND version=59;
COMMIT;
