import { Injectable } from "@nestjs/common";
export type ApprovalNotification = {
  chatId: string;
  ticketNumber: string;
  amount: string;
  currency: string;
  purpose: string;
  callbacks: { approve: string; reject: string; clarify: string };
};
export interface ApprovalChannel {
  send(message: ApprovalNotification): Promise<void>;
  close?(): void;
}
export const APPROVAL_CHANNEL = Symbol("APPROVAL_CHANNEL");
export class TelegramDeliveryError extends Error {
  constructor(
    code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "TelegramDeliveryError";
  }
}
@Injectable()
export class TelegramApprovalChannel implements ApprovalChannel {
  private readonly active = new Set<AbortController>();
  constructor(
    private readonly token: string,
    private readonly options: {
      requestTimeoutMs?: number;
      responseMaxBytes?: number;
      retryMaxDelaySeconds?: number;
    } = {},
  ) {}
  async send(m: ApprovalNotification) {
    const controller = new AbortController();
    this.active.add(controller);
    const timeout = setTimeout(
      () => controller.abort(new Error("TELEGRAM_TIMEOUT")),
      this.options.requestTimeoutMs ?? 10_000,
    );
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: m.chatId,
          text: `AIMS approval required\n${m.ticketNumber}\n${m.currency} ${m.amount}\nPurpose: ${projectPurpose(m.purpose)}`,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Approve", callback_data: m.callbacks.approve },
                { text: "Reject", callback_data: m.callbacks.reject },
              ],
              [
                {
                  text: "Request clarification",
                  callback_data: m.callbacks.clarify,
                },
              ],
            ],
          },
        }),
        },
      );
      let body: unknown;
      try {
        body = await boundedJson(
          response,
          this.options.responseMaxBytes ?? 65_536,
        );
      } catch (error) {
        if (
          error instanceof TelegramDeliveryError &&
          error.message !== "TELEGRAM_RESPONSE_TOO_LARGE" &&
          (response.status === 429 || response.status >= 500)
        )
          body = {};
        else throw error;
      }
      if (response.status === 429) {
        const header = response.headers.get("retry-after");
        const bodyDelay = numericRetryAfter(body);
        const delay = boundedRetryAfter(
          header === null ? bodyDelay : Number(header),
          this.options.retryMaxDelaySeconds ?? 3_600,
        );
        throw new TelegramDeliveryError("TELEGRAM_RATE_LIMITED", true, delay);
      }
      if (response.status >= 500)
        throw new TelegramDeliveryError(`TELEGRAM_HTTP_${response.status}`, true);
      if (!response.ok)
        throw new TelegramDeliveryError(`TELEGRAM_HTTP_${response.status}`, false);
      if (!isRecord(body) || body.ok !== true)
        throw new TelegramDeliveryError("TELEGRAM_API_REJECTED", false);
    } catch (error) {
      if (error instanceof TelegramDeliveryError) throw error;
      if (controller.signal.aborted)
        throw new TelegramDeliveryError("TELEGRAM_TIMEOUT", true);
      throw new TelegramDeliveryError("TELEGRAM_NETWORK_FAILURE", true);
    } finally {
      clearTimeout(timeout);
      this.active.delete(controller);
    }
  }
  close() {
    for (const controller of this.active)
      controller.abort(new Error("TELEGRAM_SHUTDOWN"));
  }
}
export class DisabledApprovalChannel implements ApprovalChannel {
  async send() {
    throw new Error("TELEGRAM_NOT_CONFIGURED");
  }
}

export const TELEGRAM_PURPOSE_MAX_LENGTH = 160;
export function projectPurpose(value: string): string {
  const normalized = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(normalized);
  return characters.length <= TELEGRAM_PURPOSE_MAX_LENGTH
    ? normalized
    : `${characters.slice(0, TELEGRAM_PURPOSE_MAX_LENGTH - 1).join("")}…`;
}

async function boundedJson(response: Response, maximum: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum)
    throw new TelegramDeliveryError("TELEGRAM_RESPONSE_TOO_LARGE", false);
  if (!response.body)
    throw new TelegramDeliveryError("TELEGRAM_RESPONSE_EMPTY", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum)
        throw new TelegramDeliveryError("TELEGRAM_RESPONSE_TOO_LARGE", false);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0)
    throw new TelegramDeliveryError("TELEGRAM_RESPONSE_EMPTY", false);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TelegramDeliveryError("TELEGRAM_RESPONSE_MALFORMED", false);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function numericRetryAfter(body: unknown): number | undefined {
  if (!isRecord(body) || !isRecord(body.parameters)) return undefined;
  return typeof body.parameters.retry_after === "number"
    ? body.parameters.retry_after
    : undefined;
}
function boundedRetryAfter(value: number | undefined, maximum: number): number {
  return Number.isInteger(value) && value! >= 1
    ? Math.min(value!, maximum)
    : Math.min(300, maximum);
}
