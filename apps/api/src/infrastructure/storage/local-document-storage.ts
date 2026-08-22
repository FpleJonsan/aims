import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  DocumentStorage,
  StoredDocument,
  StoreDocumentInput,
} from './document-storage.ts';

export interface LocalStorageConfig {
  rootPath: string;
  maxUploadBytes: number;
  allowedContentTypes: ReadonlySet<string>;
}

const SIGNATURES: ReadonlyArray<{
  contentType: string;
  bytes: readonly number[];
}> = [
  { contentType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { contentType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { contentType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

export function loadLocalStorageConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  applicationRoot = process.cwd(),
): LocalStorageConfig {
  if (environment.STORAGE_DRIVER !== 'local') {
    throw new Error('Local storage requires STORAGE_DRIVER=local');
  }

  const configuredPath = environment.LOCAL_STORAGE_PATH;
  if (!configuredPath) {
    throw new Error('LOCAL_STORAGE_PATH is required');
  }

  const maxUploadBytes = Number(environment.MAX_UPLOAD_BYTES);
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0) {
    throw new Error('MAX_UPLOAD_BYTES must be a positive integer');
  }

  const allowedContentTypes = new Set(
    environment.ALLOWED_UPLOAD_TYPES?.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowedContentTypes.size === 0) {
    throw new Error('ALLOWED_UPLOAD_TYPES must contain at least one MIME type');
  }

  const unsupportedTypes = [...allowedContentTypes].filter(
    (contentType) => !SIGNATURES.some((signature) => signature.contentType === contentType),
  );
  if (unsupportedTypes.length > 0) {
    throw new Error(`No file-signature validator exists for: ${unsupportedTypes.join(', ')}`);
  }

  return {
    rootPath: path.resolve(applicationRoot, configuredPath),
    maxUploadBytes,
    allowedContentTypes,
  };
}

export class LocalDocumentStorage implements DocumentStorage {
  readonly #rootPath: string;
  readonly #maxUploadBytes: number;
  readonly #allowedContentTypes: ReadonlySet<string>;

  constructor(config: LocalStorageConfig) {
    this.#rootPath = path.resolve(config.rootPath);
    this.#maxUploadBytes = config.maxUploadBytes;
    this.#allowedContentTypes = new Set(config.allowedContentTypes);
  }

  async storeQuarantined(input: StoreDocumentInput): Promise<StoredDocument> {
    const declaredContentType = input.declaredContentType.trim().toLowerCase();
    if (!this.#allowedContentTypes.has(declaredContentType)) {
      throw new Error(`Unsupported document content type: ${declaredContentType}`);
    }
    if (input.data.byteLength === 0 || input.data.byteLength > this.#maxUploadBytes) {
      throw new Error('Document size is outside the configured upload limit');
    }

    const quarantinedKey = `quarantine/${input.key}`;
    const targetPath = this.#resolveKey(quarantinedKey);
    const detectedContentType = detectContentType(input.data);
    if (detectedContentType !== declaredContentType) {
      throw new Error('Declared document type does not match its file signature');
    }

    await mkdir(this.#rootPath, { recursive: true, mode: 0o700 });
    await this.#assertNoSymlink(this.#rootPath);

    await this.#assertNoSymlinkComponents(path.dirname(targetPath));
    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    await this.#assertNoSymlinkComponents(path.dirname(targetPath));

    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, input.data, { flag: 'wx', mode: 0o600 });
      await link(temporaryPath, targetPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }

    return {
      key: quarantinedKey,
      sizeBytes: input.data.byteLength,
      sha256: createHash('sha256').update(input.data).digest('hex'),
      contentType: detectedContentType,
      status: 'QUARANTINED',
    };
  }

  async readQuarantined(key: string, expectedSha256: string): Promise<Uint8Array> {
    if (!key.startsWith('quarantine/')) {
      throw new Error('Only quarantined documents can be read by this adapter');
    }
    if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
      throw new Error('Expected SHA-256 must contain exactly 64 hexadecimal characters');
    }
    const targetPath = this.#resolveKey(key);
    await this.#assertNoSymlinkComponents(targetPath);
    const data = await readFile(targetPath);
    const actualSha256 = createHash('sha256').update(data).digest('hex');
    if (actualSha256 !== expectedSha256.toLowerCase()) {
      throw new Error('Document integrity verification failed');
    }
    return data;
  }

  #resolveKey(key: string): string {
    if (!key || key.includes('\\') || path.posix.isAbsolute(key)) {
      throw new Error('Document key must be a relative POSIX path');
    }

    const segments = key.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('Document key contains an invalid path segment');
    }

    const resolvedPath = path.resolve(this.#rootPath, ...segments);
    if (!resolvedPath.startsWith(`${this.#rootPath}${path.sep}`)) {
      throw new Error('Document key resolves outside the storage root');
    }
    return resolvedPath;
  }

  async #assertNoSymlinkComponents(targetPath: string): Promise<void> {
    const relativePath = path.relative(this.#rootPath, targetPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('Document path is outside the storage root');
    }

    await this.#assertNoSymlink(this.#rootPath);
    let currentPath = this.#rootPath;
    for (const segment of relativePath.split(path.sep).filter(Boolean)) {
      currentPath = path.join(currentPath, segment);
      try {
        await this.#assertNoSymlink(currentPath);
      } catch (error) {
        if (isMissingPathError(error)) {
          return;
        }
        throw error;
      }
    }
  }

  async #assertNoSymlink(candidatePath: string): Promise<void> {
    const status = await lstat(candidatePath);
    if (status.isSymbolicLink()) {
      throw new Error('Symbolic links are not permitted in document storage paths');
    }
  }
}

function detectContentType(data: Uint8Array): string | undefined {
  return SIGNATURES.find(({ bytes }) =>
    bytes.every((byte, index) => data[index] === byte),
  )?.contentType;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
