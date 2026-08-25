/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ApprovalService } from "../src/application/approval/approval.service.js";
import { FinanceContextService } from "../src/application/finance-context/finance-context.service.js";
import { FinanceControlService } from "../src/application/finance-control/finance-control.service.js";
import type { FinanceConfirmationCode } from "../src/application/finance-control/finance-control.dto.js";
import { FinancialAnalysisService } from "../src/application/financial-analysis/financial-analysis.service.js";
import { PaymentRequestService } from "../src/application/payment-requests/payment-request.service.js";
import { PaymentService } from "../src/application/payments/payment.service.js";
import { PolicyService } from "../src/application/policy/policy.service.js";
import { ValidationService } from "../src/application/validation/validation.service.js";
import type { Principal } from "../src/domain/payment-request.js";
import { Postgres } from "../src/infrastructure/database/postgres.js";

const requester: Principal = {
    id: "10000000-0000-4000-8000-000000000001",
    departmentId: "00000000-0000-4000-8000-000000000001",
    roles: ["REQUESTER"],
  },
  finance: Principal = {
    id: "10000000-0000-4000-8000-000000000002",
    departmentId: "00000000-0000-4000-8000-000000000002",
    roles: ["FINANCE"],
  },
  policyAdmin: Principal = { ...finance, roles: ["ADMIN"] },
  secondFinance: Principal = {
    id: "10000000-0000-4000-8000-000000000009",
    departmentId: finance.departmentId,
    roles: ["FINANCE"],
  },
  adminOnly: Principal = {
    id: "10000000-0000-4000-8000-000000000010",
    departmentId: finance.departmentId,
    roles: ["ADMIN"],
  },
  scopedFinance: Principal = {
    id: "10000000-0000-4000-8000-000000000011",
    departmentId: finance.departmentId,
    roles: ["FINANCE"],
  },
  revokedFinance: Principal = {
    id: "10000000-0000-4000-8000-000000000012",
    departmentId: finance.departmentId,
    roles: ["FINANCE"],
  },
  inactivePayment: Principal = {
    id: "10000000-0000-4000-8000-000000000007",
    departmentId: requester.departmentId,
    roles: ["FINANCE"],
  },
  revokedPayment: Principal = {
    id: "10000000-0000-4000-8000-000000000008",
    departmentId: requester.departmentId,
    roles: ["FINANCE"],
  },
  approver: Principal = {
    id: "10000000-0000-4000-8000-000000000004",
    departmentId: requester.departmentId,
    roles: ["REQUESTER"],
  };

async function approved(
  db: Postgres,
  options: {
    hash?: string;
    payee?: string;
    amount?: string;
    automatic?: boolean;
    leavePending?: boolean;
  } = {},
) {
  const requests = new PaymentRequestService(db),
    validation = new ValidationService(db, requests, {} as never, null),
    context = new FinanceContextService(db, requests),
    analysis = new FinancialAnalysisService(db, requests, null),
    policy = new PolicyService(db, requests),
    automatic = options.automatic ?? true;
  const set = await policy.createSet(
      { code: `D7-${randomUUID()}`, name: "Day 7" },
      policyAdmin,
      "d7-set",
    ),
    version = await policy.createVersion(
      set.id,
      { effectiveFrom: "2020-01-01T00:00:00Z" },
      policyAdmin,
      "d7-version",
    );
  await policy.addRule(
    version.id,
    {
      code: `D7-R-${randomUUID()}`,
      name: "Day 7 route",
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
              reason: "Control route",
            },
          ],
      requiredEvidence: [],
      notificationMetadata: {},
      autoApprovalEligible: automatic,
    },
    policyAdmin,
    "d7-rule",
  );
  await policy.activate(version.id, policyAdmin, "d7-active");
  const draft = await requests.initiate(requester, "d7-init"),
    payee = options.payee ?? `Vendor ${randomUUID()}`;
  await requests.update(
    draft.id,
    {
      payee,
      purpose: "Final Finance Control",
      category: "Operations",
      amount: options.amount ?? "10.00",
      currency: "MYR",
      dueDate: "2026-10-15",
      paymentMethod: "BANK_TRANSFER",
      paymentDetails: "Verified beneficiary reference",
    },
    requester,
    "d7-update",
  );
  const request = await requests.submit(draft.id, requester, "d7-submit");
  await db.pool.query(
    `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by)
    VALUES($1,$2,$3,'invoice.pdf',$4,'application/pdf',20,$5,'INVOICE',1,$6)`,
    [
      randomUUID(),
      request.id,
      randomUUID(),
      `quarantine/tests/${randomUUID()}`,
      options.hash ??
        randomUUID()
          .replaceAll("", "")
          .replaceAll("-", "")
          .slice(0, 64)
          .padEnd(64, "a"),
      requester.id,
    ],
  );
  await validation.start(request.id, finance, "d7-validation");
  await validation.finalize(
    request.id,
    { overallResult: "PASS", remarks: "complete", findings: [] },
    finance,
    "d7-validation-pass",
  );
  await context.calculate(request.id, finance, "d7-context");
  await analysis.manual(
    request.id,
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
    "d7-analysis",
  );
  await policy.evaluate(request.id, finance, "d7-policy");
  const approvals = new ApprovalService(db, requests),
    view = await approvals.create(request.id, finance, "d7-approval");
  if (!automatic && !options.leavePending)
    await approvals.act(
      request.id,
      view.steps[0].id,
      { commandKey: randomUUID(), action: "APPROVE" },
      approver,
      "d7-human-approve",
    );
  return {
    request,
    requests,
    approval: view,
    service: new FinanceControlService(db, requests),
  };
}
async function confirmRequired(
  service: FinanceControlService,
  runId: string,
  actor = finance,
  possible = false,
) {
  const codes: FinanceConfirmationCode[] = [
    "PAYEE_VERIFIED",
    "PAYMENT_METHOD_VERIFIED",
    "PAYMENT_DETAILS_VERIFIED",
    "SUPPORTING_DOCUMENTS_VERIFIED",
  ];
  if (possible) codes.push("POSSIBLE_DUPLICATE_REVIEWED");
  for (const code of codes)
    await service.confirm(
      runId,
      { code, confirmed: true },
      actor,
      `confirm-${code}`,
    );
}
async function addEvidence(db: Postgres, id: string) {
  await db.pool.query(
    `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by)
 VALUES($1,$2,$3,'changed.pdf',$4,'application/pdf',20,$5,'CONTRACT',1,$6)`,
    [
      randomUUID(),
      id,
      randomUUID(),
      `quarantine/tests/${randomUUID()}`,
      randomUUID().replaceAll("-", "").repeat(2),
      requester.id,
    ],
  );
}
async function draftWithEvidence(db: Postgres, hash: string) {
  const requests = new PaymentRequestService(db),
    draft = await requests.initiate(requester, "duplicate-draft");
  await requests.update(
    draft.id,
    {
      payee: `Concurrent ${randomUUID()}`,
      purpose: "Duplicate barrier",
      category: "Operations",
      amount: "987.65",
      currency: "MYR",
      dueDate: "2026-10-20",
      paymentMethod: "BANK_TRANSFER",
      paymentDetails: "Verified beneficiary reference",
    },
    requester,
    "duplicate-draft-update",
  );
  await db.pool.query(
    `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by)
     VALUES($1,$2,$3,'duplicate.pdf',$4,'application/pdf',20,$5,'INVOICE',1,$6)`,
    [
      randomUUID(),
      draft.id,
      randomUUID(),
      `quarantine/tests/${randomUUID()}`,
      hash,
      requester.id,
    ],
  );
  return { requests, draft };
}
async function behindRequestLock<T>(
  db: Postgres,
  id: string,
  start: () => Promise<T>,
) {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT id FROM payment_requests WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    let settled = false;
    const work = start().finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(settled, false);
    await c.query("COMMIT");
    return await work;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

async function readyPayment(db: Postgres, label: string) {
  const fixture = await approved(db),
    run = (await fixture.service.start(fixture.request.id, finance, `${label}-start`)) as any;
  await confirmRequired(fixture.service, run.run.id);
  await fixture.service.finalize(run.run.id, { commandKey: randomUUID() }, finance, `${label}-ready`);
  const slipId = randomUUID();
  await db.paymentTransaction(finance.id, `${label}-slip`, (c) => c.query(
    "SELECT attach_payment_slip($1,$2,$3,'payment.pdf',$4,'application/pdf',20,$5)",
    [fixture.request.id, slipId, randomUUID(), `quarantine/tests/${randomUUID()}`, randomUUID().replaceAll("-", "").repeat(2)],
  ));
  return {
    fixture, run, slipId, service: new PaymentService(db, fixture.requests, {} as never),
    command: {
      commandKey: randomUUID(), paymentDate: new Date().toISOString().slice(0, 10),
      amount: "10.00", currency: "MYR", bankReference: `${label}-${randomUUID()}`,
      slipDocumentId: slipId, confirmPossibleDuplicate: false,
    },
  };
}

async function assertFailedPaymentClean(db: Postgres, requestId: string) {
  const state = (await db.pool.query(`SELECT pr.status,
    (SELECT count(*)::int FROM payments WHERE payment_request_id=pr.id) payments,
    (SELECT count(*)::int FROM financial_ledger_entries le JOIN payments p ON p.id=le.reference_id WHERE p.payment_request_id=pr.id AND le.reference_type='PAYMENT') ledger,
    (SELECT status FROM budget_commitments WHERE payment_request_id=pr.id ORDER BY created_at DESC LIMIT 1) commitment,
    (SELECT count(*)::int FROM audit_events WHERE entity_id=pr.id AND action IN('PAYMENT_RECORDED','COMMITMENT_CONSUMED','ACTUAL_LEDGER_POSTED','PAYMENT_REQUEST_PAID')) success_audits
    FROM payment_requests pr WHERE pr.id=$1`, [requestId])).rows[0];
  assert.deepEqual({ status: state.status, payments: state.payments, ledger: state.ledger, commitment: state.commitment, audits: state.success_audits },
    { status: "READY_FOR_PAYMENT", payments: 0, ledger: 0, commitment: "ACTIVE", audits: 0 });
}

async function assertPaymentOutcomeConsistent(db: Postgres, requestId: string) {
  const row = (await db.pool.query(`SELECT pr.status,p.id payment_id,p.amount_minor payment_amount,p.currency payment_currency,
    le.amount_minor ledger_amount,le.currency ledger_currency,bc.status commitment_status,bc.amount_minor commitment_amount,bc.currency commitment_currency,
    f.status control_status,(SELECT count(*)::int FROM payments WHERE payment_request_id=pr.id) payment_count,
    (SELECT count(*)::int FROM financial_ledger_entries x JOIN payments px ON px.id=x.reference_id WHERE px.payment_request_id=pr.id AND x.reference_type='PAYMENT') ledger_count
    FROM payment_requests pr LEFT JOIN payments p ON p.payment_request_id=pr.id LEFT JOIN financial_ledger_entries le ON le.id=p.ledger_entry_id
    LEFT JOIN budget_commitments bc ON bc.payment_request_id=pr.id AND(bc.id=p.commitment_id OR p.id IS NULL)
    LEFT JOIN finance_control_runs f ON f.id=p.finance_control_run_id WHERE pr.id=$1 ORDER BY bc.created_at DESC LIMIT 1`, [requestId])).rows[0];
  if (row.status === "PAID") {
    assert.equal(row.payment_count, 1); assert.equal(row.ledger_count, 1); assert.equal(row.commitment_status, "CONSUMED");
    assert.equal(String(row.payment_amount), String(row.ledger_amount)); assert.equal(String(row.payment_amount), String(row.commitment_amount));
    assert.equal(row.payment_currency, row.ledger_currency); assert.equal(row.payment_currency, row.commitment_currency); assert.equal(row.control_status, "PASSED");
  } else {
    assert.equal(row.payment_count, 0); assert.equal(row.ledger_count, 0); assert.notEqual(row.commitment_status, "CONSUMED");
  }
}

test("valid deterministic Finance Control passes with AI master off and stops before Payment", async () => {
  const old = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const db = new Postgres();
  try {
    const f = await approved(db),
      started = (await f.service.start(f.request.id, finance, "start")) as any;
    await confirmRequired(f.service, started.run.id);
    const result = (await f.service.finalize(
      started.run.id,
      { commandKey: randomUUID() },
      finance,
      "final",
    )) as any;
    assert.equal(result.readyForPayment, true);
    assert.equal(
      (await f.requests.get(f.request.id, requester)).status,
      "READY_FOR_PAYMENT",
    );
    const commitment = await db.pool.query(
      "SELECT status FROM budget_commitments WHERE approval_case_id=$1",
      [f.approval.case.id],
    );
    assert.equal(commitment.rows[0].status, "ACTIVE");
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int count FROM payments WHERE payment_request_id=$1",
          [f.request.id],
        )
      ).rows[0].count,
      0,
    );
    const duplicate = (await f.service.finalize(
      started.run.id,
      {
        commandKey: (
          await db.pool.query(
            "SELECT completed_command_key FROM finance_control_runs WHERE id=$1",
            [started.run.id],
          )
        ).rows[0].completed_command_key,
      },
      finance,
      "duplicate",
    )) as any;
    assert.equal(duplicate.idempotent, true);
  } finally {
    process.env.OPENAI_API_KEY = old;
    await db.onModuleDestroy();
  }
});

test("Finance Hold retains commitment and typed RECHECK creates a new current run", async () => {
  const db = new Postgres();
  try {
    const f = await approved(db),
      started = (await f.service.start(
        f.request.id,
        finance,
        "hold-start",
      )) as any;
    const held = (await f.service.finalize(
      started.run.id,
      { commandKey: randomUUID() },
      finance,
      "hold",
    )) as any;
    assert.equal(held.financeHold, true);
    assert.equal(
      (await f.requests.get(f.request.id, requester)).status,
      "FINANCE_HOLD",
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT status FROM budget_commitments WHERE approval_case_id=$1",
          [f.approval.case.id],
        )
      ).rows[0].status,
      "ACTIVE",
    );
    const recheck = (await f.service.resolve(
      started.run.id,
      { resolution: "RECHECK", note: "Operational checks completed" },
      finance,
      "resolve",
    )) as any;
    assert.equal(recheck.run.status, "CHECKING");
    await confirmRequired(f.service, recheck.run.id);
    assert.equal(
      (
        (await f.service.finalize(
          recheck.run.id,
          { commandKey: randomUUID() },
          finance,
          "repass",
        )) as any
      ).readyForPayment,
      true,
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("Finance Controller business authority enforces IDOR and segregation of duties", async () => {
  const db = new Postgres();
  try {
    const f = await approved(db);
    await assert.rejects(() =>
      f.service.start(f.request.id, requester, "self"),
    );
    await assert.rejects(() =>
      f.service.start(f.request.id, adminOnly, "admin"),
    );
    const started = (await f.service.start(
      f.request.id,
      finance,
      "allowed",
    )) as any;
    await assert.rejects(() => f.service.get(f.request.id, requester));
    assert.equal(
      ((await f.service.get(f.request.id, secondFinance)) as any).run.id,
      started.run.id,
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("barrier K: finalize replay remains authorized, run-bound, and authority-current", async () => {
  const db = new Postgres();
  try {
    const first = await approved(db),
      firstRun = (await first.service.start(
        first.request.id,
        finance,
        "replay-first-start",
      )) as any,
      commandKey = randomUUID();
    await confirmRequired(first.service, firstRun.run.id);
    await first.service.finalize(
      firstRun.run.id,
      { commandKey },
      finance,
      "replay-first-finalize",
    );
    const replay = (await first.service.finalize(
      firstRun.run.id,
      { commandKey },
      secondFinance,
      "replay-authorized",
    )) as any;
    assert.equal(replay.idempotent, true);
    assert.equal(replay.result, "PASS");
    assert.equal(replay.readyForPayment, true);
    await assert.rejects(() =>
      first.service.finalize(
        firstRun.run.id,
        { commandKey },
        requester,
        "replay-requester",
      ),
    );
    await assert.rejects(() =>
      first.service.finalize(
        firstRun.run.id,
        { commandKey },
        scopedFinance,
        "replay-wrong-scope",
      ),
    );
    await assert.rejects(() =>
      first.service.finalize(
        firstRun.run.id,
        { commandKey },
        revokedFinance,
        "replay-revoked",
      ),
    );
    await assert.rejects(() =>
      first.service.finalize(
        firstRun.run.id,
        { commandKey: randomUUID() },
        finance,
        "replay-random",
      ),
    );

    const second = await approved(db),
      secondRun = (await second.service.start(
        second.request.id,
        finance,
        "replay-second-start",
      )) as any;
    await assert.rejects(() =>
      second.service.finalize(
        secondRun.run.id,
        { commandKey },
        finance,
        "replay-cross-run",
      ),
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("read-only Finance Control detail and history do not wait on request row locks", async () => {
  const db = new Postgres();
  const blocker = await db.pool.connect();
  try {
    const f = await approved(db),
      run = (await f.service.start(
        f.request.id,
        finance,
        "read-lock-start",
      )) as any;
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT id FROM payment_requests WHERE id=$1 FOR UPDATE",
      [f.request.id],
    );
    const detail = (await Promise.race([
      f.service.get(f.request.id, finance),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("detail read blocked")), 250),
      ),
    ])) as any;
    const history = (await Promise.race([
      f.service.history(f.request.id, finance),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("history read blocked")), 250),
      ),
    ])) as any;
    assert.equal(detail.run.id, run.run.id);
    assert.equal(history.items.length >= 1, true);
    await blocker.query("ROLLBACK");
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await db.onModuleDestroy();
  }
});

test("eligibility rejects unfinished, rejected, stale, and uncommitted requests and DB blocks forced readiness", async () => {
  const db = new Postgres();
  try {
    const pending = await approved(db, {
      automatic: false,
      leavePending: true,
    });
    await assert.rejects(() =>
      pending.service.start(pending.request.id, finance, "pending-denied"),
    );

    const rejected = await approved(db);
    await db.pool.query(
      "UPDATE payment_requests SET status='REJECTED' WHERE id=$1",
      [rejected.request.id],
    );
    await assert.rejects(() =>
      rejected.service.start(rejected.request.id, finance, "rejected-denied"),
    );

    const stale = await approved(db);
    await db.pool.query(
      "UPDATE approval_cases SET status='SUPERSEDED',is_current=false WHERE payment_request_id=$1 AND is_current",
      [stale.request.id],
    );
    await assert.rejects(() =>
      stale.service.start(stale.request.id, finance, "stale-denied"),
    );

    const uncommitted = await approved(db);
    await db.pool.query(
      "UPDATE budget_commitments SET status='RELEASED',released_at=now(),release_reason='TEST' WHERE payment_request_id=$1 AND status='ACTIVE'",
      [uncommitted.request.id],
    );
    await assert.rejects(() =>
      uncommitted.service.start(
        uncommitted.request.id,
        finance,
        "missing-denied",
      ),
    );

    const forced = await approved(db);
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE payment_requests SET status='READY_FOR_PAYMENT' WHERE id=$1",
        [forced.request.id],
      ),
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("duplicate detection distinguishes confirmed, possible, and excluded rejected history", async () => {
  const db = new Postgres();
  try {
    const exactHash = randomUUID().replaceAll("-", "").repeat(2),
      activeHash = randomUUID().replaceAll("-", "").repeat(2),
      otherHash = randomUUID().replaceAll("-", "").repeat(2),
      payee = `Duplicate ${randomUUID()}`;
    const prior = await approved(db, {
      hash: exactHash,
      payee,
      amount: "12.00",
    });
    await db.pool.query(
      "UPDATE payment_requests SET status='REJECTED' WHERE id=$1",
      [prior.request.id],
    );
    const noBlock = await approved(db, {
        hash: exactHash,
        payee,
        amount: "12.00",
      }),
      noRun = (await noBlock.service.start(
        noBlock.request.id,
        finance,
        "no-duplicate",
      )) as any;
    assert.equal(noRun.run.duplicate_status, "NO_DUPLICATE");
    const active = await approved(db, {
      hash: activeHash,
      payee,
      amount: "12.00",
    });
    void active;
    const possible = await approved(db, {
        hash: otherHash,
        payee,
        amount: "12.00",
      }),
      possibleRun = (await possible.service.start(
        possible.request.id,
        finance,
        "possible",
      )) as any;
    assert.equal(possibleRun.run.duplicate_status, "POSSIBLE_DUPLICATE");
    const confirmed = await approved(db, {
        hash: activeHash,
        payee: `Exact ${randomUUID()}`,
        amount: "15.00",
      }),
      confirmedRun = (await confirmed.service.start(
        confirmed.request.id,
        finance,
        "confirmed",
      )) as any;
    assert.equal(confirmedRun.run.duplicate_status, "CONFIRMED_DUPLICATE");
    await confirmRequired(confirmed.service, confirmedRun.run.id);
    const held = (await confirmed.service.finalize(
      confirmedRun.run.id,
      { commandKey: randomUUID() },
      finance,
      "confirmed-hold",
    )) as any;
    assert.equal(held.failedCheckCodes.includes("DUPLICATE_INVOICE"), true);
  } finally {
    await db.onModuleDestroy();
  }
});

test("finalization refreshes duplicate truth and blocks newly confirmed evidence", async () => {
  const db = new Postgres();
  try {
    const hash = randomUUID().replaceAll("-", "").repeat(2),
      target = await approved(db, { hash }),
      run = (await target.service.start(
        target.request.id,
        finance,
        "fresh-duplicate-start",
      )) as any;
    assert.equal(run.run.duplicate_status, "NO_DUPLICATE");
    await confirmRequired(target.service, run.run.id);
    await approved(db, {
      hash,
      payee: `Different ${randomUUID()}`,
      amount: "765.43",
    });
    const result = (await target.service.finalize(
      run.run.id,
      { commandKey: randomUUID() },
      finance,
      "fresh-duplicate-finalize",
    )) as any;
    assert.equal(result.financeHold, true);
    assert.equal(result.failedCheckCodes.includes("DUPLICATE_INVOICE"), true);
    assert.equal(
      (
        await db.pool.query(
          "SELECT duplicate_status,duplicate_check_version,duplicate_checked_at FROM finance_control_runs WHERE id=$1",
          [run.run.id],
        )
      ).rows[0].duplicate_status,
      "CONFIRMED_DUPLICATE",
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("new confirmed evidence overrides a reviewed possible duplicate", async () => {
  const db = new Postgres();
  try {
    const payee = `Possible ${randomUUID()}`,
      hash = randomUUID().replaceAll("-", "").repeat(2);
    await approved(db, {
      hash: randomUUID().replaceAll("-", "").repeat(2),
      payee,
      amount: "44.00",
    });
    const target = await approved(db, { hash, payee, amount: "44.00" }),
      run = (await target.service.start(
        target.request.id,
        finance,
        "possible-refresh-start",
      )) as any;
    assert.equal(run.run.duplicate_status, "POSSIBLE_DUPLICATE");
    await confirmRequired(target.service, run.run.id, finance, true);
    await approved(db, {
      hash,
      payee: `Exact ${randomUUID()}`,
      amount: "99.00",
    });
    const result = (await target.service.finalize(
      run.run.id,
      { commandKey: randomUUID() },
      finance,
      "possible-refresh-finalize",
    )) as any;
    assert.equal(result.financeHold, true);
    assert.equal(result.failedCheckCodes.includes("DUPLICATE_INVOICE"), true);
  } finally {
    await db.onModuleDestroy();
  }
});

test("reviewed recurring similarity is not promoted to confirmed duplicate", async () => {
  const db = new Postgres();
  try {
    const payee = `Recurring ${randomUUID()}`;
    await approved(db, {
      hash: randomUUID().replaceAll("-", "").repeat(2),
      payee,
      amount: "71.00",
    });
    const target = await approved(db, {
        hash: randomUUID().replaceAll("-", "").repeat(2),
        payee,
        amount: "71.00",
      }),
      run = (await target.service.start(
        target.request.id,
        finance,
        "recurring-start",
      )) as any;
    await confirmRequired(target.service, run.run.id, finance, true);
    const result = (await target.service.finalize(
      run.run.id,
      { commandKey: randomUUID() },
      finance,
      "recurring-finalize",
    )) as any;
    assert.equal(result.readyForPayment, true);
    assert.equal(
      (
        await db.pool.query(
          "SELECT duplicate_status FROM finance_control_runs WHERE id=$1",
          [run.run.id],
        )
      ).rows[0].duplicate_status,
      "POSSIBLE_DUPLICATE",
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("application role cannot forge Finance Control terminal readiness", async () => {
  const db = new Postgres();
  try {
    const f = await approved(db),
      run = (await f.service.start(
        f.request.id,
        finance,
        "forgery-start",
      )) as any;
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE finance_control_runs SET status='PASSED' WHERE id=$1",
        [run.run.id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE payment_requests SET status='READY_FOR_PAYMENT' WHERE id=$1",
        [f.request.id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE finance_control_runs SET finalized_by=$2,finalized_at=now() WHERE id=$1",
        [run.run.id, finance.id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query("INSERT INTO finance_control_runs(id) VALUES($1)", [
        randomUUID(),
      ]),
    );
    await assert.rejects(() =>
      db.pool.query("INSERT INTO finance_control_checks(id) VALUES($1)", [
        randomUUID(),
      ]),
    );
    await assert.rejects(() =>
      db.pool.query(
        "INSERT INTO finance_control_confirmations(id) VALUES($1)",
        [randomUUID()],
      ),
    );
    await assert.rejects(() =>
      db.pool.query("INSERT INTO finance_control_exceptions(id) VALUES($1)", [
        randomUUID(),
      ]),
    );
    await assert.rejects(() =>
      db.pool.query("SELECT complete_finance_control_pass($1,$2)", [
        run.run.id,
        randomUUID(),
      ]),
    );
    const attacker = await db.pool.connect();
    try {
      await attacker.query("BEGIN");
      await attacker.query("SELECT set_config('aims.user_id',$1,true)", [
        finance.id,
      ]);
      await assert.rejects(() =>
        attacker.query("SELECT complete_finance_control_pass($1,$2)", [
          run.run.id,
          randomUUID(),
        ]),
      );
      await attacker.query("ROLLBACK");
      await assert.rejects(() =>
        attacker.query("SET ROLE aims_finance_executor"),
      );
    } finally {
      attacker.release();
    }
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE finance_control_runs SET status='PASSED' WHERE id=$1",
        [run.run.id],
      ),
    );
    await confirmRequired(f.service, run.run.id);
    assert.equal(
      (
        (await f.service.finalize(
          run.run.id,
          { commandKey: randomUUID() },
          finance,
          "forgery-valid",
        )) as any
      ).readyForPayment,
      true,
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE finance_control_runs SET duplicate_status='CONFIRMED_DUPLICATE' WHERE id=$1",
        [run.run.id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE finance_control_checks SET result='FAIL' WHERE finance_control_run_id=$1",
        [run.run.id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE finance_control_confirmations SET confirmed=false WHERE finance_control_run_id=$1",
        [run.run.id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "INSERT INTO finance_control_checks(id,finance_control_run_id,code,source,result) VALUES($1,$2,'POST_PASS_FORGERY','SYSTEM','FAIL')",
        [randomUUID(), run.run.id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "DELETE FROM finance_control_exceptions WHERE finance_control_run_id=$1",
        [run.run.id],
      ),
    );
    await assert.rejects(() =>
      db.financeTransaction(finance.id, "privileged-post-pass-mutation", (c) =>
        c.query(
          "INSERT INTO finance_control_checks(id,finance_control_run_id,code,source,result) VALUES($1,$2,'PRIVILEGED_POST_PASS','SYSTEM','FAIL')",
          [randomUUID(), run.run.id],
        ),
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false WHERE id=$1",
        [run.run.id],
      ),
    );
    assert.equal(
      (await f.requests.get(f.request.id, requester)).status,
      "READY_FOR_PAYMENT",
    );
    await db.pool.query(
      "UPDATE budget_commitments SET status='RELEASED',released_at=now(),release_reason='FORGERY_TEST' WHERE payment_request_id=$1 AND status='ACTIVE'",
      [f.request.id],
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE payment_requests SET status='READY_FOR_PAYMENT' WHERE id=$1",
        [f.request.id],
      ),
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("Finance Hold resolution rejects whitespace-only notes", async () => {
  const db = new Postgres();
  try {
    const f = await approved(db),
      run = (await f.service.start(
        f.request.id,
        finance,
        "blank-note-start",
      )) as any;
    await f.service.finalize(
      run.run.id,
      { commandKey: randomUUID() },
      finance,
      "blank-note-hold",
    );
    await assert.rejects(() =>
      f.service.resolve(
        run.run.id,
        { resolution: "RECHECK", note: "   " },
        finance,
        "blank-note-resolve",
      ),
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("post-PASS evidence and material changes supersede control, clear readiness, and release commitment", async () => {
  for (const kind of ["evidence", "material", "policy"] as const) {
    const db = new Postgres();
    try {
      const f = await approved(db),
        run = (await f.service.start(
          f.request.id,
          finance,
          `stale-${kind}`,
        )) as any;
      await confirmRequired(f.service, run.run.id);
      await f.service.finalize(
        run.run.id,
        { commandKey: randomUUID() },
        finance,
        "pass",
      );
      if (kind === "evidence") await addEvidence(db, f.request.id);
      else if (kind === "material")
        await db.pool.query(
          "UPDATE payment_requests SET amount=amount+1 WHERE id=$1",
          [f.request.id],
        );
      else
        await db.pool.query(
          "UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=$1 AND is_current",
          [f.request.id],
        );
      assert.equal(
        (await f.requests.get(f.request.id, requester)).status,
        "SUBMITTED",
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT status FROM finance_control_runs WHERE id=$1",
            [run.run.id],
          )
        ).rows[0].status,
        "SUPERSEDED",
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT status FROM budget_commitments WHERE approval_case_id=$1",
            [f.approval.case.id],
          )
        ).rows[0].status,
        "RELEASED",
      );
    } finally {
      await db.onModuleDestroy();
    }
  }
});

test("barrier G: duplicate Finance Control creation yields one current run", async () => {
  const db = new Postgres();
  try {
    const f = await approved(db),
      runs = (await behindRequestLock(db, f.request.id, () =>
        Promise.all([
          f.service.start(f.request.id, finance, "g1"),
          f.service.start(f.request.id, secondFinance, "g2"),
        ]),
      )) as any[];
    assert.equal(runs[0].run.id, runs[1].run.id);
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int count FROM finance_control_runs WHERE payment_request_id=$1 AND is_current",
          [f.request.id],
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("barrier A: two Finance controllers finalize one run exactly once", async () => {
  const db = new Postgres();
  try {
    const f = await approved(db),
      run = (await f.service.start(f.request.id, finance, "a-start")) as any;
    await confirmRequired(f.service, run.run.id);
    const outcomes = await behindRequestLock(db, f.request.id, () =>
      Promise.allSettled([
        f.service.finalize(
          run.run.id,
          { commandKey: randomUUID() },
          finance,
          "a1",
        ),
        f.service.finalize(
          run.run.id,
          { commandKey: randomUUID() },
          secondFinance,
          "a2",
        ),
      ]),
    );
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(
      (await f.requests.get(f.request.id, requester)).status,
      "READY_FOR_PAYMENT",
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("barrier B: PASS versus HOLD has one serialized result", async () => {
  const db = new Postgres();
  try {
    const f = await approved(db),
      run = (await f.service.start(f.request.id, finance, "b-start")) as any;
    await confirmRequired(f.service, run.run.id);
    const outcomes = await behindRequestLock(db, f.request.id, () =>
      Promise.allSettled([
        f.service.finalize(
          run.run.id,
          { commandKey: randomUUID() },
          finance,
          "b-pass",
        ),
        f.service.confirm(
          run.run.id,
          { code: "PAYEE_VERIFIED", confirmed: false },
          secondFinance,
          "b-fail",
        ),
      ]),
    );
    assert.equal(
      outcomes.filter((x) => x.status === "fulfilled").length >= 1,
      true,
    );
    assert.equal(
      ["READY_FOR_PAYMENT", "FINANCE_HOLD"].includes(
        (await f.requests.get(f.request.id, requester)).status,
      ),
      true,
    );
  } finally {
    await db.onModuleDestroy();
  }
});

for (const [label, mutate] of [
  [
    "C: PASS versus evidence mutation",
    async (db: Postgres, id: string) => addEvidence(db, id),
  ],
  [
    "D: PASS versus material mutation",
    async (db: Postgres, id: string) => {
      await db.pool.query(
        "UPDATE payment_requests SET payee='Changed during control' WHERE id=$1",
        [id],
      );
    },
  ],
  [
    "E: PASS versus Approval invalidation",
    async (db: Postgres, id: string) => {
      await db.pool.query(
        "UPDATE approval_cases SET status='SUPERSEDED',is_current=false WHERE payment_request_id=$1 AND is_current",
        [id],
      );
    },
  ],
  [
    "F: PASS versus commitment release",
    async (db: Postgres, id: string) => {
      await db.pool.query(
        "UPDATE budget_commitments SET status='RELEASED',released_at=now(),release_reason='TEST_RACE' WHERE payment_request_id=$1 AND status='ACTIVE'",
        [id],
      );
    },
  ],
] as const)
  test(`barrier ${label} preserves readiness invariants`, async () => {
    const db = new Postgres();
    try {
      const f = await approved(db),
        run = (await f.service.start(
          f.request.id,
          finance,
          `race-${label}`,
        )) as any;
      await confirmRequired(f.service, run.run.id);
      await behindRequestLock(db, f.request.id, () =>
        Promise.allSettled([
          f.service.finalize(
            run.run.id,
            { commandKey: randomUUID() },
            finance,
            "race-pass",
          ),
          mutate(db, f.request.id),
        ]),
      );
      const state = await db.pool.query(
        `SELECT pr.status,f.status control_status,ac.status approval_status,count(bc.id) FILTER(WHERE bc.status='ACTIVE')::int active_commitments FROM payment_requests pr
 LEFT JOIN finance_control_runs f ON f.id=$2 LEFT JOIN approval_cases ac ON ac.id=$3 LEFT JOIN budget_commitments bc ON bc.approval_case_id=ac.id WHERE pr.id=$1 GROUP BY pr.status,f.status,ac.status`,
        [f.request.id, run.run.id, f.approval.case.id],
      );
      assert.equal(
        state.rows[0].status === "READY_FOR_PAYMENT" &&
          (state.rows[0].control_status !== "PASSED" ||
            state.rows[0].approval_status !== "APPROVED" ||
            state.rows[0].active_commitments !== 1),
        false,
      );
    } finally {
      await db.onModuleDestroy();
    }
  });

test("barrier H: finalize versus new duplicate evidence cannot leave stale readiness", async () => {
  const db = new Postgres();
  try {
    const hash = randomUUID().replaceAll("-", "").repeat(2),
      target = await approved(db, { hash }),
      run = (await target.service.start(
        target.request.id,
        finance,
        "barrier-h-start",
      )) as any,
      candidate = await draftWithEvidence(db, hash);
    await confirmRequired(target.service, run.run.id);
    const outcomes = await Promise.allSettled([
      target.service.finalize(
        run.run.id,
        { commandKey: randomUUID() },
        finance,
        "barrier-h-finalize",
      ),
      candidate.requests.submit(
        candidate.draft.id,
        requester,
        "barrier-h-submit",
      ),
    ]);
    const state = await db.pool.query(
      `SELECT pr.status,f.status control_status,f.is_current FROM payment_requests pr
       JOIN finance_control_runs f ON f.id=$2 WHERE pr.id=$1`,
      [target.request.id, run.run.id],
    );
    if (outcomes[1].status === "fulfilled")
      assert.equal(
        state.rows[0].status === "READY_FOR_PAYMENT" &&
          state.rows[0].control_status === "PASSED" &&
          state.rows[0].is_current,
        false,
      );
    else
      assert.equal(
        outcomes[0].status === "fulfilled" ||
          state.rows[0].status !== "READY_FOR_PAYMENT",
        true,
      );
  } finally {
    await db.onModuleDestroy();
  }
});

test("barrier I: direct PASS forgery loses to controlled finalization", async () => {
  const db = new Postgres();
  try {
    const f = await approved(db),
      run = (await f.service.start(
        f.request.id,
        finance,
        "barrier-i-start",
      )) as any;
    await confirmRequired(f.service, run.run.id);
    const outcomes = await Promise.allSettled([
      db.pool.query(
        "UPDATE finance_control_runs SET status='PASSED' WHERE id=$1",
        [run.run.id],
      ),
      f.service.finalize(
        run.run.id,
        { commandKey: randomUUID() },
        finance,
        "barrier-i-finalize",
      ),
    ]);
    assert.equal(
      outcomes.filter((x) => x.status === "rejected").length >= 1,
      true,
    );
    assert.equal(
      (await f.requests.get(f.request.id, requester)).status,
      "READY_FOR_PAYMENT",
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("barrier J: finalization versus Policy invalidation preserves the full authority chain", async () => {
  const db = new Postgres();
  try {
    const f = await approved(db),
      run = (await f.service.start(
        f.request.id,
        finance,
        "barrier-j-start",
      )) as any;
    await confirmRequired(f.service, run.run.id);
    await Promise.allSettled([
      f.service.finalize(
        run.run.id,
        { commandKey: randomUUID() },
        finance,
        "barrier-j-finalize",
      ),
      db.pool.query(
        "UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=$1 AND is_current",
        [f.request.id],
      ),
    ]);
    const state = await db.pool.query(
      `SELECT pr.status,f.status control_status,ac.status approval_status,bc.status commitment_status
       FROM payment_requests pr JOIN finance_control_runs f ON f.id=$2
       JOIN approval_cases ac ON ac.id=$3 JOIN budget_commitments bc ON bc.approval_case_id=ac.id WHERE pr.id=$1`,
      [f.request.id, run.run.id, f.approval.case.id],
    );
    assert.equal(
      state.rows[0].status === "READY_FOR_PAYMENT" &&
        (state.rows[0].control_status !== "PASSED" ||
          state.rows[0].approval_status !== "APPROVED" ||
          state.rows[0].commitment_status !== "ACTIVE"),
      false,
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("barrier L: inverse dependent mutation fails fast without deadlock", async () => {
  const db = new Postgres(),
    first = await db.pool.connect();
  try {
    const f = await approved(db);
    await first.query("BEGIN");
    await first.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      f.request.id,
    ]);
    await first.query(
      "SELECT id FROM payment_requests WHERE id=$1 FOR UPDATE",
      [f.request.id],
    );
    const inverse = await Promise.race([
      db.pool
        .query(
          "UPDATE budget_commitments SET release_reason='INVERSE_TEST' WHERE payment_request_id=$1 AND status='ACTIVE'",
          [f.request.id],
        )
        .then(() => "unexpected-success")
        .catch(() => "retry-required"),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("deadlock-timeout"), 500),
      ),
    ]);
    assert.equal(inverse, "retry-required");
    await first.query(
      "UPDATE budget_commitments SET release_reason='SERIAL_OWNER' WHERE payment_request_id=$1 AND status='ACTIVE'",
      [f.request.id],
    );
    await first.query("COMMIT");
  } finally {
    await first.query("ROLLBACK").catch(() => undefined);
    first.release();
    await db.onModuleDestroy();
  }
});

test("DAY_8_2_PAYMENT_ATOMIC_FAILURE_INJECTION_MATRIX rolls back every posting boundary and remains retryable", async () => {
  const points = [
    "AFTER_PAYMENT_INSERT", "AFTER_LEDGER_INSERT", "AFTER_COMMITMENT_CONSUMPTION",
    "BEFORE_REQUEST_PAID", "AFTER_REQUEST_PAID_BEFORE_COMMIT", "BEFORE_SUCCESS_AUDIT",
  ];
  for (const point of points) {
    const db = new Postgres();
    try {
      const f = await readyPayment(db, point), beforeLedger = Number((await db.pool.query("SELECT count(*) FROM financial_ledger_entries")).rows[0].count);
      await assert.rejects(() => db.paymentTransaction(finance.id, `fault-${point}`, async (c) => {
        await c.query("SELECT set_config('aims.test_payment_fault',$1,true)", [point]);
        await c.query("SELECT record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
          f.fixture.request.id, randomUUID(), f.command.commandKey, f.command.paymentDate, 1000,
          f.command.currency, f.command.bankReference, f.command.slipDocumentId, f.command.confirmPossibleDuplicate,
        ]);
      }, f.command.commandKey), new RegExp(point));
      await assertFailedPaymentClean(db, f.fixture.request.id);
      assert.equal(Number((await db.pool.query("SELECT count(*) FROM financial_ledger_entries")).rows[0].count), beforeLedger);
      const paid = await f.service.record(f.fixture.request.id, f.command, finance, `retry-${point}`) as any;
      assert.ok(paid.id);
      const success = (await db.pool.query("SELECT action,count(*)::int count FROM audit_events WHERE entity_id=$1 AND action IN('PAYMENT_RECORDED','COMMITMENT_CONSUMED','ACTUAL_LEDGER_POSTED','PAYMENT_REQUEST_PAID') GROUP BY action", [f.fixture.request.id])).rows;
      assert.equal(success.length, 4); assert.equal(success.every((x: any) => x.count === 1), true);
    } finally { await db.onModuleDestroy(); }
  }
});

test("PAYMENT_POST_COMMIT_RESPONSE_LOSS returns the original identity without duplicate effects", async () => {
  const db = new Postgres();
  try {
    const f = await readyPayment(db, "response-loss"), first = await f.service.record(f.fixture.request.id, f.command, finance, "response-lost") as any;
    const replay = await f.service.record(f.fixture.request.id, f.command, finance, "response-retry") as any;
    assert.equal(replay.id, first.id);
    await assert.rejects(() => f.service.record(f.fixture.request.id, { ...f.command, bankReference: `${f.command.bankReference}-changed` }, finance, "response-conflict"), /IDEMPOTENCY_CONFLICT/);
    const facts = (await db.pool.query(`SELECT
      (SELECT count(*)::int FROM payments WHERE payment_request_id=$1) payments,
      (SELECT count(*)::int FROM financial_ledger_entries WHERE reference_type='PAYMENT' AND reference_id=$2) ledger,
      (SELECT count(*)::int FROM budget_commitments WHERE payment_request_id=$1 AND status='CONSUMED') consumed,
      (SELECT count(*)::int FROM audit_events WHERE entity_id=$1 AND action IN('PAYMENT_RECORDED','COMMITMENT_CONSUMED','ACTUAL_LEDGER_POSTED','PAYMENT_REQUEST_PAID')) audits`, [f.fixture.request.id, first.id])).rows[0];
    assert.deepEqual(facts, { payments: 1, ledger: 1, consumed: 1, audits: 4 });
  } finally { await db.onModuleDestroy(); }
});

test("Day 8 records external payment atomically, idempotently, and immutably", async () => {
  const db = new Postgres();
  try {
    const fixture = await approved(db),
      run = (await fixture.service.start(
        fixture.request.id,
        finance,
        "d8-start",
      )) as any;
    await confirmRequired(fixture.service, run.run.id);
    await fixture.service.finalize(
      run.run.id,
      { commandKey: randomUUID() },
      finance,
      "d8-ready",
    );
    const slipId = randomUUID();
    await db.paymentTransaction(finance.id, "d8-slip", (c) =>
      c.query(
        "SELECT attach_payment_slip($1,$2,$3,'payment.pdf',$4,'application/pdf',20,$5)",
        [
          fixture.request.id,
          slipId,
          randomUUID(),
          `quarantine/tests/${randomUUID()}`,
          randomUUID().replaceAll("-", "").repeat(2),
        ],
      ),
    );
    const service = new PaymentService(db, fixture.requests, {} as never),
      commandKey = randomUUID(),
      bankReference = `D8-${randomUUID()}`;
    const before = (
      await db.pool.query(
        "SELECT COALESCE(sum(amount_minor),0)::bigint actual,(SELECT COALESCE(sum(amount_minor),0)::bigint FROM budget_commitments WHERE budget_id=$1 AND status='ACTIVE') committed FROM financial_ledger_entries WHERE budget_id=$1",
        [
          run.run.commitment_id
            ? (
                await db.pool.query(
                  "SELECT budget_id FROM budget_commitments WHERE id=$1",
                  [run.run.commitment_id],
                )
              ).rows[0].budget_id
            : (
                await db.pool.query(
                  "SELECT budget_id FROM budget_commitments WHERE payment_request_id=$1 AND status='ACTIVE'",
                  [fixture.request.id],
                )
              ).rows[0].budget_id,
        ],
      )
    ).rows[0];
    await assert.rejects(() =>
      service.record(
        fixture.request.id,
        {
          commandKey: randomUUID(),
          paymentDate: new Date().toISOString().slice(0, 10),
          amount: "9.99",
          currency: "MYR",
          bankReference: `BAD-${randomUUID()}`,
          slipDocumentId: slipId,
          confirmPossibleDuplicate: false,
        },
        finance,
        "d8-bad-amount",
      ),
    );
    assert.equal(
      Number(
        (
          await db.pool.query(
            "SELECT count(*) FROM payments WHERE payment_request_id=$1",
            [fixture.request.id],
          )
        ).rows[0].count,
      ),
      0,
    );
    await assert.rejects(() =>
      service.record(
        fixture.request.id,
        {
          commandKey: randomUUID(),
          paymentDate: new Date().toISOString().slice(0, 10),
          amount: "10.00",
          currency: "MYR",
          bankReference: `NOAUTH-${randomUUID()}`,
          slipDocumentId: slipId,
          confirmPossibleDuplicate: false,
        },
        requester,
        "d8-noauth",
      ),
    );
    const first = (await service.record(
      fixture.request.id,
      {
        commandKey,
        paymentDate: new Date().toISOString().slice(0, 10),
        amount: "10.00",
        currency: "MYR",
        bankReference,
        slipDocumentId: slipId,
        confirmPossibleDuplicate: false,
      },
      finance,
      "d8-record",
    )) as any;
    const replay = (await service.record(
      fixture.request.id,
      {
        commandKey,
        paymentDate: new Date().toISOString().slice(0, 10),
        amount: "10.00",
        currency: "MYR",
        bankReference,
        slipDocumentId: slipId,
        confirmPossibleDuplicate: false,
      },
      finance,
      "d8-replay",
    )) as any;
    assert.equal(replay.id, first.id);
    const originalCommand = {
      commandKey,
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: "10.00",
      currency: "MYR",
      bankReference,
      slipDocumentId: slipId,
      confirmPossibleDuplicate: false,
    };
    for (const changed of [
      { paymentDate: "2020-01-01" },
      { amount: "10.01" },
      { currency: "USD" },
      { bankReference: `${bankReference}-CHANGED` },
      { slipDocumentId: randomUUID() },
      { confirmPossibleDuplicate: true },
    ])
      await assert.rejects(
        () => service.record(fixture.request.id, { ...originalCommand, ...changed }, finance, "d8-fingerprint-conflict"),
        /IDEMPOTENCY_CONFLICT/,
      );
    const normalizedReplay = await service.record(
      fixture.request.id,
      { ...originalCommand, bankReference: `  ${bankReference.toLowerCase()}  ` },
      finance,
      "d8-normalized-replay",
    ) as any;
    assert.equal(normalizedReplay.id, first.id);

    for (const unauthorized of [requester, adminOnly, approver, scopedFinance, revokedFinance, inactivePayment, revokedPayment])
      await assert.rejects(
        () => service.record(fixture.request.id, originalCommand, unauthorized, "d8-unauthorized-replay"),
        /(authority|authenticated)/i,
      );
    const facts = (
      await db.pool.query(
        `SELECT pr.status,p.id payment_id,bc.status commitment_status,bc.payment_id commitment_payment_id,le.id ledger_id,le.amount_minor,p.amount_minor payment_amount
      FROM payment_requests pr JOIN payments p ON p.payment_request_id=pr.id JOIN budget_commitments bc ON bc.id=p.commitment_id JOIN financial_ledger_entries le ON le.id=p.ledger_entry_id WHERE pr.id=$1`,
        [fixture.request.id],
      )
    ).rows[0];
    assert.equal(facts.status, "PAID");
    assert.equal(facts.commitment_status, "CONSUMED");
    assert.equal(facts.commitment_payment_id, facts.payment_id);
    assert.equal(String(facts.payment_amount), String(facts.amount_minor));
    const after = (
      await db.pool.query(
        "SELECT COALESCE(sum(amount_minor),0)::bigint actual,(SELECT COALESCE(sum(amount_minor),0)::bigint FROM budget_commitments WHERE budget_id=$1 AND status='ACTIVE') committed FROM financial_ledger_entries WHERE budget_id=$1",
        [
          (
            await db.pool.query(
              "SELECT budget_id FROM budget_commitments WHERE payment_id=$1",
              [first.id],
            )
          ).rows[0].budget_id,
        ],
      )
    ).rows[0];
    assert.equal(BigInt(after.actual) - BigInt(before.actual), 1000n);
    assert.equal(BigInt(before.committed) - BigInt(after.committed), 1000n);
    const history = await service.list(finance, { page: 1, pageSize: 25, search: first.ticketNumber });
    assert.equal(
      history.items.some((x: any) => x.id === first.id),
      true,
    );
    for (const filter of [
      { search: first.ticketNumber }, { search: bankReference }, { payee: first.payee, search: first.ticketNumber },
      { departmentId: first.departmentId, search: first.ticketNumber }, { category: first.category, search: first.ticketNumber },
      { dateFrom: new Date().toISOString().slice(0, 10), search: first.ticketNumber },
      { dateTo: new Date().toISOString().slice(0, 10), search: first.ticketNumber },
      { status: "PAID", search: first.ticketNumber },
    ]) {
      const filtered = await service.list(finance, { page: 1, pageSize: 25, ...filter } as any);
      assert.equal(filtered.items.some((x: any) => x.id === first.id), true, JSON.stringify(filter));
    }
    const firstPage = await service.list(finance, { page: 1, pageSize: 1 });
    assert.equal(firstPage.items.length, 1); assert.equal(firstPage.total >= 1, true);
    assert.match(
      ((await service.get(first.id, requester)) as any).bankReference,
      /^••••/,
    );
    await assert.rejects(() => service.get(first.id, adminOnly));
    assert.match(
      await service.export(finance, { page: 1, pageSize: 25 }),
      /Ticket Number/,
    );
    assert.match(await service.export(finance, { page: 1, pageSize: 25, search: first.ticketNumber }), new RegExp(first.ticketNumber));
    await assert.rejects(() => service.export(approver, { page: 1, pageSize: 25 }), /authority/i);
    await assert.rejects(() =>
      db.pool.query("INSERT INTO payments(id) VALUES($1)", [randomUUID()]),
    );
    await assert.rejects(() =>
      db.pool.query("INSERT INTO financial_ledger_entries(id) VALUES($1)", [
        randomUUID(),
      ]),
    );
    await assert.rejects(() =>
      db.pool.query("UPDATE payments SET bank_reference='FORGED' WHERE id=$1", [
        first.id,
      ]),
    );
    await assert.rejects(() =>
      db.pool.query("DELETE FROM payments WHERE id=$1", [first.id]),
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE financial_ledger_entries SET amount_minor=1 WHERE id=$1",
        [facts.ledger_id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE budget_commitments SET status='ACTIVE' WHERE payment_id=$1",
        [first.id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE payment_requests SET payee='Changed after payment' WHERE id=$1",
        [fixture.request.id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE payment_documents SET removed_at=now() WHERE id=$1",
        [slipId],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE payment_requests SET status='PAID' WHERE id<>$1 AND status='APPROVED'",
        [fixture.request.id],
      ),
    );
    await assert.rejects(() =>
      db.pool.query(
        "SELECT record_payment($1,$2,$3,current_date,1000,'MYR','FORGED',$4,false)",
        [fixture.request.id, randomUUID(), randomUUID(), slipId],
      ),
    );
    const attacker = await db.pool.connect();
    try {
      await attacker.query("BEGIN");
      await attacker.query("SELECT set_config('aims.user_id',$1,true)", [
        finance.id,
      ]);
      await assert.rejects(() =>
        attacker.query(
          "SELECT record_payment($1,$2,$3,current_date,1000,'MYR','FORGED',$4,false)",
          [fixture.request.id, randomUUID(), randomUUID(), slipId],
        ),
      );
      await attacker.query("ROLLBACK");
      await assert.rejects(() =>
        attacker.query("SET ROLE aims_payment_executor"),
      );
    } finally {
      attacker.release();
    }
  } finally {
    await db.onModuleDestroy();
  }
});

for (const [name, mutate] of [
  ["PAYMENT_RACE_B_EVIDENCE_MUTATION", async (db: Postgres, f: any) => addEvidence(db, f.fixture.request.id)],
  ["PAYMENT_RACE_C_MATERIAL_REQUEST_MUTATION", async (db: Postgres, f: any) => db.pool.query("UPDATE payment_requests SET payee=payee||' changed' WHERE id=$1", [f.fixture.request.id])],
  ["PAYMENT_RACE_D_COMMITMENT_RELEASE", async (db: Postgres, f: any) => db.pool.query("UPDATE budget_commitments SET status='RELEASED',released_at=now(),release_reason='PAYMENT_RACE' WHERE payment_request_id=$1 AND status='ACTIVE'", [f.fixture.request.id])],
  ["PAYMENT_RACE_E_FINANCE_CONTROL_SUPERSESSION", async (db: Postgres, f: any) => db.pool.query("UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=$1 AND is_current", [f.fixture.request.id])],
] as const) test(name, async () => {
  const db = new Postgres();
  try {
    const f = await readyPayment(db, name);
    const outcomes = await behindRequestLock(db, f.fixture.request.id, () => Promise.allSettled([
      f.service.record(f.fixture.request.id, f.command, finance, `${name}-payment`), mutate(db, f),
    ]));
    assert.equal(outcomes.some((x) => x.status === "fulfilled"), true);
    await assertPaymentOutcomeConsistent(db, f.fixture.request.id);
  } finally { await db.onModuleDestroy(); }
});

test("PAYMENT_RACE_F_SAME_BANK_REFERENCE_DIFFERENT_REQUESTS", async () => {
  const db = new Postgres(), blocker = await db.pool.connect();
  try {
    const a = await readyPayment(db, "race-f-a"), b = await readyPayment(db, "race-f-b"), reference = `SHARED-${randomUUID()}`;
    a.command.bankReference = reference; b.command.bankReference = reference;
    await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(hashtext('AIMS_DUPLICATE_CONTROL'))");
    let settled = false;
    const work = Promise.allSettled([
      a.service.record(a.fixture.request.id, a.command, finance, "race-f-a"),
      b.service.record(b.fixture.request.id, b.command, secondFinance, "race-f-b"),
    ]).finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 25)); assert.equal(settled, false); await blocker.query("COMMIT");
    const outcomes = await work; assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    await assertPaymentOutcomeConsistent(db, a.fixture.request.id); await assertPaymentOutcomeConsistent(db, b.fixture.request.id);
  } finally { await blocker.query("ROLLBACK").catch(() => undefined); blocker.release(); await db.onModuleDestroy(); }
});

test("PAYMENT_RACE_G_DUPLICATE_CANDIDATE_INSERTION", async () => {
  const db = new Postgres(), blocker = await db.pool.connect();
  try {
    const f = await readyPayment(db, "race-g");
    const candidate = await f.fixture.requests.initiate(requester, "race-g-candidate");
    await f.fixture.requests.update(candidate.id, {
      payee: String(f.fixture.request.payee), purpose: "New duplicate candidate", category: String(f.fixture.request.category),
      amount: String(f.fixture.request.amount), currency: String(f.fixture.request.currency), dueDate: "2030-01-01",
      paymentMethod: String(f.fixture.request.paymentMethod), paymentDetails: "Candidate",
    }, requester, "race-g-capture");
    await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(hashtext('AIMS_DUPLICATE_CONTROL'))");
    let settled = false;
    const work = Promise.allSettled([
      f.service.record(f.fixture.request.id, f.command, finance, "race-g-payment"),
      f.fixture.requests.submit(candidate.id, requester, "race-g-submit"),
    ]).finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 25)); assert.equal(settled, false); await blocker.query("COMMIT");
    const outcomes = await work;
    assert.equal(outcomes.some((x) => x.status === "fulfilled"), true); await assertPaymentOutcomeConsistent(db, f.fixture.request.id);
  } finally { await blocker.query("ROLLBACK").catch(() => undefined); blocker.release(); await db.onModuleDestroy(); }
});

test("PAYMENT_RACE_H_POST_COMMIT_RETRY", async () => {
  const db = new Postgres();
  try {
    const f = await readyPayment(db, "race-h"), first = await f.service.record(f.fixture.request.id, f.command, finance, "race-h-commit") as any;
    const results = await behindRequestLock(db, f.fixture.request.id, () => Promise.all([
      f.service.record(f.fixture.request.id, f.command, finance, "race-h-1"), f.service.record(f.fixture.request.id, f.command, secondFinance, "race-h-2"),
      f.service.record(f.fixture.request.id, f.command, finance, "race-h-3"),
    ])) as any[];
    assert.equal(results.every((x) => x.id === first.id), true); await assertPaymentOutcomeConsistent(db, f.fixture.request.id);
  } finally { await db.onModuleDestroy(); }
});

test("PAYMENT_RACE_A_SAME_REQUEST_TWO_OPERATORS produces one record and one ledger posting", async () => {
  const db = new Postgres();
  try {
    const fixture = await approved(db),
      run = (await fixture.service.start(
        fixture.request.id,
        finance,
        "d8-race-start",
      )) as any;
    await confirmRequired(fixture.service, run.run.id);
    await fixture.service.finalize(
      run.run.id,
      { commandKey: randomUUID() },
      finance,
      "d8-race-ready",
    );
    const slipId = randomUUID();
    await db.paymentTransaction(finance.id, "d8-race-slip", (c) =>
      c.query(
        "SELECT attach_payment_slip($1,$2,$3,'race.pdf',$4,'application/pdf',20,$5)",
        [
          fixture.request.id,
          slipId,
          randomUUID(),
          `quarantine/tests/${randomUUID()}`,
          randomUUID().replaceAll("-", "").repeat(2),
        ],
      ),
    );
    const service = new PaymentService(db, fixture.requests, {} as never),
      base = {
        paymentDate: new Date().toISOString().slice(0, 10),
        amount: "10.00",
        currency: "MYR",
        bankReference: `RACE-${randomUUID()}`,
        slipDocumentId: slipId,
        confirmPossibleDuplicate: false,
      };
    const results = await behindRequestLock(db, fixture.request.id, () => Promise.allSettled([
      service.record(
        fixture.request.id,
        { ...base, commandKey: randomUUID() },
        finance,
        "d8-race-a",
      ),
      service.record(
        fixture.request.id,
        { ...base, commandKey: randomUUID() },
        secondFinance,
        "d8-race-b",
      ),
    ]));
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    const counts = (
      await db.pool.query(
        "SELECT(SELECT count(*) FROM payments WHERE payment_request_id=$1) payments,(SELECT count(*) FROM financial_ledger_entries WHERE reference_type='PAYMENT' AND reference_id IN(SELECT id FROM payments WHERE payment_request_id=$1)) ledger",
        [fixture.request.id],
      )
    ).rows[0];
    assert.equal(Number(counts.payments), 1);
    assert.equal(Number(counts.ledger), 1);
  } finally {
    await db.onModuleDestroy();
  }
});
