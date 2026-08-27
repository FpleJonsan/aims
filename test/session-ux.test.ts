import assert from "node:assert/strict";
import test from "node:test";
import { defaultFinanceView, routeForSession, safeInternalPath, type SessionEntitlements } from "../app/lib/session-ux.ts";

const session=(overrides:Partial<SessionEntitlements["capabilities"]>={},workspaces={requester:true,finance:true}):SessionEntitlements=>({
  workspaces,
  capabilities:{financeAnalysis:false,approval:false,financeControl:false,payment:false,reporting:false,policyAdmin:false,...overrides},
});

test("crafted external and protocol login redirects are rejected",()=>{
  for(const path of ["https://evil.example","//evil.example","javascript:alert(1)","/\\evil.example","\u0000/requester"])assert.equal(safeInternalPath(path),null);
  assert.equal(safeInternalPath("/requester/requests?id=1"),"/requester/requests?id=1");
});

test("deep-linked unauthorized Finance routes fall back without rendering the denied route",()=>{
  const result=routeForSession(session({approval:true}),"/finance/payment-queue",null);
  assert.deepEqual(result,{workspace:"finance",path:"/finance/approvals",financeView:"approvals"});
});

test("revoked stored Finance preference falls back to Requester",()=>{
  const result=routeForSession(session({}, {requester:true,finance:false}),"/login","finance");
  assert.deepEqual(result,{workspace:"requester",path:"/requester",financeView:null});
});

test("all removed workspace entitlements produce the No Access state",()=>{
  const result=routeForSession(session({}, {requester:false,finance:false}),"/finance/dashboard","finance");
  assert.deepEqual(result,{workspace:null,path:"/no-access",financeView:null});
});

test("Finance landing priority is deterministic and capability based",()=>{
  assert.equal(defaultFinanceView(session({reporting:true})),"dashboard");
  assert.equal(defaultFinanceView(session({financeAnalysis:true,approval:true})),"work-queue");
  assert.equal(defaultFinanceView(session({approval:true})),"approvals");
  assert.equal(defaultFinanceView(session({financeControl:true})),"finance-control");
  assert.equal(defaultFinanceView(session({payment:true})),"payment-queue");
});

test("Requester-only login never lands in Finance",()=>{
  const result=routeForSession(session({}, {requester:true,finance:false}),"/",null);
  assert.equal(result.path,"/requester");
});
