import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { FinanceContextService } from "../src/application/finance-context/finance-context.service.js";
import { FinancialAnalysisService } from "../src/application/financial-analysis/financial-analysis.service.js";
import { PaymentRequestService } from "../src/application/payment-requests/payment-request.service.js";
import {
  PolicyService,
  fingerprintEvidence,
} from "../src/application/policy/policy.service.js";
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
const approvalRule = (code: string) => ({
  code,
  name: code,
  priority: 500,
  effect: "REQUIRE_APPROVAL",
  conditions: { currencies: ["MYR"] },
  approvalSteps: [
    {
      sequence: 1,
      requiredRole: "AM",
      authorityScope: "DEPARTMENT",
      mandatory: true,
      reason: "Test policy",
    },
  ],
  requiredEvidence: [],
  notificationMetadata: {},
  autoApprovalEligible: false,
});
async function activateFixture(service: PolicyService) {
  const set = await service.createSet(
      { code: `FIXTURE-${randomUUID()}`, name: "Synthetic test policy" },
      admin,
      "fixture-set",
    ),
    version = await service.createVersion(
      set.id,
      { effectiveFrom: "2020-01-01T00:00:00Z" },
      admin,
      "fixture-version",
    );
  await service.addRule(
    version.id,
    {
      code: "HIGH-EXCEPTION",
      name: "High risk exception",
      priority: 10,
      effect: "REQUIRE_JUSTIFICATION",
      conditions: { riskLevels: ["HIGH", "CRITICAL"] },
      approvalSteps: [],
      requiredEvidence: [],
      notificationMetadata: {},
      autoApprovalEligible: false,
      exceptionCode: "HIGH_RISK_JUSTIFICATION",
      exceptionReason: "High risk requires justification",
      justificationRole: "FINANCE",
    },
    admin,
    "fixture-high",
  );
  await service.addRule(
    version.id,
    {
      code: "LOW-SAFE",
      name: "Low risk safe",
      priority: 100,
      effect: "ALLOW_NO_APPROVAL",
      conditions: { amountMinorMax: "100000", riskLevels: ["LOW"] },
      approvalSteps: [],
      requiredEvidence: [],
      notificationMetadata: {},
      autoApprovalEligible: true,
    },
    admin,
    "fixture-low",
  );
  await service.activate(version.id, admin, "fixture-active");
}
async function eligible(
  db: Postgres,
  requests: PaymentRequestService,
  risk: "LOW" | "HIGH",
) {
  const validation = new ValidationService(db, requests, {} as never, null),
    context = new FinanceContextService(db, requests),
    analysis = new FinancialAnalysisService(db, requests, null);
  const d = await requests.initiate(requester, "d5-i");
  await requests.update(
    d.id,
    {
      payee: "Vendor",
      purpose: "Policy test",
      category: "Operations",
      amount: "10.00",
      currency: "MYR",
      dueDate: "2026-09-30",
      paymentMethod: "BANK_TRANSFER",
      paymentDetails: "Synthetic",
    },
    requester,
    "d5-u",
  );
  const r = await requests.submit(d.id, requester, "d5-s");
  await db.pool.query(
    `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference,storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key,trusted_storage_object_version)VALUES($1,$2,$3,'x.pdf',$4,'application/pdf',20,$5,'INVOICE',1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean','VERSION_BOUND','test-fixture',gen_random_uuid()::text,$4,gen_random_uuid()::text)`,
    [
      randomUUID(),
      r.id,
      randomUUID(),
      `quarantine/tests/${randomUUID()}`,
      randomUUID().replaceAll("-", "").repeat(2),
      requester.id,
    ],
  );
  await validation.start(r.id, finance, "d5-v");
  await validation.finalize(
    r.id,
    { overallResult: "PASS", remarks: "complete", findings: [] },
    finance,
    "d5-vf",
  );
  await context.calculate(r.id, finance, "d5-c");
  await analysis.manual(
    r.id,
    {
      riskLevel: risk,
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
    "d5-a",
  );
  return r;
}
test("policy uses human-final risk, creates POLICY exception, stores justification, and creates no approval", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    service = new PolicyService(db, requests);
  try {
    await activateFixture(service);
    const r = await eligible(db, requests, "HIGH");
    const result = await service.evaluate(r.id, finance, "d5-e");
    assert.equal(result.result, "JUSTIFICATION_REQUIRED");
    assert.equal(result.ready_for_approval, false);
    assert.equal(result.evaluated_input.humanFinalRisk, "HIGH");
    assert.equal(result.exception_status, "OPEN");
    const requestedAudit = await db.pool.query(
      "SELECT count(*)::int count FROM audit_events WHERE action='POLICY_JUSTIFICATION_REQUESTED' AND entity_id=$1",
      [r.id],
    );
    assert.equal(requestedAudit.rows[0].count, 1);
    const response = await service.justify(
      r.id,
      result.exception_id,
      { justification: "Finance-controlled reason" },
      finance,
      "d5-j",
    );
    assert.equal(response.reevaluationRequired, true);
    const reevaluated = await service.evaluate(r.id, finance, "d5-re");
    assert.equal(reevaluated.result, "PASS");
    assert.equal(reevaluated.ready_for_approval, true);
    assert.equal(
      reevaluated.evaluated_input.policyJustificationExceptionId,
      result.exception_id,
    );
    const approval = await db.pool.query(
      "SELECT count(*)::int count FROM approval_cases WHERE payment_request_id=$1",
      [r.id],
    );
    assert.equal(approval.rows[0].count, 0);
  } finally {
    await db.onModuleDestroy();
  }
});
test("duplicate deterministic evaluation is idempotent, AI-free and only marks readiness", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    service = new PolicyService(db, requests);
  try {
    await activateFixture(service);
    const r = await eligible(db, requests, "LOW");
    const [a, b] = await Promise.all([
      service.evaluate(r.id, finance, "d5-c1"),
      service.evaluate(r.id, finance, "d5-c2"),
    ]);
    assert.equal(a.id, b.id);
    assert.equal(a.auto_approval_eligible, true);
    const count = await db.pool.query(
      "SELECT count(*)::int count FROM policy_decision_runs WHERE payment_request_id=$1 AND is_current",
      [r.id],
    );
    assert.equal(count.rows[0].count, 1);
    assert.equal((await requests.get(r.id, requester)).status, "VALIDATING");
  } finally {
    await db.onModuleDestroy();
  }
});
test("requester cannot administer or evaluate policy", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    service = new PolicyService(db, requests);
  try {
    await assert.rejects(() => service.list(requester));
    await assert.rejects(() =>
      service.evaluate(randomUUID(), requester, "d5-no"),
    );
  } finally {
    await db.onModuleDestroy();
  }
});
test("active evidence changes supersede the decision while historical evidence identity remains readable", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    service = new PolicyService(db, requests);
  try {
    const r = await eligible(db, requests, "LOW"),
      decision = await service.evaluate(r.id, finance, "d51-e");
    assert.match(decision.evidence_fingerprint, /^[0-9a-f]{64}$/);
    const addedId = randomUUID(),
      addedLogicalId = randomUUID();
    await db.pool.query(
      `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference,storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key,trusted_storage_object_version) VALUES($1,$2,$3,'new.pdf',$4,'application/pdf',20,$5,'CONTRACT',1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean','VERSION_BOUND','test-fixture',gen_random_uuid()::text,$4,gen_random_uuid()::text)`,
      [
        addedId,
        r.id,
        addedLogicalId,
        `quarantine/tests/${randomUUID()}`,
        randomUUID().replaceAll("-", "").repeat(2),
        requester.id,
      ],
    );
    await assert.rejects(() => service.get(r.id, finance, false));
    const history = await service.get(r.id, finance, true);
    assert.equal(history[0].id, decision.id);
    assert.equal(history[0].is_current, false);
    assert.equal(history[0].stale, true);
    assert.equal(history[0].ready_for_approval, false);
    const afterAdd = await service.evaluate(r.id, finance, "d51-after-add");
    assert.notEqual(
      afterAdd.evidence_fingerprint,
      decision.evidence_fingerprint,
    );
    await db.pool.query(
      "UPDATE payment_documents SET removed_at=now() WHERE id=$1",
      [addedId],
    );
    await assert.rejects(() => service.get(r.id, finance, false));
    const afterRemoval = await service.evaluate(
      r.id,
      finance,
      "d51-after-remove",
    );
    await assert.rejects(() =>
      db.pool.query(
        "UPDATE payment_documents SET document_type='HISTORICAL_ONLY' WHERE id=$1",
        [addedId],
      ),
    );
    assert.equal((await service.get(r.id, finance, false)).id, afterRemoval.id);
    const active = await db.pool.query<{
      id: string;
      logical_document_id: string;
      document_type: string | null;
      version: number;
    }>(
      "SELECT * FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL ORDER BY uploaded_at LIMIT 1",
      [r.id],
    );
    await db.transaction(async (c) => {
      await c.query(
        "UPDATE payment_documents SET removed_at=now() WHERE id=$1",
        [active.rows[0].id],
      );
      await c.query(
        `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference,storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key,trusted_storage_object_version) VALUES($1,$2,$3,'replacement.pdf',$4,'application/pdf',20,$5,$6,$7,$8,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean','VERSION_BOUND','test-fixture',gen_random_uuid()::text,$4,gen_random_uuid()::text)`,
        [
          randomUUID(),
          r.id,
          active.rows[0].logical_document_id,
          `quarantine/tests/${randomUUID()}`,
          randomUUID().replaceAll("-", "").repeat(2),
          active.rows[0].document_type,
          Number(active.rows[0].version) + 1,
          requester.id,
        ],
      );
    });
    await assert.rejects(() => service.get(r.id, finance, false));
  } finally {
    await db.onModuleDestroy();
  }
});
test("evidence revision versus evaluation serializes on the request lock", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    service = new PolicyService(db, requests);
  try {
    const r = await eligible(db, requests, "LOW"),
      blocker = await db.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT id FROM policy_versions WHERE status='ACTIVE' FOR UPDATE",
    );
    const evaluating = service.evaluate(r.id, finance, "d51-evidence-race");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const probe = await db.pool.connect();
    await probe.query("BEGIN");
    await assert.rejects(() =>
      probe.query(
        "SELECT id FROM payment_requests WHERE id=$1 FOR UPDATE NOWAIT",
        [r.id],
      ),
    );
    await probe.query("ROLLBACK");
    probe.release();
    let mutationFinished = false;
    const mutation = db.pool
      .query(
        `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference,storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key,trusted_storage_object_version) VALUES($1,$2,$3,'race.pdf',$4,'application/pdf',20,$5,'CONTRACT',1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean','VERSION_BOUND','test-fixture',gen_random_uuid()::text,$4,gen_random_uuid()::text)`,
        [
          randomUUID(),
          r.id,
          randomUUID(),
          `quarantine/tests/${randomUUID()}`,
          randomUUID().replaceAll("-", "").repeat(2),
          requester.id,
        ],
      )
      .then((value) => {
        mutationFinished = true;
        return value;
      });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(mutationFinished, false);
    await blocker.query("COMMIT");
    blocker.release();
    await evaluating;
    await mutation;
    await assert.rejects(() => service.get(r.id, finance, false));
    const decision = await service.evaluate(r.id, finance, "d52-after-race");
    const evidence = await db.pool.query<{
      id: string;
      logical_document_id: string;
      version: number;
      document_type: string | null;
      sha256: string;
    }>(
      "SELECT id,logical_document_id,version,document_type,sha256 FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL ORDER BY logical_document_id,version,id",
      [r.id],
    );
    assert.equal(
      decision.evidence_fingerprint,
      fingerprintEvidence(evidence.rows),
    );
    assert.ok(decision.evaluated_input.evidenceTypes.includes("CONTRACT"));
  } finally {
    await db.onModuleDestroy();
  }
});
test("rule creation versus activation has exactly one valid serial outcome", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    service = new PolicyService(db, requests);
  try {
    const set = await service.createSet(
        { code: `RACE-${randomUUID()}`, name: "Race" },
        admin,
        "d51-set",
      ),
      version = await service.createVersion(
        set.id,
        { effectiveFrom: "2020-01-01T00:00:00Z" },
        admin,
        "d51-version",
      );
    await service.addRule(version.id, approvalRule("BASE"), admin, "d51-base");
    const ruleAudit = await db.pool.query(
      "SELECT count(*)::int count FROM audit_events WHERE action='POLICY_RULE_CREATED' AND entity_type='POLICY_RULE' AND safe_metadata->>'policyVersionId'=$1",
      [version.id],
    );
    assert.equal(ruleAudit.rows[0].count, 1);
    const blocker = await db.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT id FROM policy_versions WHERE id=$1 FOR UPDATE",
      [version.id],
    );
    const adding = service.addRule(
        version.id,
        { ...approvalRule("RACING"), conditions: { currencies: ["USD"] } },
        admin,
        "d51-add",
      ),
      activating = service.activate(version.id, admin, "d51-activate");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await blocker.query("COMMIT");
    blocker.release();
    const outcomes = await Promise.allSettled([adding, activating]);
    assert.equal(outcomes[1].status, "fulfilled");
    const state = await db.pool.query(
      "SELECT status FROM policy_versions WHERE id=$1",
      [version.id],
    );
    assert.equal(state.rows[0].status, "ACTIVE");
    const racing = await db.pool.query(
      "SELECT count(*)::int count FROM policy_rules WHERE policy_version_id=$1 AND code='RACING'",
      [version.id],
    );
    assert.equal(
      racing.rows[0].count,
      outcomes[0].status === "fulfilled" ? 1 : 0,
    );
    await assert.rejects(() =>
      db.pool.query(
        `INSERT INTO policy_rules(id,policy_version_id,code,name,priority,effect,conditions,approval_steps,required_evidence,auto_approval_eligible) VALUES($1,$2,'LATE','Late',900,'ALLOW_NO_APPROVAL','{}','[]','[]',true)`,
        [randomUUID(), version.id],
      ),
    );
  } finally {
    await db.onModuleDestroy();
  }
});
test("simultaneous global activations serialize and preserve one active version", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    service = new PolicyService(db, requests);
  try {
    const drafts = [];
    for (const suffix of ["A", "B"]) {
      const set = await service.createSet(
          {
            code: `ACT-${suffix}-${randomUUID()}`,
            name: `Activation ${suffix}`,
          },
          admin,
          `d51-s-${suffix}`,
        ),
        version = await service.createVersion(
          set.id,
          { effectiveFrom: "2020-01-01T00:00:00Z" },
          admin,
          `d51-v-${suffix}`,
        );
      await service.addRule(
        version.id,
        approvalRule(`RULE-${suffix}`),
        admin,
        `d51-r-${suffix}`,
      );
      drafts.push(version.id);
    }
    const blocker = await db.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT pg_advisory_xact_lock(hashtext('AIMS_GLOBAL_POLICY'))",
    );
    const attempts = drafts.map((id, index) =>
      service.activate(id, admin, `d51-act-${index}`),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await blocker.query("COMMIT");
    blocker.release();
    const outcomes = await Promise.allSettled(attempts);
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 2);
    const active = await db.pool.query(
      "SELECT count(*)::int count FROM policy_versions WHERE status='ACTIVE'",
    );
    assert.equal(active.rows[0].count, 1);
  } finally {
    await db.onModuleDestroy();
  }
});
test("explicit retirement preserves history, audits, and produces controlled no-policy evaluation", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    service = new PolicyService(db, requests);
  try {
    const active = await db.pool.query<{ id: string }>(
      "SELECT id FROM policy_versions WHERE status='ACTIVE'",
    );
    const r = await eligible(db, requests, "LOW"),
      blocker = await db.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT id FROM policy_versions WHERE id=$1 FOR UPDATE",
      [active.rows[0].id],
    );
    const retiring = service.retire(active.rows[0].id, admin, "d51-retire"),
      evaluating = service.evaluate(r.id, finance, "d51-none");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await blocker.query("COMMIT");
    blocker.release();
    const retired = await retiring,
      decision = await evaluating;
    assert.equal(retired.status, "RETIRED");
    const row = await db.pool.query(
      "SELECT retired_by,retired_at FROM policy_versions WHERE id=$1",
      [active.rows[0].id],
    );
    assert.equal(row.rows[0].retired_by, admin.id);
    assert.ok(row.rows[0].retired_at);
    assert.equal(decision.result, "NO_APPLICABLE_POLICY");
    const audit = await db.pool.query(
      "SELECT count(*)::int count FROM audit_events WHERE action='POLICY_VERSION_RETIRED' AND entity_type='POLICY_VERSION' AND entity_id=$1",
      [active.rows[0].id],
    );
    assert.equal(audit.rows[0].count, 1);
    const set = await service.createSet(
        { code: `RESTORE-${randomUUID()}`, name: "Restored test policy" },
        admin,
        "d51-restore-set",
      ),
      version = await service.createVersion(
        set.id,
        { effectiveFrom: "2020-01-01T00:00:00Z" },
        admin,
        "d51-restore-version",
      );
    await service.addRule(
      version.id,
      approvalRule("RESTORE"),
      admin,
      "d51-restore-rule",
    );
    await service.activate(version.id, admin, "d51-restore-active");
  } finally {
    await db.onModuleDestroy();
  }
});
test("policy lifecycle metadata and activated or retired rules are immutable", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    service = new PolicyService(db, requests);
  try {
    const set = await service.createSet(
        { code: `LIFE-${randomUUID()}`, name: "Lifecycle" },
        admin,
        "life-set",
      ),
      version = await service.createVersion(
        set.id,
        { effectiveFrom: "2020-01-01T00:00:00Z" },
        admin,
        "life-version",
      ),
      rule = await service.addRule(
        version.id,
        approvalRule("LIFECYCLE"),
        admin,
        "life-rule",
      );
    await service.activate(version.id, admin, "life-active");
    const active = await db.pool.query(
      "SELECT * FROM policy_versions WHERE id=$1",
      [version.id],
    );
    assert.equal(active.rows[0].status, "ACTIVE");
    for (const statement of [
      {
        sql: "UPDATE policy_versions SET status='DRAFT' WHERE id=$1",
        args: [version.id],
      },
      {
        sql: "UPDATE policy_versions SET activated_at=activated_at+interval '1 second' WHERE id=$1",
        args: [version.id],
      },
      {
        sql: "UPDATE policy_versions SET activated_by=$2 WHERE id=$1",
        args: [version.id, requester.id],
      },
      {
        sql: "UPDATE policy_rules SET priority=priority+1 WHERE id=$1",
        args: [rule.id],
      },
    ])
      await assert.rejects(() => db.pool.query(statement.sql, statement.args));
    await service.retire(version.id, admin, "life-retire");
    const retired = await db.pool.query(
      "SELECT * FROM policy_versions WHERE id=$1",
      [version.id],
    );
    assert.equal(retired.rows[0].status, "RETIRED");
    for (const statement of [
      {
        sql: "UPDATE policy_versions SET status='ACTIVE' WHERE id=$1",
        args: [version.id],
      },
      {
        sql: "UPDATE policy_versions SET status='DRAFT' WHERE id=$1",
        args: [version.id],
      },
      {
        sql: "UPDATE policy_versions SET retired_at=retired_at+interval '1 second' WHERE id=$1",
        args: [version.id],
      },
      {
        sql: "UPDATE policy_versions SET retired_by=$2 WHERE id=$1",
        args: [version.id, requester.id],
      },
      {
        sql: "UPDATE policy_versions SET activated_at=activated_at+interval '1 second' WHERE id=$1",
        args: [version.id],
      },
      {
        sql: "UPDATE policy_versions SET activated_by=$2 WHERE id=$1",
        args: [version.id, requester.id],
      },
      {
        sql: "UPDATE policy_rules SET priority=priority+1 WHERE id=$1",
        args: [rule.id],
      },
      { sql: "DELETE FROM policy_rules WHERE id=$1", args: [rule.id] },
    ])
      await assert.rejects(() => db.pool.query(statement.sql, statement.args));
    await activateFixture(service);
  } finally {
    await db.onModuleDestroy();
  }
});
test("concurrent NO_APPLICABLE_POLICY evaluation reuses one equivalent decision", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    service = new PolicyService(db, requests);
  try {
    await activateFixture(service);
    const active = await db.pool.query<{ id: string }>(
      "SELECT id FROM policy_versions WHERE status='ACTIVE'",
    );
    await service.retire(active.rows[0].id, admin, "none-retire");
    const r = await eligible(db, requests, "LOW"),
      [a, b] = await Promise.all([
        service.evaluate(r.id, finance, "none-a"),
        service.evaluate(r.id, finance, "none-b"),
      ]);
    assert.equal(a.id, b.id);
    assert.equal(a.result, "NO_APPLICABLE_POLICY");
    assert.ok(a.reused || b.reused);
    const count = await db.pool.query(
      "SELECT count(*)::int count FROM policy_decision_runs WHERE payment_request_id=$1 AND is_current",
      [r.id],
    );
    assert.equal(count.rows[0].count, 1);
    await activateFixture(service);
  } finally {
    await db.onModuleDestroy();
  }
});
test("application role cannot physically delete payment documents", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db);
  try {
    const r = await eligible(db, requests, "LOW"),
      document = await db.pool.query<{ id: string }>(
        "SELECT id FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL LIMIT 1",
        [r.id],
      );
    await assert.rejects(() =>
      db.pool.query("DELETE FROM payment_documents WHERE id=$1", [
        document.rows[0].id,
      ]),
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int count FROM payment_documents WHERE id=$1",
          [document.rows[0].id],
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await db.onModuleDestroy();
  }
});

test("missing policy CONTRACT opens one executable clarification and returns through new validation to Policy",async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');
  const os=await import('node:os');
  const {default:path}=await import('node:path');
  const {default:pg}=await import('pg');
  const {PaymentDocumentService}=await import('../src/application/documents/payment-document.service.js');
  const {LocalDocumentStorage}=await import('../src/infrastructure/storage/local-document-storage.js');
  const {DeterministicLocalMalwareScanner}=await import('../src/infrastructure/security/deterministic-local-malware-scanner.js');
  const {DocumentScanWorker}=await import('../src/worker/document-scan-worker.js');
  const root=await mkdtemp(path.join(os.tmpdir(),'aims-policy-clarification-'));
  const db=new Postgres(),requests=new PaymentRequestService(db),policy=new PolicyService(db,requests);
  const storage=new LocalDocumentStorage({rootPath:root,maxUploadBytes:10485760,allowedContentTypes:new Set(['application/pdf']),demoMode:true});
  const pool=new pg.Pool({connectionString:process.env.DOCUMENT_WORKER_DATABASE_URL});
  const worker=new DocumentScanWorker(pool,storage,new DeterministicLocalMalwareScanner(),{
    workerId:'policy-evidence-test',pollIntervalMs:100,batchSize:10,leaseSeconds:120,maximumAttempts:3,retryDelaySeconds:1,
    storageTimeoutMs:1000,scannerTimeoutMs:1000,shutdownGraceMs:1000,telegramEnabled:false,scannerEnabled:true,
  });
  try{
    const set=await policy.createSet({code:`P164-${randomUUID()}`,name:'Required contract'},admin,'p164-set');
    const version=await policy.createVersion(set.id,{effectiveFrom:'2020-01-01T00:00:00Z'},admin,'p164-version');
    await policy.addRule(version.id,{...approvalRule('CONTRACT'),requiredEvidence:['CONTRACT']},admin,'p164-rule');
    await policy.activate(version.id,admin,'p164-active');
    const r=await eligible(db,requests,'LOW');
    const original=(await db.pool.query('SELECT to_jsonb(v) value FROM validation_runs v WHERE payment_request_id=$1 AND is_current',[r.id])).rows[0].value;
    const outcomes=await Promise.all([policy.evaluate(r.id,finance,'p164-eval-a'),policy.evaluate(r.id,finance,'p164-eval-b')]);
    const decision=outcomes[0];
    assert.equal(decision.exception_code,'REQUIRED_EVIDENCE_MISSING');
    assert.equal(decision.clarificationId,outcomes[1].clarificationId);
    assert.equal(decision.id,outcomes[1].id);
    assert.equal((await requests.get(r.id,requester)).status,'NEEDS_CLARIFICATION');
    assert.deepEqual((await db.pool.query('SELECT to_jsonb(v) value FROM validation_runs v WHERE id=$1',[original.id])).rows[0].value,original);
    const before=(await requests.get(r.id,requester)).audit;
    await policy.evaluate(r.id,finance,'p164-retry');
    assert.deepEqual((await requests.get(r.id,requester)).audit,before);
    const validation=new ValidationService(db,requests,storage,null);
    const clarification=(await validation.get(r.id,requester)).clarifications[0];
    assert.match(clarification.reason,/CONTRACT/);
    const documents=new PaymentDocumentService(db,requests,storage);
    const buffer=Buffer.from('%PDF-1.7\nSynthetic contract\n%%EOF\n');
    const uploaded=await documents.upload(r.id,{originalname:'contract.pdf',mimetype:'application/pdf',buffer} as Express.Multer.File,'CONTRACT',requester,'p164-upload') as {id:string};
    await worker.pollBatch();
    assert.equal((await db.pool.query('SELECT security_status FROM payment_documents WHERE id=$1',[uploaded.id])).rows[0].security_status,'CLEAN');
    const afterUpload=(await requests.get(r.id,requester)).audit;
    const pending=await policy.evaluate(r.id,finance,'p164-upload-retry');
    assert.equal(pending.clarificationId,clarification.id);
    assert.equal(pending.ready_for_approval,false);
    assert.deepEqual((await requests.get(r.id,requester)).audit,afterUpload);
    await validation.respond(r.id,clarification.id,{response:'Required contract attached'},requester,'p164-respond');
    assert.equal((await requests.get(r.id,requester)).status,'SUBMITTED');
    await assert.rejects(policy.evaluate(r.id,finance,'p164-no-bypass'),/Current Validation/);
    await validation.start(r.id,finance,'p164-new-validation');
    const current=(await validation.get(r.id,finance)).current;
    assert.notEqual(current.id,original.id);
    await validation.finalize(r.id,{overallResult:'PASS',remarks:'Contract checked',findings:[]},finance,'p164-validated');
    await new FinanceContextService(db,requests).calculate(r.id,finance,'p164-context');
    await new FinancialAnalysisService(db,requests,null).manual(r.id,{
      riskLevel:'LOW',priority:'NORMAL',urgency:'NORMAL',riskFlags:[],financialAssessment:'Budget reviewed',spendingAssessment:'Spending reviewed',complianceRemarks:'Contract reviewed',evidenceReferences:[],remarks:'Reassessed',
    },finance,'p164-analysis');
    const passed=await policy.evaluate(r.id,finance,'p164-policy-pass');
    assert.equal(passed.result,'PASS');assert.equal(passed.ready_for_approval,true);
    assert.equal((await db.pool.query('SELECT 1 FROM approval_cases WHERE payment_request_id=$1',[r.id])).rowCount,0);
    const events=(await db.pool.query('SELECT * FROM audit_events WHERE entity_id=$1 ORDER BY occurred_at,id',[r.id])).rows;
    const requested=events.filter(e=>e.action==='VALIDATION_CLARIFICATION_REQUESTED');
    assert.equal(requested.length,1);assert.equal(requested[0].previous_state,'VALIDATING');assert.equal(requested[0].new_state,'NEEDS_CLARIFICATION');
    assert.equal(requested[0].actor_id,finance.id);assert.equal(requested[0].safe_metadata.source,'POLICY');
    assert.equal(events.filter(e=>e.action==='VALIDATION_CLARIFICATION_RESPONDED').length,1);
    assert.equal((await db.pool.query("SELECT 1 FROM validation_clarifications WHERE payment_request_id=$1 AND status='OPEN'",[r.id])).rowCount,0);
  }finally{await worker.close();await db.onModuleDestroy();await rm(root,{recursive:true,force:true})}
});
