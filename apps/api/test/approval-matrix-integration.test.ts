import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ApprovalService } from "../src/application/approval/approval.service.js";
import { ApprovalMatrixService } from "../src/application/approval-matrix/approval-matrix.service.js";
import { ApprovalDelegationService } from "../src/application/approval-delegation/approval-delegation.service.js";
import { FinanceContextService } from "../src/application/finance-context/finance-context.service.js";
import { FinancialAnalysisService } from "../src/application/financial-analysis/financial-analysis.service.js";
import { PaymentRequestService } from "../src/application/payment-requests/payment-request.service.js";
import { ClaimItemService } from "../src/application/claim-items/claim-item.service.js";
import { PolicyService } from "../src/application/policy/policy.service.js";
import { ValidationService } from "../src/application/validation/validation.service.js";
import type { Principal } from "../src/domain/payment-request.js";
import { Postgres } from "../src/infrastructure/database/postgres.js";

type ApprovalStep = { id: string; status: string; sequence: number; parallel_group: number | null };

process.env.TELEGRAM_APPROVAL_ENABLED = "false";

const requester: Principal = { id: "10000000-0000-4000-8000-000000000001", departmentId: "00000000-0000-4000-8000-000000000001", roles: ["REQUESTER"] };
const finance: Principal = { id: "10000000-0000-4000-8000-000000000002", departmentId: "00000000-0000-4000-8000-000000000002", roles: ["FINANCE"] };
const admin: Principal = { ...finance, roles: ["ADMIN"] };
const financeMaster: Principal = { ...finance, roles: ["FINANCE_MASTER"] };
// Seeded synthetic local-dev fixtures (migrations 014/017): both hold AM/DEPARTMENT
// authority over department 00000000-...-000000000001; `insufficient` holds only
// a low-ceiling AM grant and no DIRECTOR authority, making it a clean delegate target.
const approver: Principal = { id: "10000000-0000-4000-8000-000000000004", departmentId: requester.departmentId, roles: ["REQUESTER"] };
const secondApprover: Principal = { id: "10000000-0000-4000-8000-000000000008", departmentId: requester.departmentId, roles: ["REQUESTER"] };
const insufficient: Principal = { id: "10000000-0000-4000-8000-000000000005", departmentId: requester.departmentId, roles: ["REQUESTER"] };

async function eligibleRequest(db: Postgres, amount = "20000.00") {
  const requests = new PaymentRequestService(db),
    validation = new ValidationService(db, requests, {} as never, null),
    context = new FinanceContextService(db, requests),
    analysis = new FinancialAnalysisService(db, requests, null),
    policy = new PolicyService(db, requests);
  const set = await policy.createSet({ code: `P20.5F-${randomUUID()}`, name: "Matrix integration synthetic" }, admin, "matrix-policy-set"),
    version = await policy.createVersion(set.id, { effectiveFrom: "2020-01-01T00:00:00Z" }, admin, "matrix-policy-version");
  // Policy still gates whether approval applies at all; its own step content
  // is a placeholder here since a matching published Approval Matrix rule
  // takes over the actual routing once Policy says approval is required.
  await policy.addRule(
    version.id,
    {
      code: "MATRIX-GATE",
      name: "Approval required, routed by matrix",
      priority: 1,
      effect: "REQUIRE_APPROVAL",
      conditions: { currencies: ["MYR"] },
      approvalSteps: [{ sequence: 1, requiredRole: "AM", authorityScope: "DEPARTMENT", mandatory: true, reason: "Policy placeholder" }],
      requiredEvidence: [],
      notificationMetadata: {},
      autoApprovalEligible: false,
    },
    admin,
    "matrix-policy-rule",
  );
  await policy.activate(version.id, admin, "matrix-policy-active");
  const d = await requests.initiate(requester, "matrix-i");
  await requests.update(
    d.id,
    { payee: "Synthetic Vendor", purpose: "Matrix integration", dueDate: "2026-09-30", paymentMethod: "BANK_TRANSFER", paymentDetails: "Synthetic" },
    requester,
    "matrix-u",
  );
  await new ClaimItemService(db, requests).create(d.id, { category: "Operations", departmentId: requester.departmentId, currency: "MYR", amount }, requester, "matrix-claim");
  const r = await requests.submit(d.id, requester, "matrix-s");
  await db.pool.query(
    `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference,storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key,trusted_storage_object_version) VALUES($1,$2,$3,'approval.pdf',$4,'application/pdf',20,$5,'INVOICE',1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean','VERSION_BOUND','test-fixture',gen_random_uuid()::text,$4,gen_random_uuid()::text)`,
    [randomUUID(), r.id, randomUUID(), `quarantine/tests/${randomUUID()}`, randomUUID().replaceAll("-", "").repeat(2), requester.id],
  );
  await validation.start(r.id, finance, "matrix-v");
  await validation.finalize(r.id, { overallResult: "PASS", remarks: "complete", findings: [] }, finance, "matrix-vf");
  await context.calculate(r.id, finance, "matrix-c");
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
      evidenceReferences: [{ source: "FINANCE_CONTEXT", reference: "current", field: "projected_available_amount_minor" }],
    },
    finance,
    "matrix-a",
  );
  await policy.evaluate(r.id, finance, "matrix-p");
  return { r, requests };
}

test("Approval Matrix routes a published parallel-approval rule and pins the matrix version on the case", async () => {
  const db = new Postgres();
  try {
    const matrix = new ApprovalMatrixService(db),
      delegations = new ApprovalDelegationService(db),
      request = ({ ip: "203.0.113.1", correlationId: "matrix-it" }) as never;
    await matrix.saveDraft(
      {
        routingEnabled: true,
        rules: [
          {
            id: randomUUID(),
            code: "DUAL-AM-THEN-DIRECTOR",
            name: "Dual AM sign-off then Director",
            priority: 1,
            active: true,
            isFallback: false,
            conditionLogic: "ALL",
            conditions: { currencies: ["MYR"] },
            financeReviewRequired: false,
            aiAnalysisRequired: false,
            steps: [
              { sequence: 1, parallelGroup: 1, requiredApprovals: 2, requiredRole: "AM", authorityScope: "DEPARTMENT", mandatory: true, reason: "Dual AM sign-off" },
              { sequence: 1, parallelGroup: 1, requiredApprovals: 2, requiredRole: "AM", authorityScope: "DEPARTMENT", mandatory: true, reason: "Dual AM sign-off" },
              { sequence: 2, parallelGroup: null, requiredApprovals: null, requiredRole: "DIRECTOR", authorityScope: "ORGANIZATION", mandatory: true, reason: "Final authority" },
            ],
            effectiveFrom: "2020-01-01",
            effectiveTo: null,
          },
        ],
      },
      financeMaster,
      request,
    );
    const published = await matrix.publish("go live for integration test", financeMaster, request);
    assert.equal(published.version, 1);

    const { r, requests } = await eligibleRequest(db);
    const service = new ApprovalService(db, requests, matrix, delegations);
    const created = await service.create(r.id, finance, "matrix-create");
    assert.ok(created.case.approval_matrix_version_id, "case should pin the matrix version that routed it");
    const activeSteps = created.steps.filter((s: ApprovalStep) => s.status === "ACTIVE");
    assert.equal(activeSteps.length, 2, "both parallel steps should activate together");
    assert.ok(activeSteps.every((s: ApprovalStep) => s.sequence === 1 && s.parallel_group === 1));

    // First parallel approver acts: group threshold (2) not yet met, case stays pending.
    const first = await service.act(r.id, activeSteps[0].id, { commandKey: randomUUID(), action: "APPROVE" }, approver, "matrix-act-1");
    assert.equal(first.approval!.case.status, "PENDING");
    const afterFirst = first.approval!.steps.find((s: ApprovalStep) => s.id === activeSteps[1].id);
    assert.equal(afterFirst.status, "ACTIVE", "the sibling parallel step remains active");

    // Second parallel approver acts: group threshold met, advances to the DIRECTOR step.
    const second = await service.act(r.id, activeSteps[1].id, { commandKey: randomUUID(), action: "APPROVE" }, secondApprover, "matrix-act-2");
    assert.equal(second.approval!.case.status, "PENDING");
    const directorStep = second.approval!.steps.find((s: ApprovalStep) => s.sequence === 2);
    assert.equal(directorStep.status, "ACTIVE");

    const final = await service.act(r.id, directorStep.id, { commandKey: randomUUID(), action: "APPROVE" }, finance, "matrix-act-3");
    assert.equal(final.approval!.case.status, "APPROVED");
    assert.equal((final.approval as { commitmentStatus: string }).commitmentStatus, "ACTIVE");
  } finally {
    await db.pool.end();
  }
});

test("an active Approval Delegation lets the delegate act, and audit records both identities", async () => {
  const db = new Postgres();
  try {
    const matrix = new ApprovalMatrixService(db),
      delegations = new ApprovalDelegationService(db),
      request = ({ ip: "203.0.113.2", correlationId: "delegation-it" }) as never;
    await matrix.saveDraft(
      {
        routingEnabled: true,
        rules: [
          {
            id: randomUUID(),
            code: "DIRECTOR-ONLY",
            name: "Director sign-off",
            priority: 1,
            active: true,
            isFallback: false,
            conditionLogic: "ALL",
            conditions: { currencies: ["MYR"] },
            financeReviewRequired: false,
            aiAnalysisRequired: false,
            steps: [{ sequence: 1, parallelGroup: null, requiredApprovals: null, requiredRole: "DIRECTOR", authorityScope: "ORGANIZATION", mandatory: true, reason: "Final authority" }],
            effectiveFrom: "2020-01-01",
            effectiveTo: null,
          },
        ],
      },
      financeMaster,
      request,
    );
    await matrix.publish("go live for delegation test", financeMaster, request);

    const today = new Date().toISOString().slice(0, 10);
    await delegations.create(
      { delegateFrom: finance.id, delegateTo: insufficient.id, startDate: today, endDate: "2099-12-31", reason: "Director is on leave" },
      financeMaster,
      request,
    );

    const { r, requests } = await eligibleRequest(db);
    const service = new ApprovalService(db, requests, matrix, delegations);
    const created = await service.create(r.id, finance, "delegation-create");
    const step = created.steps.find((s: ApprovalStep) => s.status === "ACTIVE");

    const result = await service.act(r.id, step.id, { commandKey: randomUUID(), action: "APPROVE" }, insufficient, "delegation-act");
    assert.equal(result.approval!.case.status, "APPROVED");

    const audit = await db.pool.query<{ safe_metadata: { delegatedFrom?: string } }>(
      `SELECT safe_metadata FROM audit_events WHERE action='APPROVAL_CASE_COMPLETED' AND entity_id=$1`,
      [r.id],
    );
    assert.equal(audit.rows[0]?.safe_metadata?.delegatedFrom, finance.id, "audit should record the original approver behind the delegate's action");
  } finally {
    await db.pool.end();
  }
});
