export interface StoredDocument {
  key: string;
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
  quarantinedKey: string;
  destinationKey: string;
  expectedSha256: string;
}

export interface StorageObjectPage {
  /** Complete normalized object keys in strict lexical order, each greater than the input cursor. */
  keys: string[];
  /** Last returned complete key when more keys remain; otherwise null. */
  nextCursor: string | null;
  complete: boolean;
}

export interface DocumentStorage {
  storeQuarantined(input: StoreDocumentInput): Promise<StoredDocument>;
  readQuarantined(key: string, expectedSha256: string, signal?: AbortSignal): Promise<Uint8Array>;
  promoteQuarantined(input: PromoteDocumentInput): Promise<StoredDocument>;
  read(key: string, expectedSha256: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  metadata(key: string, signal?: AbortSignal): Promise<{ sizeBytes: number; sha256: string }>;
  /**
   * Enumerates a frozen dataset with deterministic, lossless continuation over
   * globally ordered complete object keys. Implementations return at most
   * pageSize keys and honor cancellation promptly. Callers may await operation
   * settlement after abort so implementations must release traversal resources
   * while unwinding.
   */
  listPage(cursor: string | null, pageSize: number, signal?: AbortSignal): Promise<StorageObjectPage>;
}
