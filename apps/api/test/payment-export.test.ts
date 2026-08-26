import assert from "node:assert/strict";
import test from "node:test";
import { PaymentService } from "../src/application/payments/payment.service.js";
import type { Principal } from "../src/domain/payment-request.js";

const operator: Principal = { id: "10000000-0000-4000-8000-000000000002", departmentId: "00000000-0000-4000-8000-000000000002", roles: ["FINANCE"] };

function fixture(total: number) {
  return new PaymentService({ pool: { query: async (query: string, values?: unknown[]) => {
    if (!query.includes("FROM payments p")) return { rowCount: 1, rows: [{ "?column?": 1 }] };
    const offset = Number(values?.[8] ?? 0), count = Math.max(0, Math.min(100, total - offset));
    return { rowCount: count, rows: Array.from({ length: count }, (_, index) => ({
      id: `payment-${offset + index}`, ticket_number: `PAY-${offset + index}`, total,
      finance_access: true, amount_minor: "100", bank_reference: "SAFE-REFERENCE",
    })) };
  } } } as never, {} as never, {} as never);
}

test("payment export pages through a bounded result instead of silently truncating at 100", async () => {
  const old = process.env.MAX_PAYMENT_EXPORT_ROWS;
  process.env.MAX_PAYMENT_EXPORT_ROWS = "200";
  try {
    const csv = await fixture(150).export(operator, { page: 1, pageSize: 25 });
    assert.equal(csv.split("\r\n").length, 151);
  } finally { process.env.MAX_PAYMENT_EXPORT_ROWS = old; }
});

test("payment export fails explicitly when the configured operational limit is exceeded", async () => {
  const old = process.env.MAX_PAYMENT_EXPORT_ROWS;
  process.env.MAX_PAYMENT_EXPORT_ROWS = "100";
  try {
    await assert.rejects(() => fixture(101).export(operator, { page: 1, pageSize: 25 }), /narrow the filters/);
  } finally { process.env.MAX_PAYMENT_EXPORT_ROWS = old; }
});
