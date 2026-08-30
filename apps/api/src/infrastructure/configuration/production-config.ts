import { isPlaceholderSecret, readServerSecret } from "./secret-boundary.js";

const MIN_SECRET_LENGTH = 32;

export type ConfigurationMode = "development" | "test" | "production";

export interface ConfigurationSummary {
  mode: ConfigurationMode;
  aimsEnvironment: "development" | "local" | "competition" | "staging" | "production";
  identity: "LOCAL_SESSION" | "COMPETITION_HEADER";
  storage: string;
  malwareScanner:string;
  aiProviderConfigured: boolean;
  telegramEnabled: boolean;
}

/** Validates deployment-critical configuration without making network calls. */
export function validateProductionConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ConfigurationSummary {
  const mode = normalizeMode(environment.NODE_ENV);
  const aimsEnvironment=environment.AIMS_ENVIRONMENT??"development";
  if(!["development","local","competition","staging","production"].includes(aimsEnvironment))
    throw new Error("AIMS_ENVIRONMENT must be development, local, competition, staging, or production");
  const production = mode === "production"||aimsEnvironment==="production";
  const telegramEnabled = environment.TELEGRAM_APPROVAL_ENABLED === "true";
  const storage = environment.STORAGE_DRIVER ?? "";
  const malwareScanner=environment.MALWARE_SCANNER_DRIVER??"";

  requireDatabaseUrl(readServerSecret("DATABASE_URL", environment), "DATABASE_URL", production);
  if (production) {
    if (environment.AIMS_DEMO_MODE === "true") throw new Error("Production rejects the deprecated competition identity mode");
    requireDatabaseUrl(readServerSecret("FINANCE_DATABASE_URL", environment), "FINANCE_DATABASE_URL", true);
    requireDatabaseUrl(readServerSecret("PAYMENT_DATABASE_URL", environment), "PAYMENT_DATABASE_URL", true);
    if (storage !== "object") throw new Error("Production requires an approved private object-storage adapter; local or missing storage is forbidden");
    if(malwareScanner!=="provider")throw new Error("Production requires an approved malware-scanner provider; deterministic local or missing scanning is forbidden");
  }else{
    if(storage!=="local")throw new Error("This foundation currently supports only explicit LOCAL document storage outside Production");
    if(malwareScanner!=="deterministic-local")throw new Error("Local document security requires MALWARE_SCANNER_DRIVER=deterministic-local");
  }
  if(production)throw new Error("Production authentication is not configured; an approved corporate adapter is required");
  if(aimsEnvironment==="staging")throw new Error("Staging authentication is not configured; an approved test IdP adapter is required");

  if (telegramEnabled) {
    requireSecret(environment.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN", production);
    requireSecret(environment.TELEGRAM_WEBHOOK_SECRET, "TELEGRAM_WEBHOOK_SECRET", production);
    requireSecret(environment.TELEGRAM_CALLBACK_SECRET, "TELEGRAM_CALLBACK_SECRET", production);
    if (production) requireHttpsUrl(environment.TELEGRAM_WEBHOOK_URL, "TELEGRAM_WEBHOOK_URL");
  }

  const aiMasterRequested = environment.AI_MASTER === "ON";
  if (aiMasterRequested) {
    requireSecret(environment.OPENAI_API_KEY, "OPENAI_API_KEY", production);
    requireHttpsUrl(environment.OPENAI_BASE_URL ?? "https://api.openai.com/v1", "OPENAI_BASE_URL");
  }

  return {
    mode,
    aimsEnvironment: aimsEnvironment as ConfigurationSummary["aimsEnvironment"],
    identity: aimsEnvironment === "competition" || environment.AIMS_DEMO_MODE === "true" ? "COMPETITION_HEADER" : "LOCAL_SESSION",
    storage,
    malwareScanner,
    aiProviderConfigured: Boolean(environment.OPENAI_API_KEY),
    telegramEnabled,
  };
}

function normalizeMode(value: string | undefined): ConfigurationMode {
  if (!value || value === "development") return "development";
  if (value === "test" || value === "production") return value;
  throw new Error("NODE_ENV must be development, test, or production");
}

function requireUrl(value: string | undefined, name: string, protocols: string[]): void {
  if (!value) throw new Error(`${name} is required`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be a valid URL`); }
  if (!protocols.includes(parsed.protocol)) throw new Error(`${name} uses an unsupported protocol`);
  if (!parsed.hostname) throw new Error(`${name} must include a host`);
}

function requireDatabaseUrl(value: string | undefined, name: string, production: boolean): void {
  requireUrl(value, name, ["postgres:", "postgresql:"]);
  if (production && value && isPlaceholderSecret(value)) {
    throw new Error(`${name} contains a placeholder credential and is forbidden in production`);
  }
  const parsed = new URL(value!);
  if (!parsed.username || !parsed.password) throw new Error(`${name} must include an injected runtime credential`);
}

function requireHttpsUrl(value: string | undefined, name: string): void {
  if (!value) throw new Error(`${name} is required`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be a valid URL`); }
  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
}

function requireSecret(value: string | undefined, name: string, strong: boolean): void {
  if (!value) throw new Error(`${name} is required when its feature is enabled`);
  if (strong && value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must contain at least ${MIN_SECRET_LENGTH} characters in production`);
  }
  if (strong && isPlaceholderSecret(value)) throw new Error(`${name} contains a placeholder and is forbidden in production`);
}
