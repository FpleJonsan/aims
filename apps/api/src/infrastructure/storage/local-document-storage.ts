import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, opendir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertUnprotectedAdapter } from '../configuration/aims-environment.js';

import type {
  DocumentStorage,
  PromoteDocumentInput,
  StoredDocument,
  StoreDocumentInput,
} from './document-storage.js';

export interface LocalStorageConfig {
  rootPath: string;
  maxUploadBytes: number;
  allowedContentTypes: ReadonlySet<string>;
  demoMode: true;
}

const SIGNATURES: ReadonlyArray<{
  contentType: string;
  bytes: readonly number[];
}> = [
  { contentType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { contentType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { contentType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

const INSPECTION_PREFIX_BYTES = 16;
const INSPECTION_TAIL_BYTES = 2048;

export function loadLocalStorageConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  applicationRoot = process.cwd(),
): LocalStorageConfig {
  if (environment.STORAGE_DRIVER !== 'local') {
    throw new Error('Local storage requires STORAGE_DRIVER=local');
  }
  assertUnprotectedAdapter('STORAGE_PROVIDER', environment);
  if (environment.LOCAL_STORAGE_DEMO_MODE !== 'true') {
    throw new Error('Local storage requires explicit LOCAL_STORAGE_DEMO_MODE=true risk acceptance');
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
    demoMode: true,
  };
}

export class LocalDocumentStorage implements DocumentStorage {
  readonly #rootPath: string;
  readonly #maxUploadBytes: number;
  readonly #allowedContentTypes: ReadonlySet<string>;

  constructor(config: LocalStorageConfig, environment:Readonly<Record<string,string|undefined>>=process.env) {
    assertUnprotectedAdapter('STORAGE_PROVIDER', environment);
    if (config.demoMode !== true) {
      throw new Error('Local document storage requires explicit development demo mode');
    }
    this.#rootPath = path.resolve(config.rootPath);
    this.#maxUploadBytes = config.maxUploadBytes;
    this.#allowedContentTypes = new Set(config.allowedContentTypes);
  }

  trustedKey(destination:string):string{return this.#normalizeTrustedKey(`active/${destination}`)}

  async storeQuarantined(input: StoreDocumentInput): Promise<StoredDocument> {
    const declaredContentType = input.declaredContentType.trim().toLowerCase();
    if (!this.#allowedContentTypes.has(declaredContentType)) {
      throw new Error(`Unsupported document content type: ${declaredContentType}`);
    }
    const quarantinedKey = `quarantine/${input.key}`;
    const targetPath = this.#resolveKey(quarantinedKey);
    await this.#prepareTargetDirectory(targetPath);

    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    const handle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    const digest = createHash('sha256');
    let prefix: Uint8Array<ArrayBufferLike> = new Uint8Array();
    let tail: Uint8Array<ArrayBufferLike> = new Uint8Array();
    let sizeBytes = 0;
    try {
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
        await writeAll(handle, chunk);
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

      await handle.sync();
      await handle.close();
      await link(temporaryPath, targetPath);
      await this.#assertCanonicalInsideRoot(targetPath);

      return {
        provider: 'LOCAL',
        backendId: 'local-development',
        key: quarantinedKey,
        objectVersion: `sha256:${digest.copy().digest('hex')}`,
        sizeBytes,
        sha256: digest.digest('hex'),
        contentType: detectedContentType,
        status: 'QUARANTINED',
      };
    } finally {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
    }
  }

  async readQuarantined(backendId:string,key: string, objectVersion:string, expectedSha256: string,signal?:AbortSignal): Promise<Uint8Array> {
    this.#assertBackend(backendId);
    if (!key.startsWith('quarantine/')) {
      throw new Error('Only quarantined documents can be read by this adapter');
    }
    if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
      throw new Error('Expected SHA-256 must contain exactly 64 hexadecimal characters');
    }
    return this.read(backendId,key,objectVersion,expectedSha256,signal);
  }

  async read(backendId:string,key:string,objectVersion:string,expectedSha256:string,signal?:AbortSignal):Promise<Uint8Array>{
    this.#assertBackend(backendId);
    const digest=expectedSha256;
    if(!key.startsWith('quarantine/')&&!key.startsWith('active/'))throw new Error('Document key is outside a private storage zone');
    if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error('Expected SHA-256 must contain exactly 64 hexadecimal characters');
    const targetPath=this.#resolveKey(key);await this.#assertNoSymlinkComponents(targetPath);
    const data=await readFile(targetPath,{signal}),actual=createHash('sha256').update(data).digest('hex');
    if(actual!==digest.toLowerCase())throw new Error('Document integrity verification failed');
    if(objectVersion!==`sha256:${actual}`)throw new Error('Document object version verification failed');
    return data;
  }

  async delete(backendId:string,key:string,objectVersion:string):Promise<void>{await this.metadata(backendId,key,objectVersion);const target=this.#resolveKey(key);await this.#assertNoSymlinkComponents(target);await rm(target,{force:true});}
  async exists(key:string):Promise<boolean>{try{const target=this.#resolveKey(key);await this.#assertNoSymlinkComponents(target);await lstat(target);return true;}catch(error){if(isMissingPathError(error))return false;throw error;}}
  async metadata(backendId:string,key:string,objectVersion:string,signal?:AbortSignal):Promise<{backendId:string;key:string;objectVersion:string;sizeBytes:number;sha256:string}>{
    this.#assertBackend(backendId);
    if(signal?.aborted)throw new Error('Document metadata read aborted');
    const target=this.#resolveKey(key);await this.#assertNoSymlinkComponents(target);const data=await readFile(target,{signal});
    const sha256=createHash('sha256').update(data).digest('hex');
    const actualVersion=`sha256:${sha256}`;if(objectVersion!==actualVersion)throw new Error('Document object version verification failed');
    return{backendId:'local-development',key,objectVersion:actualVersion,sizeBytes:data.byteLength,sha256};
  }
  async listPage(cursor:string|null,pageSize:number,signal?:AbortSignal):Promise<{keys:string[];objects:Array<{backendId:string;key:string;objectVersion:string}>;nextCursor:string|null;complete:boolean}>{
    if(!Number.isInteger(pageSize)||pageSize<1||pageSize>500)throw new Error('Storage enumeration page size must be between 1 and 500');
    if(cursor!==null&&(cursor.length>1024||cursor.includes('\\')||path.posix.isAbsolute(cursor)))throw new Error('Storage enumeration cursor is invalid');
    if(signal?.aborted)throw new Error('Storage enumeration aborted');
    const {candidates}=await selectBoundedPageCandidates(this.#walkStorageKeys(signal),cursor,pageSize,signal);
    const hasMore=candidates.length>pageSize,keys=candidates.slice(0,pageSize);
    const objects=[];for(const key of keys){const target=this.#resolveKey(key);const data=await readFile(target,{signal});const sha=createHash('sha256').update(data).digest('hex');objects.push({backendId:'local-development',key,objectVersion:`sha256:${sha}`});}
    return{keys,objects,nextCursor:hasMore?keys.at(-1)??null:null,complete:!hasMore};
  }

  async *#walkStorageKeys(signal?:AbortSignal):AsyncGenerator<string>{
    for(const zone of ['active','quarantine']){
      if(signal?.aborted)throw new Error('Storage enumeration aborted');
      const base=this.#resolveKey(`${zone}/placeholder`),root=path.dirname(base);
      try{yield* walkIncremental(root,zone,signal)}catch(error){if(!isMissingPathError(error))throw error;}
    }
  }

  async promoteQuarantined(input: PromoteDocumentInput): Promise<StoredDocument> {
    this.#assertBackend(input.backendId);
    if(input.signal?.aborted)throw new Error('Document promotion aborted');
    const data = await this.readQuarantined(input.backendId,input.quarantinedKey,input.quarantinedObjectVersion,input.expectedSha256,input.signal);
    if(data.byteLength!==input.expectedSizeBytes)throw new Error('Document promotion size verification failed');
    const sourcePath = this.#resolveKey(input.quarantinedKey);
    const activeKey = this.#normalizeTrustedKey(input.trustedKey);
    const targetPath = this.#resolveKey(activeKey);
    await this.#prepareTargetDirectory(targetPath);
    try{await link(sourcePath, targetPath)}catch(error){if(!isExistingPathError(error))throw error;const existing=await this.metadata(input.backendId,activeKey,`sha256:${input.expectedSha256.toLowerCase()}`,input.signal);if(existing.sha256!==input.expectedSha256.toLowerCase()||existing.sizeBytes!==input.expectedSizeBytes)throw new Error('Existing promoted document identity mismatch')}
    if(input.signal?.aborted)throw new Error('Document promotion aborted');
    await this.#assertCanonicalInsideRoot(targetPath);

    const contentType = detectContentType(data);
    if (!contentType || !hasValidContainerEnding(contentType, appendTail(new Uint8Array(), data, INSPECTION_TAIL_BYTES))) {
      throw new Error('Quarantined document failed structural verification during promotion');
    }
    return {
      provider: 'LOCAL',
      backendId: 'local-development',
      key: activeKey,
      objectVersion: `sha256:${input.expectedSha256.toLowerCase()}`,
      sizeBytes: data.byteLength,
      sha256: input.expectedSha256.toLowerCase(),
      contentType,
      status: 'ACTIVE',
    };
  }

  #assertBackend(backendId:string){if(backendId!=='local-development')throw new Error('Document storage backend mismatch')}

  #normalizeTrustedKey(key:string){const normalized=path.posix.normalize(key);if(normalized!==key||!key.startsWith('active/'))throw new Error('Trusted document key must be canonical in the private active zone');this.#resolveKey(key);return key}

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

  async #prepareTargetDirectory(targetPath: string): Promise<void> {
    await mkdir(this.#rootPath, { recursive: true, mode: 0o700 });
    await this.#assertNoSymlink(this.#rootPath);
    await this.#assertCanonicalInsideRoot(this.#rootPath, true);
    await this.#assertNoSymlinkComponents(path.dirname(targetPath));
    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    await this.#assertNoSymlinkComponents(path.dirname(targetPath));
    await this.#assertCanonicalInsideRoot(path.dirname(targetPath), true);
  }

  async #assertCanonicalInsideRoot(candidatePath: string, allowRoot = false): Promise<void> {
    const [canonicalRoot, canonicalCandidate] = await Promise.all([
      realpath(this.#rootPath),
      realpath(candidatePath),
    ]);
    const isRoot = canonicalCandidate === canonicalRoot;
    if ((!allowRoot || !isRoot) && !canonicalCandidate.startsWith(`${canonicalRoot}${path.sep}`)) {
      throw new Error('Canonical document path is outside the storage root');
    }
  }
}

function detectContentType(data: Uint8Array): string | undefined {
  return SIGNATURES.find(({ bytes }) =>
    bytes.every((byte, index) => data[index] === byte),
  )?.contentType;
}

function hasValidContainerEnding(contentType: string, tail: Uint8Array): boolean {
  if (contentType === 'application/pdf') {
    return new TextDecoder('latin1').decode(tail).trimEnd().endsWith('%%EOF');
  }
  if (contentType === 'image/jpeg') {
    return tail.length >= 2 && tail.at(-2) === 0xff && tail.at(-1) === 0xd9;
  }
  if (contentType === 'image/png') {
    const ending = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
    return tail.length >= ending.length && ending.every(
      (byte, index) => tail[tail.length - ending.length + index] === byte,
    );
  }
  return false;
}

function appendPrefix(current: Uint8Array, chunk: Uint8Array, limit: number): Uint8Array {
  if (current.length >= limit) return current;
  const remaining = limit - current.length;
  return concatBytes(current, chunk.subarray(0, remaining));
}

function appendTail(current: Uint8Array, chunk: Uint8Array, limit: number): Uint8Array {
  const combined = concatBytes(current, chunk);
  return combined.length <= limit ? combined : combined.subarray(combined.length - limit);
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (bytesWritten === 0) throw new Error('Document write made no progress');
    offset += bytesWritten;
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isExistingPathError(error:unknown):boolean{return typeof error==='object'&&error!==null&&'code' in error&&(error as {code?:string}).code==='EEXIST'}

async function* walkIncremental(directory:string,prefix:string,signal?:AbortSignal):AsyncGenerator<string>{
  if(signal?.aborted)throw new Error('Storage enumeration aborted');
  const handle=await opendir(directory);
  try{
    while(true){
      if(signal?.aborted)throw new Error('Storage enumeration aborted');
      const entry=await handle.read();
      if(entry===null)break;
      if(signal?.aborted)throw new Error('Storage enumeration aborted');
      if(entry.isSymbolicLink())throw new Error('Symbolic links are not permitted in document storage paths');
      const next=path.join(directory,entry.name),key=`${prefix}/${entry.name}`;
      if(entry.isDirectory())yield* walkIncremental(next,key,signal);else if(entry.isFile())yield key;
    }
  }finally{await handle.close().catch(error=>{if(!(error instanceof Error&&'code' in error&&error.code==='ERR_DIR_CLOSED'))throw error})}
}

/** @internal Testable bounded top-N selection used by local enumeration. */
export async function selectBoundedPageCandidates(keys:AsyncIterable<string>,cursor:string|null,pageSize:number,signal?:AbortSignal):Promise<{candidates:string[];scanned:number;maxRetained:number}>{
  const candidates:string[]=[];let scanned=0,maxRetained=0;
  for await(const key of keys){
    if(signal?.aborted)throw new Error('Storage enumeration aborted');
    scanned+=1;
    if(cursor!==null&&key<=cursor)continue;
    insertBoundedKey(candidates,key,pageSize+1);
    maxRetained=Math.max(maxRetained,candidates.length);
  }
  return{candidates,scanned,maxRetained};
}

function insertBoundedKey(keys:string[],key:string,limit:number):void{
  let low=0,high=keys.length;
  while(low<high){const middle=(low+high)>>>1;if(keys[middle]<key)low=middle+1;else high=middle}
  if(keys[low]===key)throw new Error('Duplicate document storage object key');
  keys.splice(low,0,key);
  if(keys.length>limit)keys.pop();
}
