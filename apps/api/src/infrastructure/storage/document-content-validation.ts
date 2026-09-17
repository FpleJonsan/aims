/**
 * Content-type/signature validation shared by every DocumentStorage adapter.
 * Extracted from LocalDocumentStorage so a second (e.g. S3) adapter cannot
 * silently drift from the same security checks — there is exactly one place
 * that decides what "a valid PDF/JPEG/PNG" means for quarantined uploads.
 */

export const SIGNATURES: ReadonlyArray<{
  contentType: string;
  bytes: readonly number[];
}> = [
  { contentType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { contentType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { contentType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

export const INSPECTION_PREFIX_BYTES = 16;
export const INSPECTION_TAIL_BYTES = 2048;

export function detectContentType(data: Uint8Array): string | undefined {
  return SIGNATURES.find(({ bytes }) => bytes.every((byte, index) => data[index] === byte))?.contentType;
}

export function hasValidContainerEnding(contentType: string, tail: Uint8Array): boolean {
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

export function appendPrefix(current: Uint8Array, chunk: Uint8Array, limit: number): Uint8Array {
  if (current.length >= limit) return current;
  const remaining = limit - current.length;
  return concatBytes(current, chunk.subarray(0, remaining));
}

export function appendTail(current: Uint8Array, chunk: Uint8Array, limit: number): Uint8Array {
  const combined = concatBytes(current, chunk);
  return combined.length <= limit ? combined : combined.subarray(combined.length - limit);
}

export function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

/** Shared MAX_UPLOAD_BYTES parsing so every adapter enforces the same bound identically. */
export function parseMaxUploadBytes(environment: Readonly<Record<string, string | undefined>>): number {
  const maxUploadBytes = Number(environment.MAX_UPLOAD_BYTES);
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0) {
    throw new Error('MAX_UPLOAD_BYTES must be a positive integer');
  }
  return maxUploadBytes;
}

/** Shared ALLOWED_UPLOAD_TYPES parsing so every adapter accepts identically-shaped content types. */
export function parseAllowedContentTypes(environment: Readonly<Record<string, string | undefined>>): ReadonlySet<string> {
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
  return allowedContentTypes;
}
