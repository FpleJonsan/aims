import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";

const migration=await readFile(new URL("../../migrations/059_p12_recovery_generation_fencing.sql",import.meta.url),"utf8");

test("migration 059 is the sole forward recovery-generation migration",async()=>{
 const names=(await readdir(new URL("../../migrations/",import.meta.url))).filter(name=>/^\d{3}_.*\.sql$/.test(name)).sort();
 assert.equal(names.at(-1),"059_p12_recovery_generation_fencing.sql");assert.equal(names.length,59);
 assert.match(migration,/requires schema version 58/);assert.match(migration,/SET version=59,migration_id='059_p12_recovery_generation_fencing'/);
});

test("recovery generation is durable, unique, monotonic, audited, and migrator-only",()=>{
 assert.match(migration,/CREATE TABLE aims_recovery_generation/);assert.match(migration,/generation uuid NOT NULL UNIQUE/);assert.match(migration,/generation_sequence bigint NOT NULL UNIQUE CHECK\(generation_sequence>0\)/);
 assert.match(migration,/CREATE TABLE aims_recovery_generation_events/);assert.match(migration,/append_only/);assert.match(migration,/correlation_id uuid NOT NULL UNIQUE/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION advance_aims_recovery_generation\(text,uuid\) TO aims_migrator/);
 assert.match(migration,/REVOKE ALL ON FUNCTION advance_aims_recovery_generation\(text,uuid\) FROM aims_app,aims_finance_executor,aims_payment_executor,aims_document_worker_executor/);
 assert.doesNotMatch(migration,/CREATE ROLE|ALTER ROLE/);
});

test("only replay-sensitive authority is fenced and financial history is untouched",()=>{
 for(const token of ["aims_sessions","approval_action_tokens","telegram_pending_interactions","notification_outbox","payment_documents"])assert.match(migration,new RegExp(token));
 for(const historical of ["payments","financial_ledger_entries","budget_commitments","finance_control_runs","approval_actions"])assert.doesNotMatch(migration,new RegExp(`UPDATE public\\.${historical}|ALTER TABLE ${historical}`));
 assert.match(migration,/scan_claim_generation IS DISTINCT FROM current_generation/);assert.match(migration,/scan_claim_token IS DISTINCT FROM p_claim_token/);assert.match(migration,/doc\.version<>p_document_version/);assert.match(migration,/doc\.sha256<>lower\(p_sha256\)/);
});

test("generation advance and consumers share an explicit serialization contract",()=>{
 assert.match(migration,/pg_advisory_xact_lock\(hashtext\('aims:recovery-generation'\)\)/);
 assert.match(migration,/WHERE singleton FOR UPDATE/);assert.match(migration,/WHERE singleton FOR SHARE/);
 assert.match(migration,/MIGRATION_059_INITIAL_GENERATION/);assert.match(migration,/RECOVERY_GENERATION_ADVANCED/);
});
