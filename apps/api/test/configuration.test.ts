import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConfigurationService } from "../src/application/configuration/configuration.service.js";
import { defaultPayloadFor } from "../src/application/configuration/configuration.defaults.js";

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
  const service = new ConfigurationService({ pool: { query }, transaction: async (operation: (client: { query: typeof query }) => Promise<unknown>) => operation({ query }) } as never);
  return { calls, service };
}

test("getActive returns category defaults when nothing has ever been published", async () => {
  const { service } = fakeDatabase({});
  const active = await service.getActive("company");
  assert.equal(active.version, 0);
  assert.deepEqual(active.payload, defaultPayloadFor("company"));
});

test("getActive rejects an unknown category", async () => {
  const { service } = fakeDatabase({});
  await assert.rejects(() => service.getActive("not-a-category"), BadRequestException);
});

test("workflow configuration accepts only the frozen authority contract",async()=>{
  const {service}=fakeDatabase({});
  const active=await service.getActive("workflow");assert.deepEqual(active.payload,defaultPayloadFor("workflow"));
  const invalid={...defaultPayloadFor("workflow"),stageCount:13};
  const configured=fakeDatabase({"SELECT * FROM configuration_versions WHERE category=$1 AND status='draft'":()=>({rowCount:1,rows:[{id:"draft",payload:invalid}]})});
  const preview=await configured.service.preview("workflow");assert.equal(preview.canPublish,false);assert.match(preview.validationErrors[0],/frozen Enterprise workflow/);
});

test("saveDraft creates a new draft when none exists and audits DRAFT_CREATED", async () => {
  const { calls, service } = fakeDatabase({ "SELECT id FROM configuration_versions": () => ({ rowCount: 0, rows: [] }) });
  const payload = { ...defaultPayloadFor("system") };
  await service.saveDraft("system", payload, actor, request());
  const insert = calls.find((c) => c.sql.includes("INSERT INTO configuration_versions"));
  assert.ok(insert, "expected an insert for the new draft");
  assert.equal(insert!.values[1], "system");
  assert.equal(insert!.values[2], JSON.stringify(payload));
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "CONFIGURATION_DRAFT_CREATED");
  assert.equal(audit!.values[4], insert!.values[0]);
});

test("saveDraft updates the existing draft in place and audits DRAFT_UPDATED", async () => {
  const { calls, service } = fakeDatabase({ "SELECT id FROM configuration_versions": () => ({ rowCount: 1, rows: [{ id: "draft-1" }] }) });
  const payload = { ...defaultPayloadFor("system"), sessionTimeoutMinutes: 45 };
  await service.saveDraft("system", payload, actor, request());
  const update = calls.find((c) => c.sql.includes("UPDATE configuration_versions SET payload="));
  assert.deepEqual(update!.values, ["draft-1", JSON.stringify(payload)]);
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "CONFIGURATION_DRAFT_UPDATED");
  assert.equal(audit!.values[4], "draft-1");
});

test("discardDraft deletes the draft and audits, or raises NotFoundException when there is none", async () => {
  const present = fakeDatabase({ "DELETE FROM configuration_versions": () => ({ rowCount: 1, rows: [{ id: "draft-1" }] }) });
  await present.service.discardDraft("finance", actor, request());
  const audit = present.calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "CONFIGURATION_DRAFT_DISCARDED");
  assert.equal(audit!.values[4], "draft-1");

  const absent = fakeDatabase({ "DELETE FROM configuration_versions": () => ({ rowCount: 0, rows: [] }) });
  await assert.rejects(() => absent.service.discardDraft("finance", actor, request()), NotFoundException);
});

test("preview surfaces validation errors and never persists anything", async () => {
  const invalidAi = { ...defaultPayloadFor("ai"), temperature: 5 };
  const { calls, service } = fakeDatabase({
    "SELECT * FROM configuration_versions WHERE category=$1 AND status='draft'": () => ({ rowCount: 1, rows: [{ id: "draft-1", payload: invalidAi }] }),
  });
  const preview = await service.preview("ai");
  assert.equal(preview.canPublish, false);
  assert.ok(preview.validationErrors.some((message) => message.includes("Temperature")));
  assert.equal(preview.nextVersion, 1);
  assert.ok(!calls.some((c) => /^(INSERT|UPDATE|DELETE)/.test(c.sql.trim())), "preview must be read-only");
});

test("publish rejects an invalid draft without writing a new version", async () => {
  const invalidSystem = { ...defaultPayloadFor("system"), maximumUploadCount: 0 };
  const { calls, service } = fakeDatabase({
    "SELECT * FROM configuration_versions WHERE category=$1 AND status='draft' FOR UPDATE": () => ({ rowCount: 1, rows: [{ id: "draft-1", payload: invalidSystem }] }),
  });
  await assert.rejects(() => service.publish("system", "Rolling out new limits", actor, request()), BadRequestException);
  assert.ok(!calls.some((c) => c.sql.includes("SET status='published'")));
});

test("publish marks the draft published as version 1 and audits PUBLISHED", async () => {
  const validSystem = { ...defaultPayloadFor("system") };
  const { calls, service } = fakeDatabase({
    "SELECT * FROM configuration_versions WHERE category=$1 AND status='draft' FOR UPDATE": () => ({ rowCount: 1, rows: [{ id: "draft-1", payload: validSystem }] }),
  });
  const result = await service.publish("system", "Initial rollout", actor, request());
  assert.equal(result.version, 1);
  const publish = calls.find((c) => c.sql.includes("SET status='published'"));
  assert.equal(publish!.values[0], "draft-1");
  assert.equal(publish!.values[1], 1);
  assert.equal(publish!.values[2], "Initial rollout");
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "CONFIGURATION_PUBLISHED");
  assert.equal(audit!.values[4], "draft-1");
});

test("rollback publishes a new version copying a valid historical payload", async () => {
  const validNumbering = defaultPayloadFor("numbering");
  const { calls, service } = fakeDatabase({
    "SELECT * FROM configuration_versions WHERE category=$1 AND status='published' AND version=$2": () => ({ rowCount: 1, rows: [{ payload: validNumbering }] }),
    "SELECT max(version) max": () => ({ rowCount: 1, rows: [{ max: 3 }] }),
  });
  const result = await service.rollback("numbering", 2, "Reverting a bad change", actor, request());
  assert.equal(result.version, 4);
  const insert = calls.find((c) => c.sql.includes("INSERT INTO configuration_versions"));
  assert.equal(insert!.values[2], 4);
  assert.ok((insert!.values[4] as string).startsWith("Rollback to version 2: Reverting a bad change"));
  const audit = calls.find((c) => c.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit!.values[2], "CONFIGURATION_ROLLED_BACK");
});

test("rollback refuses a historical payload that is no longer valid", async () => {
  const duplicatePrefixNumbering = {
    documentTypes: {
      ...(defaultPayloadFor("numbering").documentTypes as Record<string, unknown>),
      CLAIM: (defaultPayloadFor("numbering").documentTypes as never as Record<string, { prefix: string }>).PAYMENT_REQUEST,
    },
  };
  const { calls, service } = fakeDatabase({
    "SELECT * FROM configuration_versions WHERE category=$1 AND status='published' AND version=$2": () => ({ rowCount: 1, rows: [{ payload: duplicatePrefixNumbering }] }),
  });
  await assert.rejects(() => service.rollback("numbering", 1, "Reverting", actor, request()), ConflictException);
  assert.ok(!calls.some((c) => c.sql.includes("INSERT INTO configuration_versions")));
});
