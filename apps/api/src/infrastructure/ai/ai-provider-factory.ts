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
