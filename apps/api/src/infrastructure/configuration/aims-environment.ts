export type AimsRuntimeEnvironment =
  | "development"
  | "test"
  | "local"
  | "competition"
  | "staging"
  | "production";

export type AimsSecurityEnvironment =
  | "development"
  | "test"
  | "staging"
  | "production";

export interface AimsEnvironmentClassification {
  runtime: AimsRuntimeEnvironment;
  security: AimsSecurityEnvironment;
  protected: boolean;
}

const ALLOWED = new Set<AimsRuntimeEnvironment>([
  "development",
  "test",
  "local",
  "competition",
  "staging",
  "production",
]);

/** AIMS_ENVIRONMENT is the security boundary; NODE_ENV only controls runtime behavior. */
export function classifyAimsEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AimsEnvironmentClassification {
  const configured = environment.AIMS_ENVIRONMENT?.trim().toLowerCase();
  let runtime: AimsRuntimeEnvironment;
  if (configured) {
    if (!ALLOWED.has(configured as AimsRuntimeEnvironment)) {
      throw new Error("AIMS_ENVIRONMENT_UNKNOWN");
    }
    runtime = configured as AimsRuntimeEnvironment;
  } else if (environment.NODE_ENV === "test") {
    runtime = "test";
  } else if (environment.NODE_ENV === "production") {
    throw new Error("AIMS_ENVIRONMENT_REQUIRED_FOR_DEPLOYABLE_RUNTIME");
  } else {
    runtime = "development";
  }

  if (
    environment.NODE_ENV === "production" &&
    !["staging", "production"].includes(runtime)
  ) {
    throw new Error("AIMS_ENVIRONMENT_RUNTIME_MISMATCH");
  }
  if (["staging", "production"].includes(runtime) && environment.NODE_ENV !== "production") {
    throw new Error("AIMS_ENVIRONMENT_RUNTIME_MISMATCH");
  }

  const security: AimsSecurityEnvironment =
    runtime === "staging" || runtime === "production"
      ? runtime
      : runtime === "test"
        ? "test"
        : "development";
  return { runtime, security, protected: security === "staging" || security === "production" };
}

export function assertUnprotectedAdapter(
  adapterCategory: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const classification = classifyAimsEnvironment(environment);
  if (classification.protected) {
    throw new Error(`PROTECTED_ENVIRONMENT_UNSAFE_${adapterCategory} (${classification.runtime})`);
  }
}
