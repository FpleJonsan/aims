import { isPlaceholderSecret } from "../infrastructure/configuration/secret-boundary.js";
import { loadTelegramConfig } from "../infrastructure/configuration/telegram-config.js";

export type WorkerConfig = {
  workerId: string;
  pollIntervalMs: number;
  batchSize: number;
  leaseSeconds: number;
  maximumAttempts: number;
  retryDelaySeconds: number;
  storageTimeoutMs: number;
  scannerTimeoutMs: number;
  shutdownGraceMs: number;
  telegramEnabled: boolean;
  telegramRequestTimeoutMs?: number;
  telegramResponseMaxBytes?: number;
  telegramRetryMaxDelaySeconds?: number;
  outboxLeaseSeconds?: number;
  scannerEnabled: boolean;
  healthPort?:number;
  databaseUrl?: string;
  documentDatabaseUrl?: string;
};

export function loadWorkerConfig(environment:Readonly<Record<string,string|undefined>>=process.env):WorkerConfig{
  const production=environment.NODE_ENV==="production"||environment.AIMS_ENVIRONMENT==="production";
  const telegram=loadTelegramConfig(environment),telegramEnabled=telegram.enabled;
  const scannerEnabled=environment.DOCUMENT_SCAN_WORKER_ENABLED!=="false";
  const databaseUrl=environment.DATABASE_URL?.trim()||undefined;
  const documentDatabaseUrl=environment.DOCUMENT_WORKER_DATABASE_URL?.trim()||undefined;
  if(!telegramEnabled&&!scannerEnabled)throw new Error("At least one worker workload must be enabled");
  if(telegramEnabled){
    validateDatabaseUrl(databaseUrl,"DATABASE_URL",production,environment.AIMS_EXPECTED_DATABASE,"aims_app");
  }
  if(scannerEnabled){
    validateDatabaseUrl(documentDatabaseUrl,"DOCUMENT_WORKER_DATABASE_URL",production,environment.AIMS_EXPECTED_DATABASE,"aims_document_worker_runtime");
    if(production){
      if(environment.STORAGE_DRIVER!=="object")throw new Error("Production document worker requires approved object storage");
      if(environment.MALWARE_SCANNER_DRIVER!=="provider")throw new Error("Production document worker requires an approved malware scanner provider");
      throw new Error("Production document worker scanner provider is not implemented");
    }
    if(environment.STORAGE_DRIVER!=="local"||environment.MALWARE_SCANNER_DRIVER!=="deterministic-local")throw new Error("Local document worker requires explicit local storage and deterministic scanner configuration");
  }
  const leaseSeconds=integer(environment.DOCUMENT_SCAN_LEASE_SECONDS,120,5,3600,"DOCUMENT_SCAN_LEASE_SECONDS");
  const storageTimeoutMs=integer(environment.DOCUMENT_SCAN_STORAGE_TIMEOUT_MS,10000,10,60000,"DOCUMENT_SCAN_STORAGE_TIMEOUT_MS");
  const scannerTimeoutMs=integer(environment.DOCUMENT_SCAN_SCANNER_TIMEOUT_MS,30000,10,60000,"DOCUMENT_SCAN_SCANNER_TIMEOUT_MS");
  const shutdownGraceMs=integer(environment.WORKER_SHUTDOWN_GRACE_MS,15000,100,60000,"WORKER_SHUTDOWN_GRACE_MS");
  if(storageTimeoutMs*2+scannerTimeoutMs>=leaseSeconds*1000)throw new Error("Document scan storage and scanner deadlines must fit within DOCUMENT_SCAN_LEASE_SECONDS");
  return{
    workerId:boundedIdentity(environment.AIMS_WORKER_ID??`aims-worker-${process.pid}`),
    pollIntervalMs:integer(environment.WORKER_POLL_INTERVAL_MS,1000,50,60000,"WORKER_POLL_INTERVAL_MS"),
    batchSize:integer(environment.WORKER_BATCH_SIZE,10,1,100,"WORKER_BATCH_SIZE"),
    leaseSeconds,
    maximumAttempts:integer(environment.DOCUMENT_SCAN_MAX_ATTEMPTS,5,1,20,"DOCUMENT_SCAN_MAX_ATTEMPTS"),
    retryDelaySeconds:integer(environment.DOCUMENT_SCAN_RETRY_DELAY_SECONDS,300,1,86400,"DOCUMENT_SCAN_RETRY_DELAY_SECONDS"),
    storageTimeoutMs,scannerTimeoutMs,shutdownGraceMs,healthPort:integer(environment.WORKER_HEALTH_PORT,3002,1024,65535,"WORKER_HEALTH_PORT"),
    telegramEnabled,telegramRequestTimeoutMs:telegram.requestTimeoutMs,telegramResponseMaxBytes:telegram.responseMaxBytes,telegramRetryMaxDelaySeconds:telegram.retryMaxDelaySeconds,outboxLeaseSeconds:telegram.outboxLeaseSeconds,scannerEnabled,databaseUrl,documentDatabaseUrl,
  };
}

function validateDatabaseUrl(value:string|undefined,name:string,production:boolean,expected:string|undefined,requiredUser:string){
  if(!value)throw new Error(`${name} is required for the enabled worker workload`);
  let parsed:URL;try{parsed=new URL(value)}catch{throw new Error(`${name} must be a valid PostgreSQL URL`)}
  if(!["postgres:","postgresql:"].includes(parsed.protocol)||!parsed.username||!parsed.password)throw new Error(`${name} must include an injected PostgreSQL runtime credential`);
  if(decodeURIComponent(parsed.username)!==requiredUser)throw new Error(`${name} must use ${requiredUser}`);
  if(production){
    if(!expected||["aims","aims_competition","postgres","template0","template1"].includes(expected))throw new Error("Production worker requires an explicit isolated AIMS_EXPECTED_DATABASE");
    if(["localhost","127.0.0.1","::1"].includes(parsed.hostname))throw new Error(`${name} cannot use a local host in Production`);
    if(decodeURIComponent(parsed.pathname.slice(1))!==expected)throw new Error(`${name} does not target AIMS_EXPECTED_DATABASE`);
    if(parsed.searchParams.get("sslmode")!=="verify-full")throw new Error(`${name} requires sslmode=verify-full in Production`);
    if(isPlaceholderSecret(value))throw new Error(`${name} contains a forbidden placeholder`);
  }
}
function integer(value:string|undefined,fallback:number,min:number,max:number,name:string){const result=value===undefined?fallback:Number(value);if(!Number.isInteger(result)||result<min||result>max)throw new Error(`${name} must be an integer between ${min} and ${max}`);return result}
function boundedIdentity(value:string){if(!/^[A-Za-z0-9._:-]{1,128}$/.test(value))throw new Error("AIMS_WORKER_ID is invalid");return value}
