import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolePermissionService } from "../src/application/role-permission/role-permission.service.js";
import { PermissionGuard } from "../src/application/auth/permission.guard.js";
import { PERMISSION_METADATA_KEY } from "../src/application/auth/require-permission.decorator.js";

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

test("create generates a unique code from the name, inserts the requested permissions, and audits with the permission count", async () => {
  const db = fakeDatabase({
    "SELECT 1 FROM roles WHERE code": () => ({ rowCount: 0, rows: [] }),
    "SELECT id FROM permissions WHERE id = ANY": () => ({ rowCount: 2, rows: [{ id: "perm-1" }, { id: "perm-2" }] }),
  });
  const service = new RolePermissionService(db as never);
  const result = await service.create({ name: "Regional Approver", description: "desc", permissionIds: ["perm-1", "perm-2"] } as never, actor, request());
  assert.equal(result.code, "REGIONAL_APPROVER");
  const roleInsert = db.calls.find((c) => c.sql.includes("INSERT INTO roles(id,code,name,description,is_system,disabled)"));
  assert.deepEqual(roleInsert!.values, [result.id, "REGIONAL_APPROVER", "Regional Approver", "desc"]);
  const permissionInserts = db.calls.filter((c) => c.sql.includes("INSERT INTO role_permissions"));
  assert.deepEqual(permissionInserts.map((c) => c.values[1]).sort(), ["perm-1", "perm-2"]);
  const audit = db.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "ROLE_CREATED");
  assert.match((audit!.values[5] as string), /"permissionCount":2/);
});

test("create rejects an unknown permission id", async () => {
  const db = fakeDatabase({
    "SELECT 1 FROM roles WHERE code": () => ({ rowCount: 0, rows: [] }),
    "SELECT id FROM permissions WHERE id = ANY": () => ({ rowCount: 1, rows: [{ id: "perm-1" }] }),
  });
  const service = new RolePermissionService(db as never);
  await assert.rejects(
    () => service.create({ name: "X", permissionIds: ["perm-1", "perm-2"] } as never, actor, request()),
    BadRequestException,
  );
});

test("update refuses to edit the Technical Admin (is_system) role", async () => {
  const db = fakeDatabase({
    "SELECT code, name, description, is_system, disabled FROM roles WHERE id": () =>
      ({ rowCount: 1, rows: [{ code: "ADMIN", name: "Technical Admin", description: null, is_system: true, disabled: false }] }),
  });
  const service = new RolePermissionService(db as never);
  await assert.rejects(() => service.update("role-admin", { name: "Hacked" } as never, actor, request()), ForbiddenException);
});

test("update toggles disabled and audits ROLE_DISABLED distinctly from a plain field edit", async () => {
  const db = fakeDatabase({
    "SELECT code, name, description, is_system, disabled FROM roles WHERE id": () =>
      ({ rowCount: 1, rows: [{ code: "FOO", name: "Foo", description: null, is_system: false, disabled: false }] }),
  });
  const service = new RolePermissionService(db as never);
  await service.update("role-1", { disabled: true } as never, actor, request());
  const update = db.calls.find((c) => c.sql.includes("UPDATE roles SET name="));
  assert.deepEqual(update!.values, ["role-1", "Foo", null, true]);
  const audit = db.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "ROLE_DISABLED");
});

test("clone copies the source role's permission set into a newly coded role and audits the source", async () => {
  const db = fakeDatabase({
    "SELECT description FROM roles WHERE id": () => ({ rowCount: 1, rows: [{ description: "Source desc" }] }),
    "SELECT 1 FROM roles WHERE code": () => ({ rowCount: 0, rows: [] }),
  });
  const service = new RolePermissionService(db as never);
  const result = await service.clone("role-source", { name: "Finance Analyst Copy" } as never, actor, request());
  assert.equal(result.code, "FINANCE_ANALYST_COPY");
  const roleInsert = db.calls.find((c) => c.sql.includes("INSERT INTO roles(id,code,name,description,is_system,disabled)"));
  assert.deepEqual(roleInsert!.values, [result.id, "FINANCE_ANALYST_COPY", "Finance Analyst Copy", "Source desc"]);
  const copy = db.calls.find((c) => c.sql.includes("INSERT INTO role_permissions(role_id,permission_id) SELECT $1, permission_id FROM role_permissions WHERE role_id=$2"));
  assert.deepEqual(copy!.values, [result.id, "role-source"]);
  const audit = db.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "ROLE_CLONED");
  assert.match((audit!.values[5] as string), /"sourceRoleId":"role-source"/);
});

test("setPermissions refuses the Technical Admin role, and otherwise adds/removes only the diff", async () => {
  const systemDb = fakeDatabase({ "SELECT code, is_system FROM roles WHERE id": () => ({ rowCount: 1, rows: [{ code: "ADMIN", is_system: true }] }) });
  const systemService = new RolePermissionService(systemDb as never);
  await assert.rejects(() => systemService.setPermissions("role-admin", { permissionIds: [] } as never, actor, request()), ForbiddenException);

  const db = fakeDatabase({
    "SELECT code, is_system FROM roles WHERE id": () => ({ rowCount: 1, rows: [{ code: "FOO", is_system: false }] }),
    "SELECT permission_id FROM role_permissions WHERE role_id": () => ({ rowCount: 2, rows: [{ permission_id: "perm-1" }, { permission_id: "perm-2" }] }),
    "SELECT id FROM permissions WHERE id = ANY": () => ({ rowCount: 2, rows: [{ id: "perm-2" }, { id: "perm-3" }] }),
  });
  const service = new RolePermissionService(db as never);
  await service.setPermissions("role-1", { permissionIds: ["perm-2", "perm-3"], reason: "quarterly review" } as never, actor, request());
  const added = db.calls.find((c) => c.sql.includes("INSERT INTO role_permissions") && c.values[1] === "perm-3");
  const removed = db.calls.find((c) => c.sql.includes("DELETE FROM role_permissions") && c.values[1] === "perm-1");
  assert.ok(added);
  assert.ok(removed);
  const audit = db.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "ROLE_PERMISSIONS_UPDATED");
  assert.match((audit!.values[5] as string), /"added":1,"removed":1,"reason":"quarterly review"/);
});

test("getEffectivePermissionCodes unions permissions across every role a user holds, adding APPROVER only when an active approval authority exists", async () => {
  const withAuthority = fakeDatabase({
    "SELECT 1 FROM approval_authorities WHERE user_id": () => ({ rowCount: 1, rows: [{}] }),
    "SELECT DISTINCT p.code": (values) => {
      assert.deepEqual([...(values[0] as string[])].sort(), ["APPROVER", "FINANCE", "REQUESTER"]);
      return { rowCount: 3, rows: [{ code: "REQUEST_CREATE" }, { code: "APPROVAL_APPROVE" }, { code: "FINANCE_CONTEXT_VIEW" }] };
    },
  });
  const service = new RolePermissionService(withAuthority as never);
  const codes = await service.getEffectivePermissionCodes({ id: "user-1", departmentId: "d", roles: ["REQUESTER", "FINANCE"] } as never);
  assert.deepEqual([...codes].sort(), ["APPROVAL_APPROVE", "FINANCE_CONTEXT_VIEW", "REQUEST_CREATE"]);

  const withoutAuthority = fakeDatabase({
    "SELECT 1 FROM approval_authorities WHERE user_id": () => ({ rowCount: 0, rows: [] }),
    "SELECT DISTINCT p.code": (values) => {
      assert.deepEqual([...(values[0] as string[])].sort(), ["FINANCE", "REQUESTER"]);
      return { rowCount: 0, rows: [] };
    },
  });
  const service2 = new RolePermissionService(withoutAuthority as never);
  const codes2 = await service2.getEffectivePermissionCodes({ id: "user-1", departmentId: "d", roles: ["REQUESTER", "FINANCE"] } as never);
  assert.deepEqual([...codes2], []);
});

function fakeContext(requiredPermission: string | undefined, principal: unknown) {
  const handler = function targetHandler() {};
  if (requiredPermission) Reflect.defineMetadata(PERMISSION_METADATA_KEY, requiredPermission, handler);
  class TargetClass {}
  return {
    getHandler: () => handler,
    getClass: () => TargetClass,
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as never;
}

test("PermissionGuard passes routes with no required permission, and enforces the required code against the effective union otherwise", async () => {
  const rolePermissions = { getEffectivePermissionCodes: async () => new Set(["REQUEST_CREATE"]) };
  const guard = new PermissionGuard(new Reflector(), rolePermissions as never);
  assert.equal(await guard.canActivate(fakeContext(undefined, { id: "u1", roles: [] })), true);
  assert.equal(await guard.canActivate(fakeContext("REQUEST_CREATE", { id: "u1", roles: [] })), true);
  await assert.rejects(() => guard.canActivate(fakeContext("USER_DELETE", { id: "u1", roles: [] })), ForbiddenException);
});
