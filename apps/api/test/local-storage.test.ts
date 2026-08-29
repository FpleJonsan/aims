import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadLocalStorageConfig,
  LocalDocumentStorage,
} from '../src/infrastructure/storage/local-document-storage.js';
import {
  DocumentQuarantineService,
  type DocumentMalwareScanner,
} from '../src/application/documents/document-quarantine-service.js';
import { assertAllowedDocumentExtension } from '../src/application/documents/payment-document.service.js';
import { DeterministicLocalMalwareScanner } from '../src/infrastructure/security/deterministic-local-malware-scanner.js';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\nsynthetic fixture\n%%EOF\n');

test('stores and reads an immutable quarantined document with verified integrity', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
  try {
    const storage = createStorage(rootPath);
    const key = 'payment-requests/PAY-2026-000001/documents/invoice-v1.pdf';
    const stored = await storage.storeQuarantined({
      key,
      declaredContentType: 'application/pdf',
      data: byteStream(PDF_BYTES, 3),
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
      storage.storeQuarantined({ key, declaredContentType: 'application/pdf', data: byteStream(PDF_BYTES) }),
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
      () => storage.storeQuarantined({ key: '../outside.pdf', declaredContentType: 'application/pdf', data: byteStream(PDF_BYTES) }),
      () => storage.storeQuarantined({ key: '/absolute.pdf', declaredContentType: 'application/pdf', data: byteStream(PDF_BYTES) }),
      () => storage.storeQuarantined({ key: 'unsafe\\file.pdf', declaredContentType: 'application/pdf', data: byteStream(PDF_BYTES) }),
      () => storage.storeQuarantined({ key: 'safe/empty.pdf', declaredContentType: 'application/pdf', data: byteStream(new Uint8Array()) }),
      () => storage.storeQuarantined({ key: 'safe/file.pdf', declaredContentType: 'image/png', data: byteStream(new Uint8Array([1])) }),
      () => storage.storeQuarantined({ key: 'safe/large.pdf', declaredContentType: 'application/pdf', data: byteStream(PDF_BYTES) }),
    ];

    for (const operation of cases) {
      await assert.rejects(operation());
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
      data: byteStream(PDF_BYTES),
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
        data: byteStream(new TextEncoder().encode('not a PDF')),
      }),
      /does not match its file signature/,
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('requires an allowed filename extension that matches declared MIME',()=>{
  assert.doesNotThrow(()=>assertAllowedDocumentExtension('invoice.pdf','application/pdf'));
  assert.doesNotThrow(()=>assertAllowedDocumentExtension('receipt.JPEG','image/jpeg'));
  assert.throws(()=>assertAllowedDocumentExtension('invoice.exe','application/pdf'),/extension/);
  assert.throws(()=>assertAllowedDocumentExtension('invoice.png','application/pdf'),/extension/);
  assert.throws(()=>assertAllowedDocumentExtension('invoice','application/pdf'),/extension/);
});

test('deterministic local scanner proves clean, rejected, and failure outcomes and rejects Production',async()=>{
  const scanner=new DeterministicLocalMalwareScanner();
  const request=(data:string)=>({key:'quarantine/test.pdf',sha256:'0'.repeat(64),contentType:'application/pdf',data:new TextEncoder().encode(data)});
  assert.equal((await scanner.scan(request('harmless'))).verdict,'CLEAN');
  assert.equal((await scanner.scan(request('AIMS_LOCAL_SCAN_REJECT'))).verdict,'INFECTED');
  assert.equal((await scanner.scan(request('AIMS_LOCAL_SCAN_FAIL'))).verdict,'ERROR');
  const prior=process.env.AIMS_ENVIRONMENT;process.env.AIMS_ENVIRONMENT='production';
  try{assert.throws(()=>new DeterministicLocalMalwareScanner(),/forbidden in production/);}finally{if(prior===undefined)delete process.env.AIMS_ENVIRONMENT;else process.env.AIMS_ENVIRONMENT=prior;}
});

test('detects document modification during read', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
  try {
    const storage = createStorage(rootPath);
    const stored = await storage.storeQuarantined({
      key: 'safe/invoice.pdf',
      declaredContentType: 'application/pdf',
      data: byteStream(PDF_BYTES),
    });
    await writeFile(path.join(rootPath, stored.key), '%PDF-1.7\nmodified\n%%EOF\n');

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
        data: byteStream(PDF_BYTES),
      }),
      /Symbolic links are not permitted/,
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
    await rm(outsidePath, { recursive: true, force: true });
  }
});

test('rejects files with a valid header but an invalid closing structure', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
  try {
    const storage = createStorage(rootPath);
    await assert.rejects(
      storage.storeQuarantined({
        key: 'safe/truncated.pdf',
        declaredContentType: 'application/pdf',
        data: byteStream(new TextEncoder().encode('%PDF-1.7 truncated')),
      }),
      /required closing marker/,
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('promotes only after a clean malware scan and preserves integrity', async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
  try {
    const storage = createStorage(rootPath);
    const quarantined = await storage.storeQuarantined({
      key: 'safe/clean.pdf',
      declaredContentType: 'application/pdf',
      data: byteStream(PDF_BYTES),
    });
    const scanner: DocumentMalwareScanner = {
      scan: async () => ({ verdict: 'CLEAN', engine: 'test-scanner', reference: 'scan-1' }),
    };
    const service = new DocumentQuarantineService(storage, scanner);

    const result = await service.scanAndPromote(quarantined, 'documents/clean.pdf');

    assert.equal(result.document.status, 'ACTIVE');
    assert.equal(result.document.key, 'active/documents/clean.pdf');
    assert.equal(result.scan.verdict, 'CLEAN');
    assert.deepEqual(
      [...(await readFile(path.join(rootPath, result.document.key)))],
      [...PDF_BYTES],
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('fails closed when malware scanning is infected or unavailable', async () => {
  const verdicts = ['INFECTED', 'ERROR'] as const;
  for (const verdict of verdicts) {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'aims-storage-'));
    try {
      const storage = createStorage(rootPath);
      const quarantined = await storage.storeQuarantined({
        key: `safe/${verdict.toLowerCase()}.pdf`,
        declaredContentType: 'application/pdf',
        data: byteStream(PDF_BYTES),
      });
      const scanner: DocumentMalwareScanner = {
        scan: async () => ({ verdict, engine: 'test-scanner', reference: `scan-${verdict}` }),
      };
      const service = new DocumentQuarantineService(storage, scanner);

      await assert.rejects(
        service.scanAndPromote(quarantined, `documents/${verdict.toLowerCase()}.pdf`),
        new RegExp(verdict),
      );
      await assert.rejects(
        readFile(path.join(rootPath, `active/documents/${verdict.toLowerCase()}.pdf`)),
        /ENOENT/,
      );
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  }
});

test('validates configuration and resolves storage against the application root', () => {
  const config = loadLocalStorageConfig(
    {
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DEMO_MODE: 'true',
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
      LOCAL_STORAGE_DEMO_MODE: 'true',
      LOCAL_STORAGE_PATH: './storage',
      MAX_UPLOAD_BYTES: '10',
      ALLOWED_UPLOAD_TYPES: 'application/zip',
    }),
    /No file-signature validator/,
  );
  assert.throws(
    () => loadLocalStorageConfig({
      NODE_ENV: 'production',
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DEMO_MODE: 'true',
    }),
    /forbidden in production/,
  );
});

test('direct construction is forbidden in production', () => {
  const previousNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(
      () => createStorage('/unused'),
      /forbidden in production/,
    );
  } finally {
    if (previousNodeEnvironment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnvironment;
    }
  }
});

function createStorage(rootPath: string, maxUploadBytes = 1024): LocalDocumentStorage {
  return new LocalDocumentStorage({
    rootPath,
    maxUploadBytes,
    allowedContentTypes: new Set(['application/pdf', 'image/png']),
    demoMode: true,
  });
}

async function* byteStream(data: Uint8Array, chunkSize = data.byteLength || 1): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
    yield data.subarray(offset, Math.min(offset + chunkSize, data.byteLength));
  }
}
