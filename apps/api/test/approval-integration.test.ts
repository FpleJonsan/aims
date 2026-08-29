import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { ApprovalService } from "../src/application/approval/approval.service.js";
import { ApprovalOutboxService } from "../src/application/approval/approval-outbox.service.js";
import type { ApprovalChannel } from "../src/application/approval/telegram-approval.channel.js";
import { FinanceContextService } from "../src/application/finance-context/finance-context.service.js";
import { FinancialAnalysisService } from "../src/application/financial-analysis/financial-analysis.service.js";
import { PaymentRequestService } from "../src/application/payment-requests/payment-request.service.js";
import { PolicyService } from "../src/application/policy/policy.service.js";
import { ValidationService } from "../src/application/validation/validation.service.js";
import type { Principal } from "../src/domain/payment-request.js";
import { Postgres } from "../src/infrastructure/database/postgres.js";

const requester: Principal = {
  id: "10000000-0000-4000-8000-000000000001",
  departmentId: "00000000-0000-4000-8000-000000000001",
  roles: ["REQUESTER"],
};
const finance: Principal = {
  id: "10000000-0000-4000-8000-000000000002",
  departmentId: "00000000-0000-4000-8000-000000000002",
  roles: ["FINANCE"],
};
const admin: Principal = { ...finance, roles: ["ADMIN"] };
const approver: Principal = {
  id: "10000000-0000-4000-8000-000000000004",
  departmentId: "00000000-0000-4000-8000-000000000001",
  roles: ["REQUESTER"],
};
const secondApprover: Principal = {
  id: "10000000-0000-4000-8000-000000000008",
  departmentId: requester.departmentId,
  roles: ["REQUESTER"],
};
const insufficient: Principal = {
    id: "10000000-0000-4000-8000-000000000005",
    departmentId: requester.departmentId,
    roles: ["REQUESTER"],
  },
  wrongDepartment: Principal = {
    id: "10000000-0000-4000-8000-000000000006",
    departmentId: finance.departmentId,
    roles: ["REQUESTER"],
  },
  inactive: Principal = {
    id: "10000000-0000-4000-8000-000000000007",
    departmentId: requester.departmentId,
    roles: ["REQUESTER"],
  };

async function eligible(db: Postgres, amount = "20000.00", automatic = false) {
  const requests = new PaymentRequestService(db),
    validation = new ValidationService(db, requests, {} as never, null),
    context = new FinanceContextService(db, requests),
    analysis = new FinancialAnalysisService(db, requests, null),
    policy = new PolicyService(db, requests);
  const set = await policy.createSet(
      { code: `D6-${randomUUID()}`, name: "Day 6 synthetic" },
      admin,
      "d6-policy-set",
    ),
    version = await policy.createVersion(
      set.id,
      { effectiveFrom: "2020-01-01T00:00:00Z" },
      admin,
      "d6-policy-version",
    );
  await policy.addRule(
    version.id,
    {
      code: automatic ? "D6-AUTO" : "D6-SEQUENTIAL",
      name: automatic ? "Automatic approval" : "Sequential approval",
      priority: 1,
      effect: automatic ? "ALLOW_NO_APPROVAL" : "REQUIRE_APPROVAL",
      conditions: { currencies: ["MYR"] },
      approvalSteps: automatic
        ? []
        : [
            {
              sequence: 1,
              requiredRole: "AM",
              authorityScope: "DEPARTMENT",
              mandatory: true,
              reason: "Synthetic Day 6 route",
            },
            {
              sequence: 2,
              requiredRole: "DIRECTOR",
              authorityScope: "ORGANIZATION",
              mandatory: true,
              reason: "Synthetic final authority",
            },
          ],
      requiredEvidence: [],
      notificationMetadata: {},
      autoApprovalEligible: automatic,
    },
    admin,
    "d6-policy-rule",
  );
  await policy.activate(version.id, admin, "d6-policy-active");
  const d = await requests.initiate(requester, "d6-i");
  await requests.update(
    d.id,
    {
      payee: "Synthetic Vendor",
      purpose: "Approval integration",
      category: "Operations",
      amount,
      currency: "MYR",
      dueDate: "2026-09-30",
      paymentMethod: "BANK_TRANSFER",
      paymentDetails: "Synthetic",
    },
    requester,
    "d6-u",
  );
  const r = await requests.submit(d.id, requester, "d6-s");
  await db.pool.query(
    `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference) VALUES($1,$2,$3,'approval.pdf',$4,'application/pdf',20,$5,'INVOICE',1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean')`,
    [
      randomUUID(),
      r.id,
      randomUUID(),
      `quarantine/tests/${randomUUID()}`,
      randomUUID().replaceAll("-", "").repeat(2),
      requester.id,
    ],
  );
  await validation.start(r.id, finance, "d6-v");
  await validation.finalize(
    r.id,
    { overallResult: "PASS", remarks: "complete", findings: [] },
    finance,
    "d6-vf",
  );
  await context.calculate(r.id, finance, "d6-c");
  await analysis.manual(
    r.id,
    {
      riskLevel: "LOW",
      priority: "NORMAL",
      urgency: "NORMAL",
      riskFlags: [],
      financialAssessment: "Reviewed",
      spendingAssessment: "Reviewed",
      complianceRemarks: "Reviewed",
      evidenceReferences: [
        {
          source: "FINANCE_CONTEXT",
          reference: "current",
          field: "projected_available_amount_minor",
        },
      ],
    },
    finance,
    "d6-a",
  );
  await policy.evaluate(r.id, finance, "d6-p");
  return { r, requests };
}
async function addEvidence(db: Postgres, requestId: string) {
  await db.retryableTransaction((client) =>
    client.query(
      `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference) VALUES($1,$2,$3,'changed.pdf',$4,'application/pdf',20,$5,'CONTRACT',1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean')`,
      [
        randomUUID(),
        requestId,
        randomUUID(),
        `quarantine/tests/${randomUUID()}`,
        randomUUID().replaceAll("-", "").repeat(2),
        requester.id,
      ],
    ),
  );
}

async function behindRequestLock<T>(
  db: Postgres,
  requestId: string,
  start: () => Promise<T>,
) {
  const blocker = await db.pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM payment_requests WHERE id=$1 FOR UPDATE", [
      requestId,
    ]);
    let settled = false;
    const running = start().finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(settled, false, "operation must wait behind the real row lock");
    await blocker.query("COMMIT");
    return await running;
  } catch (error) {
    await blocker.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    blocker.release();
  }
}

test("barrier E: duplicate Approval Case creation is serialized", async () => {
  const db = new Postgres();
  try {
    const { r, requests } = await eligible(db),
      service = new ApprovalService(db, requests);
    const [a, b] = await behindRequestLock(db, r.id, () =>
      Promise.all([
        service.create(r.id, finance, "d6-create-a"),
        service.create(r.id, finance, "d6-create-b"),
      ]),
    );
    assert.equal(a.case.id, b.case.id);
    assert.equal(
      (await requests.get(r.id, requester)).status,
      "PENDING_APPROVAL",
    );
    assert.equal((await requests.get(r.id, approver)).id, r.id);
    await assert.rejects(() => requests.get(r.id, insufficient));
    await assert.rejects(() => requests.get(r.id, wrongDepartment));
    await assert.rejects(() => requests.get(r.id, inactive));
    assert.equal((await requests.get(r.id, finance)).id, r.id);
    const authorizedPage = await service.list(approver, { page: 1, pageSize: 100 });
    assert.ok(authorizedPage.items.some((item) => item.approval_case_id === a.case.id));
    for (const denied of [insufficient, wrongDepartment, inactive]) {
      const deniedPage = await service.list(denied, { page: 1, pageSize: 100 });
      assert.equal(deniedPage.items.some((item) => item.approval_case_id === a.case.id), false);
    }
    const [first, second] = a.steps;
    await assert.rejects(() =>
      service.act(
        r.id,
        first.id,
        { commandKey: randomUUID(), action: "APPROVE" },
        requester,
        "self",
      ),
    );
    await assert.rejects(() =>
      service.act(
        r.id,
        second.id,
        { commandKey: randomUUID(), action: "APPROVE" },
        finance,
        "bypass",
      ),
    );
    const key = randomUUID();
    const firstResult = (await service.act(
      r.id,
      first.id,
      { commandKey: key, action: "APPROVE" },
      approver,
      "approve",
    )) as { approval: { readyForFinanceControl: boolean } };
    assert.equal(firstResult.approval.readyForFinanceControl, false);
    const duplicate = await service.act(
      r.id,
      first.id,
      { commandKey: key, action: "APPROVE" },
      approver,
      "duplicate",
    );
    assert.equal(duplicate.idempotent, true);
    const finalResult = (await service.act(
      r.id,
      second.id,
      { commandKey: randomUUID(), action: "APPROVE" },
      finance,
      "director",
    )) as { approval: { readyForFinanceControl: boolean } };
    assert.equal(finalResult.approval.readyForFinanceControl, true);
    assert.equal((await requests.get(r.id, requester)).status, "APPROVED");
    const commitment = await db.pool.query(
      "SELECT * FROM budget_commitments WHERE approval_case_id=$1 AND status='ACTIVE'",
      [a.case.id],
    );
    assert.equal(commitment.rowCount, 1);
    assert.equal(commitment.rows[0].source, "APPROVAL");
    await addEvidence(db, r.id);
    assert.equal((await requests.get(r.id, requester)).status, "SUBMITTED");
    assert.equal(
      (
        await db.pool.query("SELECT status FROM approval_cases WHERE id=$1", [
          a.case.id,
        ])
      ).rows[0].status,
      "SUPERSEDED",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT status,release_reason FROM budget_commitments WHERE approval_case_id=$1",
          [a.case.id],
        )
      ).rows[0].status,
      "RELEASED",
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("barrier C: Approve versus Clarification has one serial outcome", async () => {
  const db = new Postgres();
  try {
    const { r, requests } = await eligible(db),
      service = new ApprovalService(db, requests),
      view = await service.create(r.id, finance, "race-create"),
      step = view.steps[0];
    const outcomes = await behindRequestLock(db, r.id, () =>
      Promise.allSettled([
        service.act(
          r.id,
          step.id,
          { commandKey: randomUUID(), action: "APPROVE" },
          approver,
          "race-a",
        ),
        service.act(
          r.id,
          step.id,
          {
            commandKey: randomUUID(),
            action: "REQUEST_CLARIFICATION",
            reason: "Need evidence",
            requiredResponse: "Provide evidence",
          },
          secondApprover,
          "race-c",
        ),
      ]),
    );
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    const count = await db.pool.query(
      "SELECT count(*)::int count FROM approval_actions WHERE approval_step_id=$1",
      [step.id],
    );
    assert.equal(count.rows[0].count, 1);
  } finally {
    await db.onModuleDestroy();
  }
});

test("barrier A: two authorized users cannot both act on one Approval step", async () => {
  const db = new Postgres();
  try {
    const fixture = await eligible(db),
      service = new ApprovalService(db, fixture.requests),
      view = await service.create(fixture.r.id, finance, "race-a-create"),
      step = view.steps[0];
    const outcomes = await behindRequestLock(db, fixture.r.id, () =>
      Promise.allSettled([
        service.act(
          fixture.r.id,
          step.id,
          { commandKey: randomUUID(), action: "APPROVE" },
          approver,
          "race-a-one",
        ),
        service.act(
          fixture.r.id,
          step.id,
          { commandKey: randomUUID(), action: "APPROVE" },
          secondApprover,
          "race-a-two",
        ),
      ]),
    );
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int count FROM approval_actions WHERE approval_step_id=$1",
          [step.id],
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("barrier B: Approve versus Reject cannot produce mixed terminal state", async () => {
  const db = new Postgres();
  try {
    const fixture = await eligible(db),
      service = new ApprovalService(db, fixture.requests),
      view = await service.create(fixture.r.id, finance, "race-b-create"),
      step = view.steps[0];
    const outcomes = await behindRequestLock(db, fixture.r.id, () =>
      Promise.allSettled([
        service.act(
          fixture.r.id,
          step.id,
          { commandKey: randomUUID(), action: "APPROVE" },
          approver,
          "race-b-approve",
        ),
        service.act(
          fixture.r.id,
          step.id,
          {
            commandKey: randomUUID(),
            action: "REJECT",
            reason: "Controlled rejection",
          },
          secondApprover,
          "race-b-reject",
        ),
      ]),
    );
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int count FROM approval_actions WHERE approval_step_id=$1",
          [step.id],
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("barrier D: Approval action versus evidence revision serializes safely", async () => {
  const db = new Postgres();
  try {
    const fixture = await eligible(db),
      service = new ApprovalService(db, fixture.requests),
      view = await service.create(fixture.r.id, finance, "race-d-create");
    await behindRequestLock(db, fixture.r.id, () =>
      Promise.allSettled([
        service.act(
          fixture.r.id,
          view.steps[0].id,
          { commandKey: randomUUID(), action: "APPROVE" },
          approver,
          "race-d-approve",
        ),
        addEvidence(db, fixture.r.id),
      ]),
    );
    const state = await db.pool.query(
      `SELECT pr.status request_status,ac.status case_status,
       count(aa.id)::int actions FROM payment_requests pr
       JOIN approval_cases ac ON ac.payment_request_id=pr.id
       LEFT JOIN approval_actions aa ON aa.approval_case_id=ac.id
       WHERE pr.id=$1 GROUP BY pr.status,ac.status`,
      [fixture.r.id],
    );
    assert.equal(state.rows[0].request_status, "SUBMITTED");
    assert.equal(state.rows[0].case_status, "SUPERSEDED");
    assert.equal(state.rows[0].actions <= 1, true);
  } finally {
    await db.onModuleDestroy();
  }
});

test("evidence revision supersedes an active Approval case", async () => {
  const db = new Postgres();
  try {
    const { r, requests } = await eligible(db),
      service = new ApprovalService(db, requests),
      view = await service.create(r.id, finance, "stale-create");
    await db.pool.query(
      `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference) VALUES($1,$2,$3,'changed.pdf',$4,'application/pdf',20,$5,'CONTRACT',1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean')`,
      [
        randomUUID(),
        r.id,
        randomUUID(),
        `quarantine/tests/${randomUUID()}`,
        randomUUID().replaceAll("-", "").repeat(2),
        requester.id,
      ],
    );
    await assert.rejects(() =>
      service.act(
        r.id,
        view.steps[0].id,
        { commandKey: randomUUID(), action: "APPROVE" },
        approver,
        "stale",
      ),
    );
    await assert.rejects(() => requests.get(r.id, approver));
    const historical = await db.pool.query(
      "SELECT status,is_current FROM approval_cases WHERE id=$1",
      [view.case.id],
    );
    assert.equal(historical.rows[0].status, "SUPERSEDED");
    assert.equal(historical.rows[0].is_current, false);
  } finally {
    await db.onModuleDestroy();
  }
});

async function telegramToken(
  db: Postgres,
  view: { case: { id: string }; steps: Array<{ id: string }> },
  action: "APPROVE" | "REJECT" | "REQUEST_CLARIFICATION",
  options: {
    recipient?: Principal;
    status?: "ACTIVE" | "CONSUMED" | "EXPIRED" | "REVOKED";
    expired?: boolean;
    stepIndex?: number;
  } = {},
) {
  const id = randomUUID(),
    callback = `${id}.${randomUUID()}`,
    recipient = options.recipient ?? approver;
  await db.pool.query(
    "INSERT INTO approval_action_tokens(id,token_hash,approval_case_id,approval_step_id,recipient_user_id,action,expires_at,status)VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $8 THEN now()-interval '1 minute' ELSE now()+interval '10 minutes' END,$7)",
    [
      id,
      createHash("sha256").update(callback).digest("hex"),
      view.case.id,
      view.steps[options.stepIndex ?? 0].id,
      recipient.id,
      action,
      options.status ?? "ACTIVE",
      options.expired ?? false,
    ],
  );
  return callback;
}
test("barrier F: duplicate auto-approval creates one case and commitment", async () => {
  const db = new Postgres();
  try {
    const { r, requests } = await eligible(db, "10.00", true),
      service = new ApprovalService(db, requests);
    const [a, b] = await behindRequestLock(db, r.id, () =>
      Promise.all([
        service.create(r.id, finance, "auto-a"),
        service.create(r.id, finance, "auto-b"),
      ]),
    );
    assert.equal(a.case.id, b.case.id);
    assert.equal((await requests.get(r.id, requester)).status, "APPROVED");
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int count FROM budget_commitments WHERE approval_case_id=$1 AND status='ACTIVE'",
          [a.case.id],
        )
      ).rows[0].count,
      1,
    );
    await addEvidence(db, r.id);
    assert.equal((await requests.get(r.id, requester)).status, "SUBMITTED");
    assert.equal(
      (
        await db.pool.query(
          "SELECT status FROM budget_commitments WHERE approval_case_id=$1",
          [a.case.id],
        )
      ).rows[0].status,
      "RELEASED",
    );
  } finally {
    await db.onModuleDestroy();
  }
});

async function assertMaterialInvalidation(
  db: Postgres,
  requestId: string,
  caseId: string,
  priorRevision: number,
) {
  const request = await db.pool.query(
      "SELECT status,row_version FROM payment_requests WHERE id=$1",
      [requestId],
    ),
    approval = await db.pool.query(
      "SELECT status,is_current FROM approval_cases WHERE id=$1",
      [caseId],
    ),
    commitment = await db.pool.query(
      "SELECT status,release_reason FROM budget_commitments WHERE approval_case_id=$1",
      [caseId],
    ),
    downstream = await db.pool.query(
      `SELECT
       (SELECT count(*) FROM validation_runs WHERE payment_request_id=$1 AND is_current)::int validation,
       (SELECT count(*) FROM finance_context_snapshots WHERE payment_request_id=$1 AND is_current)::int context,
       (SELECT count(*) FROM financial_analysis_runs WHERE payment_request_id=$1 AND is_current)::int analysis,
       (SELECT count(*) FROM policy_decision_runs WHERE payment_request_id=$1 AND is_current)::int policy`,
      [requestId],
    );
  assert.equal(request.rows[0].status, "SUBMITTED");
  assert.equal(request.rows[0].row_version, priorRevision + 1);
  assert.equal(approval.rows[0].status, "SUPERSEDED");
  assert.equal(approval.rows[0].is_current, false);
  assert.equal(commitment.rows[0].status, "RELEASED");
  assert.equal(commitment.rows[0].release_reason, "REQUEST_MATERIAL_CHANGED");
  assert.deepEqual(downstream.rows[0], {
    validation: 0,
    context: 0,
    analysis: 0,
    policy: 0,
  });
  assert.equal(
    (
      await db.pool.query(
        "SELECT count(*)::int count FROM audit_events WHERE entity_id=$1 AND action='REQUEST_MATERIAL_CHANGE_INVALIDATED_DOWNSTREAM'",
        [requestId],
      )
    ).rows[0].count,
    1,
  );
}

test("direct DB material fields invalidate approved authorization and preserve non-material updates", async () => {
  const changes: Array<{ column: string; value: string }> = [
    { column: "amount", value: "11.00" },
    { column: "payee", value: "Changed Vendor" },
    { column: "currency", value: "USD" },
    { column: "department_id", value: finance.departmentId },
    { column: "category", value: "Changed Category" },
  ];
  for (const change of changes) {
    const db = new Postgres();
    try {
      const fixture = await eligible(db, "10.00", true),
        service = new ApprovalService(db, fixture.requests),
        view = await service.create(
          fixture.r.id,
          finance,
          `material-${change.column}`,
        ),
        before = await db.pool.query(
          "SELECT row_version FROM payment_requests WHERE id=$1",
          [fixture.r.id],
        );
      await db.pool.query(
        `UPDATE payment_requests SET ${change.column}=$2 WHERE id=$1`,
        [fixture.r.id, change.value],
      );
      await assertMaterialInvalidation(
        db,
        fixture.r.id,
        view.case.id,
        before.rows[0].row_version,
      );
    } finally {
      await db.onModuleDestroy();
    }
  }
  const db = new Postgres();
  try {
    const fixture = await eligible(db, "10.00", true),
      service = new ApprovalService(db, fixture.requests),
      view = await service.create(fixture.r.id, finance, "nonmaterial"),
      before = await db.pool.query(
        "SELECT row_version FROM payment_requests WHERE id=$1",
        [fixture.r.id],
      );
    await db.pool.query("UPDATE payment_requests SET remark=$2 WHERE id=$1", [
      fixture.r.id,
      "Internal display note",
    ]);
    assert.equal(
      (await fixture.requests.get(fixture.r.id, requester)).status,
      "APPROVED",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT status FROM budget_commitments WHERE approval_case_id=$1",
          [view.case.id],
        )
      ).rows[0].status,
      "ACTIVE",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT row_version FROM payment_requests WHERE id=$1",
          [fixture.r.id],
        )
      ).rows[0].row_version,
      before.rows[0].row_version,
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("direct material change while pending Approval revokes the active route", async () => {
  const db = new Postgres();
  try {
    const fixture = await eligible(db),
      service = new ApprovalService(db, fixture.requests),
      view = await service.create(fixture.r.id, finance, "pending-material");
    await telegramToken(db, view, "APPROVE");
    await db.pool.query(
      "UPDATE payment_requests SET purpose='Changed after routing' WHERE id=$1",
      [fixture.r.id],
    );
    assert.equal(
      (await fixture.requests.get(fixture.r.id, requester)).status,
      "SUBMITTED",
    );
    assert.equal(
      (
        await db.pool.query("SELECT status FROM approval_cases WHERE id=$1", [
          view.case.id,
        ])
      ).rows[0].status,
      "SUPERSEDED",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int count FROM approval_action_tokens WHERE approval_case_id=$1 AND status='ACTIVE'",
          [view.case.id],
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await db.onModuleDestroy();
  }
});
test("Telegram callbacks bind identity and route all actions through Approval commands", async () => {
  const old = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = "d6-test-secret";
  const db = new Postgres(),
    base = Date.now();
  try {
    const first = await eligible(db),
      approveService = new ApprovalService(db, first.requests),
      approveView = await approveService.create(
        first.r.id,
        finance,
        "tg-a-create",
      );
    await approveService.bindTelegram(
      {
        userId: approver.id,
        telegramUserId: String(base + 1),
        telegramChatId: String(base + 101),
      },
      admin,
      "tg-bind-a",
    );
    const approveToken = await telegramToken(db, approveView, "APPROVE");
    await assert.rejects(() =>
      approveService.telegramWebhook("d6-test-secret", {
        update_id: base + 201,
        callback_query: { data: approveToken, from: { id: 999999 } },
      }),
    );
    await assert.rejects(() =>
      approveService.telegramWebhook("d6-test-secret", {
        update_id: base + 202,
        callback_query: { data: "forged", from: { id: base + 1 } },
      }),
    );
    await approveService.telegramWebhook("d6-test-secret", {
      update_id: base + 203,
      callback_query: { data: approveToken, from: { id: base + 1 } },
    });
    const duplicate = (await approveService.telegramWebhook("d6-test-secret", {
      update_id: base + 204,
      callback_query: { data: approveToken, from: { id: base + 1 } },
    })) as { idempotent?: boolean };
    assert.equal(duplicate.idempotent, true);
    const second = await eligible(db),
      rejectService = new ApprovalService(db, second.requests),
      rejectView = await rejectService.create(
        second.r.id,
        finance,
        "tg-r-create",
      );
    await rejectService.bindTelegram(
      {
        userId: approver.id,
        telegramUserId: String(base + 2),
        telegramChatId: String(base + 102),
      },
      admin,
      "tg-bind-r",
    );
    const rejectToken = await telegramToken(db, rejectView, "REJECT");
    const prompt = (await rejectService.telegramWebhook("d6-test-secret", {
      update_id: base + 205,
      callback_query: {
        data: rejectToken,
        from: { id: base + 2 },
        message: { chat: { id: base + 102 } },
      },
    })) as { method: string };
    assert.equal(prompt.method, "sendMessage");
    await rejectService.telegramWebhook("d6-test-secret", {
      update_id: base + 206,
      message: {
        text: "Controlled rejection reason",
        from: { id: base + 2 },
        chat: { id: base + 102 },
      },
    });
    assert.equal(
      (await second.requests.get(second.r.id, requester)).status,
      "REJECTED",
    );
    const third = await eligible(db),
      clarifyService = new ApprovalService(db, third.requests),
      clarifyView = await clarifyService.create(
        third.r.id,
        finance,
        "tg-c-create",
      );
    await clarifyService.bindTelegram(
      {
        userId: approver.id,
        telegramUserId: String(base + 3),
        telegramChatId: String(base + 103),
      },
      admin,
      "tg-bind-c",
    );
    const clarifyToken = await telegramToken(
      db,
      clarifyView,
      "REQUEST_CLARIFICATION",
    );
    await clarifyService.telegramWebhook("d6-test-secret", {
      update_id: base + 207,
      callback_query: {
        data: clarifyToken,
        from: { id: base + 3 },
        message: { chat: { id: base + 103 } },
      },
    });
    await clarifyService.telegramWebhook("d6-test-secret", {
      update_id: base + 208,
      message: {
        text: "Provide procurement confirmation",
        from: { id: base + 3 },
        chat: { id: base + 103 },
      },
    });
    assert.equal(
      (await third.requests.get(third.r.id, requester)).status,
      "NEEDS_CLARIFICATION",
    );
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = old;
    await db.onModuleDestroy();
  }
});

test("revoked Telegram identity can be rebound without reviving old authority", async () => {
  const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = "rebind-secret";
  const db = new Postgres(),
    base = Date.now();
  try {
    const fixture = await eligible(db),
      service = new ApprovalService(db, fixture.requests),
      telegramUserId = String(base + 30001),
      telegramChatId = String(base + 30101);
    await service.bindTelegram(
      { userId: approver.id, telegramUserId, telegramChatId },
      admin,
      "rebind-first",
    );
    const view = await service.create(fixture.r.id, finance, "rebind-create"),
      oldToken = await telegramToken(db, view, "APPROVE");
    await assert.rejects(() =>
      service.bindTelegram(
        {
          userId: secondApprover.id,
          telegramUserId,
          telegramChatId: String(base + 30102),
        },
        admin,
        "rebind-conflict",
      ),
    );
    await service.bindTelegram(
      { userId: approver.id, telegramUserId, telegramChatId },
      admin,
      "rebind-second",
    );
    await assert.rejects(() =>
      service.telegramWebhook("rebind-secret", {
        update_id: base + 30201,
        callback_query: { data: oldToken, from: { id: Number(telegramUserId) } },
      }),
    );
    const newToken = await telegramToken(db, view, "APPROVE");
    await service.telegramWebhook("rebind-secret", {
      update_id: base + 30202,
      callback_query: { data: newToken, from: { id: Number(telegramUserId) } },
    });
    const bindings = await db.pool.query(
      "SELECT status,count(*)::int count FROM telegram_identity_bindings WHERE telegram_user_id=$1 GROUP BY status",
      [telegramUserId],
    );
    assert.equal(bindings.rows.find((row) => row.status === "ACTIVE").count, 1);
    assert.equal(bindings.rows.find((row) => row.status === "REVOKED").count, 1);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int count FROM audit_events WHERE action='TELEGRAM_IDENTITY_REVOKED' AND safe_metadata->>'userId'=$1",
          [approver.id],
        )
      ).rows[0].count >= 1,
      true,
    );
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = oldSecret;
    await db.onModuleDestroy();
  }
});

test("barrier H: Telegram callback versus upstream invalidation is serial", async () => {
  const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = "race-h-secret";
  const db = new Postgres(),
    base = Date.now();
  try {
    const fixture = await eligible(db),
      service = new ApprovalService(db, fixture.requests),
      view = await service.create(fixture.r.id, finance, "race-h-create");
    await service.bindTelegram(
      {
        userId: approver.id,
        telegramUserId: String(base + 40001),
        telegramChatId: String(base + 40101),
      },
      admin,
      "race-h-bind",
    );
    const token = await telegramToken(db, view, "APPROVE");
    await behindRequestLock(db, fixture.r.id, () =>
      Promise.allSettled([
        service.telegramWebhook("race-h-secret", {
          update_id: base + 40201,
          callback_query: { data: token, from: { id: base + 40001 } },
        }),
        addEvidence(db, fixture.r.id),
      ]),
    );
    const state = await db.pool.query(
      `SELECT pr.status request_status,ac.status case_status,
       count(aa.id)::int actions FROM payment_requests pr
       JOIN approval_cases ac ON ac.payment_request_id=pr.id
       LEFT JOIN approval_actions aa ON aa.approval_case_id=ac.id
       WHERE pr.id=$1 GROUP BY pr.status,ac.status`,
      [fixture.r.id],
    );
    assert.equal(state.rows[0].request_status, "SUBMITTED");
    assert.equal(state.rows[0].case_status, "SUPERSEDED");
    assert.equal(state.rows[0].actions <= 1, true);
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = oldSecret;
    await db.onModuleDestroy();
  }
});

test("barrier I: expired-token rotation and retry preserve one active set", async () => {
  const oldWebhook = process.env.TELEGRAM_WEBHOOK_SECRET,
    oldCallback = process.env.TELEGRAM_CALLBACK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = "rotation-secret";
  process.env.TELEGRAM_CALLBACK_SECRET = "rotation-secret";
  const db = new Postgres(),
    base = Date.now();
  try {
    const fixture = await eligible(db),
      service = new ApprovalService(db, fixture.requests);
    await service.bindTelegram(
      {
        userId: approver.id,
        telegramUserId: String(base + 501),
        telegramChatId: String(base + 601),
      },
      admin,
      "rotation-bind",
    );
    const view = await service.create(
      fixture.r.id,
      finance,
      "rotation-create",
    );
    await db.pool.query(
      "UPDATE notification_outbox SET status='SENT' WHERE aggregate_id<>$1 AND status IN('PENDING','FAILED_RETRYABLE')",
      [view.steps[0].id],
    );
    for (const action of [
      "APPROVE",
      "REJECT",
      "REQUEST_CLARIFICATION",
    ] as const) {
      const id = randomUUID(),
        raw = `${id}.expired`;
      await db.pool.query(
        "INSERT INTO approval_action_tokens(id,token_hash,approval_case_id,approval_step_id,recipient_user_id,action,expires_at,status)VALUES($1,$2,$3,$4,$5,$6,now()-interval '1 minute','ACTIVE')",
        [
          id,
          createHash("sha256").update(raw).digest("hex"),
          view.case.id,
          view.steps[0].id,
          approver.id,
          action,
        ],
      );
    }
    let sends = 0;
    const channel: ApprovalChannel = {
        send: async () => {
          sends++;
          if (sends === 1) throw new Error("AMBIGUOUS_TEST_FAILURE");
        },
      },
      outbox = new ApprovalOutboxService(db, channel);
    await outbox.dispatch();
    await db.pool.query(
      "UPDATE notification_outbox SET next_attempt_at=now() WHERE aggregate_id=$1",
      [view.steps[0].id],
    );
    await Promise.all([outbox.dispatch(), outbox.dispatch()]);
    const tokens = await db.pool.query(
      "SELECT status,count(*)::int count FROM approval_action_tokens WHERE approval_step_id=$1 GROUP BY status",
      [view.steps[0].id],
    );
    assert.equal(
      tokens.rows.find((row) => row.status === "ACTIVE").count,
      3,
    );
    assert.equal(
      tokens.rows.find((row) => row.status === "EXPIRED").count,
      3,
    );
    assert.equal(sends, 2);
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = oldWebhook;
    process.env.TELEGRAM_CALLBACK_SECRET = oldCallback;
    await db.onModuleDestroy();
  }
});

test("outbox lease recovery rejects stale workers and permits one reclaimer", async () => {
  const oldLease = process.env.OUTBOX_PROCESSING_LEASE_SECONDS,
    oldSecret = process.env.TELEGRAM_CALLBACK_SECRET;
  process.env.OUTBOX_PROCESSING_LEASE_SECONDS = "1";
  process.env.TELEGRAM_CALLBACK_SECRET = "lease-test-secret";
  const db = new Postgres(),
    base = Date.now();
  let releaseSlow: (() => void) | undefined;
  try {
    const fixture = await eligible(db),
      approval = new ApprovalService(db, fixture.requests);
    await approval.bindTelegram(
      {
        userId: approver.id,
        telegramUserId: String(base + 20001),
        telegramChatId: String(base + 20101),
      },
      admin,
      "lease-bind",
    );
    const view = await approval.create(fixture.r.id, finance, "lease-create");
    await db.pool.query(
      "UPDATE notification_outbox SET status='SENT' WHERE aggregate_id<>$1 AND status IN('PENDING','FAILED_RETRYABLE')",
      [view.steps[0].id],
    );
    let slowEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
        slowEntered = resolve;
      }),
      slowGate = new Promise<void>((resolve) => {
        releaseSlow = resolve;
      }),
      slowChannel: ApprovalChannel = {
        send: async () => {
          slowEntered();
          await slowGate;
        },
      },
      fastChannel: ApprovalChannel = { send: async () => undefined },
      workerA = new ApprovalOutboxService(db, slowChannel),
      workerB = new ApprovalOutboxService(db, fastChannel),
      workerC = new ApprovalOutboxService(db, fastChannel),
      claimA = await (
        workerA as unknown as { claim(): Promise<Record<string, unknown>> }
      ).claim();
    assert.equal(claimA.status, "PROCESSING");
    const slowDelivery = (
      workerA as unknown as {
        deliver(row: Record<string, unknown>): Promise<Record<string, unknown>>;
      }
    ).deliver(claimA);
    await entered;
    assert.equal(
      await (
        workerB as unknown as { claim(): Promise<unknown | null> }
      ).claim(),
      null,
    );
    await db.pool.query(
      "UPDATE notification_outbox SET claimed_at=now()-interval '2 seconds',attempts=5 WHERE id=$1",
      [claimA.id],
    );
    const reclaimed = await Promise.all([
      (
        workerB as unknown as { claim(): Promise<Record<string, unknown> | null> }
      ).claim(),
      (
        workerC as unknown as { claim(): Promise<Record<string, unknown> | null> }
      ).claim(),
    ]);
    assert.equal(reclaimed.filter(Boolean).length, 1);
    const claimB = reclaimed.find(Boolean)!;
    assert.notEqual(claimB.claim_token, claimA.claim_token);
    const fastResult = await (
      workerB as unknown as {
        deliver(row: Record<string, unknown>): Promise<{ status: string }>;
      }
    ).deliver(claimB);
    assert.equal(fastResult.status, "SENT");
    releaseSlow?.();
    const staleResult = await slowDelivery;
    assert.equal(staleResult.status, "STALE_CLAIM");
    const final = await db.pool.query(
      "SELECT status,claim_token FROM notification_outbox WHERE id=$1",
      [claimA.id],
    );
    assert.equal(final.rows[0].status, "SENT");
    assert.equal(final.rows[0].claim_token, null);
    assert.equal(
      await (
        workerB as unknown as { claim(): Promise<unknown | null> }
      ).claim(),
      null,
    );
    await db.pool.query(
      `INSERT INTO notification_outbox(id,aggregate_type,aggregate_id,event_type,channel,recipient_user_id,payload,status,attempts)
       VALUES($1,'APPROVAL_STEP',$2,'TERMINAL_TEST','TELEGRAM',$3,'{}','FAILED_TERMINAL',1)`,
      [randomUUID(), randomUUID(), approver.id],
    );
    assert.equal(
      await (
        workerB as unknown as { claim(): Promise<unknown | null> }
      ).claim(),
      null,
    );
  } finally {
    releaseSlow?.();
    process.env.OUTBOX_PROCESSING_LEASE_SECONDS = oldLease;
    process.env.TELEGRAM_CALLBACK_SECRET = oldSecret;
    await db.onModuleDestroy();
  }
});

test("webhook retry after a forced transient domain failure loses no action", async () => {
  const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = "retry-secret";
  const db = new Postgres(),
    base = Date.now();
  try {
    const fixture = await eligible(db),
      service = new ApprovalService(db, fixture.requests),
      view = await service.create(fixture.r.id, finance, "retry-create");
    await service.bindTelegram(
      {
        userId: approver.id,
        telegramUserId: String(base + 701),
        telegramChatId: String(base + 801),
      },
      admin,
      "retry-bind",
    );
    const callback = await telegramToken(db, view, "APPROVE"),
      originalAct = service.act.bind(service),
      update = {
        update_id: base + 901,
        callback_query: { data: callback, from: { id: base + 701 } },
      };
    (service as unknown as { act: ApprovalService["act"] }).act = async () => {
      throw new Error("FORCED_TRANSIENT_FAILURE");
    };
    await assert.rejects(() =>
      service.telegramWebhook("retry-secret", update),
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT status FROM telegram_webhook_updates WHERE update_id=$1",
          [update.update_id],
        )
      ).rows[0].status,
      "FAILED_RETRYABLE",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT status FROM approval_action_tokens WHERE token_hash=$1",
          [createHash("sha256").update(callback).digest("hex")],
        )
      ).rows[0].status,
      "ACTIVE",
    );
    (service as unknown as { act: ApprovalService["act"] }).act = originalAct;
    await service.telegramWebhook("retry-secret", update);
    const replay = await service.telegramWebhook("retry-secret", update);
    assert.equal((replay as { idempotent?: boolean }).idempotent, true);
    const state = await db.pool.query(
      "SELECT status,attempts FROM telegram_webhook_updates WHERE update_id=$1",
      [update.update_id],
    );
    assert.equal(state.rows[0].status, "COMPLETED");
    assert.equal(state.rows[0].attempts, 2);
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = oldSecret;
    await db.onModuleDestroy();
  }
});

test("Telegram rejects invalid identities, authority, secret, and dead tokens", async () => {
  const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = "security-secret";
  const db = new Postgres(),
    base = Date.now();
  try {
    const fixture = await eligible(db, "100000.00"),
      service = new ApprovalService(db, fixture.requests),
      view = await service.create(fixture.r.id, finance, "security-create");
    await service.bindTelegram(
      {
        userId: approver.id,
        telegramUserId: String(base + 1001),
        telegramChatId: String(base + 1101),
      },
      admin,
      "security-bind",
    );
    const expired = await telegramToken(db, view, "APPROVE", {
      expired: true,
    });
    await assert.rejects(() =>
      service.telegramWebhook("security-secret", {
        update_id: base + 1201,
        callback_query: { data: expired, from: { id: base + 1001 } },
      }),
    );
    await db.pool.query(
      "UPDATE approval_action_tokens SET status='EXPIRED' WHERE token_hash=$1",
      [createHash("sha256").update(expired).digest("hex")],
    );
    for (const status of ["REVOKED", "CONSUMED"] as const) {
      const dead = await telegramToken(db, view, "APPROVE", { status });
      await assert.rejects(() =>
        service.telegramWebhook("security-secret", {
          update_id: base + (status === "REVOKED" ? 1202 : 1203),
          callback_query: { data: dead, from: { id: base + 1001 } },
        }),
      );
    }
    const valid = await telegramToken(db, view, "APPROVE");
    await assert.rejects(() =>
      service.telegramWebhook("wrong-secret", {
        update_id: base + 1204,
        callback_query: { data: valid, from: { id: base + 1001 } },
      }),
    );
    await assert.rejects(() =>
      service.telegramWebhook("security-secret", {
        update_id: base + 1205,
        callback_query: { data: valid, from: { id: base + 1999 } },
      }),
    );
    for (const [principal, telegramId] of [
      [insufficient, base + 1002],
      [wrongDepartment, base + 1003],
      [requester, base + 1004],
    ] as const) {
      await service.bindTelegram(
        {
          userId: principal.id,
          telegramUserId: String(telegramId),
          telegramChatId: String(telegramId + 100),
        },
        admin,
        `security-bind-${telegramId}`,
      );
      const token = await telegramToken(db, view, "APPROVE", {
        recipient: principal,
      });
      await assert.rejects(
        () =>
          service.telegramWebhook("security-secret", {
            update_id: telegramId + 10000,
            callback_query: { data: token, from: { id: telegramId } },
          }),
        /.+/,
        `principal ${principal.id} must not be authorized`,
      );
    }
    await assert.rejects(() =>
      service.bindTelegram(
        {
          userId: inactive.id,
          telegramUserId: String(base + 1005),
          telegramChatId: String(base + 1105),
        },
        admin,
        "security-inactive-bind",
      ),
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int count FROM approval_actions WHERE approval_case_id=$1",
          [view.case.id],
        )
      ).rows[0].count,
      0,
    );
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = oldSecret;
    await db.onModuleDestroy();
  }
});

test("Telegram APPROVE denies wrong-step, evidence-stale, superseded, and material-stale tokens", async () => {
  const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = "approve-stale-secret";
  const db = new Postgres(),
    base = Date.now() + 70000;
  try {
    const first = await eligible(db),
      service = new ApprovalService(db, first.requests),
      view = await service.create(first.r.id, finance, "approve-wrong-step");
    await service.bindTelegram(
      {
        userId: approver.id,
        telegramUserId: String(base + 1),
        telegramChatId: String(base + 101),
      },
      admin,
      "approve-stale-bind",
    );
    const wrongStep = await telegramToken(db, view, "APPROVE", {
      stepIndex: 1,
    });
    await assert.rejects(() =>
      service.telegramWebhook("approve-stale-secret", {
        update_id: base + 201,
        callback_query: { data: wrongStep, from: { id: base + 1 } },
      }),
    );
    const evidenceToken = await telegramToken(db, view, "APPROVE");
    await addEvidence(db, first.r.id);
    await assert.rejects(() =>
      service.telegramWebhook("approve-stale-secret", {
        update_id: base + 202,
        callback_query: { data: evidenceToken, from: { id: base + 1 } },
      }),
    );
    const second = await eligible(db),
      materialService = new ApprovalService(db, second.requests),
      materialView = await materialService.create(
        second.r.id,
        finance,
        "approve-material",
      ),
      materialToken = await telegramToken(db, materialView, "APPROVE");
    await db.pool.query(
      "UPDATE payment_requests SET payment_details='Changed account' WHERE id=$1",
      [second.r.id],
    );
    await assert.rejects(() =>
      materialService.telegramWebhook("approve-stale-secret", {
        update_id: base + 203,
        callback_query: { data: materialToken, from: { id: base + 1 } },
      }),
    );
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = oldSecret;
    await db.onModuleDestroy();
  }
});

for (const action of ["REJECT", "REQUEST_CLARIFICATION"] as const) {
  test(`Telegram ${action} security cross-product denies invalid transport and authority`, async () => {
    const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    process.env.TELEGRAM_WEBHOOK_SECRET = `matrix-${action}`;
    const db = new Postgres(),
      base = Date.now() + (action === "REJECT" ? 50000 : 60000),
      secret = `matrix-${action}`;
    let updateId = base;
    try {
      const fixture = await eligible(db),
        service = new ApprovalService(db, fixture.requests),
        view = await service.create(fixture.r.id, finance, `matrix-${action}`);
      await service.bindTelegram(
        {
          userId: approver.id,
          telegramUserId: String(base + 1),
          telegramChatId: String(base + 101),
        },
        admin,
        `matrix-bind-${action}`,
      );
      const expired = await telegramToken(db, view, action, { expired: true });
      await assert.rejects(() =>
        service.telegramWebhook(secret, {
          update_id: ++updateId,
          callback_query: { data: expired, from: { id: base + 1 } },
        }),
      );
      await db.pool.query(
        "UPDATE approval_action_tokens SET status='EXPIRED' WHERE token_hash=$1",
        [createHash("sha256").update(expired).digest("hex")],
      );
      for (const status of ["CONSUMED", "REVOKED"] as const) {
        const dead = await telegramToken(db, view, action, { status });
        await assert.rejects(() =>
          service.telegramWebhook(secret, {
            update_id: ++updateId,
            callback_query: { data: dead, from: { id: base + 1 } },
          }),
        );
      }
      const valid = await telegramToken(db, view, action);
      await assert.rejects(() =>
        service.telegramWebhook("invalid-secret", {
          update_id: ++updateId,
          callback_query: { data: valid, from: { id: base + 1 } },
        }),
      );
      for (const invalidData of ["malformed", `${valid}forged`])
        await assert.rejects(() =>
          service.telegramWebhook(secret, {
            update_id: ++updateId,
            callback_query: { data: invalidData, from: { id: base + 1 } },
          }),
        );
      for (const identity of [base + 2, base + 3])
        await assert.rejects(() =>
          service.telegramWebhook(secret, {
            update_id: ++updateId,
            callback_query: { data: valid, from: { id: identity } },
          }),
        );
      for (const [principal, telegramId] of [
        [insufficient, base + 4],
        [wrongDepartment, base + 5],
        [requester, base + 6],
      ] as const) {
        await service.bindTelegram(
          {
            userId: principal.id,
            telegramUserId: String(telegramId),
            telegramChatId: String(telegramId + 100),
          },
          admin,
          `matrix-authority-${action}-${telegramId}`,
        );
        const authorityToken = await telegramToken(db, view, action, {
          recipient: principal,
        });
        await service.telegramWebhook(secret, {
          update_id: ++updateId,
          callback_query: {
            data: authorityToken,
            from: { id: telegramId },
            message: { chat: { id: telegramId + 100 } },
          },
        });
        await assert.rejects(() =>
          service.telegramWebhook(secret, {
            update_id: ++updateId,
            message: {
              text: "Unauthorized response",
              from: { id: telegramId },
              chat: { id: telegramId + 100 },
            },
          }),
        );
        await db.pool.query(
          "UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE recipient_user_id=$1 AND status='PENDING'",
          [principal.id],
        );
      }
      await assert.rejects(() =>
        service.bindTelegram(
          {
            userId: inactive.id,
            telegramUserId: String(base + 7),
            telegramChatId: String(base + 107),
          },
          admin,
          `matrix-inactive-${action}`,
        ),
      );
      const wrongStep = await telegramToken(db, view, action, { stepIndex: 1 });
      await service.telegramWebhook(secret, {
        update_id: ++updateId,
        callback_query: {
          data: wrongStep,
          from: { id: base + 1 },
          message: { chat: { id: base + 101 } },
        },
      });
      await assert.rejects(() =>
        service.telegramWebhook(secret, {
          update_id: ++updateId,
          message: {
            text: "Wrong step response",
            from: { id: base + 1 },
            chat: { id: base + 101 },
          },
        }),
      );
      await db.pool.query(
        "UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE recipient_user_id=$1 AND status='PENDING'",
        [approver.id],
      );
      const promptUpdate = ++updateId;
      await service.telegramWebhook(secret, {
        update_id: promptUpdate,
        callback_query: {
          data: valid,
          from: { id: base + 1 },
          message: { chat: { id: base + 101 } },
        },
      });
      const replyUpdate = ++updateId,
        reply = {
          update_id: replyUpdate,
          message: {
            text: "Valid accountable reason",
            from: { id: base + 1 },
            chat: { id: base + 101 },
          },
        };
      await service.telegramWebhook(secret, reply);
      const duplicate = await service.telegramWebhook(secret, reply);
      assert.equal((duplicate as { idempotent?: boolean }).idempotent, true);
      assert.equal(
        (
          await db.pool.query(
            "SELECT count(*)::int count FROM approval_actions WHERE approval_case_id=$1",
            [view.case.id],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(promptUpdate < replyUpdate, true);

      const evidenceFixture = await eligible(db),
        evidenceService = new ApprovalService(db, evidenceFixture.requests),
        evidenceView = await evidenceService.create(
          evidenceFixture.r.id,
          finance,
          `matrix-evidence-${action}`,
        ),
        evidenceToken = await telegramToken(db, evidenceView, action);
      await addEvidence(db, evidenceFixture.r.id);
      await assert.rejects(() =>
        evidenceService.telegramWebhook(secret, {
          update_id: ++updateId,
          callback_query: { data: evidenceToken, from: { id: base + 1 } },
        }),
      );
      const materialFixture = await eligible(db),
        materialService = new ApprovalService(db, materialFixture.requests),
        materialView = await materialService.create(
          materialFixture.r.id,
          finance,
          `matrix-material-${action}`,
        ),
        materialToken = await telegramToken(db, materialView, action);
      await db.pool.query(
        "UPDATE payment_requests SET payee='Materially changed vendor' WHERE id=$1",
        [materialFixture.r.id],
      );
      await assert.rejects(() =>
        materialService.telegramWebhook(secret, {
          update_id: ++updateId,
          callback_query: { data: materialToken, from: { id: base + 1 } },
        }),
      );
    } finally {
      process.env.TELEGRAM_WEBHOOK_SECRET = oldSecret;
      await db.onModuleDestroy();
    }
  });
}

test("barrier G: final Approval and commitment versus invalidation stays consistent", async () => {
  const db = new Postgres();
  try {
    const fixture = await eligible(db),
      service = new ApprovalService(db, fixture.requests),
      view = await service.create(fixture.r.id, finance, "final-race-create");
    await service.act(
      fixture.r.id,
      view.steps[0].id,
      { commandKey: randomUUID(), action: "APPROVE" },
      approver,
      "final-race-first",
    );
    const outcomes = await behindRequestLock(db, fixture.r.id, () =>
      Promise.allSettled([
        service.act(
          fixture.r.id,
          view.steps[1].id,
          { commandKey: randomUUID(), action: "APPROVE" },
          finance,
          "final-race-approve",
        ),
        db.pool.query(
          "UPDATE payment_requests SET amount=amount+1 WHERE id=$1",
          [fixture.r.id],
        ),
      ]),
    );
    assert.equal(outcomes.some((outcome) => outcome.status === "fulfilled"), true);
    const invariant = await db.pool.query(
      `SELECT pr.status request_status,ac.status approval_status,
       count(bc.id) FILTER(WHERE bc.status='ACTIVE')::int active_commitments
       FROM payment_requests pr JOIN approval_cases ac ON ac.id=$2
       LEFT JOIN budget_commitments bc ON bc.approval_case_id=ac.id
       WHERE pr.id=$1 GROUP BY pr.status,ac.status`,
      [fixture.r.id, view.case.id],
    );
    assert.equal(
      invariant.rows[0].request_status === "APPROVED" &&
        invariant.rows[0].approval_status === "SUPERSEDED" &&
        invariant.rows[0].active_commitments > 0,
      false,
    );
  } finally {
    await db.onModuleDestroy();
  }
});
