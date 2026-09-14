import {
  isPlaceholderSecret,
  readServerSecret,
} from "../configuration/secret-boundary.js";
import {
  isAiMasterEnabled,
  loadAiReliabilityConfig,
  type AiReliabilityConfig,
} from "./ai-governance.js";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider.js";
import { classifyAimsEnvironment } from "../configuration/aims-environment.js";

type ProviderConstructor = (
  apiKey: string,
  model: string,
  baseUrl: string,
  reliability: AiReliabilityConfig,
) => OpenAiCompatibleProvider;

/** Provider-only values remain untouched until AI is explicitly requested. */
export function createAiProvider(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  construct: ProviderConstructor = (apiKey, model, baseUrl, reliability) =>
    new OpenAiCompatibleProvider(apiKey, model, baseUrl, reliability),
): OpenAiCompatibleProvider | null {
  if (!isAiMasterEnabled(environment)) return null;
  const classification=classifyAimsEnvironment(environment);
  const provider=(environment.AI_PROVIDER??"openai-compatible").toLowerCase();
  if(classification.protected&&["fake","test","deterministic","local"].includes(provider))
    throw new Error("PROTECTED_ENVIRONMENT_UNSAFE_AI_PROVIDER");
  if(provider!=="openai-compatible")throw new Error("UNSUPPORTED_AI_PROVIDER");

  const apiKey = readServerSecret("OPENAI_API_KEY", environment);
  if (!apiKey) throw new Error("OPENAI_API_KEY is required when AI_MASTER=ON");
  if (isPlaceholderSecret(apiKey))
    throw new Error(
      "OPENAI_API_KEY contains a placeholder and is forbidden when AI_MASTER=ON",
    );

  const baseUrl = environment.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("OPENAI_BASE_URL must be a valid URL when AI_MASTER=ON");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname)
    throw new Error("OPENAI_BASE_URL must use HTTPS when AI_MASTER=ON");

  return construct(
    apiKey,
    environment.OPENAI_MODEL ?? "gpt-5-mini",
    baseUrl,
    loadAiReliabilityConfig(environment),
  );
}

/**
 * Constructs the AI provider whenever deployment credentials are valid,
 * independent of any business enablement decision. Business Configuration's
 * published "ai" category (P20.5H) is the sole authority for whether AI
 * actually runs, checked by each call site (ValidationService,
 * FinancialAnalysisService, FinanceIntelligenceService) against the
 * published payload; this factory never reads AI_MASTER or AI_PROVIDER, so
 * environment variables here are strictly deployment credentials/endpoints.
 * Missing or invalid credentials return null (handled by each call site's
 * existing AI_UNAVAILABLE_FALLBACK path) rather than failing application
 * boot — a deployment with AI left OFF in Business Configuration need not
 * provision an OpenAI credential at all.
 */
export function createAiRuntimeProvider(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  construct: ProviderConstructor = (apiKey, model, baseUrl, reliability) =>
    new OpenAiCompatibleProvider(apiKey, model, baseUrl, reliability),
): OpenAiCompatibleProvider | null {
  const apiKey = readServerSecret("OPENAI_API_KEY", environment);
  if (!apiKey || isPlaceholderSecret(apiKey)) return null;

  const baseUrl = environment.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) return null;

  let reliability;
  try {
    reliability = loadAiReliabilityConfig(environment);
  } catch {
    return null;
  }

  return construct(apiKey, "gpt-5-mini", baseUrl, reliability);
}
