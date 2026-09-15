import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAiReliabilityConfig,
  AI_BOUNDS,
} from "../src/infrastructure/ai/ai-governance.js";
import {
  createAiProvider,
  createAiRuntimeProvider,
} from "../src/infrastructure/ai/ai-provider-factory.js";
import {
  AiProviderError,
  OpenAiCompatibleProvider,
  resolveTemperature,
  supportsCustomTemperature,
} from "../src/infrastructure/ai/openai-compatible-provider.js";
import { loadPublishedAiConfig } from "../src/application/configuration/ai-runtime-config.js";
import type { Queryable } from "../src/application/configuration/configuration.types.js";
const ok = () =>
  new Response(
    JSON.stringify({
      output_text: '{"result":"OK"}',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }),
    { status: 200 },
  );
const failure = (status: number) =>
  new Response(JSON.stringify({ error: { message: "safe" } }), { status });
const provider = (
  responses: Array<Response | Error>,
  delays: number[] = [],
  config = {
    requestTimeoutMs: 50,
    maxRetries: 2,
    retryBaseDelayMs: 1,
    maxResponseBytes: 1024,
  },
) => {
  let calls = 0;
  const instance = new OpenAiCompatibleProvider(
    "test-key",
    "test-model",
    "https://provider.test/v1",
    config,
    {
      fetch: async () => {
        const value = responses[calls++];
        if (value instanceof Error) throw value;
        return value;
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0,
    },
  );
  return { instance, calls: () => calls };
};
const classified = (classification: string) => (error: unknown) =>
  error instanceof AiProviderError &&
  error.details.classification === classification;
test("AI reliability configuration is finite and bounded", () => {
  assert.equal(loadAiReliabilityConfig({}).maxRetries, 2);
  for (const [name, value] of [
    ["AI_REQUEST_TIMEOUT_MS", "0"],
    ["AI_MAX_RETRIES", "-1"],
    ["AI_RETRY_BASE_DELAY_MS", "Infinity"],
    ["AI_MAX_RESPONSE_BYTES", "999999999"],
  ])
    assert.throws(
      () => loadAiReliabilityConfig({ [name]: value }),
      new RegExp(name),
    );
});

test("AI master OFF dominates secrets, subordinate flags, and malformed provider-only configuration", () => {
  let constructions = 0;
  let outbound = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    outbound++;
    throw new Error("must not call");
  };
  try {
    for (const environment of [
      { AI_MASTER: "OFF" },
      { AI_MASTER: "OFF", OPENAI_API_KEY: "sk-unused-valid-secret" },
      {
        AI_MASTER: "OFF",
        DOCUMENT_VALIDATION: "ON",
        FINANCE_WATCH: "ON",
        OPENAI_API_KEY: "sk-unused-valid-secret",
        OPENAI_BASE_URL: "not a URL",
        AI_REQUEST_TIMEOUT_MS: "invalid",
        AI_MAX_RETRIES: "invalid",
        AI_MAX_RESPONSE_BYTES: "invalid",
      },
    ]) {
      const result = createAiProvider(environment, (...args) => {
        constructions++;
        return new OpenAiCompatibleProvider(...args);
      });
      assert.equal(result, null);
    }
    assert.equal(constructions, 0);
    assert.equal(outbound, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI master ON initializes exactly once and fails closed for invalid provider configuration", () => {
  let constructions = 0;
  const valid = {
    AI_MASTER: "ON",
    OPENAI_API_KEY: "sk-configured-valid-secret",
    OPENAI_BASE_URL: "https://provider.test/v1",
  };
  assert.ok(
    createAiProvider(valid, (...args) => {
      constructions++;
      return new OpenAiCompatibleProvider(...args);
    }),
  );
  assert.equal(constructions, 1);
  assert.throws(() => createAiProvider({ AI_MASTER: "ON" }), /OPENAI_API_KEY/);
  assert.throws(
    () =>
      createAiProvider({
        ...valid,
        OPENAI_API_KEY: "replace_with_key",
      }),
    /placeholder/,
  );
  assert.throws(
    () => createAiProvider({ ...valid, OPENAI_BASE_URL: "http://provider.test" }),
    /HTTPS/,
  );
  for (const [name, value] of [
    ["AI_REQUEST_TIMEOUT_MS", "0"],
    ["AI_MAX_RETRIES", "-1"],
    ["AI_MAX_RETRIES", "999"],
    ["AI_MAX_RESPONSE_BYTES", "invalid"],
  ])
    assert.throws(
      () => createAiProvider({ ...valid, [name]: value }),
      new RegExp(name),
    );
});
test("provider retries only transient network, 429, and selected 5xx with bounded backoff", async () => {
  for (const transient of [429, 500, 503]) {
    const delays: number[] = [];
    const x = provider([failure(transient), failure(transient), ok()], delays);
    const result = await x.instance.diagnoseStructuredOutput();
    assert.equal(result.retryCount, 2);
    assert.equal(result.providerAttempts, 3);
    assert.deepEqual(delays, [1, 2]);
  }
  const network = provider([new TypeError("network"), ok()]);
  assert.equal(
    (await network.instance.diagnoseStructuredOutput()).providerAttempts,
    2,
  );
  for (const terminal of [400, 401, 403, 501]) {
    const x = provider([failure(terminal), ok()]);
    await assert.rejects(
      () => x.instance.diagnoseStructuredOutput(),
      AiProviderError,
    );
    assert.equal(x.calls(), 1);
  }
});
test("provider timeout aborts and retries finitely", async () => {
  let aborts = 0;
  const instance = new OpenAiCompatibleProvider(
    "test-key",
    "test-model",
    "https://provider.test/v1",
    {
      requestTimeoutMs: 2,
      maxRetries: 1,
      retryBaseDelayMs: 1,
      maxResponseBytes: 1024,
    },
    {
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborts++;
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          ),
        ),
      sleep: async () => {},
      random: () => 0,
    },
  );
  await assert.rejects(
    () => instance.diagnoseStructuredOutput(),
    classified("PROVIDER_TIMEOUT"),
  );
  assert.equal(aborts, 2);
});
test("provider rejects oversized, malformed, and schema-invalid responses without retry", async () => {
  for (const response of [
    new Response("{}", { status: 200, headers: { "content-length": "2048" } }),
    new Response("x".repeat(1025), { status: 200 }),
  ]) {
    const x = provider([response]);
    await assert.rejects(
      () => x.instance.diagnoseStructuredOutput(),
      classified("RESPONSE_TOO_LARGE"),
    );
  }
  const malformed = provider([new Response("not-json", { status: 200 })]);
  await assert.rejects(
    () => malformed.instance.diagnoseStructuredOutput(),
    classified("INVALID_PROVIDER_RESPONSE"),
  );
  const invalid = provider([
    new Response(JSON.stringify({ output_text: '{"result":"WRONG"}' }), {
      status: 200,
    }),
  ]);
  await assert.rejects(
    () => invalid.instance.diagnoseStructuredOutput(),
    classified("STRUCTURED_OUTPUT_INVALID"),
  );
  assert.ok(AI_BOUNDS.maxAggregateDocumentBytes >= AI_BOUNDS.maxDocumentBytes);
});
test("runtime provider ignores AI_MASTER and AI_PROVIDER: only credentials gate construction (P20.5H)", () => {
  let constructions = 0;
  const construct = (...args: unknown[]) => {
    constructions++;
    return new (OpenAiCompatibleProvider as unknown as new (...a: unknown[]) => OpenAiCompatibleProvider)(...args);
  };
  // No AI_MASTER at all, and AI_MASTER explicitly OFF, still construct when credentials are valid.
  for (const environment of [
    { OPENAI_API_KEY: "sk-configured-valid-secret", OPENAI_BASE_URL: "https://provider.test/v1" },
    { AI_MASTER: "OFF", OPENAI_API_KEY: "sk-configured-valid-secret", OPENAI_BASE_URL: "https://provider.test/v1" },
  ])
    assert.ok(createAiRuntimeProvider(environment, construct as never));
  assert.equal(constructions, 2);
  // AI_PROVIDER requesting a different value has no effect: the runtime factory never reads it.
  assert.ok(
    createAiRuntimeProvider(
      { AI_PROVIDER: "fake", OPENAI_API_KEY: "sk-configured-valid-secret", OPENAI_BASE_URL: "https://provider.test/v1" },
      construct as never,
    ),
  );
});
test("runtime provider returns null (never throws) for missing or invalid credentials", () => {
  assert.equal(createAiRuntimeProvider({}), null);
  assert.equal(createAiRuntimeProvider({ OPENAI_API_KEY: "replace_with_key" }), null);
  assert.equal(
    createAiRuntimeProvider({ OPENAI_API_KEY: "sk-configured-valid-secret", OPENAI_BASE_URL: "http://provider.test" }),
    null,
  );
  assert.equal(
    createAiRuntimeProvider({ OPENAI_API_KEY: "sk-configured-valid-secret", OPENAI_BASE_URL: "not a url" }),
    null,
  );
  assert.equal(
    createAiRuntimeProvider({
      OPENAI_API_KEY: "sk-configured-valid-secret",
      OPENAI_BASE_URL: "https://provider.test/v1",
      AI_MAX_RETRIES: "invalid",
    }),
    null,
  );
});
test("document provider input enforces count, per-document, aggregate, and text bounds before fetch", async () => {
  let calls = 0;
  const instance = new OpenAiCompatibleProvider(
    "key",
    "model",
    "https://provider.test/v1",
    undefined,
    {
      fetch: async () => {
        calls++;
        return ok();
      },
      sleep: async () => {},
      random: () => 0,
    },
  );
  const base = {
    id: "00000000-0000-4000-8000-000000000001",
    version: 1,
    sha256: "a".repeat(64),
    filename: "x.pdf",
    mimeType: "application/pdf",
  };
  const request = { payee: null, amount: null, currency: null, dueDate: null };
  await assert.rejects(
    () =>
      instance.analyzeDocuments({
        request,
        documents: Array.from({ length: AI_BOUNDS.maxDocuments + 1 }, () => ({
          ...base,
          data: new Uint8Array(),
        })),
      }),
    /count/,
  );
  await assert.rejects(
    () =>
      instance.analyzeDocuments({
        request,
        documents: [
          { ...base, data: new Uint8Array(AI_BOUNDS.maxDocumentBytes + 1) },
        ],
      }),
    /per-document/,
  );
  await assert.rejects(
    () =>
      instance.analyzeDocuments({
        request,
        documents: Array.from({ length: 4 }, () => ({
          ...base,
          data: new Uint8Array(AI_BOUNDS.maxDocumentBytes),
        })),
      }),
    /aggregate/,
  );
  await assert.rejects(
    () =>
      instance.analyzeDocuments({
        request: { ...request, payee: "x".repeat(9000) },
        documents: [],
      }),
    /Request facts/,
  );
  assert.equal(calls, 0);
});

// P20.9 RC1 blocker correction — reproduces the confirmed live-preflight
// failure: OpenAI's reasoning-tier models (gpt-5-mini, the RC's published
// default) reject an explicit `temperature` with HTTP 400 "Unsupported
// parameter", so every runtime call that forwarded Business Configuration's
// temperature unconditionally failed 100% of the time in production, while
// the standalone smoke tests (which never pass a runtime override) never
// exercised this path and falsely appeared to prove the integration worked.
test("supportsCustomTemperature classifies known model families; unrecognized models fail safe (omit)", () => {
  for (const reasoning of ["gpt-5-mini", "gpt-5", "gpt-5.1-preview", "o1-mini", "o1", "o3", "o3-mini", "o4-mini"])
    assert.equal(supportsCustomTemperature(reasoning), false, reasoning);
  for (const chat of ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"])
    assert.equal(supportsCustomTemperature(chat), true, chat);
  for (const unknown of ["some-future-model", "claude-3", ""])
    assert.equal(supportsCustomTemperature(unknown), false, unknown);
});
test("resolveTemperature omits for unsupported models and an absent configured value, preserves for supported models, and never mutates its input", () => {
  assert.equal(resolveTemperature("gpt-5-mini", 0.2), undefined);
  assert.equal(resolveTemperature("gpt-4o-mini", undefined), undefined);
  assert.equal(resolveTemperature("gpt-4o-mini", 0.2), 0.2);
  const overrides = { model: "gpt-5-mini", temperature: 0.2, maxOutputTokens: 4096 };
  resolveTemperature(overrides.model, overrides.temperature);
  assert.deepEqual(overrides, { model: "gpt-5-mini", temperature: 0.2, maxOutputTokens: 4096 });
});
test("runtime override temperature is capability-gated on the actual outbound Responses API request: omitted for gpt-5-mini (A), preserved for a known temperature-supporting model (B), maxOutputTokens/model untouched", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const captor = (payload: unknown) => async (..._args: Parameters<typeof fetch>) => {
    bodies.push(JSON.parse((_args[1]?.body as string) ?? "{}"));
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const documentPayload = {
    output_text: JSON.stringify({ extractions: [], checks: [], missingInformation: [], overallResult: "PASS", confidence: 1 }),
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  const request = { payee: null, amount: null, currency: null, dueDate: null };
  // A: gpt-5-mini — the RC's published model — must not receive `temperature` at all.
  const reasoning = new OpenAiCompatibleProvider("key", "gpt-5-mini", "https://provider.test/v1", undefined, {
    fetch: captor(documentPayload), sleep: async () => {}, random: () => 0,
  });
  await reasoning.analyzeDocuments({ request, documents: [] }, { model: "gpt-5-mini", temperature: 0.2, maxOutputTokens: 4096 });
  const reasoningBody = bodies.at(-1)!;
  assert.equal("temperature" in reasoningBody, false, "gpt-5-mini must not receive temperature");
  assert.equal(reasoningBody.model, "gpt-5-mini");
  assert.equal(reasoningBody.max_output_tokens, 4096, "max_output_tokens is not model-restricted and must pass through unchanged");
  // B: a known temperature-supporting chat model must receive the configured value unchanged.
  const chat = new OpenAiCompatibleProvider("key", "gpt-4o-mini", "https://provider.test/v1", undefined, {
    fetch: captor(documentPayload), sleep: async () => {}, random: () => 0,
  });
  await chat.analyzeDocuments({ request, documents: [] }, { model: "gpt-4o-mini", temperature: 0.2, maxOutputTokens: 4096 });
  const chatBody = bodies.at(-1)!;
  assert.equal(chatBody.temperature, 0.2, "a temperature-supporting model must still receive the configured value");
});
test("Business Configuration's stored temperature survives the runtime path unchanged: loadPublishedAiConfig -> runtime overrides -> capability-gated provider request, with no billable call", async () => {
  const publishedPayload = {
    enabled: true, provider: "openai-compatible", model: "gpt-5-mini", temperature: 0.2, maxTokens: 4096,
    validationAiEnabled: true, documentExtractionEnabled: true, documentValidationEnabled: true,
    financialAnalysisAiEnabled: false, financialRiskAnalysisEnabled: false, spendingPatternAnalysisEnabled: false,
    complianceAnalysisEnabled: false, financeWatchEnabled: false, askAimsEnabled: false, manualModeAlwaysAvailable: true,
  };
  const fakeClient: Queryable = {
    query: async <T = unknown>() => ({ rows: [{ payload: publishedPayload }] as T[], rowCount: 1 }),
  };
  const aiConfig = await loadPublishedAiConfig(fakeClient);
  assert.equal(aiConfig.temperature, 0.2, "the runtime config loader must not alter the published value");
  assert.equal(aiConfig.model, "gpt-5-mini");
  let called = false;
  const bodies: Array<Record<string, unknown>> = [];
  const provider = new OpenAiCompatibleProvider("key", aiConfig.model, "https://provider.test/v1", undefined, {
    fetch: async (...args: Parameters<typeof fetch>) => {
      called = true;
      bodies.push(JSON.parse((args[1]?.body as string) ?? "{}"));
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({ extractions: [], checks: [], missingInformation: [], overallResult: "PASS", confidence: 1 }),
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      );
    },
    sleep: async () => {},
    random: () => 0,
  });
  // The exact overrides shape ValidationService/FinancialAnalysisService build from the loaded config.
  await provider.analyzeDocuments(
    { request: { payee: null, amount: null, currency: null, dueDate: null }, documents: [] },
    { model: aiConfig.model, temperature: aiConfig.temperature, maxOutputTokens: aiConfig.maxTokens },
  );
  assert.equal(called, true, "the runtime path must reach the provider (no fetch mocking is a stand-in for a billable call)");
  assert.equal("temperature" in bodies.at(-1)!, false, "gpt-5-mini's outbound request must omit temperature even though Business Configuration publishes 0.2");
  assert.equal(publishedPayload.temperature, 0.2, "the published configuration payload itself is never mutated by the runtime path");
});
