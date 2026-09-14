import assert from 'node:assert/strict';
import test from 'node:test';
import {Postgres} from '../src/infrastructure/database/postgres.js';
import {PaymentRequestService} from '../src/application/payment-requests/payment-request.service.js';
import {PortalService} from '../src/application/portal/portal.service.js';
import type {Principal} from '../src/domain/payment-request.js';
const actor:Principal={id:'10000000-0000-4000-8000-000000000001',departmentId:'00000000-0000-4000-8000-000000000001',roles:['REQUESTER']};
test('Payment Details saved on a draft survives Save Draft and reappears on Continue Request',async()=>{
 const db=new Postgres(),requests=new PaymentRequestService(db),portal=new PortalService(db);
 const paymentDetails='Maybank account 5123 4567 8901, Acme Office Supplies Sdn Bhd';
 try{
  const draft=await requests.initiate(actor,'payment-details-init');
  const saved=await requests.update(draft.id,{payee:'Acme Office Supplies Sdn Bhd',purpose:'Payment Details regression coverage',dueDate:'2026-09-30',paymentMethod:'BANK_TRANSFER',paymentDetails},actor,'payment-details-save');
  assert.equal(saved.paymentDetails,paymentDetails);
  const detail=JSON.parse(JSON.stringify(await portal.requesterDetail(actor,draft.id)));
  assert.equal(detail.request.payment_details,paymentDetails);
 }finally{await db.onModuleDestroy();}
});
