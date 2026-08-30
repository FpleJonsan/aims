import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateProductionConfig } from "../src/infrastructure/configuration/production-config.js";
import { redactSensitiveData, redactSensitiveText, SERVER_SECRET_NAMES } from "../src/infrastructure/configuration/secret-boundary.js";

const local = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://aims_app:local@localhost:5432/aims",
  STORAGE_DRIVER: "local",
  MALWARE_SCANNER_DRIVER: "deterministic-local",
};
const productionUrl=(user:string,database="aims_production")=>`postgresql://${user}:strong-runtime-value@db.internal/${database}?sslmode=verify-full`;
const productionDatabase={AIMS_EXPECTED_DATABASE:"aims_production",DATABASE_URL:productionUrl("aims_app"),FINANCE_DATABASE_URL:productionUrl("aims_finance_runtime"),PAYMENT_DATABASE_URL:productionUrl("aims_payment_runtime")};

test("development accepts explicit local storage and optional integrations disabled", () => {
  const result = validateProductionConfig(local);
  assert.equal(result.identity, "LOCAL_SESSION");
  assert.equal(result.telegramEnabled, false);
});

test("production fails closed without an approved corporate authentication adapter", () => {
  const configured={...local,...productionDatabase,STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:"provider"};
  assert.throws(() => validateProductionConfig({ ...configured, NODE_ENV: "production" }), /approved corporate adapter/);
  assert.throws(() => validateProductionConfig({ ...configured, AIMS_ENVIRONMENT: "production" }), /approved corporate adapter/);
});

test("production rejects local document storage", () => {
  assert.throws(() => validateProductionConfig({
    ...local,
    ...productionDatabase,
    NODE_ENV: "production",
    AUTH_TRUSTED_PROXY: "true",
  }), /private object-storage adapter/);
});

test("production rejects missing object storage, missing scanner, and deterministic local scanner",()=>{
  const base={...local,...productionDatabase,NODE_ENV:"production"};
  assert.throws(()=>validateProductionConfig({...base,STORAGE_DRIVER:""}),/private object-storage adapter/);
  assert.throws(()=>validateProductionConfig({...base,STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:""}),/malware-scanner provider/);
  assert.throws(()=>validateProductionConfig({...base,STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:"deterministic-local"}),/malware-scanner provider/);
});

test("production rejects placeholder and incomplete database credentials", () => {
  const production = {...local,...productionDatabase,NODE_ENV:"production",STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:"provider"};
  assert.throws(() => validateProductionConfig({...production,DATABASE_URL:"postgresql://aims_app:replace_with_password@db.internal/aims_production?sslmode=verify-full"}), /placeholder credential/);
  assert.throws(() => validateProductionConfig({...local,DATABASE_URL:"postgresql://db.internal/aims"}), /injected runtime credential/);
});

test("production rejects competition compatibility mode", () => {
  const production = {...local,...productionDatabase,NODE_ENV:"production",AIMS_DEMO_MODE:"true",STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:"provider"};
  assert.throws(() => validateProductionConfig(production), /competition identity mode/);
});

test("production database identity, TLS, and role separation fail closed",()=>{
 const base={...local,...productionDatabase,NODE_ENV:"production",STORAGE_DRIVER:"object",MALWARE_SCANNER_DRIVER:"provider"};
 assert.throws(()=>validateProductionConfig({...base,AIMS_EXPECTED_DATABASE:"aims_competition"}),/AIMS_EXPECTED_DATABASE|isolated non-local database/);
 assert.throws(()=>validateProductionConfig({...base,DATABASE_URL:productionUrl("aims_app").replace("?sslmode=verify-full","")}),/sslmode=verify-full/);
 assert.throws(()=>validateProductionConfig({...base,DATABASE_URL:productionUrl("postgres")}),/administrator identity/);
 assert.throws(()=>validateProductionConfig({...base,PAYMENT_DATABASE_URL:productionUrl("aims_finance_runtime")}),/identities must be distinct/);
 assert.throws(()=>validateProductionConfig({...base,DATABASE_URL:productionUrl("aims_app","wrong_database")}),/AIMS_EXPECTED_DATABASE/);
});

test("secret redaction protects structured and unstructured boundaries", () => {
  const canary="p5-canary-not-a-real-secret", connection=`postgresql://aims:${canary}@localhost:5432/aims`;
  const serialized=JSON.stringify(redactSensitiveData({authorization:`Bearer ${canary}`,nested:{databaseUrl:connection,note:`password=${canary}`}}));
  assert.doesNotMatch(serialized,new RegExp(canary));
  assert.match(serialized,/REDACTED/);
  assert.doesNotMatch(redactSensitiveText(`failed ${connection}`),new RegExp(canary));
});

test("server secret catalogue excludes browser-public configuration", () => {
  assert.ok(SERVER_SECRET_NAMES.includes("DATABASE_URL"));
  assert.ok(SERVER_SECRET_NAMES.includes("OPENAI_API_KEY"));
  assert.equal(SERVER_SECRET_NAMES.some((name)=>name.startsWith("NEXT_PUBLIC_")),false);
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
