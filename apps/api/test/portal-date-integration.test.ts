import assert from 'node:assert/strict';
import test from 'node:test';
import {Postgres} from '../src/infrastructure/database/postgres.js';
import {PaymentRequestService} from '../src/application/payment-requests/payment-request.service.js';
import {PortalService} from '../src/application/portal/portal.service.js';
import type {Principal} from '../src/domain/payment-request.js';
const actor:Principal={id:'10000000-0000-4000-8000-000000000001',departmentId:'00000000-0000-4000-8000-000000000001',roles:['REQUESTER']};
test('DATE stays date-only across pools and timezones; timestamp parsing is unchanged',async()=>{
 const db=new Postgres(),original=process.env.TZ;
 try{for(const timezone of ['Asia/Kuala_Lumpur','UTC','America/Los_Angeles']){
  process.env.TZ=timezone;
  for(const pool of [db.pool,db.financePool,db.paymentPool]){if(!pool)continue;
   const {rows:[row]}=await pool.query("SELECT DATE '2026-09-30' AS due_date, NULL::date AS empty_date, TIMESTAMP '2026-09-30 12:30:00' AS local_timestamp, TIMESTAMPTZ '2026-09-30 12:30:00+08' AS event_timestamp");
   assert.equal(row.due_date,'2026-09-30');assert.equal(row.empty_date,null);assert.equal(JSON.parse(JSON.stringify(row)).due_date,'2026-09-30');
   assert.ok(row.local_timestamp instanceof Date);assert.ok(row.event_timestamp instanceof Date);assert.equal(row.event_timestamp.toISOString(),'2026-09-30T04:30:00.000Z');
  }
 }}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;await db.onModuleDestroy();}
});
test('save, update, submit, portal detail and request history retain the calendar date',async()=>{
 const db=new Postgres(),requests=new PaymentRequestService(db),portal=new PortalService(db),original=process.env.TZ;process.env.TZ='Asia/Kuala_Lumpur';
 try{
  const draft=await requests.initiate(actor,'date-only-init');
  await requests.update(draft.id,{payee:'Date-only synthetic vendor',purpose:'Date-only integration',category:'Operations',amount:'12.34',currency:'MYR',dueDate:'2026-09-30',paymentMethod:'BANK_TRANSFER',paymentDetails:'Synthetic'},actor,'date-only-save');
  async function verify(date:string){
   assert.equal((await requests.get(draft.id,actor)).dueDate,date);
   const detail=JSON.parse(JSON.stringify(await portal.requesterDetail(actor,draft.id)));assert.equal(detail.request.due_date,date);
   const history=JSON.parse(JSON.stringify(await portal.requesterList(actor,{search:'Date-only synthetic vendor'})));assert.equal(history.items.find((row:{id:string})=>row.id===draft.id).due_date,date);
   const {rows:[stored]}=await db.pool.query('SELECT due_date::text AS value FROM payment_requests WHERE id=$1',[draft.id]);assert.equal(stored.value,date);
  }
  await verify('2026-09-30');await requests.update(draft.id,{dueDate:'2026-10-01'},actor,'date-only-update');await verify('2026-10-01');
  const submitted=await requests.submit(draft.id,actor,'date-only-submit');assert.equal(submitted.dueDate,'2026-10-01');await verify('2026-10-01');
 }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;await db.onModuleDestroy();}
});
