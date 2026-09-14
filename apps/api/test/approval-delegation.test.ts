import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { ApprovalDelegationService } from "../src/application/approval-delegation/approval-delegation.service.js";

const request = (overrides: Record<string, unknown> = {}) =>
  ({ ip: "203.0.113.9", correlationId: "test-correlation", ...overrides }) as never;
const actor = { id: "actor-1", departmentId: "dept-1", roles: ["FINANCE_MASTER"] as never };

function fakeDatabase(handlers: Record<string, (values: unknown[]) => unknown>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    for (const [needle, handler] of Object.entries(handlers)) {
      if (sql.includes(needle)) return handler(values);
    }
    if (sql.includes("SELECT display_name FROM users")) return { rowCount: 1, rows: [{ display_name: "Actor Name" }] };
    if (sql.includes("SELECT id FROM users WHERE id = ANY")) return { rowCount: 2, rows: [{ id: "a" }, { id: "b" }] };
    if (sql.includes("delegate_from = ANY")) return { rowCount: 0, rows: [] };
    if (sql.includes("JOIN users uf") || sql.includes("JOIN users ut"))
      return { rowCount: 1, rows: [{ id: "d1", delegate_from: "a", delegate_to: "b", status: "ACTIVE", effective_status: "ACTIVE" }] };
    return { rowCount: 0, rows: [] };
  };
  const service = new ApprovalDelegationService({
    pool: { query },
    transaction: async (operation: (client: { query: typeof query }) => Promise<unknown>) => operation({ query }),
  } as never);
  return { calls, service };
}

test("create rejects delegating to self", async () => {
  const { service } = fakeDatabase({});
  await assert.rejects(
    () => service.create({ delegateFrom: "a", delegateTo: "a", startDate: "2026-01-01", endDate: "2026-02-01", reason: "x" }, actor, request()),
    BadRequestException,
  );
});

test("create rejects an end date before the start date", async () => {
  const { service } = fakeDatabase({});
  await assert.rejects(
    () => service.create({ delegateFrom: "a", delegateTo: "b", startDate: "2026-02-01", endDate: "2026-01-01", reason: "x" }, actor, request()),
    BadRequestException,
  );
});

test("create inserts a delegation and audits CREATED", async () => {
  const { calls, service } = fakeDatabase({});
  await service.create({ delegateFrom: "a", delegateTo: "b", startDate: "2026-01-01", endDate: "2026-02-01", reason: "annual leave" }, actor, request());
  const insert = calls.find((c) => c.sql.includes("INSERT INTO approval_delegations"));
  assert.ok(insert, "expected an insert");
  assert.deepEqual(insert!.values.slice(1, 6), ["a", "b", "2026-01-01", "2026-02-01", "annual leave"]);
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "APPROVAL_DELEGATION_CREATED");
});

test("create rejects a chain that would form a circular delegation", async () => {
  // A -> B already exists; creating B -> A would close the cycle A -> B -> A.
  const { service } = fakeDatabase({
    "delegate_from = ANY": (values) => {
      const frontier = values[0] as string[];
      if (frontier.includes("a")) return { rowCount: 1, rows: [{ delegate_to: "b" }] };
      return { rowCount: 0, rows: [] };
    },
  });
  await assert.rejects(
    () => service.create({ delegateFrom: "b", delegateTo: "a", startDate: "2026-01-01", endDate: "2026-02-01", reason: "x" }, actor, request()),
    ConflictException,
  );
});

test("create allows a delegation chain that does not close a cycle", async () => {
  // A -> B already exists; creating C -> D shares no path back to C.
  const { service } = fakeDatabase({
    "delegate_from = ANY": (values) => {
      const frontier = values[0] as string[];
      if (frontier.includes("a")) return { rowCount: 1, rows: [{ delegate_to: "b" }] };
      return { rowCount: 0, rows: [] };
    },
  });
  await service.create({ delegateFrom: "c", delegateTo: "d", startDate: "2026-01-01", endDate: "2026-02-01", reason: "x" }, actor, request());
});

test("cancel refuses to cancel an already-cancelled delegation", async () => {
  const { service } = fakeDatabase({
    "SELECT * FROM approval_delegations WHERE id=$1 FOR UPDATE": () => ({
      rowCount: 1,
      rows: [{ id: "d1", status: "CANCELLED" }],
    }),
  });
  await assert.rejects(() => service.cancel("d1", { reason: "no longer needed" }, actor, request()), ForbiddenException);
});

test("cancel marks the delegation cancelled, records the reason, and audits CANCELLED", async () => {
  const { calls, service } = fakeDatabase({
    "SELECT * FROM approval_delegations WHERE id=$1 FOR UPDATE": () => ({ rowCount: 1, rows: [{ id: "d1", status: "ACTIVE" }] }),
  });
  await service.cancel("d1", { reason: "no longer needed" }, actor, request());
  const update = calls.find((c) => c.sql.includes("SET status='CANCELLED'"));
  assert.equal(update!.values[0], "d1");
  assert.equal(update!.values[2], "no longer needed");
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "APPROVAL_DELEGATION_CANCELLED");
});

test("resolveDelegate returns the original user when no delegation applies", async () => {
  const { service } = fakeDatabase({});
  const result = await service.resolveDelegate({ query: async () => ({ rowCount: 0, rows: [] }) } as never, "user-1", "2026-06-01");
  assert.deepEqual(result, { userId: "user-1", chain: [] });
});

test("resolveDelegate follows a multi-hop active delegation chain", async () => {
  const { service } = fakeDatabase({});
  const hops: Record<string, string> = { "user-1": "user-2", "user-2": "user-3" };
  const client = {
    query: async (_sql: string, values: unknown[]) => {
      const from = values[0] as string;
      const to = hops[from];
      return to ? { rowCount: 1, rows: [{ delegate_to: to }] } : { rowCount: 0, rows: [] };
    },
  } as never;
  const result = await service.resolveDelegate(client, "user-1", "2026-06-01");
  assert.deepEqual(result, { userId: "user-3", chain: ["user-2", "user-3"] });
});
