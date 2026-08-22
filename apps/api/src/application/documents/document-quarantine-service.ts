import type {
  DocumentStorage,
  StoredDocument,
} from '../../infrastructure/storage/document-storage.js';

export interface MalwareScanRequest {
  key: string;
  sha256: string;
  contentType: string;
  data: Uint8Array;
}

export interface MalwareScanResult {
  verdict: 'CLEAN' | 'INFECTED' | 'ERROR';
  engine: string;
  reference: string;
}

export interface DocumentMalwareScanner {
  scan(request: MalwareScanRequest): Promise<MalwareScanResult>;
}

export class DocumentQuarantineService {
  constructor(
    private readonly storage: DocumentStorage,
    private readonly scanner: DocumentMalwareScanner,
  ) {}

  async scanAndPromote(
    document: StoredDocument,
    destinationKey: string,
  ): Promise<{ document: StoredDocument; scan: MalwareScanResult }> {
    if (document.status !== 'QUARANTINED') {
      throw new Error('Only quarantined documents can be scanned for promotion');
    }

    const data = await this.storage.readQuarantined(document.key, document.sha256);
    const scan = await this.scanner.scan({
      key: document.key,
      sha256: document.sha256,
      contentType: document.contentType,
      data,
    });
    if (scan.verdict !== 'CLEAN') {
      throw new Error(`Document promotion blocked by malware scan verdict: ${scan.verdict}`);
    }

    const promoted = await this.storage.promoteQuarantined({
      quarantinedKey: document.key,
      destinationKey,
      expectedSha256: document.sha256,
    });
    return { document: promoted, scan };
  }
}
