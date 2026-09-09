import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { adminSql, COMPETITION_DB, guardCompetition } from "./competition-guard.mjs";

guardCompetition();
const root = resolve(import.meta.dirname, "../migrations");
const files = (await readdir(root)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
if (!files.length) throw new Error("Competition reset refused: no migrations found.");

adminSql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${COMPETITION_DB}' AND pid<>pg_backend_pid();\nDROP DATABASE IF EXISTS ${COMPETITION_DB};\nCREATE DATABASE ${COMPETITION_DB};`, "postgres");
for (const file of files) {
  adminSql(await readFile(resolve(root, file), "utf8"));
  process.stdout.write(`Applied ${file}\n`);
}

// Create runtime roles (migrations only create executor roles) and set up grants
const password = process.env.POSTGRES_PASSWORD || "111";
adminSql(`
  -- Create runtime roles if they don't exist (migrations only create executor roles)
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_finance_runtime') THEN
      CREATE ROLE aims_finance_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_payment_runtime') THEN
      CREATE ROLE aims_payment_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aims_document_worker_runtime') THEN
      CREATE ROLE aims_document_worker_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
  END $$;
  
  -- Set passwords for all LOGIN roles
  ALTER ROLE aims_app WITH PASSWORD '${password}';
  ALTER ROLE aims_finance_runtime WITH PASSWORD '${password}';
  ALTER ROLE aims_payment_runtime WITH PASSWORD '${password}';
  ALTER ROLE aims_document_worker_runtime WITH PASSWORD '${password}';
  
  -- Grant executor roles to runtime roles (needed for SECURITY DEFINER functions)
  GRANT aims_app TO aims_finance_executor;
  GRANT aims_app TO aims_payment_executor;
  GRANT aims_app TO aims_document_worker_executor;
  GRANT aims_finance_executor TO aims_finance_runtime;
  GRANT aims_payment_executor TO aims_payment_runtime;
  GRANT aims_document_worker_executor TO aims_document_worker_runtime;
  
  -- Grant aims_owner permission to call authenticated actor functions
  -- (needed because SECURITY DEFINER functions owned by aims_owner call these)
  GRANT EXECUTE ON FUNCTION aims_authenticated_payment_actor() TO aims_owner;
  GRANT EXECUTE ON FUNCTION aims_authenticated_finance_actor() TO aims_owner;
  
  -- Grant aims_owner access to all tables (needed for SECURITY DEFINER functions)
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aims_owner;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aims_owner;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO aims_owner;
`, COMPETITION_DB);

process.stdout.write(`Competition database ${COMPETITION_DB} rebuilt safely. Run seed:competition next.\n`);
