import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ApprovalMatrixService } from "../src/application/approval-matrix/approval-matrix.service.js";

const request = (overrides: Record<string, unknown> = {}) =>
  ({ ip: "203.0.113.9", correlationId: "test-correlation", ...overrides }) as never;
const actor = { id: "actor-1", departmentId: "dept-1", roles: ["FINANCE_MASTER"] as never };

const validRule = (overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  code: "R1",
  name: "Rule 1",
  priority: 100,
  active: true,
  isFallback: false,
  conditionLogic: "ALL",
  conditions: {},
  financeReviewRequired: false,
  aiAnalysisRequired: false,
  steps: [{ sequence: 1, requiredRole: "AM", authorityScope: "DEPARTMENT", mandatory: true, reason: "Threshold" }],
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  ...overrides,
});

function fakeDatabase(handlers: Record<string, (values: unknown[]) => unknown>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    for (const [needle, handler] of Object.entries(handlers)) {
      if (sql.includes(needle)) return handler(values);
    }
    if (sql.includes("SELECT display_name FROM users")) return { rowCount: 1, rows: [{ display_name: "Actor Name" }] };
    if (sql.includes("SELECT code FROM roles")) return { rowCount: 1, rows: [{ code: "AM" }] };
    if (sql.includes("SELECT DISTINCT authority_role, authority_scope FROM approval_authorities"))
      return { rowCount: 1, rows: [{ authority_role: "AM", authority_scope: "DEPARTMENT" }] };
    return { rowCount: 0, rows: [] };
  };
  const service = new ApprovalMatrixService({
    pool: { query },
    transaction: async (operation: (client: { query: typeof query }) => Promise<unknown>) => operation({ query }),
  } as never);
  return { calls, service };
}

test("getActive returns the routing-enabled empty default when nothing is published", async () => {
  const { service } = fakeDatabase({});
  const active = await service.getActive();
  assert.equal(active.version, 0);
  assert.deepEqual(active.payload, { routingEnabled: true, rules: [] });
});

test("saveDraft rejects a payload that fails schema validation", async () => {
  const { service } = fakeDatabase({});
  await assert.rejects(() => service.saveDraft({ rules: [{ code: "" }] }, actor, request()), BadRequestException);
});

test("saveDraft creates a new draft when none exists and audits DRAFT_CREATED", async () => {
  const { calls, service } = fakeDatabase({ "SELECT id FROM approval_matrix_versions WHERE status='draft'": () => ({ rowCount: 0, rows: [] }) });
  await service.saveDraft({ routingEnabled: true, rules: [validRule()] }, actor, request());
  const insert = calls.find((c) => c.sql.includes("INSERT INTO approval_matrix_versions"));
  assert.ok(insert, "expected an insert for the new draft");
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "APPROVAL_MATRIX_DRAFT_CREATED");
});

test("saveDraft updates the existing draft in place and audits DRAFT_UPDATED", async () => {
  const { calls, service } = fakeDatabase({
    "SELECT id FROM approval_matrix_versions WHERE status='draft'": () => ({ rowCount: 1, rows: [{ id: "draft-1" }] }),
  });
  await service.saveDraft({ routingEnabled: true, rules: [] }, actor, request());
  const update = calls.find((c) => c.sql.includes("UPDATE approval_matrix_versions SET payload="));
  assert.equal(update!.values[0], "draft-1");
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "APPROVAL_MATRIX_DRAFT_UPDATED");
});

test("discardDraft throws NotFoundException when there is no draft", async () => {
  const { service } = fakeDatabase({ "DELETE FROM approval_matrix_versions WHERE status='draft'": () => ({ rowCount: 0, rows: [] }) });
  await assert.rejects(() => service.discardDraft(actor, request()), NotFoundException);
});

test("validate flags a step whose role has no active approver as unroutable", async () => {
  const { service } = fakeDatabase({
    "SELECT code FROM roles": () => ({ rowCount: 1, rows: [{ code: "AM" }] }),
    "SELECT DISTINCT authority_role, authority_scope FROM approval_authorities": () => ({ rowCount: 0, rows: [] }),
  });
  const errors = await service.validate({ routingEnabled: true, rules: [validRule() as never] });
  assert.ok(errors.some((e) => e.includes("unroutable")));
});

test("publish rejects when validation errors exist and does not write a version", async () => {
  const { calls, service } = fakeDatabase({
    "SELECT * FROM approval_matrix_versions WHERE status='draft' FOR UPDATE": () => ({
      rowCount: 1,
      rows: [{ id: "draft-1", payload: { routingEnabled: true, rules: [validRule()] } }],
    }),
    "SELECT DISTINCT authority_role, authority_scope FROM approval_authorities": () => ({ rowCount: 0, rows: [] }),
  });
  await assert.rejects(() => service.publish("go live", actor, request()), BadRequestException);
  assert.ok(!calls.some((c) => c.sql.includes("UPDATE approval_matrix_versions\n         SET status='published'")));
});

test("publish promotes the draft to version 1 and audits PUBLISHED with old/new values", async () => {
  const draftPayload = { routingEnabled: true, rules: [validRule()] };
  const { calls, service } = fakeDatabase({
    "SELECT * FROM approval_matrix_versions WHERE status='draft' FOR UPDATE": () => ({
      rowCount: 1,
      rows: [{ id: "draft-1", payload: draftPayload }],
    }),
  });
  const result = await service.publish("go live", actor, request());
  assert.equal(result.version, 1);
  const update = calls.find((c) => c.sql.includes("SET status='published'"));
  assert.equal(update!.values[0], "draft-1");
  assert.equal(update!.values[1], 1);
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "APPROVAL_MATRIX_PUBLISHED");
});

test("rollback republishes a past version's payload as a new version and never rewrites history", async () => {
  const targetPayload = { routingEnabled: true, rules: [validRule({ code: "OLD" })] };
  const { calls, service } = fakeDatabase({
    "SELECT * FROM approval_matrix_versions WHERE status='published' AND version=$1": () => ({
      rowCount: 1,
      rows: [{ id: "v1", version: 1, payload: targetPayload }],
    }),
    "SELECT max(version) max FROM approval_matrix_versions WHERE status='published'": () => ({ rowCount: 1, rows: [{ max: 3 }] }),
  });
  const result = await service.rollback(1, "reverting a bad change", actor, request());
  assert.equal(result.version, 4);
  const insert = calls.find((c) => c.sql.includes("INSERT INTO approval_matrix_versions"));
  assert.ok(insert!.values[3] as string, "expected a copied payload");
  assert.equal(JSON.parse(insert!.values[2] as string).rules[0].code, "OLD");
});

test("resolveForFacts returns null when the matrix has no published version", async () => {
  const { service } = fakeDatabase({});
  const resolution = await service.resolveForFacts(
    { query: async () => ({ rowCount: 0, rows: [] }) } as never,
    {
      amountMinor: 1000n,
      currency: "MYR",
      departmentId: "dept-1",
      category: "Travel",
      projectIds: [],
      paymentMethod: "BANK_TRANSFER",
      riskLevel: "LOW",
      priority: "LOW",
      claimCount: 1,
      asOfDate: "2026-06-01",
    },
  );
  assert.equal(resolution, null);
});
