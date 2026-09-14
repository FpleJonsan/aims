import { Injectable } from "@nestjs/common";

/**
 * The one seam a future channel (Email, In-App, SMS, Teams, Slack) needs to
 * implement. Deliberately narrower than the interactive
 * ApprovalChannel/telegram-approval.channel.ts: generic notifications are
 * plain rendered text with no inline actions, so a future channel's sender
 * never needs to know about approve/reject callback tokens.
 */
export interface RenderedNotification {
  recipientChatId: string;
  text: string;
}
export interface NotificationChannelSender {
  send(message: RenderedNotification): Promise<void>;
}

export class NotificationDeliveryError extends Error {
  constructor(
    code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "NotificationDeliveryError";
  }
}

export const NOTIFICATION_CHANNELS = Symbol("NOTIFICATION_CHANNELS");
/** channel name (e.g. "TELEGRAM") -> sender. Empty/missing entries are treated as channel-disabled, never as an error. */
export type NotificationChannelRegistry = ReadonlyMap<string, NotificationChannelSender>;

/**
 * Plain-text Telegram sender for generic (non-interactive) notifications.
 * Intentionally separate from TelegramApprovalChannel (telegram-approval.channel.ts),
 * which builds interactive approve/reject/clarify messages with inline
 * keyboards and is left untouched to avoid any regression on the existing,
 * live Approval delivery path. This sender is a smaller subset: one HTTP
 * call, no callback buttons, same bot token.
 */
@Injectable()
export class TelegramNotificationChannel implements NotificationChannelSender {
  constructor(
    private readonly token: string,
    private readonly options: { requestTimeoutMs?: number; responseMaxBytes?: number } = {},
  ) {}

  async send(message: RenderedNotification): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("TELEGRAM_TIMEOUT")),
      this.options.requestTimeoutMs ?? 10_000,
    );
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ chat_id: message.recipientChatId, text: message.text }),
      });
      const body = await readBoundedJson(response, this.options.responseMaxBytes ?? 65_536);
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? numericRetryAfter(body) ?? 300);
        throw new NotificationDeliveryError(
          "TELEGRAM_RATE_LIMITED",
          true,
          Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 3_600) : 300,
        );
      }
      if (response.status >= 500) throw new NotificationDeliveryError(`TELEGRAM_HTTP_${response.status}`, true);
      if (!response.ok) throw new NotificationDeliveryError(`TELEGRAM_HTTP_${response.status}`, false);
      if (!isRecord(body) || body.ok !== true) throw new NotificationDeliveryError("TELEGRAM_API_REJECTED", false);
    } catch (error) {
      if (error instanceof NotificationDeliveryError) throw error;
      if (controller.signal.aborted) throw new NotificationDeliveryError("TELEGRAM_TIMEOUT", true);
      throw new NotificationDeliveryError("TELEGRAM_NETWORK_FAILURE", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class DisabledNotificationChannel implements NotificationChannelSender {
  async send(): Promise<void> {
    throw new NotificationDeliveryError("CHANNEL_NOT_CONFIGURED", false);
  }
}

async function readBoundedJson(response: Response, maximum: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum)
    throw new NotificationDeliveryError("TELEGRAM_RESPONSE_TOO_LARGE", false);
  if (!response.body) throw new NotificationDeliveryError("TELEGRAM_RESPONSE_EMPTY", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new NotificationDeliveryError("TELEGRAM_RESPONSE_TOO_LARGE", false);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new NotificationDeliveryError("TELEGRAM_RESPONSE_EMPTY", false);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new NotificationDeliveryError("TELEGRAM_RESPONSE_MALFORMED", false);
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function numericRetryAfter(body: unknown): number | undefined {
  if (!isRecord(body) || !isRecord(body.parameters)) return undefined;
  return typeof body.parameters.retry_after === "number" ? body.parameters.retry_after : undefined;
}
