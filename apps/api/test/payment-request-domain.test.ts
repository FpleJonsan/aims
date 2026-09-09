import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSubmittable, canEditDraft, canReadRequest, formatTicketNumber, type PaymentRequest, type Principal } from '../src/domain/payment-request.js';
import { businessYear } from '../src/application/payment-requests/payment-request.service.js';

const requester: Principal = { id: 'user-a', departmentId: 'dept-a', roles: ['REQUESTER'] };
const otherRequester: Principal = { id: 'user-b', departmentId: 'dept-b', roles: ['REQUESTER'] };
const finance: Principal = { id: 'finance', departmentId: 'dept-b', roles: ['FINANCE'] };

test('accepts the complete DRAFT capture for submission', () => {
  assert.doesNotThrow(() => assertSubmittable(completeDraft()));
});

test('rejects SUBMITTED to SUBMITTED and incomplete draft submission', () => {
  assert.throws(() => assertSubmittable({ ...completeDraft(), status: 'SUBMITTED' }), /Only a DRAFT/);
  assert.throws(() => assertSubmittable({ ...completeDraft(), payee: null }), /payee/);
});

test('enforces owner, department and submitted snapshot boundaries', () => {
  const draft = completeDraft();
  assert.equal(canReadRequest(requester, draft), true);
  assert.equal(canReadRequest(otherRequester, draft), false);
  assert.equal(canReadRequest(finance, draft), true);
  assert.equal(canEditDraft(requester, draft), true);
  assert.equal(canEditDraft(otherRequester, draft), false);
  assert.equal(canEditDraft(requester, { ...draft, status: 'SUBMITTED' }), false);
});

test('formats deterministic tickets and rejects exhausted sequences', () => {
  assert.equal(formatTicketNumber(2026, 1n), 'PAY-2026-000001');
  assert.equal(formatTicketNumber(2026, 999999n), 'PAY-2026-999999');
  assert.throws(() => formatTicketNumber(2026, 0n));
  assert.throws(() => formatTicketNumber(2026, 1000000n));
});

test('uses configured business timezone for the ticket year', () => {
  const instant = new Date('2025-12-31T16:30:00.000Z');
  assert.equal(businessYear(instant, 'Asia/Kuala_Lumpur'), 2026);
  assert.equal(businessYear(instant, 'UTC'), 2025);
});

function completeDraft(): PaymentRequest {
  const now = new Date('2026-08-23T00:00:00Z');
  return {
    id: 'request-a', ticketNumber: null, status: 'DRAFT', payee: 'Vendor', purpose: 'Office supplies',
    category: 'Operations', amount: '125.50', currency: 'MYR', departmentId: 'dept-a',
    dueDate: '2026-09-01', paymentMethod: 'BANK_TRANSFER', paymentDetails: 'Account ending 1234',
    remark: null, createdBy: 'user-a', createdAt: now, updatedAt: now, submittedAt: null, rowVersion: 1,
  };
}

test('cancellation endpoint is authenticated POST with validated reason and command key', async () => {
  const { PaymentRequestController } = await import('../src/application/payment-requests/payment-request.controller.js');
  const { CancelPaymentRequestDto } = await import('../src/application/payment-requests/payment-request.dto.js');
  const { AuthGuard } = await import('../src/application/auth/auth.guard.js');
  const { validate } = await import('class-validator');
  assert.equal(Reflect.getMetadata('path', PaymentRequestController.prototype.cancel), ':id/cancel');
  assert.equal(Reflect.getMetadata('method', PaymentRequestController.prototype.cancel), 1);
  assert.ok(Reflect.getMetadata('__guards__', PaymentRequestController).includes(AuthGuard));
  for (const input of [{}, {reason:' ',commandKey:'bad'}, {reason:'x'.repeat(2001),commandKey:'bad'}]) {
    assert.ok((await validate(Object.assign(new CancelPaymentRequestDto(),input))).length>0);
  }
  assert.equal((await validate(Object.assign(new CancelPaymentRequestDto(),{
    reason:'Request withdrawn',commandKey:'10000000-0000-4000-8000-000000000001'
  }))).length,0);
});
