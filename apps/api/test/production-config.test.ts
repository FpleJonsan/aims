import assert from "node:assert/strict";
import test from "node:test";
import { validateProductionConfig } from "../src/infrastructure/configuration/production-config.js";

const local = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://aims_app:local@localhost:5432/aims",
  STORAGE_DRIVER: "local",
};

test("development accepts explicit local storage and optional integrations disabled", () => {
  const result = validateProductionConfig(local);
  assert.equal(result.identity, "LOCAL_HEADER");
  assert.equal(result.telegramEnabled, false);
});

test("production fails closed without trusted identity and trusted executors", () => {
  assert.throws(() => validateProductionConfig({ ...local, NODE_ENV: "production" }), /FINANCE_DATABASE_URL/);
});

test("production rejects local document storage", () => {
  assert.throws(() => validateProductionConfig({
    ...local,
    NODE_ENV: "production",
    AUTH_TRUSTED_PROXY: "true",
    FINANCE_DATABASE_URL: local.DATABASE_URL,
    PAYMENT_DATABASE_URL: local.DATABASE_URL,
  }), /Local document storage is forbidden/);
});

test("AI OFF has no OpenAI credential dependency", () => {
  assert.doesNotThrow(() => validateProductionConfig({ ...local, AI_MASTER: "OFF" }));
});

test("AI ON requires provider configuration", () => {
  assert.throws(() => validateProductionConfig({ ...local, AI_MASTER: "ON" }), /OPENAI_API_KEY/);
});

test("enabled Telegram requires all channel secrets", () => {
  assert.throws(() => validateProductionConfig({ ...local, TELEGRAM_APPROVAL_ENABLED: "true" }), /TELEGRAM_BOT_TOKEN/);
});

test("production Telegram secrets and webhook must be strong and HTTPS", () => {
  const base = {
    ...local,
    NODE_ENV: "production",
    AUTH_TRUSTED_PROXY: "true",
    FINANCE_DATABASE_URL: local.DATABASE_URL,
    PAYMENT_DATABASE_URL: local.DATABASE_URL,
    STORAGE_DRIVER: "s3",
    TELEGRAM_APPROVAL_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "x".repeat(32),
    TELEGRAM_WEBHOOK_SECRET: "y".repeat(32),
    TELEGRAM_CALLBACK_SECRET: "z".repeat(32),
  };
  assert.throws(() => validateProductionConfig(base), /TELEGRAM_WEBHOOK_URL/);
  assert.throws(() => validateProductionConfig({ ...base, TELEGRAM_WEBHOOK_URL: "http://example.test/hook" }), /HTTPS/);
  assert.equal(validateProductionConfig({ ...base, TELEGRAM_WEBHOOK_URL: "https://example.test/hook" }).telegramEnabled, true);
});
