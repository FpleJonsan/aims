/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ApprovalService } from "../src/application/approval/approval.service.js";
import { DashboardService } from "../src/application/dashboard/dashboard.service.js";
import { FinanceContextService } from "../src/application/finance-context/finance-context.service.js";
import { FinanceControlService } from "../src/application/finance-control/finance-control.service.js";
import type { FinanceConfirmationCode } from "../src/application/finance-control/finance-control.dto.js";
import { FinancialAnalysisService } from "../src/application/financial-analysis/financial-analysis.service.js";
import { PaymentRequestService } from "../src/application/payment-requests/payment-request.service.js";
import { PaymentService } from "../src/application/payments/payment.service.js";
import { PolicyService } from "../src/application/policy/policy.service.js";
import { ValidationService } from "../src/application/validation/validation.service.js";
import type { Principal } from "../src/domain/payment-request.js";
import { Postgres } from "../src/infrastructure/database/postgres.js";

const requester: Principal = { id: "10000000-0000-4000-8000-000000000001", departmentId: "00000000-0000-4000-8000-000000000001", roles: ["REQUESTER"] };
const finance: Principal = { id: "10000000-0000-4000-8000-000000000002", departmentId: "00000000-0000-4000-8000-000000000002", roles: ["FINANCE"] };
const admin: Principal = { ...finance, roles: ["ADMIN"] };
const approver: Principal = { id: "10000000-0000-4000-8000-000000000004", departmentId: requester.departmentId, roles: ["REQUESTER"] };
const confirmations: FinanceConfirmationCode[] = ["PAYEE_VERIFIED", "PAYMENT_METHOD_VERIFIED", "PAYMENT_DETAILS_VERIFIED", "SUPPORTING_DOCUMENTS_VERIFIED"];

type Scenario = { label:string;risk:"LOW"|"HIGH";automatic:boolean;clarification?:boolean;revision?:boolean;aiAssisted?:boolean;aiOff?:boolean;amount?:string };

const advisoryLowProvider = {
  calls: 0,
  async analyzeFinancialAgent(agent: string) {
    this.calls += 1;
    const output = { status:"OK",riskLevel:"LOW",priority:"NORMAL",urgency:"NORMAL",suggestedDeadline:null,findings:[{code:"UAT_ADVISORY_LOW",severity:"LOW",explanation:"Synthetic advisory result for controlled UAT.",evidenceReferences:[{source:"FINANCE_CONTEXT",reference:"current",field:"projectedAvailableMinor"}]}],summary:"Synthetic evidence-backed advisory only.",confidence:0.8 };
    return { output: agent === "AGGREGATOR" ? { ...output, disagreements:[] } : output, provider:"fake",model:"uat-deterministic",latencyMs:0,inputTokens:0,outputTokens:0,totalTokens:0 };
  },
};

async function configurePolicy(db: Postgres, scenario: Scenario) {
  const service = new PolicyService(db, new PaymentRequestService(db));
  const set = await service.createSet({ code:`UAT-${randomUUID()}`,name:`UAT ${scenario.label}` },admin,`${scenario.label}-policy-set`);
  const version = await service.createVersion(set.id,{ effectiveFrom:"2020-01-01T00:00:00Z" },admin,`${scenario.label}-policy-version`);
  await service.addRule(version.id,{
    code:`UAT-R-${randomUUID()}`,name:`${scenario.label} route`,priority:1,effect:scenario.automatic?"ALLOW_NO_APPROVAL":"REQUIRE_APPROVAL",
    conditions:{ currencies:["MYR"],riskLevels:[scenario.risk] },
    approvalSteps:scenario.automatic?[]:[
      { sequence:1,requiredRole:"AM",authorityScope:"DEPARTMENT",mandatory:true,reason:"High-risk AM review" },
      { sequence:2,requiredRole:"DIRECTOR",authorityScope:"ORGANIZATION",mandatory:true,reason:"High-risk Director review" },
    ],requiredEvidence:[],notificationMetadata:{},autoApprovalEligible:scenario.automatic,
  },admin,`${scenario.label}-policy-rule`);
  await service.activate(version.id,admin,`${scenario.label}-policy-active`);
  return service;
}

async function runScenario(db: Postgres, scenario: Scenario) {
  const requests = new PaymentRequestService(db), validation = new ValidationService(db,requests,{} as never,null),
    context = new FinanceContextService(db,requests), policy = await configurePolicy(db,scenario),
    dashboard = new DashboardService(db), beforeSummary = await dashboard.summary(finance,{page:1,pageSize:25});
  const draft = await requests.initiate(requester,`${scenario.label}-init`);
  await requests.update(draft.id,{ payee:`UAT ${scenario.label} ${randomUUID()}`,purpose:`Day 10.1 ${scenario.label}`,category:"Operations",amount:scenario.amount??"10.00",currency:"MYR",dueDate:"2026-10-30",paymentMethod:"BANK_TRANSFER",paymentDetails:"Synthetic UAT beneficiary" },requester,`${scenario.label}-capture`);
  const request = await requests.submit(draft.id,requester,`${scenario.label}-submit`);
  await addDocument(db,request.id,`${scenario.label}-invoice.pdf`);

  const buildChain = async (clarify: boolean) => {
    await validation.start(request.id,finance,`${scenario.label}-validation-start`);
    if (clarify) {
      await validation.finalize(request.id,{ overallResult:"CLARIFICATION_REQUIRED",remarks:"Controlled missing evidence",requiredResponse:"Confirm revised evidence",findings:[{code:"MISSING_INFORMATION",status:"FAIL",severity:"HIGH",explanation:"Controlled UAT clarification"}] },finance,`${scenario.label}-clarify`);
      const state = await validation.get(request.id,requester);
      await validation.respond(request.id,state.clarifications[0].id,{ response:"Synthetic evidence confirmed",purpose:`Day 10.1 ${scenario.label} revised` },requester,`${scenario.label}-response`);
      await validation.start(request.id,finance,`${scenario.label}-revalidation-start`);
    }
    await validation.finalize(request.id,{ overallResult:"PASS",remarks:"UAT evidence complete",findings:[] },finance,`${scenario.label}-validation-pass`);
    await context.calculate(request.id,finance,`${scenario.label}-context`);
    const assessment = { riskLevel:scenario.risk,priority:scenario.risk==="HIGH"?"HIGH":"NORMAL",urgency:"NORMAL",riskFlags:scenario.risk==="HIGH"?["BUDGET_PRESSURE"]:[],financialAssessment:"UAT Finance review",spendingAssessment:"UAT spending review",complianceRemarks:"UAT compliance review",evidenceReferences:[{source:"FINANCE_CONTEXT",reference:"current",field:"projected_available_amount_minor"}],...(scenario.aiAssisted&&scenario.risk==="HIGH"?{overrideReason:"Human Finance assessment overrides advisory LOW using authoritative pressure evidence"}:{}) } as any;
    if (scenario.aiAssisted) {
      const analysisDb = withAiEnabled(db);
      const analysis = new FinancialAnalysisService(analysisDb,requests,advisoryLowProvider as never), view = await analysis.start(request.id,finance,`${scenario.label}-ai-analysis`) as any;
      await analysis.finalize(request.id,view.analysis_run_id??view.id,assessment,finance,`${scenario.label}-human-final`);
    } else {
      await new FinancialAnalysisService(db,requests,null).manual(request.id,assessment,finance,`${scenario.label}-manual-analysis`);
    }
    await policy.evaluate(request.id,finance,`${scenario.label}-policy`);
    const approvals = new ApprovalService(db,requests), view = await approvals.create(request.id,finance,`${scenario.label}-approval`);
    if (!scenario.automatic) {
      await assert.rejects(() => approvals.act(request.id,view.steps[1].id,{commandKey:randomUUID(),action:"APPROVE"},finance,`${scenario.label}-bypass`),/active|step|sequence/i);
      await approvals.act(request.id,view.steps[0].id,{commandKey:randomUUID(),action:"APPROVE"},approver,`${scenario.label}-am`);
      await approvals.act(request.id,view.steps[1].id,{commandKey:randomUUID(),action:"APPROVE"},finance,`${scenario.label}-director`);
    }
    return view;
  };

  const firstApproval = await buildChain(Boolean(scenario.clarification));
  let staleIds: Record<string,string>|null = null;
  if (scenario.revision) {
    staleIds = (await db.pool.query(`SELECT
      (SELECT id FROM validation_runs WHERE payment_request_id=$1 AND is_current) validation_id,
      (SELECT id FROM finance_context_snapshots WHERE payment_request_id=$1 AND is_current) context_id,
      (SELECT id FROM financial_analysis_runs WHERE payment_request_id=$1 AND is_current) analysis_id,
      (SELECT id FROM policy_decision_runs WHERE payment_request_id=$1 AND is_current) policy_id,
      (SELECT id FROM approval_cases WHERE payment_request_id=$1 AND is_current) approval_id`,[request.id])).rows[0];
    await addDocument(db,request.id,`${scenario.label}-revision.pdf`);
    assert.equal((await requests.get(request.id,requester)).status,"SUBMITTED");
    const stale = (await db.pool.query(`SELECT
      (SELECT is_current FROM validation_runs WHERE id=$1) validation_current,
      (SELECT is_current FROM finance_context_snapshots WHERE id=$2) context_current,
      (SELECT is_current FROM financial_analysis_runs WHERE id=$3) analysis_current,
      (SELECT is_current FROM policy_decision_runs WHERE id=$4) policy_current,
      (SELECT is_current FROM approval_cases WHERE id=$5) approval_current`,[
      staleIds!.validation_id,
      staleIds!.context_id,
      staleIds!.analysis_id,
      staleIds!.policy_id,
      staleIds!.approval_id,
    ])).rows[0];
    assert.deepEqual(stale,{validation_current:false,context_current:false,analysis_current:false,policy_current:false,approval_current:false});
    await buildChain(false);
  }

  const control = new FinanceControlService(db,requests), run = await control.start(request.id,finance,`${scenario.label}-control`) as any;
  for (const code of confirmations) await control.confirm(run.run.id,{code,confirmed:true},finance,`${scenario.label}-${code}`);
  await control.finalize(run.run.id,{commandKey:randomUUID()},finance,`${scenario.label}-ready`);
  const slipId=randomUUID(); await db.paymentTransaction(finance.id,`${scenario.label}-slip`,(client)=>client.query("SELECT attach_payment_slip($1,$2,$3,'uat-payment.pdf',$4,'application/pdf',20,$5)",[request.id,slipId,randomUUID(),`quarantine/uat/${randomUUID()}`,randomUUID().replaceAll("-","").repeat(2)]));
  const paymentService = new PaymentService(db,requests,{} as never);
  const payment = await paymentService.record(request.id,{commandKey:randomUUID(),paymentDate:new Date().toISOString().slice(0,10),amount:scenario.amount??"10.00",currency:"MYR",bankReference:`UAT-${scenario.label}-${randomUUID()}`,slipDocumentId:slipId,confirmPossibleDuplicate:false},finance,`${scenario.label}-payment`) as any;
  const afterSummary=await dashboard.summary(finance,{page:1,pageSize:25}), history=await paymentService.list(finance,{page:1,pageSize:100,status:"PAID"}), proof=(await db.pool.query(`SELECT pr.ticket_number,pr.status,p.id payment_id,p.ledger_entry_id,(SELECT count(*)::int FROM audit_events WHERE entity_id=pr.id) audit_count,(SELECT array_agg(action ORDER BY occurred_at) FROM audit_events WHERE entity_id=pr.id) actions FROM payment_requests pr JOIN payments p ON p.payment_request_id=pr.id WHERE pr.id=$1`,[request.id])).rows[0];
  assert.equal(proof.status,"PAID"); assert.equal(payment.id,proof.payment_id); assert.ok(history.items.some((item:any)=>item.id===payment.id)); assert.equal(afterSummary.payments.total_paid,beforeSummary.payments.total_paid+1);
  if (scenario.aiOff) { const calls=(await db.pool.query("SELECT count(*)::int count FROM ai_usage_events WHERE payment_request_id=$1",[request.id])).rows[0].count; assert.equal(calls,0); }
  console.log(JSON.stringify({scenario:scenario.label,ticket:proof.ticket_number,aiMode:scenario.aiOff?"OFF":scenario.aiAssisted?"ON":"MANUAL",finalState:proof.status,paymentId:proof.payment_id,ledgerId:proof.ledger_entry_id,auditCount:proof.audit_count,staleIds,initialApprovalId:firstApproval.case.id,result:"PASS"}));
}

async function addDocument(db:Postgres,requestId:string,name:string){await db.pool.query(`INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by)VALUES($1,$2,$3,$4,$5,'application/pdf',20,$6,'INVOICE',1,$7)`,[randomUUID(),requestId,randomUUID(),name,`quarantine/uat/${randomUUID()}`,randomUUID().replaceAll("-","").repeat(2),requester.id]);}

function withAiEnabled(db: Postgres): Postgres {
  const analysisDb = Object.create(db) as Postgres;
  Object.defineProperty(analysisDb, "pool", { value: new Proxy(db.pool, {
    get(target, property, receiver) {
      if (property === "query") {
        return async (query: string, values?: unknown[]) => {
          if (query === "SELECT feature,enabled FROM ai_feature_configuration") {
            const result = await db.pool.query<{ feature: string; enabled: boolean }>(query, values);
            return { ...result, rows: result.rows.map((row) => ({ ...row, enabled: true })) };
          }
          return db.pool.query(query, values);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) });
  return analysisDb;
}

for (const scenario of [
  {label:"NORMAL",risk:"LOW",automatic:true},
  {label:"HIGH_RISK",risk:"HIGH",automatic:false,aiAssisted:true,amount:"50000.00"},
  {label:"CLARIFICATION_REVISION",risk:"LOW",automatic:true,clarification:true,revision:true},
  {label:"AI_OFF",risk:"LOW",automatic:true,aiOff:true},
] as Scenario[]) test(`Day 10.1 continuous UAT: ${scenario.label}`,async()=>{const db=new Postgres();try{await runScenario(db,scenario);}finally{await db.onModuleDestroy();}});
