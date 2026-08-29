import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../migrations/056_payment_slip_trust_transition.sql", import.meta.url);

test("migration 056 is a guarded forward-only schema 55 transition", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /requires schema version 55 \(055_p3_p4_document_security\)/);
  assert.match(sql, /SET version=56,migration_id='056_payment_slip_trust_transition'/);
  assert.doesNotMatch(sql, /DISABLE\s+TRIGGER|session_replication_role/i);
});

test("migration 056 exposes only narrow payment-executor trust functions", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /REVOKE ALL ON FUNCTION begin_payment_slip_security_scan[\s\S]*FROM PUBLIC,aims_app/);
  assert.match(sql, /REVOKE ALL ON FUNCTION complete_payment_slip_security_scan[\s\S]*FROM PUBLIC,aims_app/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION begin_payment_slip_security_scan[\s\S]*TO aims_payment_executor/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION complete_payment_slip_security_scan[\s\S]*TO aims_payment_executor/);
  assert.match(sql, /SECURITY DEFINER SET search_path=pg_catalog,public/);
  assert.match(sql, /payment slip business evidence is immutable/);
});

test("migration 056 retains CLEAN latest-current payment evidence as the payment gate", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /d\.security_status='CLEAN'/);
  assert.match(sql, /stale payment slip scan denied/);
  assert.match(sql, /CLEAN current payment slip required/);
});
