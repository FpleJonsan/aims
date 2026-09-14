import type { Queryable } from "./configuration.types.js";
import { defaultPayloadFor } from "./configuration.defaults.js";

export interface AiRuntimeConfig {
  enabled: boolean;
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  validationAiEnabled: boolean;
  documentExtractionEnabled: boolean;
  documentValidationEnabled: boolean;
  financialAnalysisAiEnabled: boolean;
  financialRiskAnalysisEnabled: boolean;
  spendingPatternAnalysisEnabled: boolean;
  complianceAnalysisEnabled: boolean;
  financeWatchEnabled: boolean;
  askAimsEnabled: boolean;
  manualModeAlwaysAvailable: boolean;
}

const BOOLEAN_FIELDS = [
  "enabled",
  "validationAiEnabled",
  "documentExtractionEnabled",
  "documentValidationEnabled",
  "financialAnalysisAiEnabled",
  "financialRiskAnalysisEnabled",
  "spendingPatternAnalysisEnabled",
  "complianceAnalysisEnabled",
  "financeWatchEnabled",
  "askAimsEnabled",
  "manualModeAlwaysAvailable",
] as const satisfies readonly (keyof AiRuntimeConfig)[];

/**
 * Business Configuration's published "ai" category (P20.5H) is the single
 * authority for AI runtime behavior: enablement, provider, model,
 * temperature, max tokens, and every per-module feature flag. Every AI call
 * site resolves its runtime state from here instead of environment variables
 * or the retired ai_feature_configuration table, so a publish takes effect
 * on the very next call with no restart. `client` may be a pooled connection
 * or a transaction client — both satisfy Queryable.
 */
export async function loadPublishedAiConfig(client: Queryable): Promise<AiRuntimeConfig> {
  const result = await client.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM configuration_versions WHERE category='ai' AND status='published' ORDER BY version DESC LIMIT 1`,
  );
  const payload: Record<string, unknown> = { ...defaultPayloadFor("ai"), ...(result.rows[0]?.payload ?? {}) };
  const config = {} as AiRuntimeConfig;
  for (const field of BOOLEAN_FIELDS) config[field] = payload[field] === true;
  config.provider = typeof payload.provider === "string" ? payload.provider : "openai-compatible";
  config.model = typeof payload.model === "string" ? payload.model : "gpt-5-mini";
  config.temperature = typeof payload.temperature === "number" ? payload.temperature : 0.2;
  config.maxTokens = Number.isInteger(payload.maxTokens) ? (payload.maxTokens as number) : 4096;
  return config;
}
