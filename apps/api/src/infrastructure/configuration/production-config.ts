const MIN_SECRET_LENGTH = 32;

export type ConfigurationMode = "development" | "test" | "production";

export interface ConfigurationSummary {
  mode: ConfigurationMode;
  identity: "LOCAL_SESSION" | "COMPETITION_HEADER";
  storage: string;
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
  if(production)throw new Error("Production authentication is not configured; an approved corporate adapter is required");
  if(aimsEnvironment==="staging")throw new Error("Staging authentication is not configured; an approved test IdP adapter is required");
  const telegramEnabled = environment.TELEGRAM_APPROVAL_ENABLED === "true";
  const storage = environment.STORAGE_DRIVER ?? "";

  requireUrl(environment.DATABASE_URL, "DATABASE_URL", ["postgres:", "postgresql:"]);
  if (production) {
    requireUrl(environment.FINANCE_DATABASE_URL, "FINANCE_DATABASE_URL", ["postgres:", "postgresql:"]);
    requireUrl(environment.PAYMENT_DATABASE_URL, "PAYMENT_DATABASE_URL", ["postgres:", "postgresql:"]);
    if (storage === "local") {
      throw new Error("Local document storage is forbidden in production; configure the production S3 adapter before deployment");
    }
    if (!storage) throw new Error("STORAGE_DRIVER is required in production");
  }

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
    identity: aimsEnvironment === "competition" || environment.AIMS_DEMO_MODE === "true" ? "COMPETITION_HEADER" : "LOCAL_SESSION",
    storage,
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
}
