import assert from "node:assert/strict";
import pg from "pg";

const database="aims_migration_056_test";
const scoped=value=>{const url=new URL(value);url.pathname=`/${database}`;return url.toString()};
const trusted=new pg.Client({connectionString:scoped(process.env.PAYMENT_DATABASE_URL)});
const runtime=new pg.Client({connectionString:scoped(process.env.DATABASE_URL)});
const actor="00000000-0000-4000-8000-000000000002";
await trusted.connect();await runtime.connect();

async function trustedCall(sql,values=[]){
  await trusted.query("BEGIN");
  try{await trusted.query("SELECT set_config('aims.user_id',$1,true),set_config('aims.correlation_id',$2,true)",[actor,"migration-056-proof"]);const result=await trusted.query(sql,values);await trusted.query("COMMIT");return result;}
  catch(error){await trusted.query("ROLLBACK");throw error;}
}
async function denied(operation,pattern){await assert.rejects(operation,pattern);}

await denied(()=>runtime.query("UPDATE payment_documents SET security_status='CLEAN' WHERE id='31000000-0000-4000-8000-000000000001'"),/trusted Payment executor|required|permission/i);
await denied(()=>runtime.query("SELECT begin_payment_slip_security_scan($1,$2,$3,$4)",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",1,"1".repeat(64)]),/permission denied/i);
await denied(()=>trustedCall("UPDATE payment_documents SET security_status='CLEAN' WHERE id='31000000-0000-4000-8000-000000000001'"),/permission denied|trusted function/i);
await denied(()=>trustedCall("UPDATE payment_documents SET original_filename='changed.pdf' WHERE id='31000000-0000-4000-8000-000000000001'"),/permission denied|trusted function|immutable/i);

await denied(()=>trustedCall("SELECT begin_payment_slip_security_scan($1,$2,$3,$4)",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",2,"1".repeat(64)]),/identity mismatch/i);
await denied(()=>trustedCall("SELECT begin_payment_slip_security_scan($1,$2,$3,$4)",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",1,"f".repeat(64)]),/identity mismatch/i);
await denied(()=>trustedCall("SELECT begin_payment_slip_security_scan($1,$2,$3,$4)",["11000000-0000-4000-8000-000000000006","31000000-0000-4000-8000-000000000006",1,"6".repeat(64)]),/stale payment slip/i);
await denied(()=>trustedCall("SELECT begin_payment_slip_security_scan($1,$2,$3,$4)",["11000000-0000-4000-8000-000000000007","31000000-0000-4000-8000-000000000008",1,"8".repeat(64)]),/READY_FOR_PAYMENT/i);
await denied(()=>trustedCall("SELECT begin_payment_slip_security_scan($1,$2,$3,$4)",["10000000-0000-4000-8000-000000000001","30000000-0000-4000-8000-000000000001",1,"1".repeat(64)]),/READY_FOR_PAYMENT|current payment slip/i);

let result=await trustedCall("SELECT begin_payment_slip_security_scan($1,$2,$3,$4) attempt",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",1,"1".repeat(64)]);
assert.equal(Number(result.rows[0].attempt),1);
await denied(()=>trustedCall("SELECT complete_payment_slip_security_scan($1,$2,$3,$4,$5,$6,$7,$8,$9)",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",1,"1".repeat(64),1,"CLEAN",null,null,null]),/provenance is invalid/i);
await denied(()=>trustedCall("SELECT complete_payment_slip_security_scan($1,$2,$3,$4,$5,$6,$7,$8,$9)",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",1,"1".repeat(64),1,"UNKNOWN","fixture-scanner","bad",null]),/invalid payment slip scan result/i);
await denied(()=>trustedCall("SELECT complete_payment_slip_security_scan($1,$2,$3,$4,$5,$6,$7,$8,$9)",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",1,"1".repeat(64),1,"CLEAN","fake scanner; drop table users","bad-engine",null]),/provenance is invalid/i);
await denied(()=>trustedCall("SELECT complete_payment_slip_security_scan($1,$2,$3,$4,$5,$6,$7,$8,$9)",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",1,"1".repeat(64),1,"SCAN_FAILED",null,null,"arbitrary failure"]),/failure code is invalid/i);
result=await trustedCall("SELECT complete_payment_slip_security_scan($1,$2,$3,$4,$5,$6,$7,$8,$9) status",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",1,"1".repeat(64),1,"CLEAN","fixture-scanner","clean-1",null]);
assert.equal(result.rows[0].status,"CLEAN");
await denied(()=>trustedCall("SELECT complete_payment_slip_security_scan($1,$2,$3,$4,$5,$6,$7,$8,$9)",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",1,"1".repeat(64),1,"CLEAN","fixture-scanner","repeat",null]),/requires SCANNING/i);
await denied(()=>trustedCall("SELECT begin_payment_slip_security_scan($1,$2,$3,$4)",["11000000-0000-4000-8000-000000000001","31000000-0000-4000-8000-000000000001",1,"1".repeat(64)]),/cannot start from CLEAN/i);

const concurrentCompletions=await Promise.allSettled([
  trustedCall("SELECT complete_payment_slip_security_scan($1,$2,$3,$4,$5,$6,$7,$8,$9) status",["11000000-0000-4000-8000-000000000002","31000000-0000-4000-8000-000000000002",1,"2".repeat(64),1,"REJECTED","fixture-scanner","reject-2a",null]),
  (async()=>{const second=new pg.Client({connectionString:scoped(process.env.PAYMENT_DATABASE_URL)});await second.connect();try{await second.query("BEGIN");await second.query("SELECT set_config('aims.user_id',$1,true),set_config('aims.correlation_id',$2,true)",[actor,"migration-056-concurrent"]);const value=await second.query("SELECT complete_payment_slip_security_scan($1,$2,$3,$4,$5,$6,$7,$8,$9) status",["11000000-0000-4000-8000-000000000002","31000000-0000-4000-8000-000000000002",1,"2".repeat(64),1,"REJECTED","fixture-scanner","reject-2b",null]);await second.query("COMMIT");return value;}catch(error){await second.query("ROLLBACK");throw error;}finally{await second.end();}})(),
]);
assert.equal(concurrentCompletions.filter(item=>item.status==="fulfilled").length,1);
assert.equal(concurrentCompletions.filter(item=>item.status==="rejected").length,1);
result=await trustedCall("SELECT begin_payment_slip_security_scan($1,$2,$3,$4) attempt",["11000000-0000-4000-8000-000000000005","31000000-0000-4000-8000-000000000005",1,"5".repeat(64)]);
assert.equal(Number(result.rows[0].attempt),2);
result=await trustedCall("SELECT complete_payment_slip_security_scan($1,$2,$3,$4,$5,$6,$7,$8,$9) status",["11000000-0000-4000-8000-000000000005","31000000-0000-4000-8000-000000000005",1,"5".repeat(64),2,"SCAN_FAILED",null,null,"SCANNER_UNAVAILABLE"]);
assert.equal(result.rows[0].status,"SCAN_FAILED");

await denied(()=>trustedCall("UPDATE payment_documents SET security_status='SCANNING',scan_attempt=2,scan_started_at=now(),scan_completed_at=NULL,scan_engine=NULL,scan_reference=NULL WHERE id='31000000-0000-4000-8000-000000000008'"),/permission denied|documents for PAID requests are immutable|trusted function/i);

await trusted.end();await runtime.end();
console.log("MIGRATION_056_EXECUTOR_PROOF: PASS");
