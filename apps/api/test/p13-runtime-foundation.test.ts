import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyAimsEnvironment } from "../src/infrastructure/configuration/aims-environment.js";
import { createDocumentScanner, createDocumentStorage, providerReadiness, validateDocumentProviderSelection } from "../src/infrastructure/configuration/provider-boundary.js";
import { configureTrustedProxy, installGracefulApiShutdown } from "../src/infrastructure/configuration/api-runtime.js";
import { assertProtectedDatabaseTransport, loadDatabasePoolConfig, loadRuntimeFoundationConfig } from "../src/infrastructure/configuration/runtime-foundation.js";
import { createAiProvider } from "../src/infrastructure/ai/ai-provider-factory.js";
import { loadTelegramConfig } from "../src/infrastructure/configuration/telegram-config.js";

const local={AIMS_ENVIRONMENT:"local",STORAGE_DRIVER:"local",MALWARE_SCANNER_DRIVER:"deterministic-local",LOCAL_STORAGE_DEMO_MODE:"true",LOCAL_STORAGE_PATH:"./storage/documents",MAX_UPLOAD_BYTES:"1024",ALLOWED_UPLOAD_TYPES:"application/pdf"};
const protectedBase={AIMS_ENVIRONMENT:"production",NODE_ENV:"production"};

test("canonical environment classification protects staging and production and rejects ambiguity",()=>{
  assert.equal(classifyAimsEnvironment({AIMS_ENVIRONMENT:"development"}).protected,false);
  assert.equal(classifyAimsEnvironment({AIMS_ENVIRONMENT:"test"}).security,"test");
  assert.equal(classifyAimsEnvironment({NODE_ENV:"production",AIMS_ENVIRONMENT:"staging"}).protected,true);
  assert.equal(classifyAimsEnvironment(protectedBase).protected,true);
  assert.throws(()=>classifyAimsEnvironment({AIMS_ENVIRONMENT:"prodution"}),/UNKNOWN/);
  assert.throws(()=>classifyAimsEnvironment({NODE_ENV:"production"}),/REQUIRED_FOR_DEPLOYABLE/);
  assert.throws(()=>classifyAimsEnvironment({NODE_ENV:"production",AIMS_ENVIRONMENT:"local"}),/RUNTIME_MISMATCH/);
});

test("API worker and recovery share one protected provider boundary",async()=>{
  assert.doesNotThrow(()=>validateDocumentProviderSelection({...local,AIMS_ENVIRONMENT:"development"}));
  assert.doesNotThrow(()=>validateDocumentProviderSelection({...local,AIMS_ENVIRONMENT:"test"}));
  for(const AIMS_ENVIRONMENT of ["staging","production"]){
    const unsafe={...local,NODE_ENV:"production",AIMS_ENVIRONMENT};
    assert.throws(()=>validateDocumentProviderSelection(unsafe),/UNSAFE_STORAGE_PROVIDER/);
    assert.throws(()=>createDocumentStorage(unsafe),/UNSAFE_STORAGE_PROVIDER/);
    assert.throws(()=>createDocumentScanner({...unsafe,STORAGE_DRIVER:"object"}),/UNSAFE_SCANNER_PROVIDER/);
    assert.equal(providerReadiness("storage",unsafe).status,"not_ready");
  }
  assert.doesNotThrow(()=>validateDocumentProviderSelection(local));
  assert.match(await readFile(new URL("../../src/app.module.ts",import.meta.url),"utf8"),/createDocumentStorage/);
  assert.match(await readFile(new URL("../../src/worker-main.ts",import.meta.url),"utf8"),/createDocumentStorage/);
  assert.match(await readFile(new URL("../../src/recovery-check-main.ts",import.meta.url),"utf8"),/createDocumentStorage/);
});

test("optional AI and Telegram remain dormant while unsafe enabled transports fail closed",()=>{
  assert.equal(createAiProvider({...protectedBase,AI_MASTER:"OFF",AI_PROVIDER:"fake"}),null);
  assert.equal(loadTelegramConfig({...protectedBase,TELEGRAM_APPROVAL_ENABLED:"false",TELEGRAM_TRANSPORT:"fake"}).enabled,false);
  assert.throws(()=>createAiProvider({...protectedBase,AI_MASTER:"ON",AI_PROVIDER:"fake"}),/UNSAFE_AI_PROVIDER/);
  assert.throws(()=>loadTelegramConfig({...protectedBase,TELEGRAM_APPROVAL_ENABLED:"true",TELEGRAM_TRANSPORT:"fake"}),/UNSAFE_TELEGRAM_TRANSPORT/);
});

test("hosted runtime requires release identity and secure explicit cookies",()=>{
  assert.throws(()=>loadRuntimeFoundationConfig(protectedBase),/SECURE_COOKIE_REQUIRED/);
  assert.throws(()=>loadRuntimeFoundationConfig({...protectedBase,AIMS_SESSION_COOKIE_SECURE:"true"}),/AIMS_RELEASE_VERSION/);
  const config=loadRuntimeFoundationConfig({...protectedBase,AIMS_SESSION_COOKIE_SECURE:"true",AIMS_SESSION_COOKIE_SAME_SITE:"strict",AIMS_RELEASE_VERSION:"1.2.3",AIMS_RELEASE_REVISION:"abc123",AIMS_TRUSTED_PROXY_ADDRESSES:"10.0.0.1,2001:db8::1"});
  assert.deepEqual(config.cookie,{secure:true,httpOnly:true,sameSite:"strict",path:"/"});
  assert.deepEqual(config.release,{version:"1.2.3",revision:"abc123",schemaVersion:59});
  assert.throws(()=>loadRuntimeFoundationConfig({...local,AIMS_TRUSTED_PROXY_ADDRESSES:"all"}),/TRUSTED_PROXY_ADDRESSES_INVALID/);
});

test("proxy trust is exact and graceful shutdown closes through the application lifecycle",async()=>{
  let trust:((address:string)=>boolean)|undefined;const callbacks:Record<string,()=>void>={};let closed=0;
  const app={getHttpAdapter:()=>({getInstance:()=>({set:(_name:string,value:unknown)=>{trust=value as typeof trust}})}),close:async()=>{closed+=1}} as never;
  configureTrustedProxy(app,new Set(["10.0.0.1"]));
  assert.equal(trust?.("10.0.0.1"),true);assert.equal(trust?.("10.0.0.2"),false);
  installGracefulApiShutdown(app,1000,{once:(signal:string,callback:()=>void)=>{callbacks[signal]=callback;return {} as never}} as never);
  callbacks.SIGTERM();callbacks.SIGINT();await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,1);
});

test("shutdown remains bounded when close rejects and handlers cannot race startup",async()=>{
  const callbacks:Record<string,()=>void>={};const terminations:number[]=[];
  const app={close:async()=>{throw new Error("close failed")}} as never;
  installGracefulApiShutdown(app,1000,{once:(signal:string,callback:()=>void)=>{callbacks[signal]=callback;return {} as never}} as never,code=>terminations.push(code));
  callbacks.SIGTERM();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(terminations,[1]);
  const source=await readFile(new URL("../../src/main.ts",import.meta.url),"utf8");
  assert.ok(source.indexOf("await app.listen")<source.lastIndexOf("installGracefulApiShutdown"));
});

test("shutdown deadline terminates a resource close that never settles",async()=>{
  const callbacks:Record<string,()=>void>={};const terminations:number[]=[];
  installGracefulApiShutdown({close:()=>new Promise(()=>undefined)} as never,10,{once:(signal:string,callback:()=>void)=>{callbacks[signal]=callback;return {} as never}} as never,code=>terminations.push(code));
  callbacks.SIGINT();await new Promise(resolve=>setTimeout(resolve,25));assert.deepEqual(terminations,[1]);
});

test("database pool budgets are bounded and independently configurable",()=>{
  assert.deepEqual(loadDatabasePoolConfig({}),{application:10,finance:5,payment:5,worker:2});
  assert.deepEqual(loadDatabasePoolConfig({AIMS_DB_POOL_MAX:"20",AIMS_FINANCE_DB_POOL_MAX:"7",AIMS_PAYMENT_DB_POOL_MAX:"8",AIMS_WORKER_DB_POOL_MAX:"3"}),{application:20,finance:7,payment:8,worker:3});
  for(const value of ["0","101","NaN"])assert.throws(()=>loadDatabasePoolConfig({AIMS_DB_POOL_MAX:value}),/AIMS_DB_POOL_MAX_INVALID/);
});

test("protected PostgreSQL transport rejects local and non-verifying endpoints",()=>{
  assert.doesNotThrow(()=>assertProtectedDatabaseTransport("DATABASE_URL","postgresql://user:secret@localhost/aims",local));
  assert.throws(()=>assertProtectedDatabaseTransport("DATABASE_URL","postgresql://user:secret@localhost/aims?sslmode=verify-full",protectedBase),/LOCAL_HOST_FORBIDDEN/);
  for(const host of ["127.0.0.2","0.0.0.0","[::1]","[::ffff:127.0.0.2]","[0:0:0:0:0:ffff:7f00:2]","service.localhost"])
    assert.throws(()=>assertProtectedDatabaseTransport("DATABASE_URL",`postgresql://user:secret@${host}/aims?sslmode=verify-full`,protectedBase),/LOCAL_HOST_FORBIDDEN/);
  assert.throws(()=>assertProtectedDatabaseTransport("DATABASE_URL","postgresql://user:secret@db.internal/aims",protectedBase),/VERIFY_FULL_REQUIRED/);
  assert.doesNotThrow(()=>assertProtectedDatabaseTransport("DATABASE_URL","postgresql://user:secret@db.internal/aims?sslmode=verify-full",protectedBase));
});
