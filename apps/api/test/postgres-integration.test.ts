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
