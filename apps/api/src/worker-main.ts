import "reflect-metadata";
import path from "node:path";
import {Pool} from "pg";
import {ApprovalOutboxService} from "./application/approval/approval-outbox.service.js";
import {TelegramApprovalChannel} from "./application/approval/telegram-approval.channel.js";
import {DeterministicLocalMalwareScanner} from "./infrastructure/security/deterministic-local-malware-scanner.js";
import {Postgres} from "./infrastructure/database/postgres.js";
import {LocalDocumentStorage,loadLocalStorageConfig} from "./infrastructure/storage/local-document-storage.js";
import {DocumentScanWorker} from "./worker/document-scan-worker.js";
import {loadWorkerConfig} from "./worker/worker-config.js";
import {WorkerLoop,type PollWorkload} from "./worker/worker-loop.js";

async function main(){
  const config=loadWorkerConfig(),workloads:PollWorkload[]=[];let outboxDb:Postgres|undefined,documents:DocumentScanWorker|undefined,telegram:TelegramApprovalChannel|undefined;
  if(config.telegramEnabled){outboxDb=new Postgres();telegram=new TelegramApprovalChannel(process.env.TELEGRAM_BOT_TOKEN!,{requestTimeoutMs:config.telegramRequestTimeoutMs,responseMaxBytes:config.telegramResponseMaxBytes,retryMaxDelaySeconds:config.telegramRetryMaxDelaySeconds});const outbox=new ApprovalOutboxService(outboxDb,telegram);workloads.push({name:"telegram_outbox",poll:()=>outbox.dispatch(config.batchSize)})}
  if(config.scannerEnabled){
    const root=process.cwd().endsWith(`${path.sep}apps${path.sep}api`)?path.resolve(process.cwd(),"../.."):process.cwd();
    const pool=new Pool({connectionString:config.documentDatabaseUrl,max:2,connectionTimeoutMillis:5000,statement_timeout:10000,lock_timeout:5000,idle_in_transaction_session_timeout:15000});
    documents=new DocumentScanWorker(pool,new LocalDocumentStorage(loadLocalStorageConfig(process.env,root)),new DeterministicLocalMalwareScanner(),config);
    // This migration-057 function is also the least-privilege readiness probe. The
    // worker role intentionally has no raw access to the schema-version table.
    await documents.health();workloads.push({name:"document_scan",poll:()=>documents!.pollBatch()});
  }
  const loop=new WorkerLoop(workloads,config.pollIntervalMs);let shutdownTimer:ReturnType<typeof setTimeout>|undefined,shutdownRequested=false;
  const shutdown=()=>{shutdownRequested=true;loop.stop();documents?.stop();telegram?.close();shutdownTimer??=setTimeout(()=>{process.stderr.write(`${JSON.stringify({timestamp:new Date().toISOString(),component:"aims-worker",event:"worker_shutdown_deadline_exceeded"})}\n`);process.exit(1)},config.shutdownGraceMs)};
  process.once("SIGTERM",shutdown);process.once("SIGINT",shutdown);
  process.stdout.write(`${JSON.stringify({timestamp:new Date().toISOString(),component:"aims-worker",event:"worker_started",workerId:config.workerId,workloads:workloads.map(x=>x.name)})}\n`);
  await loop.run();await documents?.close();await outboxDb?.onModuleDestroy();if(shutdownTimer)clearTimeout(shutdownTimer);
  process.stdout.write(`${JSON.stringify({timestamp:new Date().toISOString(),component:"aims-worker",event:"worker_stopped",workerId:config.workerId})}\n`);
  if(shutdownRequested)process.exit(0);
}
void main().catch(error=>{process.stderr.write(`${JSON.stringify({timestamp:new Date().toISOString(),component:"aims-worker",event:"worker_start_failed",classification:error instanceof Error?error.message.slice(0,160):"UNKNOWN"})}\n`);process.exitCode=1});
