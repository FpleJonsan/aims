import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PaymentDocumentService } from "../src/application/documents/payment-document.service.js";
import { PaymentRequestService } from "../src/application/payment-requests/payment-request.service.js";
import type { Principal } from "../src/domain/payment-request.js";
import { Postgres } from "../src/infrastructure/database/postgres.js";
import { DeterministicLocalMalwareScanner } from "../src/infrastructure/security/deterministic-local-malware-scanner.js";
import { LocalDocumentStorage } from "../src/infrastructure/storage/local-document-storage.js";

const requester:Principal={id:"10000000-0000-4000-8000-000000000001",departmentId:"00000000-0000-4000-8000-000000000001",roles:["REQUESTER"]};
const outsider:Principal={id:"90000000-0000-4000-8000-000000000001",departmentId:requester.departmentId,roles:["REQUESTER"]};
const technicalAdmin:Principal={id:"90000000-0000-4000-8000-000000000002",departmentId:requester.departmentId,roles:["ADMIN"]};

test("document lifecycle is quarantined, fail-closed, private, authorized, and concurrency-safe",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"aims-document-security-"));
  const db=new Postgres(),requests=new PaymentRequestService(db);
  const storage=new LocalDocumentStorage({rootPath:root,maxUploadBytes:10_485_760,allowedContentTypes:new Set(["application/pdf"]),demoMode:true});
  const documents=new PaymentDocumentService(db,requests,storage,new DeterministicLocalMalwareScanner());
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
    assert.equal(concurrent.filter(result=>result.status==="fulfilled").length,1,concurrent.map(result=>result.status==="rejected"?String(result.reason):"fulfilled").join(" | "));
    assert.equal(concurrent.filter(result=>result.status==="rejected").length,1);
    const cleaned=await db.pool.query("SELECT security_status,storage_object_key,scan_engine,scan_reference FROM payment_documents WHERE id=$1",[clean.id]);
    assert.equal(cleaned.rows[0].security_status,"CLEAN");assert.match(cleaned.rows[0].storage_object_key,/^active\//);
    assert.equal(cleaned.rows[0].scan_engine,"deterministic-local");
    assert.ok((await documents.download(request.id,clean.id,requester,"doc-download")).data.byteLength>0);
    await assert.rejects(()=>documents.download(request.id,clean.id,outsider,"doc-idor"),/not found/i);
    await assert.rejects(()=>documents.download(request.id,clean.id,technicalAdmin,"doc-admin"),/not found/i);

    const rejected=await documents.upload(request.id,file("rejected.pdf","AIMS_LOCAL_SCAN_REJECT"),"INVOICE",requester,"doc-reject-upload") as {id:string};
    assert.equal((await documents.scan(request.id,rejected.id,requester,"doc-reject-scan")).securityStatus,"REJECTED");
    await assert.rejects(()=>documents.download(request.id,rejected.id,requester,"doc-reject-read"),/Clean document not found/);

    const failed=await documents.upload(request.id,file("failed.pdf","AIMS_LOCAL_SCAN_FAIL"),"INVOICE",requester,"doc-fail-upload") as {id:string};
    assert.equal((await documents.scan(request.id,failed.id,requester,"doc-fail-scan")).securityStatus,"SCAN_FAILED");
    const failedRow=await db.pool.query("SELECT security_status,scan_failure_code FROM payment_documents WHERE id=$1",[failed.id]);
    assert.equal(failedRow.rows[0].security_status,"SCAN_FAILED");assert.ok(failedRow.rows[0].scan_failure_code);
    const trusted=await db.pool.query("SELECT count(*)::int count FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL AND security_status='CLEAN'",[request.id]);
    assert.equal(trusted.rows[0].count,1);
  }finally{await db.onModuleDestroy();await rm(root,{recursive:true,force:true});}
});

function file(name:string,marker:string):Express.Multer.File{
  const buffer=Buffer.from(`%PDF-1.7\n${marker}\n%%EOF\n`);
  return{fieldname:"file",originalname:name,encoding:"7bit",mimetype:"application/pdf",size:buffer.byteLength,buffer,stream:null as never,destination:"",filename:"",path:""};
}
