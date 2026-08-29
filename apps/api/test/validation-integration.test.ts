import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
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
async function submitted(requests: PaymentRequestService, db: Postgres) {
  const d = await requests.initiate(requester, "d2-init");
  await requests.update(
    d.id,
    {
      payee: "Synthetic Vendor",
      purpose: "Day 2 test",
      category: "Operations",
      amount: "10.00",
      currency: "MYR",
      dueDate: "2026-09-30",
      paymentMethod: "BANK_TRANSFER",
      paymentDetails: "Synthetic",
    },
    requester,
    "d2-update",
  );
  const submittedRequest = await requests.submit(d.id, requester, "d2-submit");
  await db.pool.query(`INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference) VALUES($1,$2,$3,'synthetic.pdf',$4,'application/pdf',20,$5,1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean')`, [randomUUID(), d.id, randomUUID(), `active/tests/${randomUUID()}`, "0".repeat(64), requester.id]);
  return submittedRequest;
}
test("manual validation is first-class, duplicate start is protected, and PASS stops before Finance Context", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    validation = new ValidationService(db, requests, {} as never, null);
  try {
    const request = await submitted(requests, db);
    const starts = await Promise.allSettled([
      validation.start(request.id, finance, "d2-start-a"),
      validation.start(request.id, finance, "d2-start-b"),
    ]);
    assert.equal(starts.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(starts.filter((x) => x.status === "rejected").length, 1);
    const result = await validation.finalize(
      request.id,
      {
        overallResult: "PASS",
        remarks: "Manual evidence reviewed",
        findings: [],
      },
      finance,
      "d2-pass",
    );
    assert.equal(result.readyForFinanceContext, true);
    const detail = await requests.get(request.id, requester);
    assert.equal(detail.status, "VALIDATING");
    const record = await validation.get(request.id, finance);
    assert.equal(record.current.source, "MANUAL");
    assert.equal(record.current.overall_result, "PASS");
  } finally {
    await db.onModuleDestroy();
  }
});
test("clarification preserves history, records response, supersedes validation, and requires revalidation", async () => {
  const db = new Postgres(),
    requests = new PaymentRequestService(db),
    validation = new ValidationService(db, requests, {} as never, null);
  try {
    const request = await submitted(requests, db);
    await validation.start(request.id, finance, "d2-c-start");
    await validation.finalize(
      request.id,
      {
        overallResult: "CLARIFICATION_REQUIRED",
        remarks: "Payee evidence missing",
        requiredResponse: "Confirm legal payee",
        findings: [
          {
            code: "MISSING_INFORMATION",
            status: "FAIL",
            severity: "HIGH",
            explanation: "Payee evidence missing",
          },
        ],
      },
      finance,
      "d2-clarify",
    );
    const state = await validation.get(request.id, requester);
    assert.equal(state.clarifications[0].clarification_type, "VALIDATION");
    await validation.respond(
      request.id,
      state.clarifications[0].id,
      {
        response: "Confirmed from supplier",
        payee: "Synthetic Vendor Sdn Bhd",
      },
      requester,
      "d2-response",
    );
    const detail = await requests.get(request.id, requester);
    assert.equal(detail.status, "SUBMITTED");
    const history = await validation.get(request.id, requester);
    assert.equal(history.current, null);
    assert.equal(history.history[0].status, "SUPERSEDED");
  } finally {
    await db.onModuleDestroy();
  }
});
