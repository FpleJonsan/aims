import { createHash } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  INSPECTION_PREFIX_BYTES,
  INSPECTION_TAIL_BYTES,
  appendPrefix,
  appendTail,
  detectContentType,
  hasValidContainerEnding,
  parseAllowedContentTypes,
  parseMaxUploadBytes,
} from './document-content-validation.js';

import type {
  DocumentStorage,
  PromoteDocumentInput,
  StoredDocument,
  StoreDocumentInput,
} from './document-storage.js';

/** The single fixed backend identity for this adapter, persisted per-document in the database. */
export const S3_BACKEND_ID = 'aws-s3';

export interface S3StorageConfig {
  bucket: string;
  region: string;
  maxUploadBytes: number;
  allowedContentTypes: ReadonlySet<string>;
}

export function loadS3StorageConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): S3StorageConfig {
  if (environment.STORAGE_DRIVER !== 'object') {
    throw new Error('S3 storage requires STORAGE_DRIVER=object');
  }
  const bucket = environment.S3_BUCKET?.trim();
  if (!bucket) {
    throw new Error('S3_BUCKET is required');
  }
  const region = environment.S3_REGION?.trim();
  if (!region) {
    throw new Error('S3_REGION is required');
  }
  return {
    bucket,
    region,
    maxUploadBytes: parseMaxUploadBytes(environment),
    allowedContentTypes: parseAllowedContentTypes(environment),
  };
}

/**
 * S3-backed DocumentStorage. Object identity is the provider's own: `objectVersion`
 * is the exact S3 `VersionId` (the bucket must have versioning enabled — this
 * adapter never assumes it and will surface a clear error if S3 returns no
 * VersionId), and `sha256` is a client-computed digest that S3 is asked to
 * independently verify via its native `ChecksumSHA256` feature on write, then
 * re-derived from `ChecksumSHA256` on every subsequent read/metadata call so a
 * later check never merely trusts the value recorded at upload time.
 *
 * No AWS credentials are read or configured here: the constructor accepts an
 * `S3Client` (real, or test-injected) that resolves credentials the normal AWS
 * SDK way — an IAM task role in ECS, never a static access key (see
 * docs/production/staging-s0-environment-plan.md §5).
 */
export class S3DocumentStorage implements DocumentStorage {
  readonly #bucket: string;
  readonly #maxUploadBytes: number;
  readonly #allowedContentTypes: ReadonlySet<string>;
  readonly #client: S3Client;

  constructor(config: S3StorageConfig, client: S3Client = new S3Client({ region: config.region })) {
    this.#bucket = config.bucket;
    this.#maxUploadBytes = config.maxUploadBytes;
    this.#allowedContentTypes = new Set(config.allowedContentTypes);
    this.#client = client;
  }

  trustedKey(destination: string): string {
    return this.#normalizeKey(`active/${destination}`, 'active/');
  }

  async storeQuarantined(input: StoreDocumentInput): Promise<StoredDocument> {
    const declaredContentType = input.declaredContentType.trim().toLowerCase();
    if (!this.#allowedContentTypes.has(declaredContentType)) {
      throw new Error(`Unsupported document content type: ${declaredContentType}`);
    }
    const quarantinedKey = this.#normalizeKey(`quarantine/${input.key}`, 'quarantine/');

    const digest = createHash('sha256');
    let prefix: Uint8Array = new Uint8Array();
    let tail: Uint8Array = new Uint8Array();
    let sizeBytes = 0;
    const chunks: Uint8Array[] = [];
    for await (const chunk of input.data) {
      if (!(chunk instanceof Uint8Array)) {
        throw new Error('Document stream must yield Uint8Array chunks');
      }
      if (chunk.byteLength === 0) continue;
      sizeBytes += chunk.byteLength;
      if (sizeBytes > this.#maxUploadBytes) {
        throw new Error('Document size exceeds the configured upload limit');
      }
      prefix = appendPrefix(prefix, chunk, INSPECTION_PREFIX_BYTES);
      tail = appendTail(tail, chunk, INSPECTION_TAIL_BYTES);
      digest.update(chunk);
      chunks.push(chunk);
    }
    if (sizeBytes === 0) {
      throw new Error('Empty documents are not permitted');
    }

    const detectedContentType = detectContentType(prefix);
    if (detectedContentType !== declaredContentType) {
      throw new Error('Declared document type does not match its file signature');
    }
    if (!hasValidContainerEnding(detectedContentType, tail)) {
      throw new Error('Document structure does not contain the required closing marker');
    }

    const body = concatChunks(chunks, sizeBytes);
    const sha256Hex = digest.digest('hex');
    const checksumBase64 = Buffer.from(sha256Hex, 'hex').toString('base64');

    const result = await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: quarantinedKey,
        Body: body,
        ContentType: detectedContentType,
        ChecksumAlgorithm: 'SHA256',
        ChecksumSHA256: checksumBase64,
      }),
    );
    const objectVersion = result.VersionId;
    if (!objectVersion) {
      throw new Error('S3 did not return a VersionId; is bucket versioning enabled?');
    }

    return {
      provider: 'OBJECT',
      backendId: S3_BACKEND_ID,
      key: quarantinedKey,
      objectVersion,
      sizeBytes,
      sha256: sha256Hex,
      contentType: detectedContentType,
      status: 'QUARANTINED',
    };
  }

  async readQuarantined(
    backendId: string,
    key: string,
    objectVersion: string,
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    this.#assertBackend(backendId);
    if (!key.startsWith('quarantine/')) {
      throw new Error('Only quarantined documents can be read by this adapter');
    }
    this.#assertSha256Shape(expectedSha256);
    return this.read(backendId, key, objectVersion, expectedSha256, signal);
  }

  async read(
    backendId: string,
    key: string,
    objectVersion: string,
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    this.#assertBackend(backendId);
    if (!key.startsWith('quarantine/') && !key.startsWith('active/')) {
      throw new Error('Document key is outside a private storage zone');
    }
    this.#assertSha256Shape(expectedSha256);

    const response = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#bucket, Key: key, VersionId: objectVersion, ChecksumMode: 'ENABLED' }),
      { abortSignal: signal },
    );
    if (response.VersionId !== objectVersion) {
      throw new Error('Document object version verification failed');
    }
    const body = response.Body;
    if (!body) {
      throw new Error('S3 returned no object body');
    }
    const data = await body.transformToByteArray();
    const actual = createHash('sha256').update(data).digest('hex');
    if (actual !== expectedSha256.toLowerCase()) {
      throw new Error('Document integrity verification failed');
    }
    return data;
  }

  async delete(backendId: string, key: string, objectVersion: string): Promise<void> {
    this.#assertBackend(backendId);
    await this.#client.send(
      new DeleteObjectCommand({ Bucket: this.#bucket, Key: key, VersionId: objectVersion }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async metadata(
    backendId: string,
    key: string,
    objectVersion: string,
    signal?: AbortSignal,
  ): Promise<{ backendId: string; key: string; objectVersion: string; sizeBytes: number; sha256: string }> {
    this.#assertBackend(backendId);
    if (signal?.aborted) throw new Error('Document metadata read aborted');
    const response = await this.#client.send(
      new HeadObjectCommand({ Bucket: this.#bucket, Key: key, VersionId: objectVersion, ChecksumMode: 'ENABLED' }),
      { abortSignal: signal },
    );
    if (response.VersionId !== objectVersion) {
      throw new Error('Document object version verification failed');
    }
    const sha256 = this.#requireChecksumHex(response.ChecksumSHA256);
    const sizeBytes = response.ContentLength;
    if (sizeBytes === undefined) {
      throw new Error('S3 returned no ContentLength for document metadata');
    }
    return { backendId: S3_BACKEND_ID, key, objectVersion, sizeBytes, sha256 };
  }

  async promoteQuarantined(input: PromoteDocumentInput): Promise<StoredDocument> {
    this.#assertBackend(input.backendId);
    if (input.signal?.aborted) throw new Error('Document promotion aborted');

    // Verify the exact source bytes before promoting anything, exactly as the
    // local adapter does — a promote can never be based on unverified content.
    const data = await this.readQuarantined(
      input.backendId,
      input.quarantinedKey,
      input.quarantinedObjectVersion,
      input.expectedSha256,
      input.signal,
    );
    if (data.byteLength !== input.expectedSizeBytes) {
      throw new Error('Document promotion size verification failed');
    }
    const activeKey = this.#normalizeKey(input.trustedKey, 'active/');
    const expectedSha256Lower = input.expectedSha256.toLowerCase();

    // S3 has no filesystem-style EEXIST on write: copying to an existing key
    // just creates a new version. To keep the same "promotion is idempotent
    // but a conflicting destination is rejected" guarantee the local adapter
    // provides, check first rather than relying on a write-time collision.
    const existing = await this.#headIfExists(activeKey);
    if (existing) {
      if (existing.sha256 !== expectedSha256Lower || existing.sizeBytes !== input.expectedSizeBytes) {
        throw new Error('Existing promoted document identity mismatch');
      }
      const contentType = this.#requireValidContentType(data);
      return {
        provider: 'OBJECT',
        backendId: S3_BACKEND_ID,
        key: activeKey,
        objectVersion: existing.objectVersion,
        sizeBytes: existing.sizeBytes,
        sha256: existing.sha256,
        contentType,
        status: 'ACTIVE',
      };
    }

    if (input.signal?.aborted) throw new Error('Document promotion aborted');
    const copyResult = await this.#client.send(
      new CopyObjectCommand({
        Bucket: this.#bucket,
        Key: activeKey,
        CopySource: `${this.#bucket}/${encodeURIComponent(input.quarantinedKey)}?versionId=${input.quarantinedObjectVersion}`,
        ChecksumAlgorithm: 'SHA256',
      }),
      { abortSignal: input.signal },
    );
    const objectVersion = copyResult.VersionId;
    if (!objectVersion) {
      throw new Error('S3 did not return a VersionId for the promoted document; is bucket versioning enabled?');
    }

    // Independent post-write proof, matching P13.3.1: never trust the write
    // response alone — re-read the exact destination and compare identity.
    const proof = await this.metadata(input.backendId, activeKey, objectVersion, input.signal);
    if (proof.sha256 !== expectedSha256Lower || proof.sizeBytes !== input.expectedSizeBytes) {
      throw new Error('Promoted document identity mismatch');
    }

    const contentType = this.#requireValidContentType(data);
    return {
      provider: 'OBJECT',
      backendId: S3_BACKEND_ID,
      key: activeKey,
      objectVersion,
      sizeBytes: proof.sizeBytes,
      sha256: proof.sha256,
      contentType,
      status: 'ACTIVE',
    };
  }

  async listPage(
    cursor: string | null,
    pageSize: number,
    signal?: AbortSignal,
  ): Promise<{ keys: string[]; objects: Array<{ backendId: string; key: string; objectVersion: string }>; nextCursor: string | null; complete: boolean }> {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      throw new Error('Storage enumeration page size must be between 1 and 500');
    }
    if (cursor !== null && cursor.length > 1024) {
      throw new Error('Storage enumeration cursor is invalid');
    }
    if (signal?.aborted) throw new Error('Storage enumeration aborted');

    const response = await this.#client.send(
      new ListObjectsV2Command({
        Bucket: this.#bucket,
        MaxKeys: pageSize,
        StartAfter: cursor ?? undefined,
      }),
      { abortSignal: signal },
    );
    const keys = (response.Contents ?? []).map((entry) => entry.Key).filter((key): key is string => Boolean(key));
    // ListObjectsV2 does not return version identity, only ListObjectVersions
    // does — fetching it per key keeps the cursor contract identical to the
    // local adapter's (a plain last-key string) at the cost of one extra HEAD
    // request per key. Acceptable here: this method serves audit/recovery
    // enumeration (P12), not upload/scan hot paths.
    const objects: Array<{ backendId: string; key: string; objectVersion: string }> = [];
    for (const key of keys) {
      if (signal?.aborted) throw new Error('Storage enumeration aborted');
      const head = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }), { abortSignal: signal });
      if (!head.VersionId) throw new Error('S3 returned no VersionId while enumerating; is bucket versioning enabled?');
      objects.push({ backendId: S3_BACKEND_ID, key, objectVersion: head.VersionId });
    }
    const complete = !response.IsTruncated;
    return { keys, objects, nextCursor: complete ? null : (keys.at(-1) ?? null), complete };
  }

  async #headIfExists(key: string): Promise<{ objectVersion: string; sha256: string; sizeBytes: number } | null> {
    try {
      const response = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key, ChecksumMode: 'ENABLED' }));
      if (!response.VersionId) throw new Error('S3 returned no VersionId; is bucket versioning enabled?');
      if (response.ContentLength === undefined) throw new Error('S3 returned no ContentLength for document metadata');
      return {
        objectVersion: response.VersionId,
        sha256: this.#requireChecksumHex(response.ChecksumSHA256),
        sizeBytes: response.ContentLength,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  #requireValidContentType(data: Uint8Array): string {
    const contentType = detectContentType(data);
    if (!contentType || !hasValidContainerEnding(contentType, appendTail(new Uint8Array(), data, INSPECTION_TAIL_BYTES))) {
      throw new Error('Quarantined document failed structural verification during promotion');
    }
    return contentType;
  }

  #requireChecksumHex(checksumBase64: string | undefined): string {
    if (!checksumBase64) {
      throw new Error('S3 returned no ChecksumSHA256; object was not uploaded with a SHA-256 checksum');
    }
    return Buffer.from(checksumBase64, 'base64').toString('hex');
  }

  #assertBackend(backendId: string): void {
    if (backendId !== S3_BACKEND_ID) throw new Error('Document storage backend mismatch');
  }

  #assertSha256Shape(sha256: string): void {
    if (!/^[a-f0-9]{64}$/i.test(sha256)) {
      throw new Error('Expected SHA-256 must contain exactly 64 hexadecimal characters');
    }
  }

  #normalizeKey(key: string, requiredPrefix: 'active/' | 'quarantine/'): string {
    if (!key.startsWith(requiredPrefix)) {
      throw new Error(`Document key must be canonical in the private ${requiredPrefix.replace('/', '')} zone`);
    }
    if (key.includes('\\') || key.includes('..') || key.startsWith('/') || key.includes('//')) {
      throw new Error('Document key contains an invalid path segment');
    }
    const segments = key.split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.')) {
      throw new Error('Document key contains an invalid path segment');
    }
    return key;
  }
}

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isNotFound(error: unknown): boolean {
  if (error instanceof NotFound) return true;
  const name = (error as { name?: string } | undefined)?.name;
  const httpStatus = (error as { $metadata?: { httpStatusCode?: number } } | undefined)?.$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || httpStatus === 404;
}
