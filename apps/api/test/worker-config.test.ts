import assert from "node:assert/strict";
import test from "node:test";
import {loadWorkerConfig} from "../src/worker/worker-config.js";
import {WorkerLoop} from "../src/worker/worker-loop.js";

const local={AIMS_ENVIRONMENT:"local",DOCUMENT_SCAN_WORKER_ENABLED:"true",DOCUMENT_WORKER_DATABASE_URL:"postgresql://aims_document_worker_runtime:test@127.0.0.1:5432/aims_test_worker",STORAGE_DRIVER:"local",MALWARE_SCANNER_DRIVER:"deterministic-local"};
test("worker config accepts explicit local scanner boundary and bounded defaults",()=>{const config=loadWorkerConfig(local);assert.equal(config.scannerEnabled,true);assert.equal(config.telegramEnabled,false);assert.equal(config.batchSize,10);assert.equal(config.maximumAttempts,5);assert.equal(config.storageTimeoutMs,10000);assert.equal(config.scannerTimeoutMs,30000);assert.equal(config.shutdownGraceMs,15000)});
test("Telegram OFF requires no Telegram or normal database credential",()=>assert.doesNotThrow(()=>loadWorkerConfig(local)));
test("Telegram OFF dominates stale credentials and malformed subordinate settings",()=>assert.doesNotThrow(()=>loadWorkerConfig({...local,TELEGRAM_BOT_TOKEN:"stale",TELEGRAM_WEBHOOK_SECRET:"stale",TELEGRAM_CALLBACK_SECRET:"stale",TELEGRAM_REQUEST_TIMEOUT_MS:"invalid",TELEGRAM_RESPONSE_MAX_BYTES:"invalid"})));
test("Telegram ON validates complete config once and fails closed when incomplete",()=>{
 const enabled={...local,TELEGRAM_APPROVAL_ENABLED:"true",DATABASE_URL:"postgresql://aims_app:test@127.0.0.1:5432/aims_test_worker",TELEGRAM_BOT_TOKEN:"bot-token-value",TELEGRAM_WEBHOOK_SECRET:"webhook-secret-value",TELEGRAM_CALLBACK_SECRET:"callback-secret-value"};
 assert.equal(loadWorkerConfig(enabled).telegramEnabled,true);
 for(const key of ["TELEGRAM_BOT_TOKEN","TELEGRAM_WEBHOOK_SECRET","TELEGRAM_CALLBACK_SECRET"] as const)assert.throws(()=>loadWorkerConfig({...enabled,[key]:undefined}),new RegExp(key));
 assert.throws(()=>loadWorkerConfig({...enabled,TELEGRAM_BOT_TOKEN:"change-me"}),/placeholder/);
 assert.throws(()=>loadWorkerConfig({...enabled,TELEGRAM_REQUEST_TIMEOUT_MS:"120000"}),/TELEGRAM_REQUEST_TIMEOUT_MS/);
 assert.throws(()=>loadWorkerConfig({...enabled,OUTBOX_PROCESSING_LEASE_SECONDS:"5",TELEGRAM_REQUEST_TIMEOUT_MS:"5000"}),/shorter than/);
});
test("worker configuration fails closed for invalid bounds and role identity",()=>{
 assert.throws(()=>loadWorkerConfig({...local,WORKER_BATCH_SIZE:"0"}),/WORKER_BATCH_SIZE/);
 assert.throws(()=>loadWorkerConfig({...local,DOCUMENT_WORKER_DATABASE_URL:"postgresql://aims_payment_runtime:test@127.0.0.1:5432/aims_test_worker"}),/aims_document_worker_runtime/);
 for(const value of ["0","-1","not-a-number","60001"])assert.throws(()=>loadWorkerConfig({...local,DOCUMENT_SCAN_STORAGE_TIMEOUT_MS:value}),/DOCUMENT_SCAN_STORAGE_TIMEOUT_MS/);
 for(const value of ["0","-1","not-a-number","60001"])assert.throws(()=>loadWorkerConfig({...local,DOCUMENT_SCAN_SCANNER_TIMEOUT_MS:value}),/DOCUMENT_SCAN_SCANNER_TIMEOUT_MS/);
 assert.throws(()=>loadWorkerConfig({...local,DOCUMENT_SCAN_LEASE_SECONDS:"5",DOCUMENT_SCAN_STORAGE_TIMEOUT_MS:"2000",DOCUMENT_SCAN_SCANNER_TIMEOUT_MS:"2000"}),/fit within/);
});
test("Production scanner startup rejects missing, local, and unimplemented providers",()=>{
 const base={...local,NODE_ENV:"production",AIMS_ENVIRONMENT:"production",AIMS_EXPECTED_DATABASE:"aims_prod",DOCUMENT_WORKER_DATABASE_URL:"postgresql://aims_document_worker_runtime:strong-value@db.internal/aims_prod?sslmode=verify-full"};
 assert.throws(()=>loadWorkerConfig({...base,STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:""}),/approved malware scanner/);
 assert.throws(()=>loadWorkerConfig({...base,STORAGE_DRIVER:"local",MALWARE_SCANNER_DRIVER:"deterministic-local"}),/approved object storage/);
 assert.throws(()=>loadWorkerConfig({...base,STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:"provider"}),/not implemented/);
 assert.throws(()=>loadWorkerConfig({...base,DOCUMENT_WORKER_DATABASE_URL:"postgresql://aims_document_worker_runtime:strong-value@127.0.0.1/aims_prod?sslmode=verify-full",STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:"provider"}),/local host/);
});
test("worker loop idles and stops without recursive or busy polling",async()=>{
 let polls=0;const loop=new WorkerLoop([{name:"test",poll:async()=>{polls+=1;return{processed:0}}}],50),running=loop.run();
 await new Promise(resolve=>setTimeout(resolve,80));loop.stop();await running;assert.ok(polls>=1&&polls<=3);
});
