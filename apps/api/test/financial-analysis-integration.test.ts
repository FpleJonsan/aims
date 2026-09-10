import assert from 'node:assert/strict';import {randomUUID}from'node:crypto';import test from'node:test';import {FinanceContextService}from'../src/application/finance-context/finance-context.service.js';import {FinancialAnalysisService}from'../src/application/financial-analysis/financial-analysis.service.js';import {PaymentRequestService}from'../src/application/payment-requests/payment-request.service.js';import {ValidationService}from'../src/application/validation/validation.service.js';import type{Principal}from'../src/domain/payment-request.js';import{Postgres}from'../src/infrastructure/database/postgres.js';
const requester:Principal={id:'10000000-0000-4000-8000-000000000001',departmentId:'00000000-0000-4000-8000-000000000001',roles:['REQUESTER']},finance:Principal={id:'10000000-0000-4000-8000-000000000002',departmentId:'00000000-0000-4000-8000-000000000002',roles:['FINANCE']};
async function eligible(db:Postgres,requests:PaymentRequestService){const validation=new ValidationService(db,requests,{}as never,null),context=new FinanceContextService(db,requests);const d=await requests.initiate(requester,'d4-i');await requests.update(d.id,{payee:'Vendor',purpose:'Risk test',category:'Operations',amount:'10.00',currency:'MYR',dueDate:'2026-09-30',paymentMethod:'BANK_TRANSFER',paymentDetails:'Synthetic'},requester,'d4-u');const r=await requests.submit(d.id,requester,'d4-s');await db.pool.query(`INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference,storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key,trusted_storage_object_version)VALUES($1,$2,$3,'x.pdf',$4,'application/pdf',20,$5,1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean','VERSION_BOUND','test-fixture',gen_random_uuid()::text,$4,gen_random_uuid()::text)`,[randomUUID(),r.id,randomUUID(),`active/tests/${randomUUID()}`,'0'.repeat(64),requester.id]);await validation.start(r.id,finance,'d4-v');await validation.finalize(r.id,{overallResult:'PASS',remarks:'complete',findings:[]},finance,'d4-vp');await context.calculate(r.id,finance,'d4-c');return r}
const manual={riskLevel:'MEDIUM',priority:'HIGH',urgency:'NORMAL',riskFlags:[{code:'BUDGET_PRESSURE'}],financialAssessment:'Projected budget remains positive.',spendingAssessment:'Historical data reviewed.',complianceRemarks:'Validation is complete.',evidenceReferences:[{source:'FINANCE_CONTEXT',reference:'current snapshot',field:'projected_available_amount_minor'}],remarks:'Manual finance review'};
test('manual mode finalizes without AI and does not start Policy',async()=>{const db=new Postgres(),requests=new PaymentRequestService(db),service=new FinancialAnalysisService(db,requests,null);try{const r=await eligible(db,requests);await assert.rejects(()=>service.manual(r.id,manual,requester,'d4-noauth'));const result=await service.manual(r.id,manual,finance,'d4-manual');assert.equal(result.status,'FINALIZED');assert.equal(result.readyForPolicyEvaluation,true);assert.equal(result.ai_assessment,null);assert.equal((await requests.get(r.id,requester)).status,'VALIDATING');const approvals=await db.pool.query(`SELECT (SELECT count(*) FROM policy_decision_runs WHERE payment_request_id=$1)+(SELECT count(*) FROM approval_cases WHERE payment_request_id=$1) count`,[r.id]);assert.equal(Number(approvals.rows[0].count),0)}finally{await db.onModuleDestroy()}});
test('AI master off makes zero provider calls and requests manual assessment',async()=>{const db=new Postgres(),requests=new PaymentRequestService(db);let calls=0;const provider={analyzeFinancialAgent:async()=>{calls++;throw Error('must not call')}};const service=new FinancialAnalysisService(db,requests,provider as never);try{const r=await eligible(db,requests);const result=await service.start(r.id,finance,'d4-off');assert.equal(result.mode,'MANUAL');assert.equal(calls,0)}finally{await db.onModuleDestroy()}});

test('manual submission rolls back every change when completion audit fails', async () => {
 const db=new Postgres(),requests=new PaymentRequestService(db),service=new FinancialAnalysisService(db,requests,null);
 try {
  const r=await eligible(db,requests);
  const snapshot=async()=>({
   request:(await db.pool.query('SELECT to_jsonb(r) value FROM payment_requests r WHERE id=$1',[r.id])).rows,
   runs:(await db.pool.query('SELECT to_jsonb(r) value FROM financial_analysis_runs r WHERE payment_request_id=$1 ORDER BY id',[r.id])).rows,
   assessments:(await db.pool.query('SELECT to_jsonb(a) value FROM financial_risk_assessments a JOIN financial_analysis_runs r ON r.id=a.analysis_run_id WHERE r.payment_request_id=$1 ORDER BY a.id',[r.id])).rows,
   audits:(await db.pool.query('SELECT to_jsonb(a) value FROM audit_events a WHERE entity_id=$1 ORDER BY id',[r.id])).rows,
  });
  const audit=requests.audit.bind(requests);
  for(const existing of [false,true]) {
   if(existing)await service.manual(r.id,manual,finance,'atomic-original');
   const before=await snapshot();
   requests.audit=async(...args)=>{if(args[2]==='MANUAL_FINANCIAL_ANALYSIS_COMPLETED')throw new Error('forced completion audit failure');return audit(...args)};
   await assert.rejects(service.manual(r.id,{...manual,remarks:'Replacement'},finance,'atomic-failed'),/forced completion audit failure/);
   requests.audit=audit;
   assert.deepEqual(await snapshot(),before);
  }
  await service.manual(r.id,{...manual,remarks:'Successful replacement'},finance,'atomic-replacement');
  const result=await snapshot();
  assert.equal(result.runs.length,2);
  assert.equal(result.runs.filter(row=>row.value.is_current&&row.value.status==='FINALIZED').length,1);
  assert.equal(result.runs.filter(row=>row.value.status==='PROCESSING').length,0);
  assert.equal(result.assessments.length,2);
  assert.equal(result.audits.filter(row=>row.value.action==='MANUAL_FINANCIAL_ANALYSIS_COMPLETED').length,2);
 } finally {await db.onModuleDestroy()}
});

test('concurrent manual submissions finalize exactly one command',async()=>{
 const db=new Postgres(),requests=new PaymentRequestService(db),service=new FinancialAnalysisService(db,requests,null);
 try {
  const r=await eligible(db,requests);
  const lock=requests.lockRequest.bind(requests);
  let arrivals=0,release!:()=>void;
  const barrier=new Promise<void>(resolve=>{release=resolve});
  requests.lockRequest=async(client,id)=>{
   await client.query('SELECT 1');
   if(++arrivals===2)release();
   await barrier;
   return lock(client,id);
  };
  const results=await Promise.allSettled(['a','b'].map(label=>service.manual(r.id,{...manual,remarks:label},finance,`atomic-${label}`)));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const failure=results.find(result=>result.status==='rejected');
  assert.ok(failure?.status==='rejected'&&failure.reason.getStatus()===409);
  const runs=await db.pool.query('SELECT * FROM financial_analysis_runs WHERE payment_request_id=$1',[r.id]);
  assert.equal(runs.rowCount,1);assert.equal(runs.rows[0].status,'FINALIZED');assert.equal(runs.rows[0].is_current,true);
  assert.equal((await db.pool.query('SELECT 1 FROM financial_risk_assessments WHERE analysis_run_id=$1',[runs.rows[0].id])).rowCount,1);
  assert.equal((await db.pool.query("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='MANUAL_FINANCIAL_ANALYSIS_COMPLETED'",[r.id])).rowCount,1);
 } finally {await db.onModuleDestroy()}
});
