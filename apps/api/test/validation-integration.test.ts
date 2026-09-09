import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
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
  await db.pool.query(`INSERT INTO payment_documents(id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,scan_attempt,scan_started_at,scan_completed_at,scan_engine,scan_reference,storage_binding_state,storage_backend_id,storage_object_version,trusted_storage_object_key,trusted_storage_object_version) VALUES($1,$2,$3,'synthetic.pdf',$4,'application/pdf',20,$5,1,$6,'LOCAL','application/pdf','application/pdf','CLEAN',1,now(),now(),'test-scanner','test-clean','VERSION_BOUND','test-fixture',gen_random_uuid()::text,$4,gen_random_uuid()::text)`, [randomUUID(), d.id, randomUUID(), `active/tests/${randomUUID()}`, "0".repeat(64), requester.id]);
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
    const previous = history.history[0];
    await validation.start(request.id, finance, "d2-revalidation-start");
    const restarted = await validation.get(request.id, finance);
    assert.notEqual(restarted.current.id, previous.id);
    await validation.finalize(request.id, {
      overallResult: "PASS", remarks: "Clarification evidence reviewed", findings: [],
    }, finance, "d2-revalidation-pass");
    const completed = await validation.get(request.id, finance);
    assert.equal(completed.current.id, restarted.current.id);
    assert.equal(completed.current.status, "COMPLETED");
    const oldRun = completed.history.find((run: { id: string }) => run.id === previous.id);
    assert.deepEqual(oldRun, previous);
  } finally {
    await db.onModuleDestroy();
  }
});


test("completed validation rejects retries without changing assessment, timestamps, findings or audit", async () => {
  const db = new Postgres(), requests = new PaymentRequestService(db),
    validation = new ValidationService(db, requests, {} as never, null);
  try {
    const request = await submitted(requests, db);
    await validation.start(request.id, finance, "immutable-start");
    const input = { overallResult: "PASS" as const, remarks: "Original assessment", findings: [] };
    await validation.finalize(request.id, input, finance, "immutable-first");
    const snapshot = async () => ({
      request: (await db.pool.query("SELECT to_jsonb(pr) AS value FROM payment_requests pr WHERE id=$1", [request.id])).rows,
      runs: (await db.pool.query("SELECT to_jsonb(v) AS value FROM validation_runs v WHERE payment_request_id=$1 ORDER BY id", [request.id])).rows,
      findings: (await db.pool.query("SELECT to_jsonb(f) AS value FROM validation_findings f JOIN validation_runs v ON v.id=f.validation_run_id WHERE v.payment_request_id=$1 ORDER BY f.id", [request.id])).rows,
      audit: (await db.pool.query("SELECT to_jsonb(a) AS value FROM audit_events a WHERE entity_id=$1 ORDER BY id", [request.id])).rows,
    });
    const before = await snapshot();
    assert.equal(before.runs[0].value.status, "COMPLETED");
    assert.ok(before.runs[0].value.completed_at);
    assert.equal(before.audit.filter(row => row.value.action === "MANUAL_VALIDATION_COMPLETED").length, 1);
    for (const retry of [input, { overallResult: "CLARIFICATION_REQUIRED" as const, remarks: "Attempted overwrite",
      findings: [{code: "MISSING_INFORMATION", status: "FAIL", severity: "HIGH", explanation: "Must not be inserted"}] }]) {
      await assert.rejects(validation.finalize(request.id, retry, finance, "immutable-retry"),
        error => error instanceof ConflictException && error.getStatus() === 409);
      assert.deepEqual(await snapshot(), before);
    }
  } finally { await db.onModuleDestroy(); }
});

test("concurrent validation finalization completes exactly once", async () => {
  const db = new Postgres(), requests = new PaymentRequestService(db),
    validation = new ValidationService(db, requests, {} as never, null);
  try {
    const request = await submitted(requests, db);
    await validation.start(request.id, finance, "concurrent-finalize-start");
    const results = await Promise.allSettled(["first", "second"].map(remarks =>
      validation.finalize(request.id, {overallResult:"PASS", remarks, findings:[]}, finance, remarks)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const rejected = results.find(result => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ConflictException);
    const audit = await db.pool.query("SELECT 1 FROM audit_events WHERE entity_id=$1 AND action='MANUAL_VALIDATION_COMPLETED'", [request.id]);
    assert.equal(audit.rowCount, 1);
  } finally { await db.onModuleDestroy(); }
});
