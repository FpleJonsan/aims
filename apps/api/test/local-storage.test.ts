import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadLocalStorageConfig,
  LocalDocumentStorage,
  selectBoundedPageCandidates,
} from '../src/infrastructure/storage/local-document-storage.js';
import {
  DocumentQuarantineService,
  type DocumentMalwareScanner,
} from '../src/application/documents/document-quarantine-service.js';
import { assertAllowedDocumentExtension } from '../src/application/documents/payment-document.service.js';
import { DeterministicLocalMalwareScanner } from '../src/infrastructure/security/deterministic-local-malware-scanner.js';
import { boundedStorageOperation } from '../src/infrastructure/recovery/restore-checker.js';

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

test('enumerates local objects through bounded ordered continuation pages',async()=>{
  const rootPath=await mkdtemp(path.join(os.tmpdir(),'aims-storage-'));
  try{
    const storage=createStorage(rootPath);
    for(const key of ['c.pdf','a.pdf','b.pdf'])await storage.storeQuarantined({key:`safe/${key}`,declaredContentType:'application/pdf',data:byteStream(PDF_BYTES)});
    const first=await storage.listPage(null,2),second=await storage.listPage(first.nextCursor,2);
    assert.equal(first.keys.length,2);assert.equal(first.complete,false);assert.ok(first.nextCursor);
    assert.equal(second.keys.length,1);assert.equal(second.complete,true);assert.equal(second.nextCursor,null);
    assert.deepEqual([...first.keys,...second.keys],[...first.keys,...second.keys].sort());
    await assert.rejects(storage.listPage(null,501));
    const controller=new AbortController();controller.abort();await assert.rejects(storage.listPage(null,2,controller.signal));
  }finally{await rm(rootPath,{recursive:true,force:true})}
});

test('pagination is globally ordered and lossless across directory-file prefix collisions',async()=>{
  const rootPath=await mkdtemp(path.join(os.tmpdir(),'aims-storage-'));
  try{
    const storage=createStorage(rootPath),created=['b.pdf','a/zzz.pdf','foo.txt','a.pdf','foo/bar.pdf','a/001.pdf','x/y.pdf','x.pdf'];
    for(const key of created)await storage.storeQuarantined({key,declaredContentType:'application/pdf',data:byteStream(PDF_BYTES)});
    const expected=created.map(key=>`quarantine/${key}`).sort();
    const enumerate=async(pageSize:number,start:string|null=null)=>{const keys:string[]=[];let cursor=start;for(let page=0;page<100;page+=1){const result=await storage.listPage(cursor,pageSize);assert.ok(result.keys.length<=pageSize);assert.deepEqual(result.keys,[...result.keys].sort());assert.ok(result.keys.every(key=>cursor===null||key>cursor));keys.push(...result.keys);if(result.complete){assert.equal(result.nextCursor,null);return keys}assert.equal(result.nextCursor,result.keys.at(-1));cursor=result.nextCursor}throw new Error('pagination did not terminate')};
    assert.deepEqual(await enumerate(1),expected);
    assert.deepEqual(await enumerate(3),expected);
    assert.deepEqual(await enumerate(1),expected);
    const first=await storage.listPage(null,3);assert.ok(first.nextCursor);assert.deepEqual([...first.keys,...await enumerate(2,first.nextCursor)],expected);
    assert.equal(new Set(await enumerate(1)).size,expected.length);
  }finally{await rm(rootPath,{recursive:true,force:true})}
});

test('bounded candidate selection incrementally scans large scrambled input',async()=>{
  const total=10_000,pageSize=7;
  async function* keys(){for(let index=total-1;index>=0;index-=1)yield `active/object-${String(index).padStart(5,'0')}.pdf`}
  const result=await selectBoundedPageCandidates(keys(),null,pageSize);
  assert.equal(result.scanned,total);
  assert.equal(result.maxRetained,pageSize+1);
  assert.equal(result.candidates.length,pageSize+1);
  assert.deepEqual(result.candidates,Array.from({length:pageSize+1},(_,index)=>`active/object-${String(index).padStart(5,'0')}.pdf`));
});

test('bounded incremental selection observes cancellation and closes its iterator',async()=>{
  const controller=new AbortController();let consumed=0,closed=false;
  async function* keys(){try{for(let index=0;index<10_000;index+=1){consumed+=1;if(consumed===25)controller.abort();yield `active/${index}.pdf`}}finally{closed=true}}
  await assert.rejects(selectBoundedPageCandidates(keys(),null,3,controller.signal),/aborted/);
  assert.equal(consumed,25);assert.equal(closed,true);
});

test('deadline-style abort and iterator errors stop incremental enumeration with cleanup',async()=>{
  const controller=new AbortController();let deadlineConsumed=0,deadlineClosed=false;
  async function* slowKeys(){try{for(let index=0;index<1_000;index+=1){deadlineConsumed+=1;await new Promise(resolve=>setTimeout(resolve,1));yield `active/${index}.pdf`}}finally{deadlineClosed=true}}
  const timer=setTimeout(()=>controller.abort(),10);
  try{await assert.rejects(selectBoundedPageCandidates(slowKeys(),null,2,controller.signal),/aborted/)}finally{clearTimeout(timer)}
  assert.ok(deadlineConsumed<100);assert.equal(deadlineClosed,true);
  let errorClosed=false;async function* failingKeys(){try{yield 'active/b.pdf';throw new Error('bounded failure')}finally{errorClosed=true}}
  await assert.rejects(selectBoundedPageCandidates(failingKeys(),null,1),/bounded failure/);assert.equal(errorClosed,true);
});

test('checker-owned storage timeout aborts flat traversal, awaits cleanup, and stops background work',async()=>{
  const parent=new AbortController();let consumed=0,opened=0,closed=0,operationSettled=false,operationSignal:AbortSignal|undefined;
  async function* keys(signal:AbortSignal){opened+=1;try{for(let index=0;index<10_000;index+=1){await new Promise(resolve=>setTimeout(resolve,2));if(signal.aborted)throw new Error('Storage enumeration aborted');consumed+=1;yield `active/${String(index).padStart(5,'0')}.pdf`}}finally{closed+=1}}
  await assert.rejects(boundedStorageOperation(async signal=>{operationSignal=signal;try{return await selectBoundedPageCandidates(keys(signal),null,3,signal)}finally{operationSettled=true}},20,parent.signal),/STORAGE_OPERATION_TIMEOUT/);
  assert.equal(operationSignal?.aborted,true);assert.equal(operationSettled,true);assert.equal(opened,closed);assert.ok(consumed<100);
  const stoppedAt=consumed;await new Promise(resolve=>setTimeout(resolve,15));assert.equal(consumed,stoppedAt);
});

test('checker-owned storage timeout unwinds every nested traversal handle',async()=>{
  const parent=new AbortController();let consumed=0,opened=0,closed=0;
  async function* nested(depth:number,signal:AbortSignal):AsyncGenerator<string>{opened+=1;try{if(depth<3)yield* nested(depth+1,signal);for(let index=0;index<10_000;index+=1){await new Promise(resolve=>setTimeout(resolve,2));if(signal.aborted)throw new Error('Storage enumeration aborted');consumed+=1;yield `active/${depth}/${index}.pdf`}}finally{closed+=1}}
  await assert.rejects(boundedStorageOperation(signal=>selectBoundedPageCandidates(nested(0,signal),null,2,signal),20,parent.signal),/STORAGE_OPERATION_TIMEOUT/);
  assert.equal(opened,4);assert.equal(closed,opened);const stoppedAt=consumed;await new Promise(resolve=>setTimeout(resolve,15));assert.equal(consumed,stoppedAt);
});

test('storage operation completion and parent-abort races clear timers and preserve classification',async()=>{
  const parent=new AbortController();let staleAbort=false;
  const value=await boundedStorageOperation(async signal=>{signal.addEventListener('abort',()=>{staleAbort=true},{once:true});return 'complete'},20,parent.signal);
  assert.equal(value,'complete');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(staleAbort,false);
  const cancelled=new AbortController();let cleaned=false,receivedAbort=false;
  const pending=boundedStorageOperation(async signal=>{try{await new Promise<void>((_,reject)=>{const abort=()=>{receivedAbort=true;reject(new Error('cancelled'))};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true})})}finally{cleaned=true}},1_000,cancelled.signal);
  cancelled.abort();await assert.rejects(pending,/VERIFICATION_DEADLINE_EXCEEDED/);assert.equal(receivedAbort,true);assert.equal(cleaned,true);
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
