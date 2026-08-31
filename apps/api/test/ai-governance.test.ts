import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAiReliabilityConfig,
  AI_BOUNDS,
} from "../src/infrastructure/ai/ai-governance.js";
import { createAiProvider } from "../src/infrastructure/ai/ai-provider-factory.js";
import {
  AiProviderError,
  OpenAiCompatibleProvider,
} from "../src/infrastructure/ai/openai-compatible-provider.js";
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
