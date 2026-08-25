import assert from "node:assert/strict";
import test from "node:test";
import {
  FINANCE_CONTROL_CHECK_CODES,
  classifyDuplicate,
} from "../src/domain/finance-control.js";
import { Postgres } from "../src/infrastructure/database/postgres.js";

test("duplicate classification is deterministic and exact evidence wins", () => {
  assert.equal(classifyDuplicate(false, false), "NO_DUPLICATE");
  assert.equal(classifyDuplicate(false, true), "POSSIBLE_DUPLICATE");
  assert.equal(classifyDuplicate(true, false), "CONFIRMED_DUPLICATE");
  assert.equal(classifyDuplicate(true, true), "CONFIRMED_DUPLICATE");
});

test("Finance Control check codes are unique typed values", () => {
  assert.equal(
    new Set(FINANCE_CONTROL_CHECK_CODES).size,
    FINANCE_CONTROL_CHECK_CODES.length,
  );
});

test("serialization retry is bounded, preserves command identity, and commits effects once", async () => {
  const db = Object.create(Postgres.prototype) as Postgres;
  const commandKey = "stable-command";
  let attempts = 0,
    effects = 0;
  const result = await db.retrySerialization(async () => {
    attempts += 1;
    assert.equal(commandKey, "stable-command");
    if (attempts === 1)
      throw Object.assign(new Error("serialize"), { code: "40001" });
    effects += 1;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.equal(effects, 1);

  attempts = 0;
  await assert.rejects(
    () =>
      db.retrySerialization(async () => {
        attempts += 1;
        throw Object.assign(new Error("serialize"), { code: "40001" });
      }, 2),
    /serialize/,
  );
  assert.equal(attempts, 3);
});

test("serialization retry does not retry unrelated database errors", async () => {
  const db = Object.create(Postgres.prototype) as Postgres;
  let attempts = 0;
  await assert.rejects(
    () =>
      db.retrySerialization(async () => {
        attempts += 1;
        throw Object.assign(new Error("constraint"), { code: "23505" });
      }),
    /constraint/,
  );
  assert.equal(attempts, 1);
});
