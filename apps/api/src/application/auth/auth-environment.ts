import { classifyAimsEnvironment } from "../../infrastructure/configuration/aims-environment.js";

export type AimsEnvironment = "local" | "competition" | "staging" | "production";

export function aimsEnvironment(environment: Readonly<Record<string,string|undefined>> = process.env): AimsEnvironment {
  const classification=classifyAimsEnvironment(environment);
  if(classification.runtime==="production")return "production";
  if(classification.runtime==="staging")return "staging";
  if(classification.runtime==="competition"||environment.AIMS_DEMO_MODE==="true")return "competition";
  return "local";
}
