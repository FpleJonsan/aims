import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { MasterDataService } from "../src/application/master-data/master-data.service.js";
import { CATEGORIES_CONFIG, CURRENCIES_CONFIG, DEPARTMENTS_CONFIG, PROJECTS_CONFIG } from "../src/application/master-data/master-data.domains.js";

const request = (overrides: Record<string, unknown> = {}) =>
  ({ ip: "203.0.113.9", correlationId: "test-correlation", header: () => undefined, ...overrides }) as never;
const actor = { id: "actor-1", departmentId: "dept-1", roles: ["FINANCE_MASTER"] as never };

function fakeDatabase(handlers: Record<string, (values: unknown[]) => unknown>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    for (const [needle, handler] of Object.entries(handlers)) {
      if (sql.includes(needle)) return handler(values);
    }
    if (sql.includes("SELECT display_name FROM users")) return { rowCount: 1, rows: [{ display_name: "Actor Name" }] };
    return { rowCount: 0, rows: [] };
  };
  return { calls, pool: { query }, transaction: async (operation: (client: { query: typeof query }) => Promise<unknown>) => operation({ query }) };
}

test("create rejects a duplicate code or name, otherwise inserts and audits", async () => {
  const dupCode = fakeDatabase({ "AND code=$1": () => ({ rowCount: 1, rows: [{}] }) });
  const service1 = new MasterDataService(dupCode as never, PROJECTS_CONFIG);
  await assert.rejects(() => service1.create({ code: "OPS", name: "Operations" } as never, actor, request()), BadRequestException);

  const dupName = fakeDatabase({ "AND code=$1": () => ({ rowCount: 0, rows: [] }), "lower(name)=lower($1)": () => ({ rowCount: 1, rows: [{}] }) });
  const service2 = new MasterDataService(dupName as never, PROJECTS_CONFIG);
  await assert.rejects(() => service2.create({ code: "OPS", name: "Operations" } as never, actor, request()), BadRequestException);

  const db = fakeDatabase({});
  const service3 = new MasterDataService(db as never, PROJECTS_CONFIG);
  const result = await service3.create({ code: "ops", name: "Operations", description: "Ops project", sortOrder: "2" } as never, actor, request());
  assert.equal(result.code, "ops");
  const insert = db.calls.find((c) => c.sql.includes("INSERT INTO master_data_projects"));
  assert.deepEqual(insert!.values, [result.id, "ops", "Operations", "Ops project", 2, false, actor.id]);
  const audit = db.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "PROJECT_CREATED");
  assert.equal(audit!.values[3], "MASTER_DATA_PROJECT");
});

test("create with isDefault clears any prior default for that table before inserting", async () => {
  const db = fakeDatabase({});
  const service = new MasterDataService(db as never, PROJECTS_CONFIG);
  await service.create({ code: "ops", name: "Operations", isDefault: true } as never, actor, request());
  const clear = db.calls.find((c) => c.sql.includes("SET is_default=false WHERE is_default=true"));
  assert.ok(clear);
  const insertIndex = db.calls.findIndex((c) => c.sql.includes("INSERT INTO master_data_projects"));
  const clearIndex = db.calls.indexOf(clear!);
  assert.ok(clearIndex < insertIndex, "default must be cleared before the new row is inserted");
});

test("update rejects an unknown id and a colliding name, otherwise merges fields and audits", async () => {
  const missing = fakeDatabase({ "SELECT * FROM master_data_projects WHERE id=$1": () => ({ rowCount: 0, rows: [] }) });
  const service1 = new MasterDataService(missing as never, PROJECTS_CONFIG);
  await assert.rejects(() => service1.update("p1", { name: "New" } as never, actor, request()), NotFoundException);

  const db = fakeDatabase({
    "SELECT * FROM master_data_projects WHERE id=$1": () => ({ rowCount: 1, rows: [{ id: "p1", code: "ops", name: "Operations", description: null, sort_order: 0, is_default: false, active: true }] }),
  });
  const service2 = new MasterDataService(db as never, PROJECTS_CONFIG);
  await service2.update("p1", { description: "Updated", sortOrder: "5" } as never, actor, request());
  const update = db.calls.find((c) => c.sql.includes("UPDATE master_data_projects SET name="));
  assert.deepEqual(update!.values, ["p1", "Operations", "Updated", 5, false, actor.id]);
  const audit = db.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "PROJECT_UPDATED");
});

test("setActive enables/disables and audits ENABLED/DISABLED distinctly", async () => {
  const db = fakeDatabase({ "SET active=$2": () => ({ rowCount: 1, rows: [{ code: "ops" }] }) });
  const service = new MasterDataService(db as never, PROJECTS_CONFIG);
  await service.setActive("p1", false, actor, request());
  let audit = db.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "PROJECT_DISABLED");

  await service.setActive("p1", true, actor, request());
  audit = db.calls.filter((c) => c.sql.includes("INSERT INTO audit_events")).at(-1);
  assert.equal(audit!.values[2], "PROJECT_ENABLED");
});

test("setActive on an unknown id raises NotFoundException", async () => {
  const db = fakeDatabase({ "SET active=$2": () => ({ rowCount: 0, rows: [] }) });
  const service = new MasterDataService(db as never, PROJECTS_CONFIG);
  await assert.rejects(() => service.setActive("missing", false, actor, request()), NotFoundException);
});

test("softDelete refuses a referenced category and permits an unreferenced one", async () => {
  const referenced = fakeDatabase({
    "SELECT * FROM master_data_categories WHERE id=$1": () => ({ rowCount: 1, rows: [{ id: "c1", code: "travel", name: "Travel" }] }),
    "FROM payment_requests WHERE category ILIKE": () => ({ rowCount: 1, rows: [{ count: "3" }] }),
  });
  const service1 = new MasterDataService(referenced as never, CATEGORIES_CONFIG);
  await assert.rejects(() => service1.softDelete("c1", actor, request()), ConflictException);
  assert.ok(!referenced.calls.some((c) => c.sql.includes("SET deleted_at=now()")));

  const unreferenced = fakeDatabase({
    "SELECT * FROM master_data_categories WHERE id=$1": () => ({ rowCount: 1, rows: [{ id: "c1", code: "travel", name: "Travel" }] }),
    "FROM payment_requests WHERE category ILIKE": () => ({ rowCount: 1, rows: [{ count: "0" }] }),
  });
  const service2 = new MasterDataService(unreferenced as never, CATEGORIES_CONFIG);
  await service2.softDelete("c1", actor, request());
  assert.ok(unreferenced.calls.some((c) => c.sql.includes("SET deleted_at=now()")));
  const audit = unreferenced.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "CATEGORY_SOFT_DELETED");
});

test("softDelete on a domain with no referenceCount probe (Project) always succeeds", async () => {
  const db = fakeDatabase({ "SELECT * FROM master_data_projects WHERE id=$1": () => ({ rowCount: 1, rows: [{ id: "p1", code: "ops", name: "Operations" }] }) });
  const service = new MasterDataService(db as never, PROJECTS_CONFIG);
  await service.softDelete("p1", actor, request());
  assert.ok(db.calls.some((c) => c.sql.includes("SET deleted_at=now()")));
});

test("currency referenceCount matches payment_requests.currency by exact code", async () => {
  const db = fakeDatabase({
    "FROM payment_requests WHERE currency =": (values) => {
      assert.equal(values[0], "MYR");
      return { rowCount: 1, rows: [{ count: "7" }] };
    },
  });
  const count = await CURRENCIES_CONFIG.referenceCount!(db.pool as never, { code: "MYR", name: "Malaysian Ringgit" } as never);
  assert.equal(count, 7);
});

test("department referenceCount cross-references the legacy departments table by name without any foreign key", async () => {
  const db = fakeDatabase({
    "JOIN departments d ON d.id = u.department_id": (values) => {
      assert.equal(values[0], "Operations");
      return { rowCount: 1, rows: [{ count: "4" }] };
    },
  });
  const count = await DEPARTMENTS_CONFIG.referenceCount!(db.pool as never, { name: "Operations" } as never);
  assert.equal(count, 4);
});

test("list applies search, status filtering, and pagination bounds", async () => {
  const db = fakeDatabase({
    "FROM master_data_projects": () => ({ rowCount: 1, rows: [{ id: "p1", code: "ops", name: "Operations", description: null, sort_order: 0, is_default: false, active: true, deleted_at: null, created_by: null, updated_by: null, created_at: "now", updated_at: "now", total: "1" }] }),
  });
  const service = new MasterDataService(db as never, PROJECTS_CONFIG);
  const result = await service.list({ search: "ops", page: "1", pageSize: "10", status: "active" } as never);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].code, "ops");
  const listQuery = db.calls.find((c) => c.sql.includes("FROM master_data_projects"));
  assert.equal(listQuery!.values[0], "%ops%");
  assert.equal(listQuery!.values[1], "active");
});
