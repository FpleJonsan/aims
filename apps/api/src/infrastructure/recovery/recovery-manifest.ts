export const RECOVERY_MANIFEST_VERSION = "1" as const;
export const SUPPORTED_SCHEMA_VERSION = 59 as const;
export const SUPPORTED_MIGRATION_ID = "059_p12_recovery_generation_fencing" as const;

const MAX_TEXT = 256;
const MAX_REFERENCE = 1024;
const ALLOWED_KEYS = new Set([
  "specificationVersion", "environment", "databaseRecoveryReference",
  "databaseRecoveryPoint", "objectRecoveryReference", "applicationRelease",
  "schemaVersion", "latestMigrationId", "expectedRecoveryGeneration",
  "generationAdvancementEvidenceReference", "createdAt", "integrity",
  "operatorMetadata",
]);

export type ManifestEvidenceClass =
  | "VERIFIABLE_FROM_RESTORED_STATE"
  | "DECLARED_EXTERNAL_EVIDENCE"
  | "PROVIDER_ATTESTATION_REQUIRED"
  | "NOT_VERIFIABLE_LOCALLY";

export interface RecoveryManifest {
  specificationVersion: typeof RECOVERY_MANIFEST_VERSION;
  environment: "local" | "competition" | "staging" | "production" | "isolated-restore";
  databaseRecoveryReference: string;
  databaseRecoveryPoint: string;
  objectRecoveryReference: string;
  applicationRelease: string;
  schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  latestMigrationId: typeof SUPPORTED_MIGRATION_ID;
  expectedRecoveryGeneration: string;
  generationAdvancementEvidenceReference: string;
  createdAt: string;
  integrity: {
    algorithm: "PROVIDER_ATTESTATION_REQUIRED" | "SHA-256";
    evidenceReference: string;
  };
  operatorMetadata?: Readonly<Record<string, string>>;
}

export const recoveryManifestTrust: Readonly<Record<keyof RecoveryManifest, ManifestEvidenceClass>> = {
  specificationVersion: "VERIFIABLE_FROM_RESTORED_STATE",
  environment: "DECLARED_EXTERNAL_EVIDENCE",
  databaseRecoveryReference: "PROVIDER_ATTESTATION_REQUIRED",
  databaseRecoveryPoint: "DECLARED_EXTERNAL_EVIDENCE",
  objectRecoveryReference: "PROVIDER_ATTESTATION_REQUIRED",
  applicationRelease: "VERIFIABLE_FROM_RESTORED_STATE",
  schemaVersion: "VERIFIABLE_FROM_RESTORED_STATE",
  latestMigrationId: "VERIFIABLE_FROM_RESTORED_STATE",
  expectedRecoveryGeneration: "VERIFIABLE_FROM_RESTORED_STATE",
  generationAdvancementEvidenceReference: "DECLARED_EXTERNAL_EVIDENCE",
  createdAt: "DECLARED_EXTERNAL_EVIDENCE",
  integrity: "PROVIDER_ATTESTATION_REQUIRED",
  operatorMetadata: "NOT_VERIFIABLE_LOCALLY",
};

export class RecoveryManifestError extends Error {
  constructor(readonly code: string, readonly path?: string) { super(path ? `${code}:${path}` : code); }
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RecoveryManifestError(code);
  return value as Record<string, unknown>;
}
function text(value: unknown, code: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new RecoveryManifestError(code);
  }
  return value;
}
function reference(value: unknown, code: string, path: string, max = MAX_REFERENCE): string {
  const result = text(value, code, max);
  if (
    /\bpostgres(?:ql)?:\/\//i.test(result) ||
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/i.test(result) ||
    /\b(?:Bearer|Basic)\s+[^\s,;]+/i.test(result) ||
    /(?:password|passwd|token|secret|api[_-]?key|client[_-]?secret|private[_-]?key|connection[_-]?string|database[_-]?url)\s*[=:]/i.test(result) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(result)
  ) throw new RecoveryManifestError("MANIFEST_PROHIBITED_CONTENT", path);
  return result;
}
function iso(value: unknown, code: string): string {
  const result = text(value, code, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(result) || Number.isNaN(Date.parse(result))) {
    throw new RecoveryManifestError(code);
  }
  return result;
}
function uuid(value: unknown, code: string): string {
  const result = text(value, code, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new RecoveryManifestError(code);
  }
  return result.toLowerCase();
}

export function parseRecoveryManifest(value: unknown): RecoveryManifest {
  const input = object(value, "MANIFEST_OBJECT_REQUIRED");
  for (const key of Object.keys(input)) if (!ALLOWED_KEYS.has(key)) throw new RecoveryManifestError("MANIFEST_FIELD_PROHIBITED");
  if (input.specificationVersion !== RECOVERY_MANIFEST_VERSION) throw new RecoveryManifestError("MANIFEST_VERSION_UNSUPPORTED");
  const environment = text(input.environment, "MANIFEST_ENVIRONMENT_INVALID", 32);
  if (!["local", "competition", "staging", "production", "isolated-restore"].includes(environment)) {
    throw new RecoveryManifestError("MANIFEST_ENVIRONMENT_INVALID");
  }
  if (input.schemaVersion !== SUPPORTED_SCHEMA_VERSION) throw new RecoveryManifestError("MANIFEST_SCHEMA_UNSUPPORTED");
  if (input.latestMigrationId !== SUPPORTED_MIGRATION_ID) throw new RecoveryManifestError("MANIFEST_MIGRATION_UNSUPPORTED");
  const integrityInput = object(input.integrity, "MANIFEST_INTEGRITY_INVALID");
  if (Object.keys(integrityInput).some((key) => !["algorithm", "evidenceReference"].includes(key))) {
    throw new RecoveryManifestError("MANIFEST_FIELD_PROHIBITED");
  }
  const algorithm = text(integrityInput.algorithm, "MANIFEST_INTEGRITY_INVALID", 32);
  if (algorithm !== "PROVIDER_ATTESTATION_REQUIRED" && algorithm !== "SHA-256") throw new RecoveryManifestError("MANIFEST_INTEGRITY_INVALID");
  let operatorMetadata: Record<string, string> | undefined;
  if (input.operatorMetadata !== undefined) {
    const metadata = object(input.operatorMetadata, "MANIFEST_OPERATOR_METADATA_INVALID");
    if (Object.keys(metadata).length > 16) throw new RecoveryManifestError("MANIFEST_OPERATOR_METADATA_INVALID");
    operatorMetadata = {};
    for (const [key, raw] of Object.entries(metadata)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) throw new RecoveryManifestError("MANIFEST_OPERATOR_METADATA_INVALID");
      if (/(secret|password|credential|token|cookie|connection|string|payee|purpose|amount|bank|document|sql|payload)/i.test(key)) {
        throw new RecoveryManifestError("MANIFEST_FIELD_PROHIBITED");
      }
      operatorMetadata[key] = reference(raw, "MANIFEST_OPERATOR_METADATA_INVALID", `operatorMetadata.${key}`, MAX_TEXT);
    }
  }
  return {
    specificationVersion: RECOVERY_MANIFEST_VERSION,
    environment: environment as RecoveryManifest["environment"],
    databaseRecoveryReference: reference(input.databaseRecoveryReference, "MANIFEST_DATABASE_REFERENCE_REQUIRED", "databaseRecoveryReference"),
    databaseRecoveryPoint: iso(input.databaseRecoveryPoint, "MANIFEST_RECOVERY_POINT_INVALID"),
    objectRecoveryReference: reference(input.objectRecoveryReference, "MANIFEST_OBJECT_REFERENCE_REQUIRED", "objectRecoveryReference"),
    applicationRelease: reference(input.applicationRelease, "MANIFEST_RELEASE_REQUIRED", "applicationRelease", 128),
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    latestMigrationId: SUPPORTED_MIGRATION_ID,
    expectedRecoveryGeneration: uuid(input.expectedRecoveryGeneration, "MANIFEST_GENERATION_INVALID"),
    generationAdvancementEvidenceReference: reference(input.generationAdvancementEvidenceReference, "MANIFEST_GENERATION_EVIDENCE_REQUIRED", "generationAdvancementEvidenceReference"),
    createdAt: iso(input.createdAt, "MANIFEST_CREATED_AT_INVALID"),
    integrity: { algorithm, evidenceReference: reference(integrityInput.evidenceReference, "MANIFEST_INTEGRITY_INVALID", "integrity.evidenceReference") },
    ...(operatorMetadata ? { operatorMetadata } : {}),
  };
}
