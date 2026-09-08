import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";

const migration=await readFile(new URL("../../migrations/061_p13_storage_object_version_binding.sql",import.meta.url),"utf8");
const worker=await readFile(new URL("../../src/worker/document-scan-worker.ts",import.meta.url),"utf8");
const documentService=await readFile(new URL("../../src/application/documents/payment-document.service.ts",import.meta.url),"utf8");
const quarantineService=await readFile(new URL("../../src/application/documents/document-quarantine-service.ts",import.meta.url),"utf8");

test("migration 061 is the sole guarded schema 60 to 61 transition",async()=>{
 const names=(await readdir(new URL("../../migrations/",import.meta.url))).filter(name=>/^\d{3}_.*\.sql$/.test(name)).sort();
 assert.equal(names.length,61);assert.equal(names.at(-1),"061_p13_storage_object_version_binding.sql");
 assert.match(migration,/requires schema version 60/);assert.match(migration,/version=61,migration_id='061_p13_storage_object_version_binding'/);
 assert.doesNotMatch(migration,/CREATE ROLE|ALTER ROLE|S3|AWS|GCS|Azure/i);
});

test("migration 061 preserves truthful legacy rows and separate immutable source and trusted identities",()=>{
 for(const value of ["LEGACY_UNBOUND","VERSION_BOUND","storage_backend_id","storage_object_version","trusted_storage_object_key","trusted_storage_object_version"])assert.match(migration,new RegExp(value));
 assert.match(migration,/DEFAULT 'LEGACY_UNBOUND'/);assert.doesNotMatch(migration,/UPDATE payment_documents SET storage_(?:backend_id|object_version)/);
 assert.match(migration,/document identity and source provenance are immutable/);assert.match(migration,/trusted document identity is write-once/);
});

test("P7 completion binds complete physical identity and remains least privilege",()=>{
 for(const value of ["p_backend_id","p_source_key","p_source_version","p_sha256","p_size_bytes","p_claim_token","current_generation","p_trusted_object_key","p_trusted_object_version"])assert.match(migration,new RegExp(value));
 assert.match(migration,/REVOKE ALL ON FUNCTION claim_next_payment_document_scan/);assert.match(migration,/TO aims_document_worker_executor/);
 assert.match(migration,/REVOKE UPDATE\(storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key,trusted_storage_object_version\)/);
 assert.match(migration,/IS DISTINCT FROM lower\(p_sha256\)/);assert.match(migration,/scan_lease_expires_at<=clock_timestamp\(\)/);
 assert.match(migration,/p_lease_seconds IS NULL OR p_max_attempts IS NULL/);
});

test("all CLEAN documents converge on durable promotion and synchronous API scan is closed",()=>{
 assert.doesNotMatch(worker,/document_type\s*!==\s*["']PAYMENT_SLIP/);
 assert.match(worker,/promoteQuarantined/);
 assert.match(documentService,/Document scanning is performed by the durable document worker/);
 assert.doesNotMatch(documentService,/scanner\.scan|scanPaymentSlip/);
 assert.doesNotMatch(quarantineService,/class DocumentQuarantineService|scanAndPromote/);
});

test("version-bound upload provenance is adapter-derived and never client-derived",()=>{
 assert.match(documentService,/stored\.provider/);assert.doesNotMatch(documentService,/storage_provider[^\n]*LOCAL/);
 assert.match(migration,/storage_provider text/);assert.match(migration,/actor,storage_provider,mime/);
});

test("worker binds promotion to the exact precomputed trusted destination",()=>{
 assert.match(worker,/requestedTrustedKey=this\.storage\.trustedKey/);
 assert.match(worker,/promoted\.key!==requestedTrustedKey/);
});
