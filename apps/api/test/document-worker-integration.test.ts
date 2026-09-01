import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import {DocumentScanWorker} from "../src/worker/document-scan-worker.js";
import type {DocumentStorage,PromoteDocumentInput} from "../src/infrastructure/storage/document-storage.js";
import type {DocumentMalwareScanner} from "../src/application/documents/document-quarantine-service.js";
import type {WorkerConfig} from "../src/worker/worker-config.js";

const appUrl=process.env.DATABASE_URL,workerUrl=process.env.DOCUMENT_WORKER_DATABASE_URL;
if(!appUrl||!workerUrl)throw new Error("isolated application and document worker database URLs are required");
const app=new pg.Pool({connectionString:appUrl}),workerA=new pg.Pool({connectionString:workerUrl}),workerB=new pg.Pool({connectionString:workerUrl});
type Claim={document_id:string;document_version:number;document_sha256:string;scan_attempt:number;claim_token:string;expired_lease_recovered:boolean};
async function insertDocument(){
 const base=await app.query<{request_id:string;user_id:string}>("SELECT pr.id request_id,pr.created_by user_id FROM payment_requests pr JOIN users u ON u.id=pr.created_by LIMIT 1");
 assert.ok(base.rowCount);const id=randomUUID(),logical=randomUUID(),sha=randomUUID().replaceAll("-","").padEnd(64,"0");
 await app.query(`INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status)
 VALUES($1,$2,$3,'worker.pdf',$6,'application/pdf',10,$4,'INVOICE',1,$5,'LOCAL','application/pdf','application/pdf','QUARANTINED')`,[id,base.rows[0].request_id,logical,sha,base.rows[0].user_id,`quarantine/worker/${id}`]);return{id,sha};
}
async function claim(pool:pg.Pool,worker:string,lease=5,max=3){return(await pool.query("SELECT * FROM claim_next_payment_document_scan($1,$2,$3,$4)",[worker,lease,max,randomUUID()])).rows[0]??null}
async function complete(pool:pg.Pool,c:Claim,status:string,disposition:string|null=null,retry=0){return pool.query("SELECT complete_payment_document_scan($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[c.document_id,c.document_version,c.document_sha256,c.scan_attempt,c.claim_token,status,disposition,retry,status==="SCAN_FAILED"?null:"test-scanner",status==="SCAN_FAILED"?null:"test-reference",status==="SCAN_FAILED"?"SCANNER_UNAVAILABLE":null,status==="CLEAN"?`active/worker/${c.document_id}`:null])}
const runtimeConfig=(overrides:Partial<WorkerConfig>={}):WorkerConfig=>({workerId:"runtime-test",batchSize:1,leaseSeconds:5,maximumAttempts:3,retryDelaySeconds:1,pollIntervalMs:50,storageTimeoutMs:50,scannerTimeoutMs:50,shutdownGraceMs:500,telegramEnabled:false,scannerEnabled:true,documentDatabaseUrl:workerUrl,...overrides});
async function scanState(id:string){return(await app.query("SELECT security_status,version,sha256,scan_attempt,scan_claim_token,scan_claimed_by,scan_failure_code,scan_failure_disposition,scan_next_attempt_at FROM payment_documents WHERE id=$1",[id])).rows[0]}

test("document workers prevent duplicate claim and stale/duplicate finalization",async()=>{
 const created=await insertDocument(),[a,b]=await Promise.all([claim(workerA,"worker-a"),claim(workerB,"worker-b")]),current=a??b;
 assert.ok(current);assert.equal([a,b].filter(Boolean).length,1);assert.equal(current.document_id,created.id);
 assert.equal(current.expired_lease_recovered,false);
 await assert.rejects(()=>complete(workerB,{...current,claim_token:randomUUID()},"CLEAN"),/stale/);
 await complete(a?workerA:workerB,current,"CLEAN");
 await assert.rejects(()=>complete(a?workerA:workerB,current,"CLEAN"),/stale/);
 const reclaimed=await claim(workerA,"worker-a");assert.ok(!reclaimed||reclaimed.document_id!==created.id);
});

test("expired lease is reclaimed and old worker cannot finalize",async()=>{
 const created=await insertDocument(),old=await claim(workerA,"worker-old",5,3);assert.equal(old.document_id,created.id);
 await app.query("SELECT pg_sleep(5.1)");const fresh=await claim(workerB,"worker-new",5,3);assert.equal(fresh.document_id,created.id);assert.equal(fresh.scan_attempt,old.scan_attempt+1);assert.equal(fresh.expired_lease_recovered,true);
 await assert.rejects(()=>complete(workerA,old,"REJECTED"),/attempt is stale|claim is stale/);
 await complete(workerB,fresh,"REJECTED");
});

test("two workers racing an expired lease produce one authoritative recovery result",async()=>{
 const created=await insertDocument(),old=await claim(workerA,"recovery-race-old",5,3);assert.equal(old.document_id,created.id);assert.equal(old.expired_lease_recovered,false);
 await app.query("SELECT pg_sleep(5.1)");
 const results=await Promise.all([claim(workerA,"recovery-race-a",5,3),claim(workerB,"recovery-race-b",5,3)]),reclaims=results.filter(value=>value?.document_id===created.id);
 assert.equal(reclaims.length,1);assert.equal(reclaims[0].expired_lease_recovered,true);
 await complete(results[0]?.document_id===created.id?workerA:workerB,reclaims[0],"REJECTED");
});

for(const attack of ["version","sha256"] as const)test(`trusted finalization rejects stale document ${attack} without changing claim or trust`,async()=>{
 const created=await insertDocument(),current=await claim(workerA,`stale-${attack}`);assert.equal(current.document_id,created.id);
 const before=await scanState(created.id),auditBefore=Number((await app.query("SELECT count(*) count FROM audit_events WHERE safe_metadata->>'documentId'=$1",[created.id])).rows[0].count);
 const forged={...current,...(attack==="version"?{document_version:current.document_version+1}:{document_sha256:"f".repeat(64)})};
 await assert.rejects(()=>complete(workerA,forged,"CLEAN"),error=>error instanceof Error&&/document scan identity mismatch/.test(error.message));
 const after=await scanState(created.id),auditAfter=Number((await app.query("SELECT count(*) count FROM audit_events WHERE safe_metadata->>'documentId'=$1",[created.id])).rows[0].count);
 assert.deepEqual(after,before);assert.equal(auditAfter,auditBefore);assert.equal(after.security_status,"SCANNING");assert.equal(after.scan_claim_token,current.claim_token);
 await complete(workerA,current,"REJECTED");
});

test("retryable failure becomes eligible and terminal poison cannot be reclaimed",async()=>{
 const created=await insertDocument(),first=await claim(workerA,"worker-a",5,2);assert.equal(first.document_id,created.id);await complete(workerA,first,"SCAN_FAILED","RETRYABLE",1);
 await app.query("SELECT pg_sleep(1.1)");const second=await claim(workerB,"worker-b",5,2);assert.equal(second.document_id,created.id);assert.equal(second.expired_lease_recovered,false);await complete(workerB,second,"SCAN_FAILED","TERMINAL",0);
 const next=await claim(workerA,"worker-a",5,2);assert.ok(!next||next.document_id!==created.id);
 const row=await app.query("SELECT security_status,scan_failure_disposition,scan_attempt,scan_claim_token FROM payment_documents WHERE id=$1",[created.id]);assert.deepEqual(row.rows[0],{security_status:"SCAN_FAILED",scan_failure_disposition:"TERMINAL",scan_attempt:2,scan_claim_token:null});
});

test("document worker has no raw trust, financial, DDL, or role-switch authority",async()=>{
 await assert.rejects(()=>workerA.query("UPDATE payment_documents SET security_status='CLEAN' WHERE false"),/permission denied/);
 await assert.rejects(()=>workerA.query("CREATE TABLE worker_forbidden(id integer)"),/permission denied/);
 for(const role of ["aims_payment_executor","aims_finance_executor","aims_owner","aims_migrator"])await assert.rejects(()=>workerA.query(`SET ROLE ${role}`),/permission denied/);
 await assert.rejects(()=>workerA.query("SELECT record_payment(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,false)"),/permission denied/);
 await assert.rejects(()=>workerA.query("SELECT complete_finance_control_pass(NULL,NULL)"),/permission denied/);
});

test("worker health exposes bounded operational evidence",async()=>{const health=(await workerA.query("SELECT * FROM payment_document_scan_worker_health()")).rows[0];for(const key of ["backlog","oldest_eligible_seconds","scanning_leases","expired_leases","retryable_failures","terminal_failures","maximum_attempt"])assert.notEqual(health[key],undefined)});

test("independent document runtime claims, performs external I/O outside its claim transaction, and persists CLEAN",async()=>{
 const created=await insertDocument();let reads=0,promotions=0;
 const storage={readQuarantined:async()=>{reads+=1;return new Uint8Array([1,2,3])},promoteQuarantined:async(input:PromoteDocumentInput)=>{promotions+=1;return{key:`active/${input.destinationKey}`,sizeBytes:3,sha256:input.expectedSha256,contentType:"application/pdf",status:"ACTIVE" as const}}} as unknown as DocumentStorage;
 const scanner={scan:async()=>({verdict:"CLEAN" as const,engine:"test-scanner",reference:"runtime-clean"})} as DocumentMalwareScanner;
 const runtime=new DocumentScanWorker(workerA,storage,scanner,runtimeConfig()),result=await runtime.pollBatch();assert.equal(result.processed,1);assert.equal(reads,1);assert.equal(promotions,1);
 const row=await app.query("SELECT security_status,scan_claim_token,storage_object_key FROM payment_documents WHERE id=$1",[created.id]);assert.equal(row.rows[0].security_status,"CLEAN");assert.equal(row.rows[0].scan_claim_token,null);assert.match(row.rows[0].storage_object_key,/^active\//);
});

for(const boundary of ["storage","scanner"] as const)test(`${boundary} timeout persists a safe retryable failure and worker remains healthy`,async()=>{
 const created=await insertDocument();
 const storage={readQuarantined:boundary==="storage"?async()=>new Promise<Uint8Array>(()=>{}):async()=>new Uint8Array([1,2,3])} as unknown as DocumentStorage;
 const scanner={scan:boundary==="scanner"?async()=>new Promise<never>(()=>{}):async()=>({verdict:"CLEAN" as const,engine:"test",reference:"clean"})} as DocumentMalwareScanner;
 const pool=new pg.Pool({connectionString:workerUrl}),runtime=new DocumentScanWorker(pool,storage,scanner,runtimeConfig({retryDelaySeconds:86400}));const result=await runtime.pollBatch();assert.equal(result.processed,1);assert.ok(result.health);
 const state=await scanState(created.id);assert.equal(state.security_status,"SCAN_FAILED");assert.equal(state.scan_failure_disposition,"RETRYABLE");assert.equal(state.scan_failure_code,boundary==="storage"?"STORAGE_TIMEOUT":"SCANNER_TIMEOUT");assert.ok(state.scan_next_attempt_at);assert.equal(state.scan_claim_token,null);await runtime.close();
});

test("repeated scanner timeout reaches terminal maximum attempts and is not reclaimed",async()=>{
 const created=await insertDocument(),storage={readQuarantined:async()=>new Uint8Array([1])} as unknown as DocumentStorage,scanner={scan:async()=>new Promise<never>(()=>{})} as DocumentMalwareScanner;
 const pool=new pg.Pool({connectionString:workerUrl}),runtime=new DocumentScanWorker(pool,storage,scanner,runtimeConfig({maximumAttempts:2}));await runtime.pollBatch();await app.query("SELECT pg_sleep(1.1)");await runtime.pollBatch();
 const state=await scanState(created.id);assert.equal(state.security_status,"SCAN_FAILED");assert.equal(state.scan_failure_disposition,"TERMINAL");assert.equal(state.scan_attempt,2);assert.equal(state.scan_failure_code,"SCANNER_TIMEOUT");assert.equal(await claim(workerA,"no-terminal-reclaim",5,2),null);await runtime.close();
});

test("shutdown aborts a hanging provider, stops new claims, closes its pool, and leaves recoverable work",async()=>{
 const created=await insertDocument();await insertDocument();
 const storage={readQuarantined:async()=>new Promise<Uint8Array>(()=>{})} as unknown as DocumentStorage,scanner={scan:async()=>({verdict:"CLEAN" as const,engine:"test",reference:"clean"})} as DocumentMalwareScanner;
 const pool=new pg.Pool({connectionString:workerUrl}),runtime=new DocumentScanWorker(pool,storage,scanner,runtimeConfig({storageTimeoutMs:1000,scannerTimeoutMs:50}));const running=runtime.pollBatch();
 for(let i=0;i<50&&(await scanState(created.id)).security_status!=="SCANNING";i+=1)await new Promise(resolve=>setTimeout(resolve,10));
 const started=Date.now();runtime.stop();await running;assert.ok(Date.now()-started<500);assert.equal((await runtime.pollBatch()).processed,0);
 const state=await scanState(created.id);assert.equal(state.security_status,"SCAN_FAILED");assert.equal(state.scan_failure_disposition,"RETRYABLE");assert.equal(state.scan_failure_code,"WORKER_SHUTDOWN_ABORTED");assert.equal(state.scan_claim_token,null);await runtime.close();await assert.rejects(()=>pool.query("SELECT 1"),/pool after calling end/);
});

test("compiled worker process starts independently, idles, and shuts down gracefully",async()=>{
 const child=spawn(process.execPath,[path.resolve(".test-dist/src/worker-main.js")],{env:{...process.env,DATABASE_URL:"",FINANCE_DATABASE_URL:"",PAYMENT_DATABASE_URL:"",DOCUMENT_SCAN_WORKER_ENABLED:"true",TELEGRAM_APPROVAL_ENABLED:"false",STORAGE_DRIVER:"local",MALWARE_SCANNER_DRIVER:"deterministic-local",LOCAL_STORAGE_DEMO_MODE:"true",LOCAL_STORAGE_PATH:"storage/documents",MAX_UPLOAD_BYTES:"1048576",ALLOWED_UPLOAD_TYPES:"application/pdf,image/jpeg,image/png",WORKER_POLL_INTERVAL_MS:"50",DOCUMENT_SCAN_STORAGE_TIMEOUT_MS:"50",DOCUMENT_SCAN_SCANNER_TIMEOUT_MS:"50",WORKER_SHUTDOWN_GRACE_MS:"500"},stdio:["ignore","pipe","pipe"]});
 let stdout="",stderr="";child.stdout.on("data",chunk=>{stdout+=String(chunk)});child.stderr.on("data",chunk=>{stderr+=String(chunk)});
 try{
  await new Promise<void>((resolve,reject)=>{const deadline=setTimeout(()=>reject(new Error(`worker did not start: ${stderr}`)),5000);const inspect=()=>{if(stdout.includes('"event":"worker_started"')){clearTimeout(deadline);resolve()}else if(child.exitCode!==null){clearTimeout(deadline);reject(new Error(`worker exited before startup: ${stderr}`))}else setTimeout(inspect,20)};inspect()});
  child.kill("SIGTERM");const exit=await new Promise<number|null>(resolve=>child.once("exit",resolve));assert.equal(exit,0);assert.match(stdout,/"event":"worker_stopped"/);assert.doesNotMatch(stderr,/password|postgresql:\/\//i);
 }finally{if(child.exitCode===null)child.kill("SIGKILL")}
});

test.after(async()=>{await Promise.all([app.end(),workerA.end(),workerB.end()])});
