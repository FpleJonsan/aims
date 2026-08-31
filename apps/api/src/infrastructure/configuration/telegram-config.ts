import { isPlaceholderSecret } from "./secret-boundary.js";

export type TelegramConfig = {
  enabled: boolean;
  botToken?: string;
  webhookSecret?: string;
  callbackSecret?: string;
  requestTimeoutMs: number;
  responseMaxBytes: number;
  retryMaxDelaySeconds: number;
  outboxLeaseSeconds: number;
};

const MIN_PRODUCTION_SECRET_LENGTH = 32;

export function loadTelegramConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TelegramConfig {
  const enabled = environment.TELEGRAM_APPROVAL_ENABLED === "true";
  const config: TelegramConfig = {
    enabled,
    botToken: environment.TELEGRAM_BOT_TOKEN?.trim() || undefined,
    webhookSecret: environment.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
    callbackSecret: environment.TELEGRAM_CALLBACK_SECRET?.trim() || undefined,
    requestTimeoutMs: integer(
      environment.TELEGRAM_REQUEST_TIMEOUT_MS,
      10_000,
      100,
      30_000,
      "TELEGRAM_REQUEST_TIMEOUT_MS",
      enabled,
    ),
    responseMaxBytes: integer(
      environment.TELEGRAM_RESPONSE_MAX_BYTES,
      65_536,
      1_024,
      1_048_576,
      "TELEGRAM_RESPONSE_MAX_BYTES",
      enabled,
    ),
    retryMaxDelaySeconds: integer(
      environment.TELEGRAM_RETRY_MAX_DELAY_SECONDS,
      3_600,
      1,
      86_400,
      "TELEGRAM_RETRY_MAX_DELAY_SECONDS",
      enabled,
    ),
    outboxLeaseSeconds: integer(
      environment.OUTBOX_PROCESSING_LEASE_SECONDS,
      120,
      1,
      3_600,
      "OUTBOX_PROCESSING_LEASE_SECONDS",
      enabled,
    ),
  };
  if (!enabled) return config;

  const production =
    environment.NODE_ENV === "production" ||
    environment.AIMS_ENVIRONMENT === "production";
  requiredSecret(config.botToken, "TELEGRAM_BOT_TOKEN", production);
  requiredSecret(config.webhookSecret, "TELEGRAM_WEBHOOK_SECRET", production);
  requiredSecret(config.callbackSecret, "TELEGRAM_CALLBACK_SECRET", production);
  if (config.requestTimeoutMs >= config.outboxLeaseSeconds * 1_000)
    throw new Error(
      "TELEGRAM_REQUEST_TIMEOUT_MS must be shorter than OUTBOX_PROCESSING_LEASE_SECONDS",
    );
  return config;
}

function requiredSecret(
  value: string | undefined,
  name: string,
  production: boolean,
): void {
  if (!value) throw new Error(`${name} is required when Telegram is enabled`);
  if (isPlaceholderSecret(value))
    throw new Error(`${name} contains a forbidden placeholder`);
  if (production && value.length < MIN_PRODUCTION_SECRET_LENGTH)
    throw new Error(
      `${name} must contain at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`,
    );
}

function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
  validate: boolean,
): number {
  if (!validate && value !== undefined) {
    const optional = Number(value);
    return Number.isInteger(optional) && optional >= min && optional <= max
      ? optional
      : fallback;
  }
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < min || result > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return result;
}
