export interface StoredDocument {
  key: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  status: 'QUARANTINED';
}

export interface StoreDocumentInput {
  key: string;
  declaredContentType: string;
  data: Uint8Array;
}

export interface DocumentStorage {
  storeQuarantined(input: StoreDocumentInput): Promise<StoredDocument>;
  readQuarantined(key: string, expectedSha256: string): Promise<Uint8Array>;
}
