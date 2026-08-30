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

export interface DocumentStorage {
  storeQuarantined(input: StoreDocumentInput): Promise<StoredDocument>;
  readQuarantined(key: string, expectedSha256: string, signal?: AbortSignal): Promise<Uint8Array>;
  promoteQuarantined(input: PromoteDocumentInput): Promise<StoredDocument>;
  read(key: string, expectedSha256: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  metadata(key: string): Promise<{ sizeBytes: number; sha256: string }>;
  listKeys(): Promise<string[]>;
}
