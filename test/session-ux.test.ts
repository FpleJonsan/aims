import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { defaultFinanceView, routeForSession, safeInternalPath, type SessionEntitlements } from "../app/lib/session-ux.ts";
import { clarificationActionable, friendlyActivity, requesterActivityVisible, requesterNeedsAction, requesterStatusPresentation } from "../app/lib/requester-presentation.ts";

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

test("valid Requester and Finance sessions preserve authorized deep links",()=>{
  assert.deepEqual(routeForSession(session({}, {requester:true,finance:false}),"/requester/requests/123",null),{workspace:"requester",path:"/requester/requests/123",financeView:null});
  assert.deepEqual(routeForSession(session({payment:true}, {requester:false,finance:true}),"/finance/payment-queue",null),{workspace:"finance",path:"/finance/payment-queue",financeView:"payment-queue"});
});

test("current session authority replaces stale Finance route assumptions",()=>{
  assert.deepEqual(routeForSession(session({approval:true}, {requester:false,finance:true}),"/finance/payment-queue",null),{workspace:"finance",path:"/finance/approvals",financeView:"approvals"});
  assert.deepEqual(routeForSession(session({policyAdmin:true}, {requester:false,finance:false}),"/finance/dashboard",null),{workspace:null,path:"/no-access",financeView:null});
});

test("requester statuses consistently expose a human label, next owner, and next action",()=>{
  assert.deepEqual(requesterStatusPresentation.PENDING_APPROVAL,{label:"Waiting for Approval",tone:"warning",owner:"Approver",action:"Waiting for required approval"});
  assert.equal(requesterStatusPresentation.READY_FOR_PAYMENT.label,"Ready for Payment");
  assert.equal(requesterStatusPresentation.PAID.action,"No action required");
  assert.equal(requesterStatusPresentation.REJECTED.label,"Not Approved");
});

test("only drafts and active clarification states require requester action",()=>{
  assert.equal(requesterNeedsAction("DRAFT"),true);
  assert.equal(requesterNeedsAction("NEEDS_CLARIFICATION"),true);
  for(const status of ["SUBMITTED","PENDING_APPROVAL","READY_FOR_PAYMENT","PAID"] as const)assert.equal(requesterNeedsAction(status),false);
});

test("requester activity uses business language rather than event codes",()=>{
  assert.equal(friendlyActivity("FINANCE_CONTROL_COMPLETED"),"Final Finance review completed");
  assert.equal(friendlyActivity("PAYMENT_RECORDED"),"Payment recorded");
  assert.equal(requesterActivityVisible("FINANCE_CONTEXT_STARTED"),false);
});

test("stale and superseded clarifications are non-actionable",()=>{
  assert.equal(clarificationActionable("OPEN"),true);
  assert.equal(clarificationActionable("RESPONDED"),false);
  assert.equal(clarificationActionable("SUPERSEDED"),false);
});

test("competition login uses product wording without demo or development presentation",async()=>{
  const source=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(source,/COMPETITION ENVIRONMENT/);
  assert.match(source,/Welcome to AIMS/);
  assert.match(source,/Select your identity to continue\./);
  assert.doesNotMatch(source,/DEMO LOGIN|Demo Mode|Demo System|Synthetic Login|LOCAL DEVELOPMENT|Local development only|approved demo identities/i);
});

test("frontend bootstraps from the authoritative server session before showing login",async()=>{
  const source=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(source,/useState<AuthPhase>\("checking"\)/);
  assert.match(source,/await api\("\/session"\)/);
  assert.match(source,/credentials:"include"/);
  assert.doesNotMatch(source,/if\s*\(localLogin&&!user\)\s*(?:throw|return)/);
});

test("legacy identity header is isolated to Competition and never used for LOCAL session bootstrap",async()=>{
  const source=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.match(source,/identityMode==="COMPETITION"&&user\?\{"x-aims-user":user\}:\{\}/);
  assert.doesNotMatch(source,/"x-aims-user":user(?!\}:\{\})/);
});
