import "reflect-metadata";
import path from "node:path";
import {Pool} from "pg";
import {ApprovalOutboxService} from "./application/approval/approval-outbox.service.js";
import {TelegramApprovalChannel} from "./application/approval/telegram-approval.channel.js";
import {Postgres} from "./infrastructure/database/postgres.js";
import {createDocumentScanner,createDocumentStorage} from "./infrastructure/configuration/provider-boundary.js";
import {loadDatabasePoolConfig} from "./infrastructure/configuration/runtime-foundation.js";
import {DocumentScanWorker} from "./worker/document-scan-worker.js";
import {loadWorkerConfig} from "./worker/worker-config.js";
import {WorkerLoop,type PollWorkload} from "./worker/worker-loop.js";
import {WorkerHealthServer} from "./worker/worker-health-server.js";
import {metrics,operationalLog} from "./infrastructure/observability/telemetry.js";
import {EXPECTED_SCHEMA_VERSION} from "./infrastructure/configuration/schema-contract.js";

async function main(){
  process.env.AIMS_PROCESS_TYPE="worker";
  const config=loadWorkerConfig(),workloads:PollWorkload[]=[];let outboxDb:Postgres|undefined,documents:DocumentScanWorker|undefined,telegram:TelegramApprovalChannel|undefined;
  if(config.telegramEnabled){outboxDb=new Postgres();telegram=new TelegramApprovalChannel(process.env.TELEGRAM_BOT_TOKEN!,{requestTimeoutMs:config.telegramRequestTimeoutMs,responseMaxBytes:config.telegramResponseMaxBytes,retryMaxDelaySeconds:config.telegramRetryMaxDelaySeconds});const outbox=new ApprovalOutboxService(outboxDb,telegram);workloads.push({name:"telegram_outbox",poll:()=>outbox.dispatch(config.batchSize)})}
  if(config.scannerEnabled){
    const root=process.cwd().endsWith(`${path.sep}apps${path.sep}api`)?path.resolve(process.cwd(),"../.."):process.cwd();
    const pool=new Pool({connectionString:config.documentDatabaseUrl,max:loadDatabasePoolConfig().worker,connectionTimeoutMillis:5000,statement_timeout:10000,lock_timeout:5000,idle_in_transaction_session_timeout:15000});
    documents=new DocumentScanWorker(pool,createDocumentStorage(process.env,root),createDocumentScanner(process.env),config);
    // This migration-057 function is also the least-privilege readiness probe. The
    // worker role intentionally has no raw access to the schema-version table.
    await documents.health();workloads.push({name:"document_scan",poll:()=>documents!.pollBatch()});
  }
  const readiness=async()=>{
    const checks:Record<string,{status:"ready"|"not_ready"|"disabled";detail?:string}>={};
    if(config.scannerEnabled){
      try{await documents!.health();checks.document_scan={status:"ready"}}
      catch{checks.document_scan={status:"not_ready",detail:"document worker database capability unavailable"}}
    }else checks.document_scan={status:"disabled"};
    if(config.telegramEnabled){
      try{const result=await outboxDb!.pool.query<{version:number}>("SELECT version FROM aims_schema_version WHERE singleton=true");checks.telegram_delivery=Number(result.rows[0]?.version)===EXPECTED_SCHEMA_VERSION?{status:"ready"}:{status:"not_ready",detail:"schema mismatch"}}
      catch{checks.telegram_delivery={status:"not_ready",detail:"application database unavailable"}}
    }else checks.telegram_delivery={status:"disabled"};
    const status=Object.values(checks).some(value=>value.status==="not_ready")?"not_ready" as const:"ready" as const;return{status,checks};
  };
  const health=new WorkerHealthServer(config.healthPort??3002,readiness);await health.start();
  const loop=new WorkerLoop(workloads,config.pollIntervalMs);let shutdownTimer:ReturnType<typeof setTimeout>|undefined,shutdownRequested=false;
  const shutdown=()=>{shutdownRequested=true;metrics.gauge("aims_worker_up",{},0);loop.stop();documents?.stop();telegram?.close();shutdownTimer??=setTimeout(()=>{operationalLog("error","worker_shutdown_deadline_exceeded",{operation:"WORKER_SHUTDOWN",status:"FAILURE"});process.exit(1)},config.shutdownGraceMs)};
  process.once("SIGTERM",shutdown);process.once("SIGINT",shutdown);
  metrics.gauge("aims_worker_up",{},1);operationalLog("info","worker_started",{operation:"WORKER_LIFECYCLE",status:"STARTED"});
  await loop.run();await health.close();await documents?.close();await outboxDb?.onModuleDestroy();if(shutdownTimer)clearTimeout(shutdownTimer);
  operationalLog("info","worker_stopped",{operation:"WORKER_LIFECYCLE",status:"STOPPED"});
  if(shutdownRequested)process.exit(0);
}
void main().catch(error=>{metrics.gauge("aims_worker_up",{},0);operationalLog("error","worker_start_failed",{operation:"WORKER_START",status:"FAILURE",safe_error_code:error instanceof Error?error.name:"UNKNOWN"});process.exitCode=1});
