import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
const sql=await readFile(new URL("../../migrations/057_p7_document_scan_worker_leases.sql",import.meta.url),"utf8");
test("migration 057 is a forward-only schema 56 transition without trust promotion",()=>{
 assert.match(sql,/version=56 AND migration_id='056_payment_slip_trust_transition'/);
 assert.match(sql,/SET version=57,migration_id='057_p7_document_scan_worker_leases'/);
 assert.doesNotMatch(sql,/UPDATE\s+payment_documents\s+SET\s+security_status='CLEAN'/i);
 assert.match(sql,/scan_claim_token uuid/);assert.match(sql,/scan_failure_disposition varchar/);
});
test("migration 057 uses bounded SKIP LOCKED claims and stale-token finalization",()=>{
 assert.match(sql,/FOR UPDATE SKIP LOCKED LIMIT 1/);assert.match(sql,/scan_lease_expires_at/);assert.match(sql,/scan_next_attempt_at/);
 assert.match(sql,/doc\.scan_claim_token IS DISTINCT FROM p_claim_token/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION claim_next_payment_document_scan/);
 assert.match(sql,/TO aims_document_worker_executor/);
 assert.doesNotMatch(sql,/TO aims_payment_executor[^;]*claim_next_payment_document_scan/);
});
