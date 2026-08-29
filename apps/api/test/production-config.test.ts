import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateProductionConfig } from "../src/infrastructure/configuration/production-config.js";

const local = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://aims_app:local@localhost:5432/aims",
  STORAGE_DRIVER: "local",
  MALWARE_SCANNER_DRIVER: "deterministic-local",
};

test("development accepts explicit local storage and optional integrations disabled", () => {
  const result = validateProductionConfig(local);
  assert.equal(result.identity, "LOCAL_SESSION");
  assert.equal(result.telegramEnabled, false);
});

test("production fails closed without an approved corporate authentication adapter", () => {
  const configured={...local,STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:"provider",FINANCE_DATABASE_URL:local.DATABASE_URL,PAYMENT_DATABASE_URL:local.DATABASE_URL};
  assert.throws(() => validateProductionConfig({ ...configured, NODE_ENV: "production" }), /approved corporate adapter/);
  assert.throws(() => validateProductionConfig({ ...configured, AIMS_ENVIRONMENT: "production" }), /approved corporate adapter/);
});

test("production rejects local document storage", () => {
  assert.throws(() => validateProductionConfig({
    ...local,
    NODE_ENV: "production",
    AUTH_TRUSTED_PROXY: "true",
    FINANCE_DATABASE_URL: local.DATABASE_URL,
    PAYMENT_DATABASE_URL: local.DATABASE_URL,
  }), /private object-storage adapter/);
});

test("production rejects missing object storage, missing scanner, and deterministic local scanner",()=>{
  const base={...local,NODE_ENV:"production",FINANCE_DATABASE_URL:local.DATABASE_URL,PAYMENT_DATABASE_URL:local.DATABASE_URL};
  assert.throws(()=>validateProductionConfig({...base,STORAGE_DRIVER:""}),/private object-storage adapter/);
  assert.throws(()=>validateProductionConfig({...base,STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:""}),/malware-scanner provider/);
  assert.throws(()=>validateProductionConfig({...base,STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:"deterministic-local"}),/malware-scanner provider/);
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
    NODE_ENV: "development",
    TELEGRAM_APPROVAL_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_WEBHOOK_SECRET: "webhook",
    TELEGRAM_CALLBACK_SECRET: "callback",
  };
  assert.doesNotThrow(() => validateProductionConfig(base));
  assert.doesNotThrow(() => validateProductionConfig({ ...base, TELEGRAM_WEBHOOK_URL: "http://example.test/hook" }));
  assert.equal(validateProductionConfig({ ...base, TELEGRAM_WEBHOOK_URL: "https://example.test/hook" }).telegramEnabled, true);
});

test("staging and competition are explicitly separated",()=>{
  assert.throws(()=>validateProductionConfig({...local,AIMS_ENVIRONMENT:"staging"}),/approved test IdP adapter/);
  assert.equal(validateProductionConfig({...local,AIMS_ENVIRONMENT:"competition"}).identity,"COMPETITION_HEADER");
});

test("dashboard UI identifies Finance Control counters as live when a custom period is active", async () => {
  const source = await readFile(new URL("../../../../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /filters\.dateFrom \|\| filters\.dateTo/);
  assert.match(source, /Finance Control: current queue — live operational status, not date filtered\./);
});
