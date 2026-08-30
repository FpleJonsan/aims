\set ON_ERROR_STOP on

-- Provider-independent role bootstrap. Credentials are assigned separately by
-- the deployment platform and must never be embedded in this file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_owner') THEN
    CREATE ROLE aims_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_migrator') THEN
    CREATE ROLE aims_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_app') THEN
    CREATE ROLE aims_app LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_finance_executor') THEN
    CREATE ROLE aims_finance_executor NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_finance_runtime') THEN
    CREATE ROLE aims_finance_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_payment_executor') THEN
    CREATE ROLE aims_payment_executor NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_payment_runtime') THEN
    CREATE ROLE aims_payment_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_document_worker_executor') THEN
    CREATE ROLE aims_document_worker_executor NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_document_worker_runtime') THEN
    CREATE ROLE aims_document_worker_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO aims_migrator,aims_app,aims_finance_runtime,aims_payment_runtime,aims_document_worker_runtime;
ALTER DATABASE :"DBNAME" OWNER TO aims_owner;
ALTER SCHEMA public OWNER TO aims_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,aims_app,aims_finance_executor,aims_finance_runtime,aims_payment_executor,aims_payment_runtime,aims_document_worker_executor,aims_document_worker_runtime;
GRANT USAGE ON SCHEMA public TO aims_app,aims_finance_executor,aims_finance_runtime,aims_payment_executor,aims_payment_runtime,aims_document_worker_executor,aims_document_worker_runtime;

GRANT aims_owner TO aims_migrator;
ALTER ROLE aims_migrator NOINHERIT;
GRANT aims_app TO aims_owner WITH ADMIN OPTION;
GRANT aims_app TO aims_finance_executor;
GRANT aims_finance_executor TO aims_finance_runtime;
GRANT aims_app TO aims_payment_executor;
GRANT aims_payment_executor TO aims_payment_runtime;
GRANT aims_document_worker_executor TO aims_document_worker_runtime;
