import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { FinanceContextService } from "../src/application/finance-context/finance-context.service.js";
import { PaymentRequestService } from "../src/application/payment-requests/payment-request.service.js";
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
async function validated(
  requests: PaymentRequestService,
  validation: ValidationService,
  db: Postgres,
  category = "Operations",
  currency = "MYR",
) {
  const draft = await requests.initiate(requester, "d3-init");
  await requests.update(
    draft.id,
    {
      payee: "Synthetic Vendor",
      purpose: "Day 3 deterministic test",
      category,
      amount: "10.00",
      currency,
      dueDate: "2026-09-30",
      paymentMethod: "BANK_TRANSFER",
      paymentDetails: "Synthetic",
    },
    requester,
    "d3-update",
  );
  const request = await requests.submit(draft.id, requester, "d3-submit");
  await db.pool.query(
    `INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference) VALUES($1,$2,$3,'synthetic.pdf',$4,'application/pdf',20,$5,1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean')`,
    [
      randomUUID(),
      draft.id,
      randomUUID(),
      `active/tests/${randomUUID()}`,
      "0".repeat(64),
      requester.id,
    ],
  );
  await validation.start(request.id, finance, "d3-validation-start");
  await validation.finalize(
    request.id,
    {
      overallResult: "PASS",
      remarks: "Validated for Finance Context",
      findings: [],
    },
    finance,
    "d3-validation-pass",
  );
  return request;
}
test("creates one immutable current snapshot and stops before Day 4", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    validation = new ValidationService(db, requests, {} as never, null),
    contexts = new FinanceContextService(db, requests);
  try {
    const request = await validated(requests, validation, db);
    const results = (await Promise.all([
      contexts.calculate(request.id, finance, "d3-a"),
      contexts.calculate(request.id, finance, "d3-b"),
    ])) as Array<{
      id: string;
      available: { decimal: string };
      projectedAvailable: { decimal: string };
      readyForFinancialRiskAnalysis: boolean;
    }>;
    assert.equal(results[0].id, results[1].id);
    assert.equal(
      Number(results[0].available.decimal) -
        Number(results[0].projectedAvailable.decimal),
      10,
    );
    assert.equal(results[0].readyForFinancialRiskAnalysis, true);
    const count = await db.pool.query(
      "SELECT count(*)::int count FROM finance_context_snapshots WHERE payment_request_id=$1 AND is_current",
      [request.id],
    );
    assert.equal(count.rows[0].count, 1);
    const detail = await requests.get(request.id, requester);
    assert.equal(detail.status, "VALIDATING");
    const requesterView = (await contexts.get(
      request.id,
      requester,
      false,
    )) as Record<string, unknown>;
    assert.equal("budgetId" in requesterView, false);
  } finally {
    await db.onModuleDestroy();
  }
});
test("rejects unauthorized calculation and records controlled budget exceptions", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    validation = new ValidationService(db, requests, {} as never, null),
    contexts = new FinanceContextService(db, requests);
  try {
    const noBudget = await validated(
      requests,
      validation,
      db,
      "No Budget",
      "MYR",
    );
    await assert.rejects(() =>
      contexts.calculate(noBudget.id, requester, "d3-noauth"),
    );
    const missing = await contexts.calculate(
      noBudget.id,
      finance,
      "d3-missing",
    );
    assert.equal(missing.exceptionCode, "MISSING_APPLICABLE_BUDGET");
    assert.equal(missing.readyForFinancialRiskAnalysis, false);
    const recalculated = await contexts.calculate(
      noBudget.id,
      finance,
      "d3-recalculate",
      true,
    );
    assert.notEqual(recalculated.id, missing.id);
    const history = (await contexts.get(noBudget.id, finance, true)) as Array<{
      status: string;
    }>;
    assert.deepEqual(
      history.map((value) => value.status),
      ["EXCEPTION", "SUPERSEDED"],
    );
    const foreign = await validated(requests, validation, db, "Foreign", "MYR");
    const mismatch = await contexts.calculate(foreign.id, finance, "d3-fx");
    assert.equal(mismatch.exceptionCode, "CURRENCY_CONTEXT_UNSUPPORTED");
  } finally {
    await db.onModuleDestroy();
  }
});
test("unvalidated requests cannot produce financial truth", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    contexts = new FinanceContextService(db, requests);
  try {
    const draft = await requests.initiate(requester, "d3-unvalidated");
    await requests.update(
      draft.id,
      {
        payee: "Vendor",
        purpose: "Eligibility",
        category: "Operations",
        amount: "1.00",
        currency: "MYR",
        dueDate: "2026-09-30",
        paymentMethod: "BANK_TRANSFER",
        paymentDetails: "Synthetic",
      },
      requester,
      "d3-unvalidated-update",
    );
    const request = await requests.submit(
      draft.id,
      requester,
      "d3-unvalidated-submit",
    );
    const result = await contexts.calculate(
      request.id,
      finance,
      "d3-unvalidated-context",
    );
    assert.equal(result.exceptionCode, "STALE_VALIDATION");
  } finally {
    await db.onModuleDestroy();
  }
});
