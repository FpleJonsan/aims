/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { ApprovalService } from "../src/application/approval/approval.service.js";
import { ApprovalMatrixService } from "../src/application/approval-matrix/approval-matrix.service.js";
import { ApprovalDelegationService } from "../src/application/approval-delegation/approval-delegation.service.js";
import { ApprovalReminderService } from "../src/application/approval/approval-reminder.service.js";
import { ClaimItemService } from "../src/application/claim-items/claim-item.service.js";
import { ConfigurationService } from "../src/application/configuration/configuration.service.js";
import { FinanceContextService } from "../src/application/finance-context/finance-context.service.js";
import { FinanceControlService } from "../src/application/finance-control/finance-control.service.js";
import type { FinanceConfirmationCode } from "../src/application/finance-control/finance-control.dto.js";
import { FinancialAnalysisService } from "../src/application/financial-analysis/financial-analysis.service.js";
import { NotificationBindingService } from "../src/application/notification/notification-binding.service.js";
import { NotificationService } from "../src/application/notification/notification.service.js";
import { PaymentRequestService } from "../src/application/payment-requests/payment-request.service.js";
import { PaymentService } from "../src/application/payments/payment.service.js";
import { PolicyService } from "../src/application/policy/policy.service.js";
import { ValidationService } from "../src/application/validation/validation.service.js";
import type { Principal } from "../src/domain/payment-request.js";
import { Postgres } from "../src/infrastructure/database/postgres.js";

const requester: Principal = { id: "10000000-0000-4000-8000-000000000001", departmentId: "00000000-0000-4000-8000-000000000001", roles: ["REQUESTER"] };
const finance: Principal = { id: "10000000-0000-4000-8000-000000000002", departmentId: "00000000-0000-4000-8000-000000000002", roles: ["FINANCE"] };
const admin: Principal = { ...finance, roles: ["ADMIN"] };
const approver: Principal = { id: "10000000-0000-4000-8000-000000000004", departmentId: requester.departmentId, roles: ["REQUESTER"] };
const confirmations: FinanceConfirmationCode[] = ["PAYEE_VERIFIED", "PAYMENT_METHOD_VERIFIED", "PAYMENT_DETAILS_VERIFIED", "SUPPORTING_DOCUMENTS_VERIFIED"];

function fakeRequest() {
  return { ip: "127.0.0.1" } as any;
}

async function enableTelegram(db: Postgres, reminders: { enabled: boolean; frequencyHours?: number } = { enabled: false }) {
  const configuration = new ConfigurationService(db);
  await configuration.saveDraft(
    "notifications",
    {
      telegramEnabled: true,
      telegramReminderEnabled: reminders.enabled,
      telegramEscalationEnabled: false,
      notificationTemplates: [],
      reminderFrequencyHours: reminders.frequencyHours ?? 24,
      escalationTimingHours: 72,
    },
    admin,
    fakeRequest(),
  );
  await configuration.publish("notifications", "notification-events test enable", admin, fakeRequest());
  return configuration;
}

async function bindTelegram(db: Postgres, userId: string, seed: string) {
  await new NotificationBindingService(db).bindTelegram({ userId, telegramUserId: seed, telegramChatId: seed }, admin, `bind-${seed}`);
}

async function rawRecipients(db: Postgres, aggregateId: string, eventType: string) {
  return (
    await db.pool.query<{ recipient_user_id: string }>(
      "SELECT recipient_user_id FROM notification_outbox WHERE aggregate_id=$1 AND event_type=$2 ORDER BY recipient_user_id",
      [aggregateId, eventType],
    )
  ).rows.map((row) => row.recipient_user_id);
}

/**
 * publish() is intentionally fire-and-forget (never awaited by the caller,
 * per the platform's own design — see NotificationService.publish()'s doc
 * comment), so the outbox insert can still be in flight immediately after
 * the triggering service call resolves. Poll briefly instead of asserting
 * on a single read.
 */
async function recipients(db: Postgres, aggregateId: string, eventType: string, atLeast = 1) {
  const deadline = Date.now() + 8000;
  let rows = await rawRecipients(db, aggregateId, eventType);
  while (rows.length < atLeast && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    rows = await rawRecipients(db, aggregateId, eventType);
  }
  return rows;
}

async function addDocument(db: Postgres, requestId: string, name: string) {
  await db.pool.query(
    `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference,storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key,trusted_storage_object_version)
     VALUES($1,$2,$3,$4,$5,'application/pdf',20,$6,'INVOICE',1,$7,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean','VERSION_BOUND','test-fixture',gen_random_uuid()::text,$5,gen_random_uuid()::text)`,
    [randomUUID(), requestId, randomUUID(), name, `active/notif/${randomUUID()}`, randomUUID().replaceAll("-", "").repeat(2), requester.id],
  );
}

async function attachCleanPaymentSlip(db: Postgres, requestId: string, label: string) {
  const slipId = randomUUID(),
    sha = randomUUID().replaceAll("-", "").repeat(2),
    key = `quarantine/notif/${randomUUID()}`,
    version = `source-${randomUUID()}`;
  await db.paymentTransaction(finance.id, `${label}-slip`, (client) =>
    client.query(
      "SELECT attach_payment_slip($1,$2,$3,'notif-payment.pdf',$4,$5,'test-fixture','application/pdf',20,$6,'LOCAL')",
      [requestId, slipId, randomUUID(), key, version, sha],
    ),
  );
  const workerUrl = process.env.DOCUMENT_WORKER_DATABASE_URL;
  if (!workerUrl) throw new Error("document worker database URL is required");
  const worker = new pg.Pool({ connectionString: workerUrl });
  try {
    const claim = (await worker.query("SELECT * FROM claim_next_payment_document_scan($1,30,3,$2)", ["notif-test", randomUUID()])).rows[0];
    assert.equal(claim.document_id, slipId);
    await worker.query(
      "SELECT complete_payment_document_scan($1,$2,$3,$4,$5,$6,$7,$8,$9,'CLEAN',NULL,0,'test-scanner',$10,NULL,$11,$12)",
      [
        claim.document_id,
        claim.document_version,
        claim.storage_backend_id,
        claim.source_object_key,
        claim.source_object_version,
        claim.document_sha256,
        claim.document_size_bytes,
        claim.scan_attempt,
        claim.claim_token,
        `${label}-clean`,
        `active/notif/${slipId}`,
        `trusted-${randomUUID()}`,
      ],
    );
  } finally {
    await worker.end();
  }
  return slipId;
}

/** Builds a request up to SUBMITTED under an auto-approval policy (Approval's own generic-notification coverage lives in approval-integration.test.ts). */
async function submittedFixture(db: Postgres, notifications: NotificationService, label: string, automatic = true) {
  const requests = new PaymentRequestService(db, notifications),
    validation = new ValidationService(db, requests, {} as never, null, notifications),
    context = new FinanceContextService(db, requests),
    analysis = new FinancialAnalysisService(db, requests, null),
    policy = new PolicyService(db, requests);
  const set = await policy.createSet({ code: `NE-${randomUUID()}`, name: label }, admin, `${label}-set`),
    version = await policy.createVersion(set.id, { effectiveFrom: "2020-01-01T00:00:00Z" }, admin, `${label}-version`);
  await policy.addRule(
    version.id,
    {
      code: `NE-R-${randomUUID()}`,
      name: label,
      priority: 1,
      effect: automatic ? "ALLOW_NO_APPROVAL" : "REQUIRE_APPROVAL",
      conditions: { currencies: ["MYR"] },
      approvalSteps: automatic
        ? []
        : [{ sequence: 1, requiredRole: "AM", authorityScope: "DEPARTMENT", mandatory: true, reason: "Notification event route" }],
      requiredEvidence: [],
      notificationMetadata: {},
      autoApprovalEligible: automatic,
    },
    admin,
    `${label}-rule`,
  );
  await policy.activate(version.id, admin, `${label}-active`);
  const draft = await requests.initiate(requester, `${label}-init`);
  await requests.update(
    draft.id,
    { payee: `Notif Vendor ${randomUUID()}`, purpose: label, dueDate: "2026-10-30", paymentMethod: "BANK_TRANSFER", paymentDetails: "Synthetic beneficiary" },
    requester,
    `${label}-capture`,
  );
  await new ClaimItemService(db, requests).create(
    draft.id,
    { category: "Operations", departmentId: requester.departmentId, currency: "MYR", amount: "10.00" },
    requester,
    `${label}-claim`,
  );
  const request = await requests.submit(draft.id, requester, `${label}-submit`);
  await addDocument(db, request.id, `${label}-invoice.pdf`);
  return { requests, validation, context, analysis, policy, request };
}

async function toApproved(fixture: Awaited<ReturnType<typeof submittedFixture>>, db: Postgres, label: string) {
  await fixture.validation.start(fixture.request.id, finance, `${label}-validation`);
  await fixture.validation.finalize(fixture.request.id, { overallResult: "PASS", remarks: "complete", findings: [] }, finance, `${label}-validation-pass`);
  await fixture.context.calculate(fixture.request.id, finance, `${label}-context`);
  await fixture.analysis.manual(
    fixture.request.id,
    {
      riskLevel: "LOW",
      priority: "NORMAL",
      urgency: "NORMAL",
      riskFlags: [],
      financialAssessment: "Reviewed",
      spendingAssessment: "Reviewed",
      complianceRemarks: "Reviewed",
      evidenceReferences: [{ source: "FINANCE_CONTEXT", reference: "current", field: "projected_available_amount_minor" }],
    },
    finance,
    `${label}-analysis`,
  );
  await fixture.policy.evaluate(fixture.request.id, finance, `${label}-policy`);
  await new ApprovalService(db, fixture.requests, new ApprovalMatrixService(db), new ApprovalDelegationService(db)).create(
    fixture.request.id,
    finance,
    `${label}-approval`,
  );
}

test("P20.5G-2: REQUEST_SUBMITTED, VALIDATION_STARTED and VALIDATION_COMPLETE publish once to the requester", async () => {
  const db = new Postgres(),
    base = Date.now();
  try {
    await enableTelegram(db);
    await bindTelegram(db, requester.id, String(base + 1));
    const notifications = new NotificationService(db, new ConfigurationService(db));
    const fixture = await submittedFixture(db, notifications, "submit-validate");

    const submitted = await recipients(db, fixture.request.id, "REQUEST_SUBMITTED");
    assert.deepEqual(submitted, [requester.id]);

    await fixture.validation.start(fixture.request.id, finance, "submit-validate-start");
    const started = await recipients(db, fixture.request.id, "VALIDATION_STARTED");
    assert.deepEqual(started, [requester.id]);

    await fixture.validation.finalize(fixture.request.id, { overallResult: "PASS", remarks: "complete", findings: [] }, finance, "submit-validate-pass");
    const completed = await recipients(db, fixture.request.id, "VALIDATION_COMPLETE");
    assert.deepEqual(completed, [requester.id]);

    const rendered = (
      await db.pool.query<{ payload: { renderedText: string } }>(
        "SELECT payload FROM notification_outbox WHERE aggregate_id=$1 AND event_type='REQUEST_SUBMITTED'",
        [fixture.request.id],
      )
    ).rows[0].payload;
    assert.match(rendered.renderedText, /has been submitted/);
  } finally {
    await db.onModuleDestroy();
  }
});

test("P20.5G-2: a Validation clarification request publishes NEED_CLARIFICATION once to the requester", async () => {
  const db = new Postgres(),
    base = Date.now();
  try {
    await enableTelegram(db);
    await bindTelegram(db, requester.id, String(base + 2));
    const notifications = new NotificationService(db, new ConfigurationService(db));
    const fixture = await submittedFixture(db, notifications, "clarify");

    await fixture.validation.start(fixture.request.id, finance, "clarify-start");
    await fixture.validation.finalize(
      fixture.request.id,
      { overallResult: "CLARIFICATION_REQUIRED", remarks: "Missing evidence", requiredResponse: "Confirm", findings: [{ code: "MISSING_INFORMATION", status: "FAIL", severity: "HIGH", explanation: "test" }] },
      finance,
      "clarify-request",
    );
    assert.deepEqual(await recipients(db, fixture.request.id, "NEED_CLARIFICATION"), [requester.id]);
  } finally {
    await db.onModuleDestroy();
  }
});

test("P20.5G-2: Finance Control publishes FINANCE_REVIEW to Finance, and FINANCE_HOLD to the requester when checks fail", async () => {
  const db = new Postgres(),
    base = Date.now();
  try {
    await enableTelegram(db);
    await bindTelegram(db, requester.id, String(base + 3));
    await bindTelegram(db, finance.id, String(base + 4));
    const notifications = new NotificationService(db, new ConfigurationService(db));
    const fixture = await submittedFixture(db, notifications, "hold");
    await toApproved(fixture, db, "hold");

    const control = new FinanceControlService(db, fixture.requests, notifications);
    const started = (await control.start(fixture.request.id, finance, "hold-start")) as any;
    assert.deepEqual(await recipients(db, fixture.request.id, "FINANCE_REVIEW"), [finance.id]);

    const held = (await control.finalize(started.run.id, { commandKey: randomUUID() }, finance, "hold-finalize")) as any;
    assert.equal(held.financeHold, true);
    assert.deepEqual(await recipients(db, fixture.request.id, "FINANCE_HOLD"), [requester.id]);
  } finally {
    await db.onModuleDestroy();
  }
});

test("P20.5G-2: Finance Control PASS publishes PAYMENT_READY, and payment recording publishes PAYMENT_COMPLETED, to the requester and Finance", async () => {
  const db = new Postgres(),
    base = Date.now();
  try {
    await enableTelegram(db);
    await bindTelegram(db, requester.id, String(base + 5));
    await bindTelegram(db, finance.id, String(base + 6));
    const notifications = new NotificationService(db, new ConfigurationService(db));
    const fixture = await submittedFixture(db, notifications, "pay");
    await toApproved(fixture, db, "pay");

    const control = new FinanceControlService(db, fixture.requests, notifications);
    const started = (await control.start(fixture.request.id, finance, "pay-start")) as any;
    for (const code of confirmations) await control.confirm(started.run.id, { code, confirmed: true }, finance, `pay-${code}`);
    await control.finalize(started.run.id, { commandKey: randomUUID() }, finance, "pay-finalize");

    const ready = await recipients(db, fixture.request.id, "PAYMENT_READY", 2);
    assert.deepEqual(ready, [finance.id, requester.id].sort());

    const slipId = await attachCleanPaymentSlip(db, fixture.request.id, "pay");
    const paymentService = new PaymentService(db, fixture.requests, {} as never, notifications);
    await paymentService.record(
      fixture.request.id,
      { commandKey: randomUUID(), paymentDate: new Date().toISOString().slice(0, 10), amount: "10.00", currency: "MYR", bankReference: `NOTIF-${randomUUID()}`, slipDocumentId: slipId, confirmPossibleDuplicate: false },
      finance,
      "pay-record",
    );
    const completed = await recipients(db, fixture.request.id, "PAYMENT_COMPLETED", 2);
    assert.deepEqual(completed, [finance.id, requester.id].sort());
  } finally {
    await db.onModuleDestroy();
  }
});

test("P20.5G-2: cancelling a request publishes CANCELLATION_REQUESTED to Finance and CANCELLATION_APPROVED to the requester, exactly once", async () => {
  const db = new Postgres(),
    base = Date.now();
  try {
    await enableTelegram(db);
    await bindTelegram(db, requester.id, String(base + 7));
    await bindTelegram(db, finance.id, String(base + 8));
    const notifications = new NotificationService(db, new ConfigurationService(db));
    const fixture = await submittedFixture(db, notifications, "cancel");

    await fixture.requests.cancel(fixture.request.id, { reason: "No longer needed", commandKey: randomUUID() }, requester, "cancel-it");

    assert.deepEqual(await recipients(db, fixture.request.id, "CANCELLATION_REQUESTED"), [finance.id]);
    assert.deepEqual(await recipients(db, fixture.request.id, "CANCELLATION_APPROVED"), [requester.id]);

    // Replaying cancel() on an already-CANCELLED request returns early and must not publish a second time.
    await fixture.requests.cancel(fixture.request.id, { reason: "No longer needed", commandKey: randomUUID() }, requester, "cancel-again");
    assert.deepEqual(await recipients(db, fixture.request.id, "CANCELLATION_APPROVED"), [requester.id]);
  } finally {
    await db.onModuleDestroy();
  }
});

test("P20.5G-2: ApprovalReminderService fires APPROVAL_REMINDER once for an overdue active step, gated by the admin reminder toggle", async () => {
  const db = new Postgres(),
    base = Date.now();
  try {
    await bindTelegram(db, approver.id, String(base + 9));
    const notifications = new NotificationService(db, new ConfigurationService(db));
    const fixture = await submittedFixture(db, notifications, "remind", false);
    await fixture.validation.start(fixture.request.id, finance, "remind-validation");
    await fixture.validation.finalize(fixture.request.id, { overallResult: "PASS", remarks: "complete", findings: [] }, finance, "remind-validation-pass");
    await fixture.context.calculate(fixture.request.id, finance, "remind-context");
    await fixture.analysis.manual(
      fixture.request.id,
      {
        riskLevel: "LOW",
        priority: "NORMAL",
        urgency: "NORMAL",
        riskFlags: [],
        financialAssessment: "Reviewed",
        spendingAssessment: "Reviewed",
        complianceRemarks: "Reviewed",
        evidenceReferences: [{ source: "FINANCE_CONTEXT", reference: "current", field: "projected_available_amount_minor" }],
      },
      finance,
      "remind-analysis",
    );
    await fixture.policy.evaluate(fixture.request.id, finance, "remind-policy");
    const view = await new ApprovalService(db, fixture.requests, new ApprovalMatrixService(db), new ApprovalDelegationService(db)).create(
      fixture.request.id,
      finance,
      "remind-approval",
    );

    const configuration = new ConfigurationService(db);
    const delegations = new ApprovalDelegationService(db);
    const reminders = new ApprovalReminderService(db, delegations, configuration, notifications);

    // Reminders are OFF by default: an overdue step must not fire one.
    await configuration.saveDraft(
      "notifications",
      { telegramEnabled: true, telegramReminderEnabled: false, telegramEscalationEnabled: false, notificationTemplates: [], reminderFrequencyHours: 1, escalationTimingHours: 72 },
      admin,
      fakeRequest(),
    );
    await configuration.publish("notifications", "reminders off", admin, fakeRequest());
    await db.pool.query("UPDATE approval_steps SET activated_at=now()-interval '2 hours' WHERE id=$1", [view.steps[0].id]);
    assert.deepEqual((await reminders.sweep()), { processed: 0 });
    assert.equal((await recipients(db, view.steps[0].id, "APPROVAL_REMINDER", 0)).length, 0);

    await enableTelegram(db, { enabled: true, frequencyHours: 1 });
    const first = await reminders.sweep();
    assert.equal(first.processed, 1);
    assert.deepEqual(await recipients(db, view.steps[0].id, "APPROVAL_REMINDER"), [approver.id]);

    // A second sweep must not duplicate the reminder for the same step/recipient.
    const second = await reminders.sweep();
    assert.equal(second.processed, 0);
    assert.equal((await recipients(db, view.steps[0].id, "APPROVAL_REMINDER")).length, 1);
  } finally {
    await db.onModuleDestroy();
  }
});
