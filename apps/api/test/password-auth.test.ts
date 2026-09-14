import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, BadRequestException, UnauthorizedException } from "@nestjs/common";
import { PasswordAuthService } from "../src/application/auth/password-auth.service.js";
import { hashPassword } from "../src/infrastructure/security/password-hash.js";

const request = (overrides: Record<string, unknown> = {}) =>
  ({ ip: "203.0.113.5", correlationId: "test-correlation", header: () => undefined, ...overrides }) as never;
const response = () => ({}) as never;

function fakeDatabase(handlers: Record<string, (values: unknown[]) => unknown>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    calls,
    pool: {
      query: async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        for (const [needle, handler] of Object.entries(handlers)) {
          if (sql.includes(needle)) return handler(values);
        }
        return { rowCount: 0, rows: [] };
      },
    },
  };
}

function fakeSessions() {
  const revoked: string[] = [];
  return {
    requireAllowedOrigin: () => undefined,
    createPasswordSessionRecord: async () => ({ principal: { id: "user", departmentId: "dept", roles: ["REQUESTER"] }, token: "t", csrf: "c", lifetime: 28800 }),
    setPasswordSessionCookies: () => undefined,
    revokeAllForUser: async (userId: string) => { revoked.push(userId); },
    revoked,
  };
}

function fakeEmail() {
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  return { send: async (message: never) => { sent.push(message as never); }, sent };
}

test("register creates a REQUESTER-only account and starts a session", async () => {
  const db = fakeDatabase({
    "FROM self_register_requester": () => ({ rowCount: 1, rows: [{ identity_id: "identity", user_id: "user", department_id: "dept", role: "REQUESTER" }] }),
    "INSERT INTO authentication_audit_events": () => ({ rowCount: 1, rows: [] }),
  });
  const sessions = fakeSessions();
  const service = new PasswordAuthService(db as never, sessions as never, fakeEmail() as never);
  const result = await service.register(
    { email: "New.User@Example.com", password: "correct horse battery staple", displayName: "New User", departmentId: "dept-1" } as never,
    request(),
    response(),
  );
  assert.equal(result.authenticated, true);
  assert.match(result.userId, /^[0-9a-f-]{36}$/);
  const registerCall = db.calls.find((c) => c.sql.includes("self_register_requester"));
  assert.equal(registerCall?.values[2], "new.user@example.com");
});

test("register maps a duplicate email to ConflictException and an invalid department to BadRequestException", async () => {
  const conflict = fakeDatabase({
    "FROM self_register_requester": () => { throw Object.assign(new Error("dup"), { code: "23505" }); },
    "INSERT INTO authentication_audit_events": () => ({ rowCount: 1, rows: [] }),
  });
  const service1 = new PasswordAuthService(conflict as never, fakeSessions() as never, fakeEmail() as never);
  await assert.rejects(
    () => service1.register({ email: "a@example.com", password: "correct horse battery staple", displayName: "A", departmentId: "d" } as never, request(), response()),
    ConflictException,
  );

  const badDept = fakeDatabase({
    "FROM self_register_requester": () => { throw Object.assign(new Error("fk"), { code: "23503" }); },
    "INSERT INTO authentication_audit_events": () => ({ rowCount: 1, rows: [] }),
  });
  const service2 = new PasswordAuthService(badDept as never, fakeSessions() as never, fakeEmail() as never);
  await assert.rejects(
    () => service2.register({ email: "a@example.com", password: "correct horse battery staple", displayName: "A", departmentId: "d" } as never, request(), response()),
    BadRequestException,
  );
});

test("login rejects an unknown email without revealing whether the account exists", async () => {
  const db = fakeDatabase({ "INSERT INTO authentication_audit_events": () => ({ rowCount: 1, rows: [] }) });
  const service = new PasswordAuthService(db as never, fakeSessions() as never, fakeEmail() as never);
  await assert.rejects(
    () => service.login({ email: "ghost@example.com", password: "whatever12345" } as never, request(), response()),
    /Invalid email or password/,
  );
});

test("login locks the account after repeated failures and rejects while locked", async () => {
  const { hash, salt, params } = await hashPassword("correct horse battery staple");
  let failedAttempts = 4;
  const db = fakeDatabase({
    "FROM user_external_identities": () => ({
      rowCount: 1,
      rows: [{ user_id: "user", department_id: "dept", role: "REQUESTER", identity_id: "identity", hash, salt, scrypt_params: params, failed_attempts: failedAttempts, locked_until: null, force_reset: false }],
    }),
    "UPDATE password_credentials SET failed_attempts": (values) => { failedAttempts = values[1] as number; return { rowCount: 1, rows: [] }; },
    "INSERT INTO authentication_audit_events": () => ({ rowCount: 1, rows: [] }),
  });
  const service = new PasswordAuthService(db as never, fakeSessions() as never, fakeEmail() as never);
  await assert.rejects(() => service.login({ email: "user@example.com", password: "wrong password entirely" } as never, request(), response()), /Invalid email or password/);
  assert.equal(failedAttempts, 5);
});

test("login succeeds with the correct password and reports mustChangePassword", async () => {
  const { hash, salt, params } = await hashPassword("correct horse battery staple");
  const db = fakeDatabase({
    "FROM user_external_identities": () => ({
      rowCount: 1,
      rows: [{ user_id: "user", department_id: "dept", role: "REQUESTER", identity_id: "identity", hash, salt, scrypt_params: params, failed_attempts: 0, locked_until: null, force_reset: true }],
    }),
    "UPDATE password_credentials SET failed_attempts=0": () => ({ rowCount: 1, rows: [] }),
    "INSERT INTO authentication_audit_events": () => ({ rowCount: 1, rows: [] }),
  });
  const service = new PasswordAuthService(db as never, fakeSessions() as never, fakeEmail() as never);
  const result = await service.login({ email: "user@example.com", password: "correct horse battery staple" } as never, request(), response());
  assert.deepEqual(result, { authenticated: true, userId: "user", mustChangePassword: true });
});

test("forgot-password never reveals whether the account exists and only emails known accounts", async () => {
  const email = fakeEmail();
  const known = fakeDatabase({
    "FROM user_external_identities": () => ({ rowCount: 1, rows: [{ user_id: "user", email: "user@example.com" }] }),
    "INSERT INTO password_reset_tokens": () => ({ rowCount: 1, rows: [] }),
    "INSERT INTO authentication_audit_events": () => ({ rowCount: 1, rows: [] }),
  });
  const service1 = new PasswordAuthService(known as never, fakeSessions() as never, email as never);
  assert.deepEqual(await service1.forgotPassword({ email: "user@example.com" } as never, request()), { ok: true });
  assert.equal(email.sent.length, 1);
  assert.equal(email.sent[0].to, "user@example.com");

  const unknown = fakeDatabase({});
  const service2 = new PasswordAuthService(unknown as never, fakeSessions() as never, email as never);
  assert.deepEqual(await service2.forgotPassword({ email: "ghost@example.com" } as never, request()), { ok: true });
  assert.equal(email.sent.length, 1);
});

test("reset-password rejects an invalid or expired token and accepts a valid one, revoking sessions", async () => {
  const sessions = fakeSessions();
  const invalid = fakeDatabase({ "INSERT INTO authentication_audit_events": () => ({ rowCount: 1, rows: [] }) });
  const service1 = new PasswordAuthService(invalid as never, sessions as never, fakeEmail() as never);
  await assert.rejects(() => service1.resetPassword({ token: "x".repeat(40), newPassword: "brand new password 123" } as never, request()), UnauthorizedException);

  const valid = fakeDatabase({
    "FROM password_reset_tokens": () => ({ rowCount: 1, rows: [{ id: "token-1", user_id: "user" }] }),
    "UPDATE password_credentials SET hash": () => ({ rowCount: 1, rows: [] }),
    "UPDATE password_reset_tokens SET used_at": () => ({ rowCount: 1, rows: [] }),
    "INSERT INTO authentication_audit_events": () => ({ rowCount: 1, rows: [] }),
  });
  const service2 = new PasswordAuthService(valid as never, sessions as never, fakeEmail() as never);
  assert.deepEqual(await service2.resetPassword({ token: "y".repeat(40), newPassword: "brand new password 123" } as never, request()), { ok: true });
  assert.deepEqual(sessions.revoked, ["user"]);
});

test("authenticated password change verifies the current password, clears force reset, revokes sessions, and audits",async()=>{
  const old=await hashPassword("temporary password 123");const calls:Array<{sql:string;values:unknown[]}>=[];
  const query=async(sql:string,values:unknown[]=[])=>{calls.push({sql,values});if(sql.includes("SELECT user_id,NULL::uuid"))return{rowCount:1,rows:[{user_id:"user",hash:old.hash,salt:old.salt,scrypt_params:old.params,failed_attempts:0,locked_until:null,force_reset:true}]};return{rowCount:1,rows:[]}};
  let loggedOut=false;const sessions={logout:async()=>{loggedOut=true}};
  const service=new PasswordAuthService({pool:{query},retryableTransaction:async(fn:(client:{query:typeof query})=>Promise<unknown>)=>fn({query})} as never,sessions as never,fakeEmail() as never);
  const result=await service.changePassword({id:"user",departmentId:"dept",roles:["REQUESTER"]} as never,{currentPassword:"temporary password 123",newPassword:"permanent password 456",confirmPassword:"permanent password 456"},request(),response());
  assert.deepEqual(result,{changed:true,reauthenticationRequired:true});assert.equal(loggedOut,true);assert.ok(calls.some(c=>c.sql.includes("force_reset=false")));assert.ok(calls.some(c=>c.sql.includes("'PASSWORD_CHANGED'")));
});
