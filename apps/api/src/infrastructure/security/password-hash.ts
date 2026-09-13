import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export type PasswordHash = { hash: Buffer; salt: Buffer; params: typeof SCRYPT_PARAMS };

export async function hashPassword(plain: string): Promise<PasswordHash> {
  const salt = randomBytes(16);
  const hash = await scrypt(plain.normalize("NFKC"), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return { hash, salt, params: SCRYPT_PARAMS };
}

export async function verifyPassword(
  plain: string,
  storedHash: Buffer,
  storedSalt: Buffer,
  params: { N: number; r: number; p: number },
): Promise<boolean> {
  const candidate = await scrypt(plain.normalize("NFKC"), storedSalt, storedHash.length, {
    N: params.N,
    r: params.r,
    p: params.p,
  });
  return candidate.length === storedHash.length && timingSafeEqual(candidate, storedHash);
}
