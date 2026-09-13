import assert from "node:assert/strict";
import test from "node:test";
import { PaymentService } from "../src/application/payments/payment.service.js";
import type { Principal } from "../src/domain/payment-request.js";

const operator: Principal = { id: "10000000-0000-4000-8000-000000000002", departmentId: "00000000-0000-4000-8000-000000000002", roles: ["FINANCE"] };

function payment(index: number) {
  return {
    id: `payment-${index}`, ticket_number: `PAY-${index}`,
    payment_date: `2026-09-${String(13 - index).padStart(2, "0")}`,
    payee: `Payee ${index}`, department_name: "Finance", category: "Operations",
    purpose: `Purpose ${index}`, amount_minor: String(12_345 + index), currency: "MYR",
    payment_method: "BANK_TRANSFER", bank_reference: `REFERENCE-${index}`, status: "PAID",
    recorded_by_name: "Finance Operator",
    recorded_at: `2026-09-${String(13 - index).padStart(2, "0")}T10:00:00.000Z`,
    finance_access: true,
  };
}

function fixture(rows: ReturnType<typeof payment>[], authorized = true) {
  const queries: { query: string; values?: unknown[] }[] = [];
  const service = new PaymentService({ pool: { query: async (query: string, values?: unknown[]) => {
    queries.push({ query, values });
    if (!query.includes("FROM payments p"))
      return { rowCount: authorized ? 1 : 0, rows: authorized ? [{ "?column?": 1 }] : [] };
    return { rowCount: rows.length, rows: rows.slice(0, Number(values?.[7])) };
  } } } as never, {} as never, {} as never);
  return { service, queries };
}

async function withExportLimit<T>(limit: number, run: () => Promise<T>) {
  const old = process.env.MAX_PAYMENT_EXPORT_ROWS;
  process.env.MAX_PAYMENT_EXPORT_ROWS = String(limit);
  try { return await run(); }
  finally { process.env.MAX_PAYMENT_EXPORT_ROWS = old; }
}

test("payment export returns every row from one dedicated bounded query", async () => {
  const { service, queries } = fixture(Array.from({ length: 150 }, (_, index) => payment(index)));
  const csv = await withExportLimit(200, () => service.export(operator, { page: 4, pageSize: 25 }));
  assert.equal(csv.split("\r\n").length, 151);
  const exportQueries = queries.filter(({ query }) => query.includes("FROM payments p"));
  assert.equal(exportQueries.length, 1);
  assert.equal(exportQueries[0].values?.[7], 201);
  assert.doesNotMatch(exportQueries[0].query, /\bOFFSET\b|count\s*\(/i);
});

test("payment export preserves filters and deterministic sorting", async () => {
  const { service, queries } = fixture([payment(0), payment(1)]);
  const input = { page: 2, pageSize: 1, search: "PAY", departmentId: "00000000-0000-4000-8000-000000000002", category: "Operations", dateFrom: "2026-09-01", dateTo: "2026-09-30", payee: "Payee" };
  const csv = await service.export(operator, input);
  const exportQuery = queries.find(({ query }) => query.includes("FROM payments p"));
  assert.deepEqual(exportQuery?.values?.slice(0, 7), [operator.id, input.search, input.departmentId, input.category, input.dateFrom, input.dateTo, input.payee]);
  assert.match(exportQuery?.query ?? "", /ORDER BY payment_date DESC,id DESC LIMIT \$8/);
  assert.ok(csv.indexOf('"PAY-0"') < csv.indexOf('"PAY-1"'));
});

test("payment export preserves CSV columns and row content", async () => {
  const { service } = fixture([payment(0)]);
  const csv = await service.export(operator, { page: 1, pageSize: 25 });
  assert.equal(csv, [
    '"Ticket Number","Payment Date","Payee","Department","Category","Purpose","Amount","Currency","Payment Method","Bank Reference","Status","Recorded By","Recorded At"',
    '"PAY-0","2026-09-13","Payee 0","Finance","Operations","Purpose 0","123.45","MYR","BANK_TRANSFER","REFERENCE-0","PAID","Finance Operator","2026-09-13T10:00:00.000Z"',
  ].join("\r\n"));
});

test("payment export permits a result exactly at the operational limit", async () => {
  const { service } = fixture([payment(0), payment(1)]);
  const csv = await withExportLimit(2, () => service.export(operator, { page: 1, pageSize: 25 }));
  assert.equal(csv.split("\r\n").length, 3);
});

test("payment export rejects a result above the operational limit", async () => {
  const { service } = fixture([payment(0), payment(1), payment(2)]);
  await withExportLimit(2, () => assert.rejects(
    () => service.export(operator, { page: 1, pageSize: 25 }),
    /narrow the filters below the 2-row operational limit/,
  ));
});

test("payment export returns only the CSV header for an empty result", async () => {
  const { service } = fixture([]);
  const csv = await service.export(operator, { page: 1, pageSize: 25 });
  assert.equal(csv.split("\r\n").length, 1);
  assert.match(csv, /^"Ticket Number","Payment Date"/);
});

test("payment export preserves Payment Operator authorization", async () => {
  const { service, queries } = fixture([payment(0)], false);
  await assert.rejects(() => service.export(operator, { page: 1, pageSize: 25 }), /Payment Operator authority/);
  assert.equal(queries.filter(({ query }) => query.includes("FROM payments p")).length, 0);
});
