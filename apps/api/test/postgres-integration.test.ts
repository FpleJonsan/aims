import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentRequestService } from '../src/application/payment-requests/payment-request.service.js';
import type { Principal } from '../src/domain/payment-request.js';
import { Postgres } from '../src/infrastructure/database/postgres.js';

const requester: Principal = {
  id: '10000000-0000-4000-8000-000000000001',
  departmentId: '00000000-0000-4000-8000-000000000001',
  roles: ['REQUESTER'],
};
const outsider: Principal = {
  id: '10000000-0000-4000-8000-000000000002',
  departmentId: '00000000-0000-4000-8000-000000000002',
  roles: [],
};

test('PostgreSQL request lifecycle is scoped, audited, atomic, and concurrency-safe', async () => {
  const database = new Postgres();
  const service = new PaymentRequestService(database);
  try {
    const draft = await service.initiate(requester, 'integration-init');
    assert.equal(draft.status, 'DRAFT');
    await assert.rejects(service.get(draft.id, outsider), /not found/i);
    const captured = await service.update(draft.id, {
      payee: 'Synthetic Vendor', purpose: 'Synthetic Day 1 integration test', category: 'Operations',
      amount: '100.00', currency: 'MYR', dueDate: '2026-09-30', paymentMethod: 'BANK_TRANSFER',
      paymentDetails: 'Synthetic account ending 0000', remark: 'No real financial data',
    }, requester, 'integration-update');
    assert.equal(captured.rowVersion, 2);

    const concurrent = await Promise.allSettled([
      service.submit(draft.id, requester, 'integration-submit-a'),
      service.submit(draft.id, requester, 'integration-submit-b'),
    ]);
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1,
      concurrent.map((result) => result.status === 'rejected' ? String(result.reason) : result.value.ticketNumber).join(' | '));
    assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
    const detail = await service.get(draft.id, requester);
    assert.equal(detail.status, 'SUBMITTED');
    assert.match(detail.ticketNumber!, /^PAY-\d{4}-\d{6}$/);
    assert.equal(detail.audit.filter((event) => (event as { action?: string }).action === 'REQUEST_SUBMITTED').length, 1);
    await assert.rejects(service.update(draft.id, { remark: 'illegal mutation' }, requester, 'integration-illegal'), /not permitted/i);

    const second = await service.initiate(requester, 'integration-init-second');
    await service.update(second.id, {
      payee: 'Second Synthetic Vendor', purpose: 'Ticket uniqueness test', category: 'Operations', amount: '1.00',
      currency: 'MYR', dueDate: '2026-09-30', paymentMethod: 'BANK_TRANSFER', paymentDetails: 'Synthetic',
    }, requester, 'integration-update-second');
    const secondSubmitted = await service.submit(second.id, requester, 'integration-submit-second');
    assert.notEqual(secondSubmitted.ticketNumber, detail.ticketNumber);
  } finally {
    await database.onModuleDestroy();
  }
});

test('request cancellation validates authority and states, audits once under concurrency, and rolls back failures', async () => {
  const database = new Postgres();
  const service = new PaymentRequestService(database);
  const { randomUUID } = await import('node:crypto');
  try {
    for (const status of ['DRAFT','SUBMITTED','VALIDATING','NEEDS_CLARIFICATION','PENDING_APPROVAL','APPROVED','FINANCE_CHECK','FINANCE_HOLD']) {
      const draft = await service.initiate(requester, 'cancel-init');
      if (status !== 'DRAFT') {
        await service.update(draft.id,{payee:'Cancellation fixture',purpose:'Cancellation acceptance',category:'Operations',amount:'1.00',currency:'MYR',dueDate:'2026-09-30',paymentMethod:'BANK_TRANSFER',paymentDetails:'Synthetic'},requester,'cancel-capture');
        await service.submit(draft.id,requester,'cancel-submit');
      }
      await database.pool.query('UPDATE payment_requests SET status=$2 WHERE id=$1', [draft.id,status]);
      const command = { reason: 'Duplicate business request', commandKey: randomUUID() };
      for (const actor of [outsider, {...requester, roles: []}, {...requester, roles: ['ADMIN']}, {...requester, departmentId: outsider.departmentId}, {...requester,id:outsider.id}]) {
        await assert.rejects(service.cancel(draft.id,command,actor as Principal,'cancel-denied'),/not permitted/);
      }
      await assert.rejects(service.cancel(draft.id,{...command,reason:' '},requester,'invalid'),/required/);
      await assert.rejects(service.cancel(draft.id,{...command,commandKey:'invalid'},requester,'invalid'),/required/);
      const results = await Promise.all([service.cancel(draft.id,command,requester,'cancel-a'),service.cancel(draft.id,command,requester,'cancel-b')]);
      assert.ok(results.every(result=>result.status==='CANCELLED'));
      assert.equal(results[0].rowVersion,results[1].rowVersion);
      await service.cancel(draft.id,{...command,commandKey:randomUUID()},requester,'cancel-retry');
      await assert.rejects(service.cancel(draft.id,command,outsider,'cancel-denied-replay'),/not permitted/);
      const events = await database.pool.query("SELECT * FROM audit_events WHERE entity_id=$1 AND action='REQUEST_CANCELLED'",[draft.id]);
      assert.equal(events.rowCount,1);
      assert.equal(events.rows[0].actor_id,requester.id);
      assert.equal(events.rows[0].previous_state,status);
      assert.equal(events.rows[0].new_state,'CANCELLED');
      assert.ok(events.rows[0].occurred_at);
      assert.ok(['cancel-a','cancel-b'].includes(events.rows[0].correlation_id));
      assert.deepEqual(events.rows[0].safe_metadata,command);
    }
    const rejected = await service.initiate(requester,'reject-init');
    await database.pool.query("UPDATE payment_requests SET status='REJECTED' WHERE id=$1",[rejected.id]);
    await assert.rejects(service.cancel(rejected.id,{reason:'No',commandKey:randomUUID()},requester,'reject-cancel'),/current state/);
    const draft = await service.initiate(requester,'rollback-init');
    const failing = new PaymentRequestService(database);
    failing.audit = async () => { throw new Error('forced audit failure'); };
    await assert.rejects(failing.cancel(draft.id,{reason:'Rollback proof',commandKey:randomUUID()},requester,'rollback'),/forced audit failure/);
    assert.equal((await service.get(draft.id,requester)).status,'DRAFT');
    assert.equal((await database.pool.query("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='REQUEST_CANCELLED'",[draft.id])).rowCount,0);
  } finally { await database.onModuleDestroy(); }
});
