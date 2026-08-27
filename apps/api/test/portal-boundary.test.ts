import assert from "node:assert/strict";
import test from "node:test";
import { PortalService } from "../src/application/portal/portal.service.js";
import { LocalIdentityController } from "../src/application/auth/local-identity.controller.js";
import type { Principal } from "../src/domain/payment-request.js";

const requester:Principal={id:"10000000-0000-4000-8000-000000000001",departmentId:"00000000-0000-4000-8000-000000000001",roles:["REQUESTER"]};

test("local login identities come from the backend and expose only safe context",async()=>{
  const previous=process.env.NODE_ENV;
  process.env.NODE_ENV="development";
  try {
    const controller=new LocalIdentityController({pool:{query:async()=>({rows:[{
      subject:"demo.requester",display_name:"Demo Requester",department:"Operations",requester:true,
      finance_analysis:false,approval:false,finance_control:false,payment:false,reporting:false,
    }]})}} as never);
    const result=await controller.list();
    assert.deepEqual(result.identities,[{subject:"demo.requester",displayName:"Demo Requester",department:"Operations",persona:"Requester",workspaces:["Requester"]}]);
    const raw=JSON.stringify(result);
    for(const restricted of ["authorityId","amountLimit","databaseRole","executorRole"]) assert.equal(raw.includes(restricted),false);
  } finally {
    if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;
  }
});

test("production does not expose the local identity catalogue",async()=>{
  const previous=process.env.NODE_ENV;
  process.env.NODE_ENV="production";
  try {
    const controller=new LocalIdentityController({} as never);
    await assert.rejects(()=>controller.list(),/Not Found/);
  } finally {
    if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;
  }
});

test("requester projection is owner scoped and excludes finance internals",async()=>{
  const queries:string[]=[];
  const db={pool:{query:async(sql:string,values:unknown[])=>{
    queries.push(sql);
    if(sql.includes("FROM payment_requests WHERE id="))return{rowCount:1,rows:[{id:values[0],ticket_number:"PAY-1",status:"PAID",payee:"Vendor",amount:"10.00",currency:"MYR",department_id:requester.departmentId}]};
    if(sql.includes("FROM payment_documents"))return{rowCount:0,rows:[]};
    if(sql.includes("FROM validation_clarifications"))return{rowCount:0,rows:[]};
    if(sql.includes("FROM audit_events"))return{rowCount:0,rows:[{action:"REQUEST_PAID",previous_state:"READY_FOR_PAYMENT",new_state:"PAID",occurred_at:new Date()}]};
    if(sql.includes("FROM payments"))return{rowCount:1,rows:[{payment_date:"2026-08-27",status:"PAID",amount_minor:"1000",currency:"MYR",payment_method:"BANK_TRANSFER",recorded_at:new Date()}]};
    throw Error("Unexpected query");
  }}};
  const result=await new PortalService(db as never).requesterDetail(requester,"20000000-0000-4000-8000-000000000001");
  assert.match(queries[0],/created_by=\$2 AND department_id=\$3/);
  const raw=JSON.stringify(result);
  for(const restricted of ["policy_rule","authority","finance_control","bank_reference","ledger","executor","provider","evidence_catalog"])
    assert.equal(raw.includes(restricted),false,restricted);
});

test("finance-only identity cannot enter requester workspace",async()=>{
  const finance:Principal={...requester,roles:["FINANCE"]};
  await assert.rejects(()=>new PortalService({} as never).requesterSummary(finance),/Requester workspace entitlement required/);
});

test("requester list queries only the owner's payment requests",async()=>{
  const queries:string[]=[];
  const db={pool:{query:async(sql:string)=>{queries.push(sql);return sql.startsWith("SELECT count")?{rows:[{total:0}]}:{rows:[]}}}};
  const result=await new PortalService(db as never).requesterList(requester,{pageSize:"20"});
  assert.equal(result.total,0);
  assert.match(queries[0],/FROM payment_requests WHERE created_by=\$1 AND department_id=\$2/);
});

test("workspace bootstrap derives capabilities from authoritative tables",async()=>{
  const db={pool:{query:async(sql:string)=>sql.includes("FROM users u JOIN departments")
    ?{rowCount:1,rows:[{external_subject:"multi",email:"multi@aims.local",display_name:"Multi User",department_name:"Operations"}]}
    :{rowCount:1,rows:[{finance_analysis:true,approval:true,finance_control:false,payment:false,reporting:true,policy_admin:false}]}}};
  const result=await new PortalService(db as never).session({...requester,roles:["REQUESTER","FINANCE"]});
  assert.deepEqual(result.workspaces,{requester:true,finance:true});
  assert.equal(result.capabilities.approval,true);
  assert.equal(result.capabilities.reporting,true);
});

test("ADMIN-only identity does not receive requester or Finance workspace",async()=>{
  const db={pool:{query:async(sql:string)=>sql.includes("FROM users u JOIN departments")
    ?{rowCount:1,rows:[{external_subject:"admin",email:"admin@aims.local",display_name:"Technical Admin",department_name:"IT"}]}
    :{rowCount:1,rows:[{finance_analysis:false,approval:false,finance_control:false,payment:false,reporting:false,policy_admin:true}]}}};
  const result=await new PortalService(db as never).session({...requester,roles:["ADMIN"]});
  assert.deepEqual(result.workspaces,{requester:false,finance:false});
  assert.equal(result.capabilities.policyAdmin,true);
});

test("technical ADMIN neither adds nor removes explicit business authority",async()=>{
  const db={pool:{query:async(sql:string)=>sql.includes("FROM users u JOIN departments")
    ?{rowCount:1,rows:[{external_subject:"admin-approver",email:"admin-approver@aims.local",display_name:"Admin Approver",department_name:"IT"}]}
    :{rowCount:1,rows:[{finance_analysis:false,approval:true,finance_control:false,payment:false,reporting:false,policy_admin:true}]}}};
  const result=await new PortalService(db as never).session({...requester,roles:["ADMIN"]});
  assert.deepEqual(result.workspaces,{requester:false,finance:true});
  assert.equal(result.capabilities.approval,true);
});
