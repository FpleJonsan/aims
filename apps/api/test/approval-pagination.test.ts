import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalService } from "../src/application/approval/approval.service.js";
import type { Principal } from "../src/domain/payment-request.js";

const actor: Principal = { id: "10000000-0000-4000-8000-000000000004", departmentId: "00000000-0000-4000-8000-000000000001", roles: ["REQUESTER"] };

function serviceWithEligibleCount(total: number) {
  return new ApprovalService({ pool: { query: async (_sql: string, values: unknown[]) => {
    const limit = Number(values[2]), offset = Number(values[3]), count = Math.max(0, Math.min(limit, total - offset));
    if (count === 0) return { rows: [{ approval_case_id: null, total }] };
    return { rows: Array.from({ length: count }, (_, index) => ({
      approval_case_id: `case-${offset + index + 1}`,
      payment_request_id: `request-${offset + index + 1}`,
      total,
    })) };
  } } } as never, {} as never);
}

test("57 authorized approvals are reachable across three authoritative pages", async () => {
  const service = serviceWithEligibleCount(57), seen = new Set<string>();
  const first = await service.list(actor, { page: 1, pageSize: 25 });
  const second = await service.list(actor, { page: 2, pageSize: 25 });
  const third = await service.list(actor, { page: 3, pageSize: 25 });
  for (const page of [first, second, third]) for (const item of page.items) seen.add(String(item.approval_case_id));
  assert.deepEqual([first.items.length, second.items.length, third.items.length], [25, 25, 7]);
  assert.equal(first.total, 57);
  assert.equal(first.totalPages, 3);
  assert.equal(first.hasPreviousPage, false);
  assert.equal(first.hasNextPage, true);
  assert.equal(third.hasPreviousPage, true);
  assert.equal(third.hasNextPage, false);
  assert.equal(seen.size, 57);
});

test("an authoritative empty shifted page retains total and navigation metadata", async () => {
  const page = await serviceWithEligibleCount(24).list(actor, { page: 2, pageSize: 25 });
  assert.equal(page.items.length, 0);
  assert.equal(page.total, 24);
  assert.equal(page.totalPages, 1);
  assert.equal(page.hasPreviousPage, true);
  assert.equal(page.hasNextPage, false);
});
