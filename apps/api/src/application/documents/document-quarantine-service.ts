export interface MalwareScanRequest {
  key: string;
  sha256: string;
  contentType: string;
  data: Uint8Array;
  signal?: AbortSignal;
}

export interface MalwareScanResult {
  verdict: 'CLEAN' | 'INFECTED' | 'ERROR';
  engine: string;
  reference: string;
}

export interface DocumentMalwareScanner {
  scan(request: MalwareScanRequest): Promise<MalwareScanResult>;
}
