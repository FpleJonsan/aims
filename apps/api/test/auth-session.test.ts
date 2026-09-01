import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "../src/application/auth/auth.guard.js";
import { CSRF_COOKIE,SESSION_COOKIE,SessionService } from "../src/application/auth/session.service.js";

const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const request=(options:{cookie?:string;origin?:string;csrf?:string;method?:string;headerUser?:string}={})=>({
  method:options.method??"GET",headers:{cookie:options.cookie??""},correlationId:"test-correlation",
  header(name:string){return ({origin:options.origin,"x-aims-csrf":options.csrf,"x-aims-user":options.headerUser} as Record<string,string|undefined>)[name.toLowerCase()]},
}) as never;

test("local login resolves the namespaced mapping and stores only token hashes",async()=>{
  const queries:Array<{sql:string;values:unknown[]}>=[];const cookies:Array<{name:string;value:string;options:Record<string,unknown>}>=[];
  const db={pool:{query:async(sql:string,values:unknown[])=>{queries.push({sql,values});if(sql.includes("FROM user_external_identities"))return{rowCount:1,rows:[{identity_id:"identity",user_id:"user",department_id:"department",role:"REQUESTER"}]};return{rowCount:1,rows:[]};}}};
  const service=new SessionService(db as never);
  const principal=await service.localLogin("demo.requester",request({method:"POST",origin:"http://localhost:3000"}),{cookie:(name:string,value:string,options:Record<string,unknown>)=>cookies.push({name,value,options})} as never);
  assert.equal(principal.id,"user");assert.deepEqual(principal.roles,["REQUESTER"]);
  const insert=queries.find(value=>value.sql.includes("INSERT INTO aims_sessions"));assert.ok(insert);
  assert.match(String(insert.values[1]),/^[0-9a-f]{64}$/);assert.notEqual(insert.values[1],cookies.find(value=>value.name===SESSION_COOKIE)?.value);
  assert.equal(cookies.find(value=>value.name===SESSION_COOKIE)?.options.httpOnly,true);
  assert.equal(cookies.find(value=>value.name===CSRF_COOKIE)?.options.httpOnly,false);
});

test("session authentication rejects missing, expired, revoked, and inactive sessions",async()=>{
  const database=(query:(sql:string)=>Promise<unknown>)=>({pool:{query},transaction:async(operation:(client:{query:typeof query})=>Promise<unknown>)=>operation({query})});
  const missing=new SessionService(database(async(sql:string)=>sql.trim().startsWith("SELECT generation FROM aims_recovery_generation")?{rowCount:1,rows:[{generation:"g"}]}:{rowCount:0,rows:[]}) as never);
  await assert.rejects(()=>missing.authenticate(request()),UnauthorizedException);
  await assert.rejects(()=>missing.authenticate(request({cookie:`${SESSION_COOKIE}=expired`})),/invalid or expired/);
  const inactive=new SessionService(database(async(sql:string)=>sql.trim().startsWith("SELECT generation FROM aims_recovery_generation")?{rowCount:1,rows:[{generation:"g"}]}:sql.includes("authentication_audit_events")?{rowCount:1,rows:[]}:{rowCount:1,rows:[{session_id:"s",csrf_token_hash:hash("csrf"),user_id:"u",department_id:"d",active:false,role:null}]}) as never);
  await assert.rejects(()=>inactive.authenticate(request({cookie:`${SESSION_COOKIE}=valid`})),/inactive/);
});

test("logout is idempotent for an unknown or already-cleared session cookie",async()=>{
  const cleared:string[]=[];const service=new SessionService({pool:{query:async()=>({rowCount:0,rows:[]})}} as never);
  await service.logout(request({method:"POST",cookie:`${SESSION_COOKIE}=stale`,origin:"http://localhost:3000",csrf:"csrf"}),{clearCookie:(name:string)=>cleared.push(name)} as never);
  assert.deepEqual(cleared,[SESSION_COOKIE,CSRF_COOKIE]);
});

test("CSRF requires exact allowed origin and matching double-submit token",()=>{
  const service=new SessionService({} as never);const expected=hash("csrf");
  assert.doesNotThrow(()=>service.verifyCsrf(request({method:"POST",origin:"http://localhost:3000",csrf:"csrf",cookie:`${CSRF_COOKIE}=csrf`}),expected));
  assert.throws(()=>service.verifyCsrf(request({method:"POST",origin:"https://evil.example",csrf:"csrf",cookie:`${CSRF_COOKIE}=csrf`}),expected),/origin/);
  assert.throws(()=>service.verifyCsrf(request({method:"POST",origin:"http://localhost:3000",csrf:"wrong",cookie:`${CSRF_COOKIE}=csrf`}),expected),/CSRF/);
  assert.doesNotThrow(()=>service.verifyCsrf(request({method:"GET"}),expected));
});

test("LOCAL protected requests never authenticate from x-aims-user",async()=>{
  const previous=process.env.AIMS_ENVIRONMENT;process.env.AIMS_ENVIRONMENT="development";
  try{
    const guard=new AuthGuard({pool:{query:async()=>{throw Error("header lookup must not execute")}}} as never,{authenticate:async()=>{throw new UnauthorizedException("Authentication required")}} as never);
    await assert.rejects(()=>guard.canActivate({switchToHttp:()=>({getRequest:()=>request({headerUser:"privileged"})})} as never),/Authentication required/);
  }finally{if(previous===undefined)delete process.env.AIMS_ENVIRONMENT;else process.env.AIMS_ENVIRONMENT=previous;}
});

test("Production and staging reject both session and header authentication",async()=>{
  for(const environment of ["production","staging"]){
    const previousNode=process.env.NODE_ENV,previousEnvironment=process.env.AIMS_ENVIRONMENT;
    process.env.NODE_ENV=environment==="production"?"production":"development";process.env.AIMS_ENVIRONMENT=environment;
    try{
      const guard=new AuthGuard({pool:{query:async()=>{throw Error("identity lookup must not execute")}}} as never,{authenticate:async()=>{throw Error("session lookup must not execute")}} as never);
      await assert.rejects(()=>guard.canActivate({switchToHttp:()=>({getRequest:()=>request({cookie:`${SESSION_COOKIE}=local`,headerUser:"privileged"})})} as never),/not configured/);
    }finally{if(previousNode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousNode;if(previousEnvironment===undefined)delete process.env.AIMS_ENVIRONMENT;else process.env.AIMS_ENVIRONMENT=previousEnvironment;}
  }
});

test("identity schema prevents collisions without email matching",async()=>{
  const {readFile}=await import("node:fs/promises");const sql=await readFile(new URL("../../migrations/054_p1l_local_identity_sessions.sql",import.meta.url),"utf8");
  assert.match(sql,/UNIQUE \(issuer, subject\)/);assert.doesNotMatch(sql,/email/i);assert.match(sql,/'local','aims-local'/);
});
