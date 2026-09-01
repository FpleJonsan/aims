import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
const sql=await readFile(new URL("../../migrations/057_p7_document_scan_worker_leases.sql",import.meta.url),"utf8");
const p10=await readFile(new URL("../../migrations/058_p10_observability_claim_recovery_and_outbox_index.sql",import.meta.url),"utf8");
test("migration 057 is a forward-only schema 56 transition without trust promotion",()=>{
 assert.match(sql,/version=56 AND migration_id='056_payment_slip_trust_transition'/);
 assert.match(sql,/SET version=57,migration_id='057_p7_document_scan_worker_leases'/);
 assert.doesNotMatch(sql,/UPDATE\s+payment_documents\s+SET\s+security_status='CLEAN'/i);
 assert.match(sql,/scan_claim_token uuid/);assert.match(sql,/scan_failure_disposition varchar/);
});
test("migration 058 exposes authoritative recovery and adds only the terminal outbox index",()=>{
 assert.match(p10,/version=57 AND migration_id='057_p7_document_scan_worker_leases'/);
 assert.match(p10,/expired_lease_recovered boolean/);
 assert.match(p10,/recovered:=doc\.security_status='SCANNING'/);
 assert.match(p10,/FOR UPDATE SKIP LOCKED LIMIT 1/);
 assert.match(p10,/notification_outbox_failed_terminal_idx/);
 assert.match(p10,/WHERE status='FAILED_TERMINAL'/);
 assert.match(p10,/OWNER TO aims_owner/);
 assert.match(p10,/REVOKE ALL ON FUNCTION claim_next_payment_document_scan[^;]+FROM PUBLIC,aims_app,aims_finance_executor,aims_payment_executor/);
 assert.match(p10,/SET version=58,migration_id='058_p10_observability_claim_recovery_and_outbox_index'/);
 assert.doesNotMatch(p10,/CREATE (?:TABLE|ROLE)|ALTER DEFAULT PRIVILEGES/i);
});
test("migration 057 uses bounded SKIP LOCKED claims and stale-token finalization",()=>{
 assert.match(sql,/FOR UPDATE SKIP LOCKED LIMIT 1/);assert.match(sql,/scan_lease_expires_at/);assert.match(sql,/scan_next_attempt_at/);
 assert.match(sql,/doc\.scan_claim_token IS DISTINCT FROM p_claim_token/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION claim_next_payment_document_scan/);
 assert.match(sql,/TO aims_document_worker_executor/);
 assert.doesNotMatch(sql,/TO aims_payment_executor[^;]*claim_next_payment_document_scan/);
});
