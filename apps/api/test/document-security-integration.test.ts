import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PaymentDocumentService } from "../src/application/documents/payment-document.service.js";
import { PaymentRequestService } from "../src/application/payment-requests/payment-request.service.js";
import type { Principal } from "../src/domain/payment-request.js";
import { Postgres } from "../src/infrastructure/database/postgres.js";
import { LocalDocumentStorage } from "../src/infrastructure/storage/local-document-storage.js";

const requester:Principal={id:"10000000-0000-4000-8000-000000000001",departmentId:"00000000-0000-4000-8000-000000000001",roles:["REQUESTER"]};

test("document lifecycle is quarantined, fail-closed, private, authorized, and concurrency-safe",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"aims-document-security-"));
  const db=new Postgres(),requests=new PaymentRequestService(db);
  const storage=new LocalDocumentStorage({rootPath:root,maxUploadBytes:10_485_760,allowedContentTypes:new Set(["application/pdf"]),demoMode:true});
  const documents=new PaymentDocumentService(db,requests,storage);
  try{
    const request=await requests.initiate(requester,"doc-security-init");
    const clean=await documents.upload(request.id,file("invoice.pdf","harmless"),"INVOICE",requester,"doc-clean-upload") as {id:string;security_status:string};
    assert.equal(clean.security_status,"QUARANTINED");
    const initial=await db.pool.query("SELECT security_status,storage_object_key FROM payment_documents WHERE id=$1",[clean.id]);
    assert.equal(initial.rows[0].security_status,"QUARANTINED");assert.match(initial.rows[0].storage_object_key,/^quarantine\//);
    await assert.rejects(()=>documents.download(request.id,clean.id,requester,"doc-before-clean"),/Clean document not found/);

    const concurrent=await Promise.allSettled([
      documents.scan(request.id,clean.id,requester,"doc-scan-a"),
      documents.scan(request.id,clean.id,requester,"doc-scan-b"),
    ]);
    assert.equal(concurrent.filter(result=>result.status==="fulfilled").length,0);
    assert.equal(concurrent.filter(result=>result.status==="rejected").length,2);
    assert.ok(concurrent.every(result=>result.status==="rejected"&&/durable document worker/.test(String(result.reason))));
    const unchanged=await db.pool.query("SELECT security_status,storage_object_key,storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key FROM payment_documents WHERE id=$1",[clean.id]);
    assert.equal(unchanged.rows[0].security_status,"QUARANTINED");assert.match(unchanged.rows[0].storage_object_key,/^quarantine\//);
    assert.equal(unchanged.rows[0].storage_binding_state,"VERSION_BOUND");assert.equal(unchanged.rows[0].storage_backend_id,"local-development");assert.match(unchanged.rows[0].storage_object_version,/^sha256:/);assert.equal(unchanged.rows[0].trusted_storage_object_key,null);
  }finally{await db.onModuleDestroy();await rm(root,{recursive:true,force:true});}
});

function file(name:string,marker:string):Express.Multer.File{
  const buffer=Buffer.from(`%PDF-1.7\n${marker}\n%%EOF\n`);
  return{fieldname:"file",originalname:name,encoding:"7bit",mimetype:"application/pdf",size:buffer.byteLength,buffer,stream:null as never,destination:"",filename:"",path:""};
}

test('historical evidence stays downloadable, immutable and excluded from active evidence after replacement',async()=>{
  const {ValidationService}=await import('../src/application/validation/validation.service.js');
  const {DocumentScanWorker}=await import('../src/worker/document-scan-worker.js');
  const {DeterministicLocalMalwareScanner}=await import('../src/infrastructure/security/deterministic-local-malware-scanner.js');
  const {default:pg}=await import('pg');
  const finance:Principal={id:'10000000-0000-4000-8000-000000000002',departmentId:'00000000-0000-4000-8000-000000000002',roles:['FINANCE']};
  const outsider:Principal={id:'10000000-0000-4000-8000-000000000004',departmentId:requester.departmentId,roles:['REQUESTER']};
  const root=await mkdtemp(path.join(os.tmpdir(),'aims-historical-documents-'));
  const db=new Postgres(),requests=new PaymentRequestService(db);
  const storage=new LocalDocumentStorage({rootPath:root,maxUploadBytes:10485760,allowedContentTypes:new Set(['application/pdf']),demoMode:true});
  const documents=new PaymentDocumentService(db,requests,storage),validation=new ValidationService(db,requests,storage,null);
  const worker=new DocumentScanWorker(new pg.Pool({connectionString:process.env.DOCUMENT_WORKER_DATABASE_URL}),storage,new DeterministicLocalMalwareScanner(),{
    workerId:'history-test',pollIntervalMs:100,batchSize:10,leaseSeconds:120,maximumAttempts:3,retryDelaySeconds:1,
    storageTimeoutMs:1000,scannerTimeoutMs:1000,shutdownGraceMs:1000,telegramEnabled:false,scannerEnabled:true,
  });
  try{
    const r=await requests.initiate(requester,'history-init');
    await requests.update(r.id,{payee:'Vendor',purpose:'Evidence history',category:'Operations',amount:'10.00',currency:'MYR',dueDate:'2026-09-30',paymentMethod:'BANK_TRANSFER',paymentDetails:'Synthetic'},requester,'history-capture');
    const original=file('invoice.pdf','original invoice');
    const first=await documents.upload(r.id,original,'INVOICE',requester,'history-v1') as {id:string};
    await worker.pollBatch();
    await requests.submit(r.id,requester,'history-submit');
    await validation.start(r.id,finance,'history-validation');
    await validation.finalize(r.id,{overallResult:'CLARIFICATION_REQUIRED',remarks:'Provide revised invoice',requiredResponse:'Upload revised invoice',findings:[]},finance,'history-clarification');
    const revised=file('invoice.pdf','revised invoice');
    const second=await documents.upload(r.id,revised,'INVOICE',requester,'history-v2') as {id:string};
    await worker.pollBatch();
    const snapshot=async()=>(await db.pool.query('SELECT to_jsonb(d) value FROM payment_documents d WHERE payment_request_id=$1 ORDER BY version',[r.id])).rows;
    const before=await snapshot();
    assert.equal(before[0].value.version,1);assert.ok(before[0].value.removed_at);assert.equal(before[1].value.version,2);assert.equal(before[1].value.removed_at,null);
    const audits=(await db.pool.query('SELECT to_jsonb(a) value FROM audit_events a WHERE entity_id=$1 ORDER BY id',[r.id])).rows;
    const history=await documents.history(r.id,finance);
    assert.equal(history.items.length,1);assert.equal(history.items[0].id,first.id);
    assert.equal(history.items[0].historical,true);assert.equal(history.items[0].activeEvidence,false);assert.equal(history.items[0].downloadable,true);
    for(const actor of [finance,requester,finance]){
      const download=await documents.downloadHistorical(r.id,first.id,actor,'history-download');
      assert.deepEqual(Buffer.from(download.data),original.buffer);assert.equal(download.historical,true);assert.equal(download.activeEvidence,false);
      assert.match(download.filename,/^historical-v1-/);
    }
    assert.deepEqual(await snapshot(),before);
    await assert.rejects(documents.download(r.id,first.id,finance,'history-not-active'),/Clean document not found/);
    await assert.rejects(documents.downloadHistorical(r.id,second.id,finance,'history-not-old'),/historical document not found/);
    await assert.rejects(documents.scan(r.id,first.id,finance,'history-no-reactivation'),/durable document worker/);
    const visible=await requests.get(r.id,finance);
    assert.equal(visible.documents.length,1);assert.equal((visible.documents[0] as {id:string}).id,second.id);
    assert.deepEqual(Buffer.from((await documents.download(r.id,second.id,finance,'history-current')).data),revised.buffer);
    await assert.rejects(documents.history(r.id,outsider));
    await assert.rejects(documents.downloadHistorical(r.id,first.id,outsider,'history-denied'));
    const after=(await db.pool.query('SELECT to_jsonb(a) value FROM audit_events a WHERE entity_id=$1 ORDER BY id',[r.id])).rows;
    for(const old of audits)assert.ok(after.some(row=>JSON.stringify(row)===JSON.stringify(old)));
    const downloads=after.filter(row=>row.value.action==='DOCUMENT_HISTORICAL_DOWNLOADED');
    assert.equal(downloads.length,3);
    assert.ok(downloads.every(row=>row.value.safe_metadata.documentId===first.id&&row.value.safe_metadata.activeEvidence===false));
    assert.deepEqual(await snapshot(),before);
    const draft=await requests.initiate(requester,'history-untrusted-init');
    const untrusted=await documents.upload(draft.id,file('untrusted.pdf','not scanned'),'INVOICE',requester,'history-untrusted') as {id:string};
    await documents.remove(draft.id,untrusted.id,requester,'history-untrusted-remove');
    assert.equal((await documents.history(draft.id,requester)).items[0].downloadable,false);
    await assert.rejects(documents.downloadHistorical(draft.id,untrusted.id,requester,'history-untrusted-denied'),/historical document not found/);
  }finally{await worker.close();await db.onModuleDestroy();await rm(root,{recursive:true,force:true})}
});
