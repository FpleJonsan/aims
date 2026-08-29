export type AimsEnvironment = "local" | "competition" | "staging" | "production";

export function aimsEnvironment(environment: Readonly<Record<string,string|undefined>> = process.env): AimsEnvironment {
  if (environment.NODE_ENV === "production" || environment.AIMS_ENVIRONMENT === "production") return "production";
  if (environment.AIMS_ENVIRONMENT === "staging") return "staging";
  if (environment.AIMS_ENVIRONMENT === "competition" || environment.AIMS_DEMO_MODE === "true") return "competition";
  return "local";
}
