export const AI_BOUNDS = Object.freeze({
  maxDocuments: 12,
  maxDocumentBytes: 10 * 1024 * 1024,
  maxAggregateDocumentBytes: 30 * 1024 * 1024,
  maxInputTextCharacters: 60_000,
  maxTextFieldCharacters: 2_000,
  maxEvidenceItems: 80,
  maxEvidenceDescriptionCharacters: 500,
  maxFindings: 40,
  maxEvidencePerFinding: 12,
  maxRecommendations: 20,
  maxQuestionCharacters: 500,
});

export interface AiReliabilityConfig {
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  maxResponseBytes: number;
}

export const DEFAULT_AI_RELIABILITY_CONFIG: AiReliabilityConfig = Object.freeze(
  {
    requestTimeoutMs: 30_000,
    maxRetries: 2,
    retryBaseDelayMs: 250,
    maxResponseBytes: 2 * 1024 * 1024,
  },
);

/** Secret presence and subordinate feature flags never override master OFF. */
export function isAiMasterEnabled(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return environment.AI_MASTER === "ON";
}

const CONFIG_LIMITS = Object.freeze({
  requestTimeoutMs: 120_000,
  maxRetries: 5,
  retryBaseDelayMs: 10_000,
  maxResponseBytes: 8 * 1024 * 1024,
});

export function loadAiReliabilityConfig(
  environment: Readonly<Record<string, string | undefined>>,
): AiReliabilityConfig {
  return {
    requestTimeoutMs: integerSetting(
      environment.AI_REQUEST_TIMEOUT_MS,
      "AI_REQUEST_TIMEOUT_MS",
      DEFAULT_AI_RELIABILITY_CONFIG.requestTimeoutMs,
      1,
      CONFIG_LIMITS.requestTimeoutMs,
    ),
    maxRetries: integerSetting(
      environment.AI_MAX_RETRIES,
      "AI_MAX_RETRIES",
      DEFAULT_AI_RELIABILITY_CONFIG.maxRetries,
      0,
      CONFIG_LIMITS.maxRetries,
    ),
    retryBaseDelayMs: integerSetting(
      environment.AI_RETRY_BASE_DELAY_MS,
      "AI_RETRY_BASE_DELAY_MS",
      DEFAULT_AI_RELIABILITY_CONFIG.retryBaseDelayMs,
      1,
      CONFIG_LIMITS.retryBaseDelayMs,
    ),
    maxResponseBytes: integerSetting(
      environment.AI_MAX_RESPONSE_BYTES,
      "AI_MAX_RESPONSE_BYTES",
      DEFAULT_AI_RELIABILITY_CONFIG.maxResponseBytes,
      1,
      CONFIG_LIMITS.maxResponseBytes,
    ),
  };
}

function integerSetting(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(
      `${name} must be a finite integer between ${minimum} and ${maximum}`,
    );
  return parsed;
}

export function assertBoundedText(
  value: unknown,
  label: string,
  maximum: number = AI_BOUNDS.maxInputTextCharacters,
): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized.length > maximum)
    throw new Error(`${label} exceeds the authorized AI input bound`);
}
