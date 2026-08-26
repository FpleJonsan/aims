import assert from "node:assert/strict";
import test from "node:test";
import { HealthService } from "../src/application/health/health.service.js";

test("AI OFF is reported disabled and does not make readiness fail", async () => {
  const previous = { ...process.env };
  process.env.STORAGE_DRIVER = "local";
  process.env.TELEGRAM_APPROVAL_ENABLED = "false";
  delete process.env.OPENAI_API_KEY;
  const pool = { query: async (query: string) => query.includes("ai_feature_configuration") ? { rows: [{ enabled: false }] } : query.includes("aims_schema_version") ? { rows: [{ version: 53, migration_id: "053_day10_1_schema_readiness" }] } : { rows: [{ "?column?": 1 }] } };
  try {
    const result = await new HealthService({ pool, financePool: pool, paymentPool: pool } as never).readiness();
    assert.equal(result.status, "ready");
    assert.equal(result.checks.ai.status, "disabled");
    assert.equal(result.checks.telegram.status, "disabled");
  } finally { process.env = previous; }
});

test("AI ON with a configured provider and current schema is ready", async () => {
  const previous = { ...process.env };
  process.env.STORAGE_DRIVER = "local"; process.env.OPENAI_API_KEY = "configured"; process.env.TELEGRAM_APPROVAL_ENABLED = "false";
  const pool = { query: async (query: string) => query.includes("ai_feature_configuration") ? { rows: [{ enabled: true }] } : query.includes("aims_schema_version") ? { rows: [{ version: 53 }] } : { rows: [{}] } };
  try { assert.equal((await new HealthService({ pool, financePool: pool, paymentPool: pool } as never).readiness()).status, "ready"); }
  finally { process.env = previous; }
});

for (const [label, failure] of [
  ["missing AI configuration table", "ai"],
  ["permission failure reading AI configuration", "ai"],
] as const) test(`${label} is not interpreted as AI OFF`, async () => {
  const previous = { ...process.env }; process.env.STORAGE_DRIVER = "local"; process.env.TELEGRAM_APPROVAL_ENABLED = "false";
  const pool = { query: async (query: string) => {
    if (query.includes("aims_schema_version")) return { rows: [{ version: 53 }] };
    if (query.includes("ai_feature_configuration")) throw new Error(failure);
    return { rows: [{}] };
  } };
  try {
    const result = await new HealthService({ pool, financePool: pool, paymentPool: pool } as never).readiness();
    assert.equal(result.status, "not_ready"); assert.equal(result.checks.ai.status, "not_ready");
  } finally { process.env = previous; }
});

test("a database behind the required migration version is not ready", async () => {
  const previous = { ...process.env }; process.env.STORAGE_DRIVER = "local"; process.env.TELEGRAM_APPROVAL_ENABLED = "false";
  const pool = { query: async (query: string) => query.includes("aims_schema_version") ? { rows: [{ version: 52 }] } : query.includes("ai_feature_configuration") ? { rows: [{ enabled: false }] } : { rows: [{}] } };
  try {
    const result = await new HealthService({ pool, financePool: pool, paymentPool: pool } as never).readiness();
    assert.equal(result.status, "not_ready"); assert.match(String(result.checks.schema.detail), /expected 53/);
  } finally { process.env = previous; }
});

test("a missing schema version table is not ready", async () => {
  const previous = { ...process.env }; process.env.STORAGE_DRIVER = "local"; process.env.TELEGRAM_APPROVAL_ENABLED = "false";
  const pool = { query: async (query: string) => { if (query.includes("aims_schema_version")) throw new Error("missing"); if (query.includes("ai_feature_configuration")) return { rows: [{ enabled: false }] }; return { rows: [{}] }; } };
  try { assert.equal((await new HealthService({ pool, financePool: pool, paymentPool: pool } as never).readiness()).status, "not_ready"); }
  finally { process.env = previous; }
});

test("required database and enabled optional dependency failures make readiness fail", async () => {
  const previous = { ...process.env };
  process.env.STORAGE_DRIVER = "local";
  process.env.TELEGRAM_APPROVAL_ENABLED = "true";
  delete process.env.TELEGRAM_BOT_TOKEN;
  const failed = { query: async () => { throw new Error("offline"); } };
  try {
    const result = await new HealthService({ pool: failed, financePool: null, paymentPool: null } as never).readiness();
    assert.equal(result.status, "not_ready");
    assert.equal(result.checks.postgresql.status, "not_ready");
    assert.equal(result.checks.telegram.status, "not_ready");
  } finally { process.env = previous; }
});
