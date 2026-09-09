import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentRequestService } from '../src/application/payment-requests/payment-request.service.js';
import { PaymentRequestCancellationService } from '../src/application/payment-requests/payment-request-cancellation.service.js';
import { randomUUID } from 'node:crypto';
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

    const cancellations = new PaymentRequestCancellationService(database, service);
    await assert.rejects(
      cancellations.cancel(draft.id, { reason: 'Not authorized', commandKey: randomUUID() }, outsider, 'cancel-outsider'),
      /CANCELLATION_NOT_AUTHORIZED/,
    );
    const dualRoleDraft = await service.initiate(requester, 'integration-dual-role-init');
    const originalFinanceTransaction = database.financeTransaction.bind(database);
    (database as unknown as { financeTransaction: () => never }).financeTransaction = () => { throw new Error('FINANCE_POOL_MUST_NOT_BE_USED'); };
    const dualRoleCancellation = await cancellations.cancel(
      dualRoleDraft.id,
      { reason: 'Requester-owned draft withdrawn', commandKey: randomUUID() },
      { ...requester, roles: ['REQUESTER', 'FINANCE'] },
      'integration-dual-role-cancel',
    );
    assert.equal(dualRoleCancellation.status, 'CANCELLED');
    (database as unknown as { financeTransaction: typeof database.financeTransaction }).financeTransaction = originalFinanceTransaction;
    const recoveryBefore = (await database.pool.query('SELECT generation FROM aims_recovery_generation WHERE singleton')).rows[0].generation;
    const commandKey = randomUUID();
    const concurrentCancellation = await Promise.all([
      cancellations.cancel(draft.id, { reason: 'Supplier order withdrawn', commandKey }, requester, 'cancel-a'),
      cancellations.cancel(draft.id, { reason: 'Supplier order withdrawn', commandKey }, requester, 'cancel-b'),
    ]);
    assert.equal(concurrentCancellation[0].status, 'CANCELLED');
    assert.equal(concurrentCancellation[1].status, 'CANCELLED');
    await assert.rejects(
      cancellations.cancel(
        draft.id,
        { reason: 'Supplier order withdrawn', commandKey },
        { ...requester, departmentId: outsider.departmentId },
        'cancel-after-department-change',
      ),
      /CANCELLATION_NOT_AUTHORIZED/,
    );
    await assert.rejects(
      cancellations.cancel(draft.id, { reason: 'Changed payload', commandKey }, requester, 'cancel-conflict'),
      /CANCELLATION_IDEMPOTENCY_CONFLICT/,
    );
    await assert.rejects(
      cancellations.cancel(draft.id, { reason: 'Different command', commandKey: randomUUID() }, requester, 'cancel-duplicate'),
      /REQUEST_ALREADY_CANCELLED/,
    );
    const cancelled = await service.get(draft.id, requester);
    const cancellationEvents = cancelled.audit.filter((event) => (event as { action?: string }).action === 'REQUEST_CANCELLED') as Array<{actor_id:string;occurred_at:Date;correlation_id:string;safe_metadata:{reason:string;commandKey:string}}>;
    assert.equal(cancellationEvents.length, 1);
    assert.equal(cancellationEvents[0].actor_id, requester.id);
    assert.ok(cancellationEvents[0].occurred_at);
    assert.equal(cancellationEvents[0].safe_metadata.reason, 'Supplier order withdrawn');
    assert.equal(cancellationEvents[0].safe_metadata.commandKey, commandKey);
    assert.ok(['cancel-a','cancel-b'].includes(cancellationEvents[0].correlation_id));
    const recoveryAfter = (await database.pool.query('SELECT generation FROM aims_recovery_generation WHERE singleton')).rows[0].generation;
    assert.equal(recoveryAfter, recoveryBefore);

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
