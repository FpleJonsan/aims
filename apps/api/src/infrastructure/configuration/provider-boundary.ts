import type { DocumentMalwareScanner } from "../../application/documents/document-quarantine-service.js";
import { DeterministicLocalMalwareScanner } from "../security/deterministic-local-malware-scanner.js";
import type { DocumentStorage } from "../storage/document-storage.js";
import { LocalDocumentStorage, loadLocalStorageConfig } from "../storage/local-document-storage.js";
import { assertUnprotectedAdapter, classifyAimsEnvironment } from "./aims-environment.js";

export type ProviderReadiness = { status: "ready" | "not_ready"; detail: string };

export function validateDocumentProviderSelection(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const classification = classifyAimsEnvironment(environment);
  if (environment.STORAGE_DRIVER === "local") assertUnprotectedAdapter("STORAGE_PROVIDER", environment);
  else if (environment.STORAGE_DRIVER !== "object" || !classification.protected)
    throw new Error(classification.protected ? "PROTECTED_ENVIRONMENT_APPROVED_STORAGE_PROVIDER_REQUIRED" : "UNSUPPORTED_STORAGE_PROVIDER");
  if (environment.MALWARE_SCANNER_DRIVER === "deterministic-local") assertUnprotectedAdapter("SCANNER_PROVIDER", environment);
  else if (environment.MALWARE_SCANNER_DRIVER !== "provider" || !classification.protected)
    throw new Error(classification.protected ? "PROTECTED_ENVIRONMENT_APPROVED_SCANNER_PROVIDER_REQUIRED" : "UNSUPPORTED_SCANNER_PROVIDER");
}

export function createDocumentStorage(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  applicationRoot = process.cwd(),
): DocumentStorage {
  const driver = environment.STORAGE_DRIVER;
  if (driver === "local") {
    assertUnprotectedAdapter("STORAGE_PROVIDER", environment);
    return new LocalDocumentStorage(loadLocalStorageConfig(environment, applicationRoot), environment);
  }
  const classification = classifyAimsEnvironment(environment);
  if (driver === "object" && classification.protected) {
    throw new Error("APPROVED_OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED");
  }
  throw new Error(
    classification.protected
      ? "PROTECTED_ENVIRONMENT_APPROVED_STORAGE_PROVIDER_REQUIRED"
      : "UNSUPPORTED_STORAGE_PROVIDER",
  );
}

export function createDocumentScanner(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DocumentMalwareScanner {
  const driver = environment.MALWARE_SCANNER_DRIVER;
  if (driver === "deterministic-local") {
    assertUnprotectedAdapter("SCANNER_PROVIDER", environment);
    return new DeterministicLocalMalwareScanner(environment);
  }
  const classification = classifyAimsEnvironment(environment);
  if (driver === "provider" && classification.protected) {
    throw new Error("APPROVED_MALWARE_SCANNER_PROVIDER_NOT_IMPLEMENTED");
  }
  throw new Error(
    classification.protected
      ? "PROTECTED_ENVIRONMENT_APPROVED_SCANNER_PROVIDER_REQUIRED"
      : "UNSUPPORTED_SCANNER_PROVIDER",
  );
}

export function providerReadiness(
  category: "storage" | "scanner",
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ProviderReadiness {
  try {
    const classification = classifyAimsEnvironment(environment);
    const driver = category === "storage" ? environment.STORAGE_DRIVER : environment.MALWARE_SCANNER_DRIVER;
    const local = category === "storage" ? driver === "local" : driver === "deterministic-local";
    const selected = category === "storage" ? driver === "object" : driver === "provider";
    if (local && !classification.protected) return { status: "ready", detail: `${category} development adapter` };
    if (local) return { status: "not_ready", detail: `${category} unsafe adapter rejected` };
    if (selected && classification.protected) return { status: "not_ready", detail: `${category} approved provider not implemented` };
    return { status: "not_ready", detail: `${category} provider not configured` };
  } catch {
    return { status: "not_ready", detail: `${category} environment configuration invalid` };
  }
}
