import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadLocalStorageConfig,
  LocalDocumentStorage,
} from '../src/infrastructure/storage/local-document-storage.ts';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 synthetic fixture');

test('stores and reads an immutable quarantined document with verified integrity', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
  try {
    const storage = createStorage(rootPath);
    const key = 'payment-requests/PAY-2026-000001/documents/invoice-v1.pdf';
    const stored = await storage.storeQuarantined({
      key,
      declaredContentType: 'application/pdf',
      data: PDF_BYTES,
    });

    assert.equal(stored.key, `quarantine/${key}`);
    assert.equal(stored.sizeBytes, PDF_BYTES.byteLength);
    assert.equal(stored.sha256.length, 64);
    assert.equal(stored.status, 'QUARANTINED');
    assert.deepEqual(
      [...(await storage.readQuarantined(stored.key, stored.sha256))],
      [...PDF_BYTES],
    );
    await assert.rejects(
      storage.storeQuarantined({ key, declaredContentType: 'application/pdf', data: PDF_BYTES }),
      /EEXIST/,
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('rejects unsafe keys, empty documents, unsupported types, and size overflow', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
  try {
    const storage = createStorage(rootPath, 4);
    const cases = [
      storage.storeQuarantined({ key: '../outside.pdf', declaredContentType: 'application/pdf', data: PDF_BYTES }),
      storage.storeQuarantined({ key: '/absolute.pdf', declaredContentType: 'application/pdf', data: PDF_BYTES }),
      storage.storeQuarantined({ key: 'unsafe\\file.pdf', declaredContentType: 'application/pdf', data: PDF_BYTES }),
      storage.storeQuarantined({ key: 'safe/empty.pdf', declaredContentType: 'application/pdf', data: new Uint8Array() }),
      storage.storeQuarantined({ key: 'safe/file.pdf', declaredContentType: 'image/png', data: new Uint8Array([1]) }),
      storage.storeQuarantined({ key: 'safe/large.pdf', declaredContentType: 'application/pdf', data: PDF_BYTES }),
    ];

    for (const operation of cases) {
      await assert.rejects(operation);
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('accepts a document exactly at the configured size boundary', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
  try {
    const storage = createStorage(rootPath, PDF_BYTES.byteLength);
    await storage.storeQuarantined({
      key: 'safe/boundary.pdf',
      declaredContentType: 'application/pdf',
      data: PDF_BYTES,
    });
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('rejects content whose signature does not match its declared type', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
  try {
    const storage = createStorage(rootPath);
    await assert.rejects(
      storage.storeQuarantined({
        key: 'safe/spoofed.pdf',
        declaredContentType: 'application/pdf',
        data: new TextEncoder().encode('not a PDF'),
      }),
      /does not match its file signature/,
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('detects document modification during read', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
  try {
    const storage = createStorage(rootPath);
    const stored = await storage.storeQuarantined({
      key: 'safe/invoice.pdf',
      declaredContentType: 'application/pdf',
      data: PDF_BYTES,
    });
    await writeFile(path.join(rootPath, stored.key), '%PDF-1.7 modified');

    await assert.rejects(
      storage.readQuarantined(stored.key, stored.sha256),
      /integrity verification failed/,
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('rejects non-quarantine reads and invalid expected digests', async () => {
  const storage = createStorage('/unused');
  await assert.rejects(storage.readQuarantined('safe/file.pdf', '0'.repeat(64)), /quarantined/);
  await assert.rejects(storage.readQuarantined('quarantine/safe/file.pdf', 'invalid'), /64 hexadecimal/);
});

test('rejects a symlinked directory inside the storage root', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
  const outsidePath = await mkdtemp(path.join(os.tmpdir(), 'aims-outside-'));
  try {
    await symlink(outsidePath, path.join(rootPath, 'quarantine'));
    const storage = createStorage(rootPath);
    await assert.rejects(
      storage.storeQuarantined({
        key: 'safe/file.pdf',
        declaredContentType: 'application/pdf',
        data: PDF_BYTES,
      }),
      /Symbolic links are not permitted/,
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});

test('validates configuration and resolves storage against the application root', () => {
  const config = loadLocalStorageConfig(
    {
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_PATH: './storage/documents',
      MAX_UPLOAD_BYTES: '10485760',
      ALLOWED_UPLOAD_TYPES: 'application/pdf,image/jpeg,image/png',
    },
    '/srv/aims',
  );

  assert.equal(config.rootPath, '/srv/aims/storage/documents');
  assert.equal(config.maxUploadBytes, 10_485_760);
  assert.deepEqual([...config.allowedContentTypes], [
    'application/pdf',
    'image/jpeg',
    'image/png',
  ]);
  assert.throws(
    () => loadLocalStorageConfig({ STORAGE_DRIVER: 's3' }),
    /STORAGE_DRIVER=local/,
  );
  assert.throws(
    () => loadLocalStorageConfig({
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_PATH: './storage',
      MAX_UPLOAD_BYTES: '10',
      ALLOWED_UPLOAD_TYPES: 'application/zip',
    }),
    /No file-signature validator/,
  );
});

function createStorage(rootPath: string, maxUploadBytes = 1024): LocalDocumentStorage {
  return new LocalDocumentStorage({
    rootPath,
    maxUploadBytes,
    allowedContentTypes: new Set(['application/pdf', 'image/png']),
  });
}
