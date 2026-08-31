import assert from "node:assert/strict";
import test from "node:test";
import {
  DisabledApprovalChannel,
  TelegramApprovalChannel,
  TelegramDeliveryError,
  TELEGRAM_PURPOSE_MAX_LENGTH,
} from "../src/application/approval/telegram-approval.channel.js";

const message = {
  chatId: "1",
  ticketNumber: "PAY-2026-1",
  amount: "10.00",
  currency: "MYR",
  purpose: `Synthetic\u0000 purpose ${"x".repeat(400)} <b>&`,
  callbacks: {
    approve: "approve-token",
    reject: "reject-token",
    clarify: "clarify-token",
  },
};

async function withFetch(implementation: typeof fetch, action: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { await action(); } finally { globalThis.fetch = original; }
}

test("Telegram message is minimized, bounded, plain text, and uses opaque callbacks", async () => {
  let request: RequestInit | undefined;
  await withFetch((async (_input, init) => { request = init; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as typeof fetch,
    () => new TelegramApprovalChannel("server-secret").send(message));
  const body = JSON.parse(String(request?.body));
  assert.equal(body.reply_markup.inline_keyboard[0][0].callback_data, "approve-token");
  assert.equal(body.parse_mode, undefined);
  assert.doesNotMatch(body.text, /bank|account|payment details/i);
  assert.doesNotMatch(body.text, /\u0000/);
  assert.ok(body.text.split("Purpose: ")[1].length <= TELEGRAM_PURPOSE_MAX_LENGTH);
});

test("Telegram provider classifies timeout, network, and response failures", async () => {
  await withFetch(((_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("abort"))); })) as typeof fetch,
    async () => assert.rejects(() => new TelegramApprovalChannel("token", { requestTimeoutMs: 5 }).send(message),
      (error) => error instanceof TelegramDeliveryError && error.message === "TELEGRAM_TIMEOUT" && error.retryable));
  await withFetch((async () => { throw new Error("raw provider detail"); }) as typeof fetch,
    async () => assert.rejects(() => new TelegramApprovalChannel("token").send(message), /TELEGRAM_NETWORK_FAILURE/));
  for (const [response, code, retryable] of [
    [new Response("", { status: 200 }), "TELEGRAM_RESPONSE_EMPTY", false],
    [new Response("not-json", { status: 200 }), "TELEGRAM_RESPONSE_MALFORMED", false],
    [new Response(JSON.stringify({ ok: false }), { status: 200 }), "TELEGRAM_API_REJECTED", false],
    [new Response(JSON.stringify({ ok: false }), { status: 401 }), "TELEGRAM_HTTP_401", false],
    [new Response(JSON.stringify({ ok: false }), { status: 503 }), "TELEGRAM_HTTP_503", true],
  ] as const) await withFetch((async () => response.clone()) as typeof fetch,
    async () => assert.rejects(() => new TelegramApprovalChannel("token").send(message),
      (error) => error instanceof TelegramDeliveryError && error.message === code && error.retryable === retryable));
});

test("Telegram provider bounds responses, honors 429 precedence, and aborts on close", async () => {
  await withFetch((async () => new Response(JSON.stringify({ ok: true, data: "x".repeat(200) }), { status: 200 })) as typeof fetch,
    async () => assert.rejects(() => new TelegramApprovalChannel("token", { responseMaxBytes: 64 }).send(message), /TELEGRAM_RESPONSE_TOO_LARGE/));
  await withFetch((async () => new Response(JSON.stringify({ ok: false, parameters: { retry_after: 9 } }), { status: 429, headers: { "retry-after": "7" } })) as typeof fetch,
    async () => assert.rejects(() => new TelegramApprovalChannel("token").send(message),
      (error) => error instanceof TelegramDeliveryError && error.message === "TELEGRAM_RATE_LIMITED" && error.retryAfterSeconds === 7));
  await withFetch((async () => new Response("", { status: 429, headers: { "retry-after": "malformed" } })) as typeof fetch,
    async () => assert.rejects(() => new TelegramApprovalChannel("token", { retryMaxDelaySeconds: 120 }).send(message),
      (error) => error instanceof TelegramDeliveryError && error.message === "TELEGRAM_RATE_LIMITED" && error.retryAfterSeconds === 120));
  await withFetch((async () => new Response("", { status: 503 })) as typeof fetch,
    async () => assert.rejects(() => new TelegramApprovalChannel("token").send(message),
      (error) => error instanceof TelegramDeliveryError && error.message === "TELEGRAM_HTTP_503" && error.retryable));
  await withFetch(((_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("abort"))); })) as typeof fetch,
    async () => { const channel = new TelegramApprovalChannel("token", { requestTimeoutMs: 30_000 }), pending = channel.send(message); channel.close(); await assert.rejects(pending, /TELEGRAM_TIMEOUT/); });
});

test("disabled Telegram delivery fails without affecting approval business state", async () => {
  await assert.rejects(() => new DisabledApprovalChannel().send(), /TELEGRAM_NOT_CONFIGURED/);
});
