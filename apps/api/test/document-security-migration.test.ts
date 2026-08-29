import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../migrations/055_p3_p4_document_security.sql", import.meta.url);

test("migration 055 is additive for historical documents and defaults them to UNVERIFIED", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /security_status varchar\(24\) NOT NULL DEFAULT 'UNVERIFIED'/);
  assert.match(sql, /security_status IN\('UNVERIFIED','QUARANTINED','SCANNING','CLEAN','REJECTED','SCAN_FAILED'\)/);
  assert.doesNotMatch(sql, /UPDATE\s+payment_documents\s+SET\s+declared_mime_type/is);
  assert.doesNotMatch(sql, /DISABLE\s+TRIGGER|session_replication_role|migration_mode/i);
  assert.match(sql, /Pre-055 rows are additive-DDL initialized as UNVERIFIED without fabricated MIME or scan provenance/);
});

test("migration 055 preserves future fail-closed scan provenance constraints", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /security_status IN\('CLEAN','REJECTED'\).*scan_engine IS NOT NULL.*scan_reference IS NOT NULL/is);
  assert.match(sql, /security_status='SCAN_FAILED'.*scan_failure_code IS NOT NULL/is);
  assert.match(sql, /OLD\.security_status='SCANNING' AND NEW\.security_status IN\('CLEAN','REJECTED','SCAN_FAILED'\)/);
  assert.match(sql, /WHERE removed_at IS NULL AND security_status='CLEAN'/);
});
