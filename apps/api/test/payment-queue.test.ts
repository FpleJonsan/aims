import assert from "node:assert/strict";
import test from "node:test";
import { PaymentService } from "../src/application/payments/payment.service.js";
import type { Principal } from "../src/domain/payment-request.js";

const actor: Principal = {
  id: "10000000-0000-4000-8000-000000000004",
  departmentId: "00000000-0000-4000-8000-000000000001",
  roles: ["FINANCE"],
};

type Authority = {
  scope: "DEPARTMENT" | "ORGANIZATION";
  departmentId: string | null;
  minimum: number | null;
  maximum: number | null;
  allowSelf: boolean;
};

function serviceFor(
  authority: Authority,
  amountMinor = 1000,
  createdBy = "requester",
) {
  const request = {
    id: "request-1",
    ticket_number: "AIMS-1",
    payee: "Vendor",
    amount: (amountMinor / 100).toFixed(2),
    currency: "MYR",
    department_id: actor.departmentId,
    category: "Operations",
    due_date: "2026-09-01",
    payment_method: "BANK_TRANSFER",
    finance_control_status: "PASSED",
  };
  const eligible =
    (authority.scope === "ORGANIZATION" ||
      authority.departmentId === request.department_id) &&
    (authority.allowSelf || createdBy !== actor.id) &&
    (authority.minimum === null || amountMinor >= authority.minimum) &&
    (authority.maximum === null || amountMinor <= authority.maximum);
  const db = {
    pool: {
      query: async (sql: string, values: unknown[]) => {
        assert.match(sql, /JOIN users u ON u\.id=a\.user_id AND u\.active/);
        assert.match(
          sql,
          /minimum_amount_minor IS NULL OR \(pr\.amount\*100\)::bigint>=a\.minimum_amount_minor/,
        );
        assert.match(
          sql,
          /maximum_amount_minor IS NULL OR \(pr\.amount\*100\)::bigint<=a\.maximum_amount_minor/,
        );
        const pageSize = Number(values[3]),
          offset = Number(values[4]);
        return {
          rows:
            eligible && offset === 0
              ? [{ ...request, total: 1 }]
              : [{ id: null, total: eligible ? 1 : 0 }],
          rowCount: 1,
          pageSize,
        };
      },
    },
  };
  return new PaymentService(db as never, {} as never, {} as never);
}

const department = actor.departmentId;
for (const [name, authority, visible] of [
  [
    "below minimum",
    {
      scope: "DEPARTMENT",
      departmentId: department,
      minimum: 1001,
      maximum: null,
      allowSelf: false,
    },
    false,
  ],
  [
    "exactly minimum",
    {
      scope: "DEPARTMENT",
      departmentId: department,
      minimum: 1000,
      maximum: null,
      allowSelf: false,
    },
    true,
  ],
  [
    "inside range",
    {
      scope: "DEPARTMENT",
      departmentId: department,
      minimum: 900,
      maximum: 1100,
      allowSelf: false,
    },
    true,
  ],
  [
    "exactly maximum",
    {
      scope: "DEPARTMENT",
      departmentId: department,
      minimum: null,
      maximum: 1000,
      allowSelf: false,
    },
    true,
  ],
  [
    "above maximum",
    {
      scope: "DEPARTMENT",
      departmentId: department,
      minimum: null,
      maximum: 999,
      allowSelf: false,
    },
    false,
  ],
  [
    "wrong department",
    {
      scope: "DEPARTMENT",
      departmentId: "00000000-0000-4000-8000-000000000002",
      minimum: 0,
      maximum: 2000,
      allowSelf: false,
    },
    false,
  ],
  [
    "organization in range",
    {
      scope: "ORGANIZATION",
      departmentId: null,
      minimum: 0,
      maximum: 1000,
      allowSelf: false,
    },
    true,
  ],
  [
    "organization out of range",
    {
      scope: "ORGANIZATION",
      departmentId: null,
      minimum: 1001,
      maximum: null,
      allowSelf: false,
    },
    false,
  ],
] as const)
  test(`Payment Queue hides or shows amount at ${name}`, async () => {
    const result = await serviceFor(authority).queue(actor, {
      page: 1,
      pageSize: 25,
    });
    assert.equal(result.items.length === 1, visible);
    assert.equal(result.total, visible ? 1 : 0);
  });

test("Payment Queue excludes prohibited self-payment", async () => {
  const result = await serviceFor(
    {
      scope: "ORGANIZATION",
      departmentId: null,
      minimum: null,
      maximum: null,
      allowSelf: false,
    },
    1000,
    actor.id,
  ).queue(actor, { page: 1, pageSize: 25 });
  assert.equal(result.total, 0);
});

test("Payment Queue pagination total is calculated from eligible rows only", async () => {
  const first = await serviceFor({
    scope: "ORGANIZATION",
    departmentId: null,
    minimum: 1000,
    maximum: 1000,
    allowSelf: false,
  }).queue(actor, { page: 1, pageSize: 1 });
  const second = await serviceFor({
    scope: "ORGANIZATION",
    departmentId: null,
    minimum: 1000,
    maximum: 1000,
    allowSelf: false,
  }).queue(actor, { page: 2, pageSize: 1 });
  assert.deepEqual(
    {
      total: first.total,
      totalPages: first.totalPages,
      items: first.items.length,
    },
    { total: 1, totalPages: 1, items: 1 },
  );
  assert.deepEqual(
    {
      total: second.total,
      items: second.items.length,
      hasPreviousPage: second.hasPreviousPage,
    },
    { total: 1, items: 0, hasPreviousPage: true },
  );
});
