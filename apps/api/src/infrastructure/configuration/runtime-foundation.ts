import { BlockList, isIP } from "node:net";
import { classifyAimsEnvironment } from "./aims-environment.js";
import { EXPECTED_SCHEMA_VERSION } from "./schema-contract.js";

const RELEASE_PATTERN = /^[A-Za-z0-9._:+/-]{1,128}$/;
const LOCAL_DATABASE_ADDRESSES=new BlockList();
LOCAL_DATABASE_ADDRESSES.addSubnet("127.0.0.0",8,"ipv4");
LOCAL_DATABASE_ADDRESSES.addAddress("0.0.0.0","ipv4");
LOCAL_DATABASE_ADDRESSES.addAddress("::1","ipv6");
LOCAL_DATABASE_ADDRESSES.addAddress("::","ipv6");

export interface RuntimeFoundationConfig {
  shutdownGraceMs: number;
  trustedProxyAddresses: ReadonlySet<string>;
  cookie: { secure: boolean; httpOnly: true; sameSite: "lax" | "strict" | "none"; path: "/" };
  release: { version: string; revision: string; schemaVersion: number };
}

export function loadRuntimeFoundationConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeFoundationConfig {
  const classification = classifyAimsEnvironment(environment);
  const trustedProxyAddresses = new Set(
    (environment.AIMS_TRUSTED_PROXY_ADDRESSES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const address of trustedProxyAddresses) {
    if (!isIP(address)) throw new Error("AIMS_TRUSTED_PROXY_ADDRESSES_INVALID");
  }
  const secure = environment.AIMS_SESSION_COOKIE_SECURE === "true" ||
    (!environment.AIMS_SESSION_COOKIE_SECURE && environment.LOCAL_COOKIE_SECURE === "true");
  if (classification.protected && !secure) throw new Error("PROTECTED_ENVIRONMENT_SECURE_COOKIE_REQUIRED");
  const sameSite = (environment.AIMS_SESSION_COOKIE_SAME_SITE ?? "lax").toLowerCase();
  if (!(["lax", "strict", "none"] as const).includes(sameSite as "lax" | "strict" | "none")) {
    throw new Error("AIMS_SESSION_COOKIE_SAME_SITE_INVALID");
  }
  if (sameSite === "none" && !secure) throw new Error("SAMESITE_NONE_REQUIRES_SECURE_COOKIE");
  const version = boundedRelease(environment.AIMS_RELEASE_VERSION, classification.protected ? undefined : "0.1.0-development", "AIMS_RELEASE_VERSION");
  const revision = boundedRelease(environment.AIMS_RELEASE_REVISION, classification.protected ? undefined : "unknown", "AIMS_RELEASE_REVISION");
  return {
    shutdownGraceMs: integer(environment.API_SHUTDOWN_GRACE_MS, 15_000, 100, 60_000, "API_SHUTDOWN_GRACE_MS"),
    trustedProxyAddresses,
    cookie: { secure, httpOnly: true, sameSite: sameSite as "lax" | "strict" | "none", path: "/" },
    release: { version, revision, schemaVersion: EXPECTED_SCHEMA_VERSION },
  };
}

export function loadDatabasePoolConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return {
    application: integer(environment.AIMS_DB_POOL_MAX, 10, 1, 100, "AIMS_DB_POOL_MAX"),
    finance: integer(environment.AIMS_FINANCE_DB_POOL_MAX, 5, 1, 100, "AIMS_FINANCE_DB_POOL_MAX"),
    payment: integer(environment.AIMS_PAYMENT_DB_POOL_MAX, 5, 1, 100, "AIMS_PAYMENT_DB_POOL_MAX"),
    worker: integer(environment.AIMS_WORKER_DB_POOL_MAX, 2, 1, 100, "AIMS_WORKER_DB_POOL_MAX"),
  };
}

export function assertProtectedDatabaseTransport(
  name:string,
  value:string|undefined,
  environment:Readonly<Record<string,string|undefined>>=process.env,
):void {
  if(!classifyAimsEnvironment(environment).protected)return;
  if(!value)throw new Error(`${name}_REQUIRED`);
  let parsed:URL;try{parsed=new URL(value)}catch{throw new Error(`${name}_INVALID`)}
  if(!["postgres:","postgresql:"].includes(parsed.protocol)||!parsed.username||!parsed.password)
    throw new Error(`${name}_INVALID`);
  if(isLocalDatabaseHost(parsed.hostname))throw new Error(`${name}_LOCAL_HOST_FORBIDDEN`);
  if(parsed.searchParams.get("sslmode")!=="verify-full")throw new Error(`${name}_VERIFY_FULL_REQUIRED`);
}

export function isLocalDatabaseHost(hostname:string):boolean {
  const normalized=hostname.toLowerCase().replace(/^\[|\]$/g,"");
  if(normalized==="localhost"||normalized.endsWith(".localhost"))return true;
  const family=isIP(normalized);
  return family===4?LOCAL_DATABASE_ADDRESSES.check(normalized,"ipv4"):family===6?LOCAL_DATABASE_ADDRESSES.check(normalized,"ipv6"):false;
}

function boundedRelease(value: string | undefined, fallback: string | undefined, name: string): string {
  const result = value?.trim() || fallback;
  if (!result || !RELEASE_PATTERN.test(result)) throw new Error(`${name}_INVALID`);
  return result;
}

function integer(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  const result = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${name}_INVALID`);
  return result;
}
