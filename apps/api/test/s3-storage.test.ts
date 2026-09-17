import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';

import {
  S3DocumentStorage,
  S3_BACKEND_ID,
  loadS3StorageConfig,
} from '../src/infrastructure/storage/s3-document-storage.js';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\nsynthetic fixture\n%%EOF\n');

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function sha256Base64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
}

async function* byteStream(data: Uint8Array, chunks = 1): AsyncGenerator<Uint8Array> {
  const size = Math.ceil(data.byteLength / chunks);
  for (let offset = 0; offset < data.byteLength; offset += size) {
    yield data.subarray(offset, Math.min(offset + size, data.byteLength));
  }
}

function baseConfig() {
  return {
    bucket: 'aims-staging-documents',
    region: 'ap-southeast-1',
    maxUploadBytes: 1_000_000,
    allowedContentTypes: new Set(['application/pdf']),
  };
}

function setup() {
  const client = new S3Client({ region: 'ap-southeast-1' });
  const mock = mockClient(client);
  const storage = new S3DocumentStorage(baseConfig(), client);
  return { mock, storage };
}

/** Wraps SDK response bodies the way the real client returns a Node stream body. */
function fakeBody(data: Uint8Array) {
  return { transformToByteArray: async () => data };
}

test('loadS3StorageConfig validates required environment', () => {
  assert.throws(() => loadS3StorageConfig({ STORAGE_DRIVER: 'local' }), /STORAGE_DRIVER=object/);
  assert.throws(
    () => loadS3StorageConfig({ STORAGE_DRIVER: 'object', S3_REGION: 'ap-southeast-1' }),
    /S3_BUCKET is required/,
  );
  assert.throws(
    () => loadS3StorageConfig({ STORAGE_DRIVER: 'object', S3_BUCKET: 'b' }),
    /S3_REGION is required/,
  );
  const config = loadS3StorageConfig({
    STORAGE_DRIVER: 'object',
    S3_BUCKET: 'b',
    S3_REGION: 'ap-southeast-1',
    MAX_UPLOAD_BYTES: '10',
    ALLOWED_UPLOAD_TYPES: 'application/pdf',
  });
  assert.equal(config.bucket, 'b');
  assert.equal(config.region, 'ap-southeast-1');
  assert.equal(config.maxUploadBytes, 10);
  assert.ok(config.allowedContentTypes.has('application/pdf'));
});

test('stores a quarantined document, computing and verifying its own SHA-256 via S3 native checksum', async () => {
  const { mock, storage } = setup();
  const expectedSha = sha256Hex(PDF_BYTES);
  mock.on(PutObjectCommand).resolves({ VersionId: 'v1', ChecksumSHA256: sha256Base64(expectedSha) });

  const stored = await storage.storeQuarantined({
    key: 'payment-requests/PAY-1/documents/invoice.pdf',
    declaredContentType: 'application/pdf',
    data: byteStream(PDF_BYTES, 3),
  });

  assert.equal(stored.provider, 'OBJECT');
  assert.equal(stored.backendId, S3_BACKEND_ID);
  assert.equal(stored.key, 'quarantine/payment-requests/PAY-1/documents/invoice.pdf');
  assert.equal(stored.objectVersion, 'v1');
  assert.equal(stored.sizeBytes, PDF_BYTES.byteLength);
  assert.equal(stored.sha256, expectedSha);
  assert.equal(stored.status, 'QUARANTINED');

  const putCalls = mock.commandCalls(PutObjectCommand);
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].args[0].input.ChecksumSHA256, sha256Base64(expectedSha));
  assert.equal(putCalls[0].args[0].input.ChecksumAlgorithm, 'SHA256');
});

test('rejects storeQuarantined inputs that fail existing content-safety checks', async () => {
  const { storage } = setup();
  await assert.rejects(
    storage.storeQuarantined({ key: 'x.pdf', declaredContentType: 'image/gif', data: byteStream(PDF_BYTES) }),
    /Unsupported document content type/,
  );
  await assert.rejects(
    storage.storeQuarantined({ key: 'x.pdf', declaredContentType: 'application/pdf', data: byteStream(new Uint8Array(0)) }),
    /Empty documents are not permitted/,
  );
  const bigConfig = { ...baseConfig(), maxUploadBytes: 4 };
  const storageWithSmallLimit = new S3DocumentStorage(bigConfig, new S3Client({ region: 'ap-southeast-1' }));
  await assert.rejects(
    storageWithSmallLimit.storeQuarantined({ key: 'x.pdf', declaredContentType: 'application/pdf', data: byteStream(PDF_BYTES) }),
    /exceeds the configured upload limit/,
  );
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0]);
  await assert.rejects(
    storage.storeQuarantined({ key: 'x.pdf', declaredContentType: 'application/pdf', data: byteStream(fakeJpeg) }),
    /does not match its file signature/,
  );
  const truncatedPdf = new TextEncoder().encode('%PDF-1.7\nno closing marker');
  await assert.rejects(
    storage.storeQuarantined({ key: 'x.pdf', declaredContentType: 'application/pdf', data: byteStream(truncatedPdf) }),
    /required closing marker/,
  );
});

test('storeQuarantined fails closed if S3 does not return a VersionId (bucket not versioned)', async () => {
  const { mock, storage } = setup();
  mock.on(PutObjectCommand).resolves({ ChecksumSHA256: sha256Base64(sha256Hex(PDF_BYTES)) });
  await assert.rejects(
    storage.storeQuarantined({ key: 'x.pdf', declaredContentType: 'application/pdf', data: byteStream(PDF_BYTES) }),
    /bucket versioning enabled/,
  );
});

test('reads a quarantined document and verifies version and hash independently', async () => {
  const { mock, storage } = setup();
  const sha = sha256Hex(PDF_BYTES);
  mock.on(GetObjectCommand).resolves({ VersionId: 'v1', Body: fakeBody(PDF_BYTES) as never });

  const data = await storage.readQuarantined(S3_BACKEND_ID, 'quarantine/x.pdf', 'v1', sha);
  assert.deepEqual([...data], [...PDF_BYTES]);
});

test('read rejects a version mismatch even when bytes are correct', async () => {
  const { mock, storage } = setup();
  const sha = sha256Hex(PDF_BYTES);
  mock.on(GetObjectCommand).resolves({ VersionId: 'v2-actual', Body: fakeBody(PDF_BYTES) as never });
  await assert.rejects(
    storage.read(S3_BACKEND_ID, 'active/x.pdf', 'v1-requested', sha),
    /object version verification failed/,
  );
});

test('read rejects tampered bytes (hash mismatch)', async () => {
  const { mock, storage } = setup();
  const wrongSha = sha256Hex(new TextEncoder().encode('different content'));
  mock.on(GetObjectCommand).resolves({ VersionId: 'v1', Body: fakeBody(PDF_BYTES) as never });
  await assert.rejects(storage.read(S3_BACKEND_ID, 'active/x.pdf', 'v1', wrongSha), /integrity verification failed/);
});

test('read rejects backend mismatch and out-of-zone keys without contacting S3', async () => {
  const { mock, storage } = setup();
  await assert.rejects(
    storage.read('some-other-backend', 'active/x.pdf', 'v1', sha256Hex(PDF_BYTES)),
    /backend mismatch/,
  );
  await assert.rejects(
    storage.read(S3_BACKEND_ID, 'not-a-zone/x.pdf', 'v1', sha256Hex(PDF_BYTES)),
    /outside a private storage zone/,
  );
  assert.equal(mock.commandCalls(GetObjectCommand).length, 0);
});

test('readQuarantined rejects non-quarantine keys and malformed digests', async () => {
  const { storage } = setup();
  await assert.rejects(
    storage.readQuarantined(S3_BACKEND_ID, 'active/x.pdf', 'v1', sha256Hex(PDF_BYTES)),
    /Only quarantined documents/,
  );
  await assert.rejects(
    storage.readQuarantined(S3_BACKEND_ID, 'quarantine/x.pdf', 'v1', 'not-a-hash'),
    /64 hexadecimal characters/,
  );
});

test('metadata returns backend-verified identity and rejects mismatches', async () => {
  const { mock, storage } = setup();
  const sha = sha256Hex(PDF_BYTES);
  mock.on(HeadObjectCommand).resolves({ VersionId: 'v1', ChecksumSHA256: sha256Base64(sha), ContentLength: PDF_BYTES.byteLength });

  const meta = await storage.metadata(S3_BACKEND_ID, 'active/x.pdf', 'v1');
  assert.deepEqual(meta, { backendId: S3_BACKEND_ID, key: 'active/x.pdf', objectVersion: 'v1', sizeBytes: PDF_BYTES.byteLength, sha256: sha });

  mock.on(HeadObjectCommand).resolves({ VersionId: 'v-different', ChecksumSHA256: sha256Base64(sha), ContentLength: PDF_BYTES.byteLength });
  await assert.rejects(storage.metadata(S3_BACKEND_ID, 'active/x.pdf', 'v1'), /object version verification failed/);

  mock.on(HeadObjectCommand).resolves({ VersionId: 'v1', ContentLength: PDF_BYTES.byteLength });
  await assert.rejects(storage.metadata(S3_BACKEND_ID, 'active/x.pdf', 'v1'), /no ChecksumSHA256/);

  mock.on(HeadObjectCommand).resolves({ VersionId: 'v1', ChecksumSHA256: sha256Base64(sha) });
  await assert.rejects(storage.metadata(S3_BACKEND_ID, 'active/x.pdf', 'v1'), /no ContentLength/);
});

test('delete and exists call S3 with the exact expected parameters', async () => {
  const { mock, storage } = setup();
  mock.on(DeleteObjectCommand).resolves({});
  await storage.delete(S3_BACKEND_ID, 'active/x.pdf', 'v1');
  const deleteCalls = mock.commandCalls(DeleteObjectCommand);
  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].args[0].input.Key, 'active/x.pdf');
  assert.equal(deleteCalls[0].args[0].input.VersionId, 'v1');

  mock.on(HeadObjectCommand).resolves({ VersionId: 'v1' });
  assert.equal(await storage.exists('active/x.pdf'), true);

  mock.on(HeadObjectCommand).rejects(Object.assign(new Error('Not Found'), { name: 'NotFound' }));
  assert.equal(await storage.exists('active/missing.pdf'), false);
});

test('exists propagates unexpected errors rather than reporting false (fail closed)', async () => {
  const { mock, storage } = setup();
  mock.on(HeadObjectCommand).rejects(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }));
  await assert.rejects(storage.exists('active/x.pdf'), /Access Denied/);
});

test('promoteQuarantined verifies source, copies, and independently re-verifies the destination', async () => {
  const { mock, storage } = setup();
  const sha = sha256Hex(PDF_BYTES);
  mock.on(GetObjectCommand).resolves({ VersionId: 'q-v1', Body: fakeBody(PDF_BYTES) as never });
  mock.on(HeadObjectCommand, { Key: 'active/payment-requests/PAY-1/documents/doc-1' }).rejects(
    Object.assign(new Error('Not Found'), { name: 'NotFound' }),
  );
  mock.on(CopyObjectCommand).resolves({ VersionId: 'a-v1' });
  mock
    .on(HeadObjectCommand, { Key: 'active/payment-requests/PAY-1/documents/doc-1', VersionId: 'a-v1' })
    .resolves({ VersionId: 'a-v1', ChecksumSHA256: sha256Base64(sha), ContentLength: PDF_BYTES.byteLength });

  const trustedKey = storage.trustedKey('payment-requests/PAY-1/documents/doc-1');
  const result = await storage.promoteQuarantined({
    backendId: S3_BACKEND_ID,
    quarantinedKey: 'quarantine/payment-requests/PAY-1/documents/doc-1',
    quarantinedObjectVersion: 'q-v1',
    trustedKey,
    expectedSha256: sha,
    expectedSizeBytes: PDF_BYTES.byteLength,
  });

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.key, trustedKey);
  assert.equal(result.objectVersion, 'a-v1');
  assert.equal(result.sha256, sha);
  assert.equal(mock.commandCalls(CopyObjectCommand).length, 1);
  const copyInput = mock.commandCalls(CopyObjectCommand)[0].args[0].input;
  assert.match(copyInput.CopySource as string, /versionId=q-v1$/);
});

test('promoteQuarantined is idempotent against an existing matching destination and does not re-copy', async () => {
  const { mock, storage } = setup();
  const sha = sha256Hex(PDF_BYTES);
  mock.on(GetObjectCommand).resolves({ VersionId: 'q-v1', Body: fakeBody(PDF_BYTES) as never });
  mock
    .on(HeadObjectCommand, { Key: 'active/doc' })
    .resolves({ VersionId: 'existing-v1', ChecksumSHA256: sha256Base64(sha), ContentLength: PDF_BYTES.byteLength });

  const result = await storage.promoteQuarantined({
    backendId: S3_BACKEND_ID,
    quarantinedKey: 'quarantine/doc',
    quarantinedObjectVersion: 'q-v1',
    trustedKey: 'active/doc',
    expectedSha256: sha,
    expectedSizeBytes: PDF_BYTES.byteLength,
  });

  assert.equal(result.objectVersion, 'existing-v1');
  assert.equal(mock.commandCalls(CopyObjectCommand).length, 0);
});

test('promoteQuarantined rejects a conflicting existing destination without copying', async () => {
  const { mock, storage } = setup();
  const sha = sha256Hex(PDF_BYTES);
  mock.on(GetObjectCommand).resolves({ VersionId: 'q-v1', Body: fakeBody(PDF_BYTES) as never });
  mock
    .on(HeadObjectCommand, { Key: 'active/doc' })
    .resolves({ VersionId: 'existing-v1', ChecksumSHA256: sha256Base64(sha256Hex(new TextEncoder().encode('other'))), ContentLength: 5 });

  await assert.rejects(
    storage.promoteQuarantined({
      backendId: S3_BACKEND_ID,
      quarantinedKey: 'quarantine/doc',
      quarantinedObjectVersion: 'q-v1',
      trustedKey: 'active/doc',
      expectedSha256: sha,
      expectedSizeBytes: PDF_BYTES.byteLength,
    }),
    /Existing promoted document identity mismatch/,
  );
  assert.equal(mock.commandCalls(CopyObjectCommand).length, 0);
});

test('promoteQuarantined rejects a source-size mismatch before touching the destination', async () => {
  const { mock, storage } = setup();
  mock.on(GetObjectCommand).resolves({ VersionId: 'q-v1', Body: fakeBody(PDF_BYTES) as never });

  await assert.rejects(
    storage.promoteQuarantined({
      backendId: S3_BACKEND_ID,
      quarantinedKey: 'quarantine/doc',
      quarantinedObjectVersion: 'q-v1',
      trustedKey: 'active/doc',
      expectedSha256: sha256Hex(PDF_BYTES),
      expectedSizeBytes: PDF_BYTES.byteLength + 1,
    }),
    /size verification failed/,
  );
  assert.equal(mock.commandCalls(HeadObjectCommand).length, 0);
  assert.equal(mock.commandCalls(CopyObjectCommand).length, 0);
});

test('promoteQuarantined never trusts the copy response alone: a mismatched post-copy proof still fails', async () => {
  const { mock, storage } = setup();
  const sha = sha256Hex(PDF_BYTES);
  mock.on(GetObjectCommand).resolves({ VersionId: 'q-v1', Body: fakeBody(PDF_BYTES) as never });
  mock.on(HeadObjectCommand, { Key: 'active/doc' }).rejects(Object.assign(new Error('Not Found'), { name: 'NotFound' }));
  mock.on(CopyObjectCommand).resolves({ VersionId: 'a-v1' });
  // Simulate an inconsistent post-write read: wrong checksum/size for the exact version just written.
  mock
    .on(HeadObjectCommand, { Key: 'active/doc', VersionId: 'a-v1' })
    .resolves({ VersionId: 'a-v1', ChecksumSHA256: sha256Base64(sha256Hex(new TextEncoder().encode('mismatch'))), ContentLength: 999 });

  await assert.rejects(
    storage.promoteQuarantined({
      backendId: S3_BACKEND_ID,
      quarantinedKey: 'quarantine/doc',
      quarantinedObjectVersion: 'q-v1',
      trustedKey: 'active/doc',
      expectedSha256: sha,
      expectedSizeBytes: PDF_BYTES.byteLength,
    }),
    /Promoted document identity mismatch/,
  );
});

test('promoteQuarantined honors an already-aborted signal before any I/O', async () => {
  const { mock, storage } = setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    storage.promoteQuarantined({
      backendId: S3_BACKEND_ID,
      quarantinedKey: 'quarantine/doc',
      quarantinedObjectVersion: 'q-v1',
      trustedKey: 'active/doc',
      expectedSha256: sha256Hex(PDF_BYTES),
      expectedSizeBytes: PDF_BYTES.byteLength,
      signal: controller.signal,
    }),
    /aborted/,
  );
  assert.equal(mock.commandCalls(GetObjectCommand).length, 0);
});

test('listPage enumerates a page, fetches version identity per key, and reports truncation correctly', async () => {
  const { mock, storage } = setup();
  mock.on(ListObjectsV2Command).resolves({
    Contents: [{ Key: 'active/a.pdf' }, { Key: 'active/b.pdf' }],
    IsTruncated: true,
  });
  mock.on(HeadObjectCommand, { Key: 'active/a.pdf' }).resolves({ VersionId: 'v-a' });
  mock.on(HeadObjectCommand, { Key: 'active/b.pdf' }).resolves({ VersionId: 'v-b' });

  const page = await storage.listPage(null, 2);
  assert.deepEqual(page.keys, ['active/a.pdf', 'active/b.pdf']);
  assert.deepEqual(page.objects, [
    { backendId: S3_BACKEND_ID, key: 'active/a.pdf', objectVersion: 'v-a' },
    { backendId: S3_BACKEND_ID, key: 'active/b.pdf', objectVersion: 'v-b' },
  ]);
  assert.equal(page.complete, false);
  assert.equal(page.nextCursor, 'active/b.pdf');
  assert.equal(mock.commandCalls(ListObjectsV2Command)[0].args[0].input.StartAfter, undefined);
});

test('listPage reports completion on the final untruncated page', async () => {
  const { mock, storage } = setup();
  mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'active/z.pdf' }], IsTruncated: false });
  mock.on(HeadObjectCommand).resolves({ VersionId: 'v-z' });

  const page = await storage.listPage('active/b.pdf', 10);
  assert.equal(page.complete, true);
  assert.equal(page.nextCursor, null);
  assert.equal(mock.commandCalls(ListObjectsV2Command)[0].args[0].input.StartAfter, 'active/b.pdf');
});

test('listPage rejects out-of-range page sizes and oversized cursors without contacting S3', async () => {
  const { mock, storage } = setup();
  await assert.rejects(storage.listPage(null, 0));
  await assert.rejects(storage.listPage(null, 501));
  await assert.rejects(storage.listPage('x'.repeat(2000), 10));
  assert.equal(mock.commandCalls(ListObjectsV2Command).length, 0);
});

test('listPage fails closed if S3 returns no VersionId while enumerating (bucket not versioned)', async () => {
  const { mock, storage } = setup();
  mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'active/a.pdf' }], IsTruncated: false });
  mock.on(HeadObjectCommand).resolves({});
  await assert.rejects(storage.listPage(null, 10), /bucket versioning enabled/);
});

test('network/service failures propagate rather than being silently swallowed', async () => {
  const { mock, storage } = setup();
  mock.on(PutObjectCommand).rejects(new Error('simulated network timeout'));
  await assert.rejects(
    storage.storeQuarantined({ key: 'x.pdf', declaredContentType: 'application/pdf', data: byteStream(PDF_BYTES) }),
    /simulated network timeout/,
  );

  mock.on(GetObjectCommand).rejects(Object.assign(new Error('checksum mismatch'), { name: 'InvalidRequest' }));
  await assert.rejects(
    storage.read(S3_BACKEND_ID, 'active/x.pdf', 'v1', sha256Hex(PDF_BYTES)),
    /checksum mismatch/,
  );
});

test('trustedKey canonicalizes into the active zone and rejects unsafe destinations', () => {
  const { storage } = setup();
  assert.equal(storage.trustedKey('payment-requests/PAY-1/documents/d1'), 'active/payment-requests/PAY-1/documents/d1');
  assert.throws(() => storage.trustedKey('../escape'), /invalid path segment/);
});
