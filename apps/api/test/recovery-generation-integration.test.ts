import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import test from "node:test";
import pg from "pg";

const appUrl=process.env.DATABASE_URL,workerUrl=process.env.DOCUMENT_WORKER_DATABASE_URL,migratorUrl=process.env.AIMS_INTEGRATION_MIGRATOR_DATABASE_URL;
if(!appUrl||!workerUrl||!migratorUrl)throw new Error("isolated application, worker, and migrator database URLs are required");
const app=new pg.Pool({connectionString:appUrl}),worker=new pg.Pool({connectionString:workerUrl}),migrator=new pg.Pool({connectionString:migratorUrl});
type Claim={document_id:string;document_version:number;document_sha256:string;scan_attempt:number;claim_token:string};

async function generation(){return(await app.query<{generation:string;generation_sequence:string}>("SELECT generation,generation_sequence FROM aims_recovery_generation WHERE singleton")).rows[0]}
async function advance(reason:string){return(await migrator.query("SELECT * FROM advance_aims_recovery_generation($1,$2)",[reason,randomUUID()])).rows[0]}
async function insertDocument(){
 const base=(await app.query("SELECT id request_id,created_by user_id FROM payment_requests LIMIT 1")).rows[0],id=randomUUID(),sha=randomUUID().replaceAll("-","").padEnd(64,"0");
 await app.query(`INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status)
 VALUES($1,$2,$3,'recovery.pdf',$6,'application/pdf',10,$4,'INVOICE',1,$5,'LOCAL','application/pdf','application/pdf','QUARANTINED')`,[id,base.request_id,randomUUID(),sha,base.user_id,`quarantine/recovery/${id}`]);return{id,sha};
}
async function claim(){return(await worker.query<Claim>("SELECT * FROM claim_next_payment_document_scan($1,$2,$3,$4)",["p12-worker",30,3,randomUUID()])).rows[0]}
async function complete(c:Claim){return worker.query("SELECT complete_payment_document_scan($1,$2,$3,$4,$5,'CLEAN',NULL,0,'test-scanner','test-reference',NULL,$6)",[c.document_id,c.document_version,c.document_sha256,c.scan_attempt,c.claim_token,`active/recovery/${c.document_id}`])}

test("privileged advance is durable, non-idempotent, and denied to every runtime",async()=>{
 const before=await generation(),correlation=randomUUID();
 for(const runtime of [app,worker])await assert.rejects(()=>runtime.query("SELECT advance_aims_recovery_generation($1,$2)",["FORBIDDEN_RUNTIME_ADVANCE",randomUUID()]),/permission denied/);
 const advanced=(await migrator.query("SELECT * FROM advance_aims_recovery_generation($1,$2)",["P12_DISPOSABLE_ADVANCE",correlation])).rows[0];
 assert.notEqual(advanced.generation,before.generation);assert.equal(Number(advanced.generation_sequence),Number(before.generation_sequence)+1);
 await assert.rejects(()=>migrator.query("SELECT * FROM advance_aims_recovery_generation($1,$2)",["DUPLICATE_OPERATOR_COMMAND",correlation]),/already used/);
 const evidence=await migrator.query("SELECT reason,correlation_id FROM aims_recovery_generation_events WHERE generation=$1",[advanced.generation]);
 assert.deepEqual(evidence.rows[0],{reason:"P12_DISPOSABLE_ADVANCE",correlation_id:correlation});
});

test("an unexpired pre-advance document claim cannot finalize and a current claim can",async()=>{
 const created=await insertDocument(),old=await claim();assert.equal(old.document_id,created.id);
 const before=(await app.query("SELECT security_status,version,sha256,scan_attempt,scan_lease_expires_at FROM payment_documents WHERE id=$1",[created.id])).rows[0];
 assert.equal(before.security_status,"SCANNING");assert.ok(new Date(before.scan_lease_expires_at)>new Date());
 await advance("P12_DOCUMENT_CLAIM_FENCE");
 await assert.rejects(()=>complete(old),/stale/);
 const fenced=(await app.query("SELECT security_status,version,sha256,scan_attempt,scan_claim_token FROM payment_documents WHERE id=$1",[created.id])).rows[0];
 assert.equal(fenced.security_status,"SCANNING");assert.equal(fenced.version,before.version);assert.equal(fenced.sha256,before.sha256);assert.equal(fenced.scan_attempt,before.scan_attempt);assert.equal(fenced.scan_claim_token,null);
 const fresh=await claim();assert.equal(fresh.document_id,created.id);assert.equal(fresh.scan_attempt,old.scan_attempt+1);await complete(fresh);
 assert.equal((await app.query("SELECT security_status FROM payment_documents WHERE id=$1",[created.id])).rows[0].security_status,"CLEAN");
});

test("sessions are database-bound to generation and stale sessions fail closed",async()=>{
 const identity=(await app.query("SELECT x.id identity_id,x.user_id FROM user_external_identities x JOIN users u ON u.id=x.user_id AND u.active LIMIT 1")).rows[0];assert.ok(identity);
 const oldHash=createHash("sha256").update(randomUUID()).digest("hex");
 await app.query("INSERT INTO aims_sessions(id,token_hash,csrf_token_hash,user_id,external_identity_id,authentication_method,expires_at)VALUES($1,$2,$3,$4,$5,'LOCAL_ADAPTER',now()+interval '1 hour')",[randomUUID(),oldHash,createHash("sha256").update("csrf").digest("hex"),identity.user_id,identity.identity_id]);
 const authenticate=(hash:string)=>app.query("SELECT 1 FROM aims_sessions s WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.issued_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton)",[hash]);
 assert.equal((await authenticate(oldHash)).rowCount,1);await advance("P12_SESSION_FENCE");assert.equal((await authenticate(oldHash)).rowCount,0);
 const freshHash=createHash("sha256").update(randomUUID()).digest("hex");await app.query("INSERT INTO aims_sessions(id,token_hash,csrf_token_hash,user_id,external_identity_id,authentication_method,expires_at)VALUES($1,$2,$3,$4,$5,'LOCAL_ADAPTER',now()+interval '1 hour')",[randomUUID(),freshHash,createHash("sha256").update("csrf2").digest("hex"),identity.user_id,identity.identity_id]);assert.equal((await authenticate(freshHash)).rowCount,1);
});

test("stale outbox claims cannot finalize and historical financial truth is unchanged",async()=>{
 const baseline=(await app.query(`SELECT(SELECT count(*) FROM payments)payments,(SELECT count(*) FROM financial_ledger_entries)ledger,(SELECT count(*) FROM budget_commitments)commitments,(SELECT count(*) FROM finance_control_checks)finance_checks,(SELECT count(*) FROM approval_actions)approval_history,(SELECT count(*) FROM audit_events)audit_history`)).rows[0];
 const id=randomUUID();await app.query("INSERT INTO notification_outbox(id,aggregate_type,aggregate_id,event_type,channel,payload)VALUES($1,'P12_TEST',$2,'P12_TEST','TELEGRAM','{}')",[id,randomUUID()]);
 const token=randomUUID();await app.query("UPDATE notification_outbox SET status='PROCESSING',attempts=attempts+1,claimed_at=now(),claim_token=$2,claimed_by='p12-old' WHERE id=$1",[id,token]);
 await advance("P12_OUTBOX_CLAIM_FENCE");
 const stale=await app.query("UPDATE notification_outbox SET status='SENT',claim_token=NULL,claimed_at=NULL,claimed_by=NULL WHERE id=$1 AND status='PROCESSING' AND claim_token=$2 AND claim_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton)",[id,token]);assert.equal(stale.rowCount,0);
 const row=(await app.query("SELECT status,claim_token,last_error_code FROM notification_outbox WHERE id=$1",[id])).rows[0];assert.deepEqual(row,{status:"FAILED_RETRYABLE",claim_token:null,last_error_code:"RECOVERY_GENERATION_ADVANCED"});
 const after=(await app.query(`SELECT(SELECT count(*) FROM payments)payments,(SELECT count(*) FROM financial_ledger_entries)ledger,(SELECT count(*) FROM budget_commitments)commitments,(SELECT count(*) FROM finance_control_checks)finance_checks,(SELECT count(*) FROM approval_actions)approval_history,(SELECT count(*) FROM audit_events)audit_history`)).rows[0];
  assert.deepEqual(after,baseline);
});

test("generation advance and worker finalization have one database serialization point",async()=>{
 const first=await insertDocument(),old=await claim();assert.equal(old.document_id,first.id);
 const recovery=await migrator.connect();
 try{
  await recovery.query("BEGIN");await recovery.query("SELECT * FROM advance_aims_recovery_generation($1,$2)",["P12_CONCURRENCY_ADVANCE",randomUUID()]);
  let settled=false;const finalization=complete(old).then(()=>{settled=true;return"completed" as const},error=>{settled=true;return error as Error});
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal(settled,false,"old worker must wait behind the recovery serialization lock");
  await recovery.query("COMMIT");const result=await finalization;assert.ok(result instanceof Error&&/stale/.test(result.message));
  assert.equal((await app.query("SELECT security_status FROM payment_documents WHERE id=$1",[first.id])).rows[0].security_status,"SCANNING");
 }finally{await recovery.query("ROLLBACK").catch(()=>undefined);recovery.release()}
 const reclaimed=await claim();assert.equal(reclaimed.document_id,first.id);await complete(reclaimed);

 const second=await insertDocument(),current=await claim();assert.equal(current.document_id,second.id);
 const workerTransaction=await worker.connect();
 try{
  await workerTransaction.query("BEGIN");await workerTransaction.query("SELECT complete_payment_document_scan($1,$2,$3,$4,$5,'REJECTED',NULL,0,'test-scanner','race-before-advance',NULL,NULL)",[current.document_id,current.document_version,current.document_sha256,current.scan_attempt,current.claim_token]);
  let advanced=false;const recoveryAfter=migrator.query("SELECT * FROM advance_aims_recovery_generation($1,$2)",["P12_CONCURRENCY_AFTER_FINALIZE",randomUUID()]).then(value=>{advanced=true;return value});
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal(advanced,false,"advance must wait for an old-generation mutation already in flight");
  await workerTransaction.query("COMMIT");await recoveryAfter;
  assert.equal((await app.query("SELECT security_status FROM payment_documents WHERE id=$1",[second.id])).rows[0].security_status,"REJECTED");
 }finally{await workerTransaction.query("ROLLBACK").catch(()=>undefined);workerTransaction.release()}
});

test.after(async()=>{await Promise.all([app.end(),worker.end(),migrator.end()])});
