import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { UserManagementService } from "../src/application/user-management/user-management.service.js";

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

function fakeSessions() {
  const revoked: string[] = [];
  return { revokeAllForUser: async (userId: string) => { revoked.push(userId); }, revoked };
}

test("create rejects a duplicate email and an inactive department", async () => {
  const dup = fakeDatabase({
    "SELECT active FROM departments": () => ({ rowCount: 1, rows: [{ active: true }] }),
    "SELECT 1 FROM users WHERE email": () => ({ rowCount: 1, rows: [{}] }),
  });
  const service1 = new UserManagementService(dup as never, fakeSessions() as never);
  await assert.rejects(
    () => service1.create({ email: "a@example.com", displayName: "A", departmentId: "d", roles: ["REQUESTER"] } as never, actor, request()),
    ConflictException,
  );

  const badDept = fakeDatabase({ "SELECT active FROM departments": () => ({ rowCount: 1, rows: [{ active: false }] }) });
  const service2 = new UserManagementService(badDept as never, fakeSessions() as never);
  await assert.rejects(
    () => service2.create({ email: "a@example.com", displayName: "A", departmentId: "d", roles: ["REQUESTER"] } as never, actor, request()),
    BadRequestException,
  );
});

test("create inserts the user, identity, credentials, and every requested role, then audits with a display-name and role snapshot", async () => {
  const db = fakeDatabase({
    "SELECT active FROM departments": () => ({ rowCount: 1, rows: [{ active: true }] }),
    "SELECT 1 FROM users WHERE email": () => ({ rowCount: 0, rows: [] }),
  });
  const service = new UserManagementService(db as never, fakeSessions() as never);
  const result = await service.create({ email: "New.User@Example.com", displayName: "New User", departmentId: "dept-1", roles: ["REQUESTER", "FINANCE"] } as never, actor, request());
  assert.match(result.temporaryPassword, /^[A-Za-z0-9_-]{20,}$/);
  assert.ok(db.calls.some((c) => c.sql.includes("INSERT INTO users") && c.values.includes("new.user@example.com")));
  assert.ok(db.calls.some((c) => c.sql.includes("INSERT INTO user_external_identities")));
  assert.ok(db.calls.some((c) => c.sql.includes("INSERT INTO password_credentials")));
  const roleInserts = db.calls.filter((c) => c.sql.includes("INSERT INTO user_roles"));
  assert.deepEqual(roleInserts.map((c) => c.values[1]).sort(), ["FINANCE", "REQUESTER"]);
  const audit = db.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.ok(audit);
  assert.equal(audit!.values[2], "USER_CREATED");
  assert.equal(audit!.values[6], "203.0.113.9");
  assert.deepEqual(audit!.values[7], actor.roles);
  assert.equal(audit!.values[8], "Actor Name");
});

test("setActive refuses to let a Finance Master disable their own account, but allows disabling others and revokes sessions", async () => {
  const db = fakeDatabase({ "UPDATE users SET active": () => ({ rowCount: 1, rows: [{ id: "target-1" }] }) });
  const sessions = fakeSessions();
  const service = new UserManagementService(db as never, sessions as never);
  await assert.rejects(() => service.setActive(actor.id, false, actor, request()), ForbiddenException);
  await service.setActive("target-1", false, actor, request());
  assert.deepEqual(sessions.revoked, ["target-1"]);
  const audit = db.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "USER_DISABLED");
});

test("lock and unlock require the target to have password credentials", async () => {
  const noCredentials = fakeDatabase({ "SELECT 1 FROM password_credentials": () => ({ rowCount: 0, rows: [] }) });
  const service1 = new UserManagementService(noCredentials as never, fakeSessions() as never);
  await assert.rejects(() => service1.lock("target-1", actor, request()), BadRequestException);

  const withCredentials = fakeDatabase({ "SELECT 1 FROM password_credentials": () => ({ rowCount: 1, rows: [{}] }) });
  const sessions = fakeSessions();
  const service2 = new UserManagementService(withCredentials as never, sessions as never);
  await service2.lock("target-1", actor, request());
  assert.ok(withCredentials.calls.some((c) => c.sql.includes("locked_until=now() + interval '100 years'")));
  assert.deepEqual(sessions.revoked, ["target-1"]);

  await service2.unlock("target-1", actor, request());
  assert.ok(withCredentials.calls.some((c) => c.sql.includes("locked_until=NULL, failed_attempts=0")));
});

test("resetPassword issues a new temporary password, forces a change, and revokes sessions", async () => {
  const db = fakeDatabase({ "SELECT 1 FROM password_credentials": () => ({ rowCount: 1, rows: [{}] }) });
  const sessions = fakeSessions();
  const service = new UserManagementService(db as never, sessions as never);
  const result = await service.resetPassword("target-1", actor, request());
  assert.match(result.temporaryPassword, /^[A-Za-z0-9_-]{20,}$/);
  assert.ok(db.calls.some((c) => c.sql.includes("force_reset=true, failed_attempts=0, locked_until=NULL")));
  assert.deepEqual(sessions.revoked, ["target-1"]);
});

test("forcePasswordReset flags the account without revoking the current session", async () => {
  const db = fakeDatabase({ "SELECT 1 FROM password_credentials": () => ({ rowCount: 1, rows: [{}] }) });
  const sessions = fakeSessions();
  const service = new UserManagementService(db as never, sessions as never);
  await service.forcePasswordReset("target-1", actor, request());
  assert.ok(db.calls.some((c) => c.sql.includes("UPDATE password_credentials SET force_reset=true")));
  assert.deepEqual(sessions.revoked, []);
});

test("assignRoles adds and removes only what changed, and refuses to let a Finance Master remove their own Finance Master role", async () => {
  const db = fakeDatabase({
    "SELECT role FROM user_roles": () => ({ rowCount: 2, rows: [{ role: "REQUESTER" }, { role: "FINANCE_MASTER" }] }),
  });
  const service = new UserManagementService(db as never, fakeSessions() as never);
  await assert.rejects(() => service.assignRoles(actor.id, ["REQUESTER"], actor, request()), ForbiddenException);

  await service.assignRoles("target-1", ["FINANCE"], actor, request());
  assert.ok(db.calls.some((c) => c.sql.includes("INSERT INTO user_roles") && c.values[1] === "FINANCE"));
  assert.ok(db.calls.some((c) => c.sql.includes("DELETE FROM user_roles") && c.values[1] === "REQUESTER"));
  assert.ok(db.calls.some((c) => c.sql.includes("DELETE FROM user_roles") && c.values[1] === "FINANCE_MASTER"));
});

test("upsertApprovalAuthority scopes department_id to the user's own department for DEPARTMENT scope, and null for ORGANIZATION", async () => {
  const db = fakeDatabase({ "SELECT department_id FROM users": () => ({ rowCount: 1, rows: [{ department_id: "dept-9" }] }) });
  const service = new UserManagementService(db as never, fakeSessions() as never);
  await service.upsertApprovalAuthority("target-1", { authorityRole: "AM", authorityScope: "DEPARTMENT", active: true }, actor, request());
  const departmentInsert = db.calls.find((c) => c.sql.includes("INSERT INTO approval_authorities"));
  assert.equal(departmentInsert!.values[4], "dept-9");

  const db2 = fakeDatabase({ "SELECT department_id FROM users": () => ({ rowCount: 1, rows: [{ department_id: "dept-9" }] }) });
  const service2 = new UserManagementService(db2 as never, fakeSessions() as never);
  await service2.upsertApprovalAuthority("target-1", { authorityRole: "DIRECTOR", authorityScope: "ORGANIZATION", active: true }, actor, request());
  const orgInsert = db2.calls.find((c) => c.sql.includes("INSERT INTO approval_authorities"));
  assert.equal(orgInsert!.values[4], null);
});
