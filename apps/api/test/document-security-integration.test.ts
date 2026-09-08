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
