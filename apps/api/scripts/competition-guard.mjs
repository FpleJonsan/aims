import pg from "pg";
import { spawnSync } from "node:child_process";

export const COMPETITION_DB = process.env.COMPETITION_DATABASE_NAME ?? "aims_competition";

export function isCompetitionEnvironment() {
  return process.env.AIMS_ENVIRONMENT === "competition" || process.env.AIMS_DEMO_MODE === "true";
}

export function guardCompetition({ requireRuntimeUrls = false } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("Competition command refused: NODE_ENV is production.");
  if (!isCompetitionEnvironment()) throw new Error("Competition command refused: AIMS_ENVIRONMENT=competition is required.");
  if (COMPETITION_DB !== "aims_competition") throw new Error("Competition command refused: database name must be exactly aims_competition.");
  if (requireRuntimeUrls) {
    for (const name of ["DATABASE_URL", "FINANCE_DATABASE_URL", "PAYMENT_DATABASE_URL"]) {
      const value = process.env[name];
      if (!value || new URL(value).pathname !== `/${COMPETITION_DB}`) {
        throw new Error(`Competition command refused: ${name} must target ${COMPETITION_DB}.`);
      }
    }
  }
}

export function pointRuntimeToCompetition() {
  for (const name of ["DATABASE_URL", "FINANCE_DATABASE_URL", "PAYMENT_DATABASE_URL"]) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required.`);
    const url = new URL(value);
    url.pathname = `/${COMPETITION_DB}`;
    process.env[name] = url.toString();
  }
}

export function adminUrl(database = "postgres") {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL is required to locate PostgreSQL.");
  const url = new URL(source);
  url.username = process.env.POSTGRES_USER ?? "postgres";
  url.password = process.env.POSTGRES_PASSWORD ?? "";
  url.pathname = `/${database}`;
  return url.toString();
}

export const { Client, Pool } = pg;

export function adminSql(sql, database = COMPETITION_DB) {
  const container = process.env.AIMS_POSTGRES_CONTAINER ?? "PostgreSQL";
  if (!/^[A-Za-z0-9_.-]+$/.test(container)) throw new Error("Invalid PostgreSQL container name.");
  if (database !== "postgres" && database !== COMPETITION_DB) throw new Error("Administrative SQL target refused.");
  const command = 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d ' + database;
  const result = spawnSync("docker", ["exec", "-i", container, "sh", "-lc", command], { input: sql, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "PostgreSQL administrative command failed.");
  return result.stdout;
}

export function bindSql(text, values = []) {
  return values.reduceRight((sql, value, index) => {
    const literal = value === null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
    return sql.replaceAll(`$${index + 1}`, literal);
  }, text);
}
