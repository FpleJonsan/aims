const REDACTED = "[REDACTED]";

export const SERVER_SECRET_NAMES = [
  "DATABASE_URL",
  "FINANCE_DATABASE_URL",
  "PAYMENT_DATABASE_URL",
  "DOCUMENT_WORKER_DATABASE_URL",
  "OPENAI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_CALLBACK_SECRET",
] as const;

export type ServerSecretName = (typeof SERVER_SECRET_NAMES)[number];

const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|token|secret|api[_-]?key|client[_-]?secret|private[_-]?key|connection[_-]?string|database[_-]?url)/i;
const PLACEHOLDER = /(?:replace[_-]?with|change[_-]?me|changeme|placeholder|example|dummy|your[_-]|<[^>]+>)/i;

/** Reads a server-only value supplied by the process runtime. It never provides a fallback. */
export function readServerSecret(
  name: ServerSecretName,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const value = environment[name]?.trim();
  return value || undefined;
}

export function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER.test(value);
}

/** Redacts common credential material before data crosses an error/log boundary. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, `$1${REDACTED}@`)
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, `$1 ${REDACTED}`)
    .replace(/((?:password|passwd|token|secret|api[_-]?key|client[_-]?secret)\s*[=:]\s*)[^\s,;&]+/gi, `$1${REDACTED}`);
}

/** Produces a JSON-safe copy suitable for logs and audit metadata. */
export function redactSensitiveData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactSensitiveData(item, seen),
    ]),
  );
}
