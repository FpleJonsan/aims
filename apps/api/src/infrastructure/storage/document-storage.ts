export interface StoredDocument {
  provider: 'LOCAL' | 'OBJECT';
  backendId: string;
  key: string;
  objectVersion: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  status: 'QUARANTINED' | 'ACTIVE';
}

export interface StoreDocumentInput {
  key: string;
  declaredContentType: string;
  data: AsyncIterable<Uint8Array>;
}

export interface PromoteDocumentInput {
  backendId: string;
  quarantinedKey: string;
  quarantinedObjectVersion: string;
  /** Exact canonical trusted key selected before promotion; substitution is forbidden. */
  trustedKey: string;
  expectedSha256: string;
  expectedSizeBytes: number;
  signal?: AbortSignal;
}

export interface StorageObjectPage {
  /** Complete normalized object keys in strict lexical order, each greater than the input cursor. */
  keys: string[];
  objects: Array<{backendId:string;key:string;objectVersion:string}>;
  /** Last returned complete key when more keys remain; otherwise null. */
  nextCursor: string | null;
  complete: boolean;
}

export interface DocumentStorage {
  storeQuarantined(input: StoreDocumentInput): Promise<StoredDocument>;
  /** Canonicalizes the provider-neutral logical destination before external I/O. */
  trustedKey(destination: string): string;
  readQuarantined(backendId: string, key: string, objectVersion: string, expectedSha256: string, signal?: AbortSignal): Promise<Uint8Array>;
  promoteQuarantined(input: PromoteDocumentInput): Promise<StoredDocument>;
  read(backendId: string, key: string, objectVersion: string, expectedSha256: string, signal?: AbortSignal): Promise<Uint8Array>;
  delete(backendId: string, key: string, objectVersion: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  metadata(backendId: string, key: string, objectVersion: string, signal?: AbortSignal): Promise<{ backendId:string; key:string; objectVersion:string; sizeBytes: number; sha256: string }>;
  /**
   * Enumerates a frozen dataset with deterministic, lossless continuation over
   * globally ordered complete object keys. Implementations return at most
   * pageSize keys and honor cancellation promptly. Callers may await operation
   * settlement after abort so implementations must release traversal resources
   * while unwinding.
   */
  listPage(cursor: string | null, pageSize: number, signal?: AbortSignal): Promise<StorageObjectPage>;
}
