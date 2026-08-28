import { createHash } from "node:crypto";
import { Postgres } from "../dist/src/infrastructure/database/postgres.js";
import { PaymentRequestService } from "../dist/src/application/payment-requests/payment-request.service.js";
import { ValidationService } from "../dist/src/application/validation/validation.service.js";
import { FinanceContextService } from "../dist/src/application/finance-context/finance-context.service.js";
import { FinancialAnalysisService } from "../dist/src/application/financial-analysis/financial-analysis.service.js";
import { PolicyService } from "../dist/src/application/policy/policy.service.js";
import { ApprovalService } from "../dist/src/application/approval/approval.service.js";
import { FinanceControlService } from "../dist/src/application/finance-control/finance-control.service.js";
import { PaymentService } from "../dist/src/application/payments/payment.service.js";
import { adminSql, bindSql, guardCompetition, pointRuntimeToCompetition } from "./competition-guard.mjs";

pointRuntimeToCompetition();
guardCompetition({ requireRuntimeUrls: true });

const IDS = {
  ops: "00000000-0000-4000-8000-000000000001", finance: "00000000-0000-4000-8000-000000000002",
  marketing: "c0000000-0000-4000-8000-000000000003", technology: "c0000000-0000-4000-8000-000000000004",
  requester: "10000000-0000-4000-8000-000000000001", analyst: "10000000-0000-4000-8000-000000000002",
  manager: "c1000000-0000-4000-8000-000000000003", director: "c1000000-0000-4000-8000-000000000004",
  controller: "c1000000-0000-4000-8000-000000000005", operator: "c1000000-0000-4000-8000-000000000006",
  reporting: "c1000000-0000-4000-8000-000000000007", admin: "c1000000-0000-4000-8000-000000000008",
  marketingRequester: "c1000000-0000-4000-8000-000000000009", technologyRequester: "c1000000-0000-4000-8000-000000000010",
};
const principal = (id, departmentId, roles) => ({ id, departmentId, roles });
const requester = principal(IDS.requester, IDS.ops, ["REQUESTER"]);
const marketingRequester = principal(IDS.marketingRequester, IDS.marketing, ["REQUESTER"]);
const technologyRequester = principal(IDS.technologyRequester, IDS.technology, ["REQUESTER"]);
const analyst = principal(IDS.analyst, IDS.finance, ["FINANCE"]);
const manager = principal(IDS.manager, IDS.ops, ["REQUESTER"]);
const director = principal(IDS.director, IDS.finance, ["REQUESTER"]);
const controller = principal(IDS.controller, IDS.finance, ["FINANCE"]);
const operator = principal(IDS.operator, IDS.finance, ["FINANCE"]);
const admin = principal(IDS.admin, IDS.finance, ["ADMIN"]);
const confirmations = ["PAYEE_VERIFIED", "PAYMENT_METHOD_VERIFIED", "PAYMENT_DETAILS_VERIFIED", "SUPPORTING_DOCUMENTS_VERIFIED"];
const competitionAiProvider = {
  async analyzeFinancialAgent(agent) {
    const output={status:"OK",riskLevel:"HIGH",priority:"HIGH",urgency:"NORMAL",suggestedDeadline:null,findings:[{code:"MARKETING_BUDGET_PRESSURE",severity:"HIGH",explanation:"The request is material relative to the current Marketing budget position.",evidenceReferences:[{source:"FINANCE_CONTEXT",reference:"current",field:"projectedAvailableMinor"}]}],summary:"Advisory flags a material Marketing request for human review.",confidence:0.86};
    return {output:agent==="AGGREGATOR"?{...output,disagreements:[]}:output,provider:"competition-deterministic",model:"competition-advisory-v1",latencyMs:0,inputTokens:0,outputTokens:0,totalTokens:0};
  },
};
const stableUuid = (value) => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4"; hex[16] = "8";
  return `${hex.slice(0,8).join("")}-${hex.slice(8,12).join("")}-${hex.slice(12,16).join("")}-${hex.slice(16,20).join("")}-${hex.slice(20).join("")}`;
};

const adminDb = { query: async (text, values) => ({ rows: [], rowCount: 0, output: adminSql(bindSql(text, values)) }) };
const db = new Postgres();
try {
  await prepareConfiguration(adminDb);
  const existing = await db.pool.query("SELECT 1 FROM audit_events WHERE action='COMPETITION_DATASET_READY' LIMIT 1");
  if (existing.rowCount) throw new Error("Competition seed already exists. Run reset:competition before reseeding.");

  const normal = await workflow({ key:"A-NORMAL", payee:"Metro Office Solutions Sdn. Bhd.", purpose:"Replacement laptops and office equipment", category:"Office & Equipment", amount:"8500.00", departmentId:IDS.ops, risk:"LOW", route:"MANAGER", stop:"PENDING" });
  const high = await workflow({ key:"B-HIGH-RISK", payee:"BrightWave Media Sdn. Bhd.", purpose:"Regional campaign and media placement", category:"Marketing", amount:"85000.00", departmentId:IDS.marketing, risk:"HIGH", route:"MULTI", stop:"PENDING" });
  const clarification = await clarificationScenario();
  const paid = [];
  for (const item of [
    { key:"D-PAID", payee:"Prime Facilities Services Sdn. Bhd.", purpose:"Quarterly facility maintenance", amount:"36000.00", paymentDate:"2026-08-15" },
    { key:"HIST-1", payee:"Nusantara Logistics Sdn. Bhd.", purpose:"Regional operations logistics", amount:"38000.00", paymentDate:"2026-07-22" },
    { key:"HIST-2", payee:"Metro Office Solutions Sdn. Bhd.", purpose:"Workspace equipment renewal", amount:"32000.00", paymentDate:"2026-07-08" },
    { key:"HIST-3", payee:"Prime Facilities Services Sdn. Bhd.", purpose:"Building maintenance services", amount:"29000.00", paymentDate:"2026-06-18" },
    { key:"HIST-4", payee:"Apex Professional Services Sdn. Bhd.", purpose:"Operational compliance advisory", amount:"25000.00", paymentDate:"2026-05-20" },
  ]) paid.push(await workflow({ ...item, category:"Office & Equipment", departmentId:IDS.ops, risk:"LOW", route:"AUTO", stop:"PAID" }));
  const ready = await workflow({ key:"READY", payee:"Vertex Business Systems Sdn. Bhd.", purpose:"Approved office equipment replenishment", category:"Office & Equipment", amount:"8500.00", departmentId:IDS.ops, risk:"LOW", route:"AUTO", stop:"READY" });

  await adminDb.query(`INSERT INTO budget_commitments(id,budget_id,amount_minor,currency,status)
    VALUES($1,'31000000-0000-4000-8000-000000000001',5650000,'MYR','ACTIVE')`, [stableUuid("competition-baseline-commitment")]);
  await db.pool.query(`INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
    VALUES($1,$2,'COMPETITION_DATASET_READY','COMPETITION_DATASET',$3,$4,$5)`, [stableUuid("competition-ready-event"), IDS.admin, stableUuid("competition-dataset"), stableUuid("competition-ready-correlation"), JSON.stringify({ normal:normal.ticket, high:high.ticket, clarification:clarification.ticket, paid:paid[0].ticket, ready:ready.ticket })]);
  process.stdout.write(JSON.stringify({ result:"PASS", normal, high, clarification, paid, ready }, null, 2) + "\n");
} finally {
  await db.onModuleDestroy();
}

async function prepareConfiguration(pool) {
  try {
    await pool.query(`INSERT INTO departments(id,code,name) VALUES($1,'MKT','Marketing'),($2,'TECH','Technology') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name`, [IDS.marketing, IDS.technology]);
    await pool.query(`UPDATE users SET display_name='Amelia Tan',email='amelia.tan@aims.demo' WHERE id=$1;
      UPDATE users SET display_name='Daniel Lim',email='daniel.lim@aims.demo' WHERE id=$2`, [IDS.requester, IDS.analyst]);
    const people = [
      [IDS.manager,"competition.manager","sarah.lee@aims.demo","Sarah Lee",IDS.ops,"REQUESTER"],
      [IDS.director,"competition.director","adrian.ng@aims.demo","Adrian Ng",IDS.finance,"REQUESTER"],
      [IDS.controller,"competition.controller","michael.wong@aims.demo","Michael Wong",IDS.finance,"FINANCE"],
      [IDS.operator,"competition.payment","nora.ismail@aims.demo","Nora Ismail",IDS.finance,"FINANCE"],
      [IDS.reporting,"competition.reporting","grace.chen@aims.demo","Grace Chen",IDS.finance,"FINANCE"],
      [IDS.admin,"competition.admin","tech.admin@aims.demo","Technical Administrator",IDS.finance,"ADMIN"],
      [IDS.marketingRequester,"competition.requester.marketing","maya.rahman@aims.demo","Maya Rahman",IDS.marketing,"REQUESTER"],
      [IDS.technologyRequester,"competition.requester.technology","ethan.teo@aims.demo","Ethan Teo",IDS.technology,"REQUESTER"],
    ];
    for (const [id,subject,email,name,dept,role] of people) {
      await pool.query("INSERT INTO users(id,external_subject,email,display_name,department_id,active) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,active=true", [id,subject,email,name,dept]);
      await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,$2) ON CONFLICT DO NOTHING", [id,role]);
    }
    await pool.query(`INSERT INTO approval_authorities(id,user_id,authority_role,authority_scope,department_id,minimum_amount_minor,maximum_amount_minor,active) VALUES
      ($1,$2,'AM','DEPARTMENT',$3,0,NULL,true),($4,$2,'AM','DEPARTMENT',$5,0,NULL,true),($6,$7,'DIRECTOR','ORGANIZATION',NULL,0,NULL,true) ON CONFLICT DO NOTHING`,
      [stableUuid("auth-manager-ops"),IDS.manager,IDS.ops,stableUuid("auth-manager-marketing"),IDS.marketing,stableUuid("auth-director"),IDS.director]);
    await pool.query("INSERT INTO finance_control_authorities(id,user_id,scope,department_id,active,allow_self_control) VALUES($1,$2,'ORGANIZATION',NULL,true,false) ON CONFLICT DO NOTHING", [stableUuid("auth-controller"),IDS.controller]);
    await pool.query("INSERT INTO payment_authorities(id,user_id,scope,department_id,active,allow_self_payment,minimum_amount_minor,maximum_amount_minor) VALUES($1,$2,'ORGANIZATION',NULL,true,false,0,NULL) ON CONFLICT DO NOTHING", [stableUuid("auth-payment"),IDS.operator]);
    await pool.query("INSERT INTO finance_reporting_authorities(id,user_id,scope,department_id,active) VALUES($1,$2,'ORGANIZATION',NULL,true) ON CONFLICT DO NOTHING", [stableUuid("auth-reporting"),IDS.reporting]);
    await pool.query("UPDATE budgets SET category='Office & Equipment' WHERE id='31000000-0000-4000-8000-000000000001'");
    await pool.query("UPDATE budgets SET status='INACTIVE' WHERE id IN ('31000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000003')");
    const budgets = [
      [stableUuid("budget-marketing"),IDS.marketing,"Marketing",16000000],
      [stableUuid("budget-technology"),IDS.technology,"Software & Technology",12000000],
      [stableUuid("budget-finance"),IDS.finance,"Professional Services",10000000],
    ];
    for (const [id,dept,category,amount] of budgets) {
      await pool.query("INSERT INTO budgets(id,fiscal_period_id,department_id,category,currency,status) VALUES($1,'30000000-0000-4000-8000-000000000001',$2,$3,'MYR','ACTIVE')", [id,dept,category]);
      await pool.query("INSERT INTO budget_versions(id,budget_id,version,original_amount_minor,revised_amount_minor,effective_from,status) VALUES($1,$2,1,$3,$3,'2026-01-01','ACTIVE')", [stableUuid(`version-${id}`),id,amount]);
    }
  } catch (error) { throw error; }
}

async function configurePolicy(key, risk, route) {
  const service = new PolicyService(db, new PaymentRequestService(db));
  const set = await service.createSet({code:`COMP-${key}`,name:`Competition ${key}`},admin,`${key}-policy-set`);
  const version = await service.createVersion(set.id,{effectiveFrom:"2020-01-01T00:00:00Z"},admin,`${key}-policy-version`);
  const approvalSteps = route === "AUTO" ? [] : route === "MANAGER"
    ? [{sequence:1,requiredRole:"AM",authorityScope:"DEPARTMENT",mandatory:true,reason:"Department Manager approval"}]
    : [{sequence:1,requiredRole:"AM",authorityScope:"DEPARTMENT",mandatory:true,reason:"Manager review for material request"},{sequence:2,requiredRole:"DIRECTOR",authorityScope:"ORGANIZATION",mandatory:true,reason:"Director review for high-risk request"}];
  await service.addRule(version.id,{code:`COMP-R-${key}`,name:`${key} route`,priority:1,effect:route==="AUTO"?"ALLOW_NO_APPROVAL":"REQUIRE_APPROVAL",conditions:{currencies:["MYR"],riskLevels:[risk]},approvalSteps,requiredEvidence:[],notificationMetadata:{},autoApprovalEligible:route==="AUTO"},admin,`${key}-policy-rule`);
  await service.activate(version.id,admin,`${key}-policy-activate`);
  return service;
}

async function createSubmitted(input) {
  const requests = new PaymentRequestService(db);
  const owner = input.departmentId === IDS.marketing ? marketingRequester : input.departmentId === IDS.technology ? technologyRequester : requester;
  const draft = await requests.initiate(owner,`${input.key}-init`);
  await requests.update(draft.id,{payee:input.payee,purpose:input.purpose,category:input.category,amount:input.amount,currency:"MYR",dueDate:"2026-12-15",paymentMethod:"BANK_TRANSFER",paymentDetails:"Synthetic competition beneficiary — no real account"},owner,`${input.key}-capture`);
  const submitted = await requests.submit(draft.id,owner,`${input.key}-submit`);
  await addDocument(submitted.id,input.key,"INVOICE",owner.id);
  return submitted;
}

async function analyze(request, input) {
  const requests = new PaymentRequestService(db);
  const validation = new ValidationService(db,requests,{},null);
  await validation.start(request.id,analyst,`${input.key}-validation-start`);
  await validation.finalize(request.id,{overallResult:"PASS",remarks:"Synthetic competition evidence verified",findings:[]},analyst,`${input.key}-validation-pass`);
  await new FinanceContextService(db,requests).calculate(request.id,analyst,`${input.key}-finance-context`);
  const assessment = {riskLevel:input.risk,priority:input.risk==="HIGH"?"HIGH":"NORMAL",urgency:"NORMAL",riskFlags:input.risk==="HIGH"?["BUDGET_PRESSURE","MATERIAL_AMOUNT"]:[],financialAssessment:input.risk==="HIGH"?"Marketing budget is valid but materially pressured by this request.":"Budget position supports this request.",spendingAssessment:input.risk==="HIGH"?"Amount is materially above routine operating requests.":"Spending is consistent with normal operations.",complianceRemarks:"Human Finance final assessment; AI is advisory only.",evidenceReferences:[{source:"FINANCE_CONTEXT",reference:"current",field:"projected_available_amount_minor"}]};
  if (input.risk === "HIGH") {
    const aiDb=withAiEnabled(db), analysis=new FinancialAnalysisService(aiDb,requests,competitionAiProvider);
    const view=await analysis.start(request.id,analyst,`${input.key}-ai-advisory`);
    await analysis.finalize(request.id,view.analysis_run_id??view.id,assessment,analyst,`${input.key}-human-final-risk`);
  } else {
    await new FinancialAnalysisService(db,requests,null).manual(request.id,assessment,analyst,`${input.key}-manual-risk`);
  }
  return requests;
}

function withAiEnabled(source) {
  const proxy=Object.create(source);
  Object.defineProperty(proxy,"pool",{value:new Proxy(source.pool,{get(target,property,receiver){
    if(property==="query") return async(query,values)=>{
      if(query==="SELECT feature,enabled FROM ai_feature_configuration"){
        const result=await source.pool.query(query,values);
        return {...result,rows:result.rows.map((row)=>({...row,enabled:true}))};
      }
      return source.pool.query(query,values);
    };
    const value=Reflect.get(target,property,receiver); return typeof value==="function"?value.bind(target):value;
  }})});
  return proxy;
}

async function workflow(input) {
  const request = await createSubmitted(input);
  const requests = await analyze(request,input);
  const policy = await configurePolicy(input.key,input.risk,input.route);
  await policy.evaluate(request.id,analyst,`${input.key}-policy-evaluate`);
  const approvals = new ApprovalService(db,requests);
  const approval = await approvals.create(request.id,analyst,`${input.key}-approval-create`);
  if (input.stop === "PENDING") return summary(request.id);
  if (input.route !== "AUTO") {
    await approvals.act(request.id,approval.steps[0].id,{commandKey:stableUuid(`${input.key}-manager-command`),action:"APPROVE"},manager,`${input.key}-manager-approve`);
    if (approval.steps[1]) await approvals.act(request.id,approval.steps[1].id,{commandKey:stableUuid(`${input.key}-director-command`),action:"APPROVE"},director,`${input.key}-director-approve`);
  }
  const control = new FinanceControlService(db,requests);
  const run = await control.start(request.id,controller,`${input.key}-control-start`);
  for (const code of confirmations) await control.confirm(run.run.id,{code,confirmed:true},controller,`${input.key}-control-${code}`);
  await control.finalize(run.run.id,{commandKey:stableUuid(`${input.key}-control-final`)},controller,`${input.key}-control-finalize`);
  if (input.stop === "READY") return summary(request.id);
  const slipId = stableUuid(`${input.key}-payment-slip`);
  await db.paymentTransaction(operator.id,`${input.key}-slip`,(client)=>client.query("SELECT attach_payment_slip($1,$2,$3,$4,$5,'application/pdf',20,$6)",[request.id,slipId,stableUuid(`${input.key}-slip-logical`),`${input.key.toLowerCase()}-payment-slip.pdf`,`quarantine/competition/${input.key.toLowerCase()}-payment-slip.pdf`,createHash("sha256").update(`${input.key}-slip`).digest("hex")]));
  await new PaymentService(db,requests,{}).record(request.id,{commandKey:stableUuid(`${input.key}-payment-command`),paymentDate:input.paymentDate??"2026-08-15",amount:input.amount,currency:"MYR",bankReference:`DEMO-TRX-${(input.paymentDate??"2026-08-15").replaceAll("-","")}-${input.key}`,slipDocumentId:slipId,confirmPossibleDuplicate:false},operator,`${input.key}-payment-record`);
  return summary(request.id);
}

async function clarificationScenario() {
  const input={key:"C-CLARIFICATION",payee:"CloudSphere Technologies Sdn. Bhd.",purpose:"Annual software subscription renewal",category:"Software & Technology",amount:"24800.00",departmentId:IDS.technology,risk:"LOW"};
  const request=await createSubmitted(input), requests=new PaymentRequestService(db), validation=new ValidationService(db,requests,{},null);
  await validation.start(request.id,analyst,`${input.key}-validation-start`);
  await validation.finalize(request.id,{overallResult:"CLARIFICATION_REQUIRED",remarks:"Invoice service period does not match the renewal request.",requiredResponse:"Provide a corrected invoice showing the annual service period.",findings:[{code:"DOCUMENT_MISMATCH",status:"FAIL",severity:"HIGH",explanation:"Invoice service period requires clarification."}]},analyst,`${input.key}-clarification`);
  return summary(request.id);
}

async function addDocument(requestId,key,type,uploadedBy) {
  const id=stableUuid(`${key}-invoice`), logical=stableUuid(`${key}-invoice-logical`), hash=createHash("sha256").update(`AIMS synthetic ${key} invoice`).digest("hex");
  await db.pool.query("INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by) VALUES($1,$2,$3,$4,$5,'application/pdf',20,$6,$7,1,$8)",[id,requestId,logical,`${key.toLowerCase()}-invoice.pdf`,`quarantine/competition/${key.toLowerCase()}-invoice.pdf`,hash,type,uploadedBy]);
}

async function summary(id) {
  return (await db.pool.query("SELECT id,ticket_number ticket,status,payee,amount::text FROM payment_requests WHERE id=$1",[id])).rows[0];
}
