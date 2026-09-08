import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import type {DocumentMalwareScanner} from "../application/documents/document-quarantine-service.js";
import type {DocumentStorage} from "../infrastructure/storage/document-storage.js";
import type {WorkerConfig} from "./worker-config.js";
import {metrics,operationalLog} from "../infrastructure/observability/telemetry.js";

type ScanClaim={document_id:string;payment_request_id:string;document_version:number;storage_backend_id:string;source_object_key:string;source_object_version:string;document_sha256:string;document_size_bytes:number;document_type:string|null;storage_provider:string;detected_mime_type:string;scan_attempt:number;claim_token:string;lease_expires_at:Date;correlation_id:string;expired_lease_recovered:boolean};

export class DocumentScanWorker{
  private lastSuccessfulJob:string|null=null;
  private stopping=false;
  private readonly activeControllers=new Set<AbortController>();
  constructor(private readonly pool:Pool,private readonly storage:DocumentStorage,private readonly scanner:DocumentMalwareScanner,private readonly config:WorkerConfig){}
  async pollBatch(){
    let processed=0;
    for(let i=0;i<this.config.batchSize&&!this.stopping;i+=1){const claim=await this.claim();if(!claim)break;await this.process(claim);processed+=1}
    const health=await this.health();this.recordHealth(health);return{processed,lastSuccessfulJob:this.lastSuccessfulJob,health};
  }
  private async claim(){
    const result=await this.pool.query<ScanClaim>("SELECT * FROM claim_next_payment_document_scan($1,$2,$3,$4)",[this.config.workerId,this.config.leaseSeconds,this.config.maximumAttempts,randomUUID()]);
    const claim=result.rows[0]??null;
    if(claim?.expired_lease_recovered)metrics.counter("aims_worker_lease_recoveries_total",{workload:"DOCUMENT_SCAN"});
    return claim;
  }
  private async process(claim:ScanClaim){
    const started=Date.now();
    metrics.counter("aims_worker_work_total",{workload:"DOCUMENT_SCAN",outcome:"CLAIMED",failure_category:"NONE"});
    try{
      const data=await this.deadline("STORAGE_TIMEOUT",this.config.storageTimeoutMs,signal=>this.storage.readQuarantined(claim.storage_backend_id,claim.source_object_key,claim.source_object_version,claim.document_sha256,signal));
      if(data.byteLength!==Number(claim.document_size_bytes))throw new Error("STORAGE_INTEGRITY_FAILURE");
      const scan=await this.deadline("SCANNER_TIMEOUT",this.config.scannerTimeoutMs,signal=>this.scanner.scan({key:claim.source_object_key,sha256:claim.document_sha256,contentType:claim.detected_mime_type,data,signal}));
      if(scan.verdict==="CLEAN"){
        const requestedTrustedKey=this.storage.trustedKey(`payment-requests/${claim.payment_request_id}/documents/${claim.document_id}`);
        const promoted=await this.deadline("STORAGE_TIMEOUT",this.config.storageTimeoutMs,signal=>this.storage.promoteQuarantined({backendId:claim.storage_backend_id,quarantinedKey:claim.source_object_key,quarantinedObjectVersion:claim.source_object_version,trustedKey:requestedTrustedKey,expectedSha256:claim.document_sha256,expectedSizeBytes:Number(claim.document_size_bytes),signal}));
        if(promoted.provider!==claim.storage_provider||promoted.backendId!==claim.storage_backend_id||promoted.status!=="ACTIVE"||promoted.key!==requestedTrustedKey||!promoted.objectVersion||promoted.sha256!==claim.document_sha256||promoted.sizeBytes!==Number(claim.document_size_bytes))throw new Error("TRUSTED_OBJECT_INTEGRITY_MISMATCH");
        const proof=await this.deadline("STORAGE_TIMEOUT",this.config.storageTimeoutMs,signal=>this.storage.metadata(claim.storage_backend_id,promoted.key,promoted.objectVersion,signal));
        if(proof.backendId!==claim.storage_backend_id||proof.key!==promoted.key||proof.objectVersion!==promoted.objectVersion||proof.sha256!==claim.document_sha256||proof.sizeBytes!==Number(claim.document_size_bytes))throw new Error("TRUSTED_OBJECT_INTEGRITY_MISMATCH");
        await this.complete(claim,"CLEAN",null,0,scan.engine,scan.reference,null,promoted.key,promoted.objectVersion);
      }else if(scan.verdict==="INFECTED")await this.complete(claim,"REJECTED",null,0,scan.engine,scan.reference,null,null,null);
      else await this.fail(claim,"SCANNER_UNAVAILABLE",scan.engine,scan.reference);
      this.lastSuccessfulJob=new Date().toISOString();
      metrics.counter("aims_worker_work_total",{workload:"DOCUMENT_SCAN",outcome:scan.verdict,failure_category:"NONE"});
      operationalLog("info","worker_workload_completed",{workload:"DOCUMENT_SCAN",status:scan.verdict,duration_ms:Date.now()-started,correlation_id:claim.correlation_id});
    }catch(error){
      try{await this.fail(claim,safeFailure(error),null,null)}catch(finalizationError){if(!/stale|no longer exists/i.test(finalizationError instanceof Error?finalizationError.message:""))throw finalizationError}
      const category=safeFailure(error),terminal=claim.scan_attempt>=this.config.maximumAttempts;
      metrics.counter("aims_worker_work_total",{workload:"DOCUMENT_SCAN",outcome:terminal?"TERMINAL_FAILURE":"RETRYABLE_FAILURE",failure_category:category});
      operationalLog("warn","worker_workload_failed",{workload:"DOCUMENT_SCAN",status:terminal?"TERMINAL":"RETRYABLE",duration_ms:Date.now()-started,correlation_id:claim.correlation_id,failure_category:category,safe_error_code:category});
    }finally{metrics.histogram("aims_worker_work_duration_seconds",{workload:"DOCUMENT_SCAN"},(Date.now()-started)/1000)}
  }
  private fail(claim:ScanClaim,code:string,engine:string|null,reference:string|null){const terminal=claim.scan_attempt>=this.config.maximumAttempts;return this.complete(claim,"SCAN_FAILED",terminal?"TERMINAL":"RETRYABLE",terminal?0:this.config.retryDelaySeconds,engine,reference,code,null,null)}
  private async deadline<T>(code:"STORAGE_TIMEOUT"|"SCANNER_TIMEOUT",milliseconds:number,operation:(signal:AbortSignal)=>Promise<T>){
    const controller=new AbortController();this.activeControllers.add(controller);
    let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
    const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener("abort",()=>reject(new WorkerExternalIoTimeout(timedOut?code:"WORKER_SHUTDOWN_ABORTED")),{once:true}));
    try{return await Promise.race([operation(controller.signal),aborted,new Promise<never>(()=>{timer=setTimeout(()=>{timedOut=true;controller.abort()},milliseconds)})])}
    finally{if(timer)clearTimeout(timer);this.activeControllers.delete(controller)}
  }
  private async complete(claim:ScanClaim,status:string,disposition:string|null,retry:number,engine:string|null,reference:string|null,failure:string|null,trustedKey:string|null,trustedVersion:string|null){
    await this.pool.query("SELECT complete_payment_document_scan($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",[claim.document_id,claim.document_version,claim.storage_backend_id,claim.source_object_key,claim.source_object_version,claim.document_sha256,claim.document_size_bytes,claim.scan_attempt,claim.claim_token,status,disposition,retry,engine,reference,failure,trustedKey,trustedVersion]);
  }
  async health(){const result=await this.pool.query("SELECT * FROM payment_document_scan_worker_health()");return result.rows[0]}
  private recordHealth(value:Record<string,unknown>){for(const [source,state] of [["backlog","PENDING"],["retryable_failures","RETRYING"],["scanning_leases","CLAIMED"],["terminal_failures","TERMINAL"],["expired_leases","EXPIRED"]] as const){metrics.gauge("aims_worker_backlog",{workload:"DOCUMENT_SCAN",state},Number(value[source]??0))}metrics.gauge("aims_worker_oldest_pending_seconds",{workload:"DOCUMENT_SCAN"},Number(value.oldest_eligible_seconds??0))}
  stop(){this.stopping=true;for(const controller of this.activeControllers)controller.abort()}
  async close(){this.stop();await this.pool.end()}
}

class WorkerExternalIoTimeout extends Error{constructor(readonly code:"STORAGE_TIMEOUT"|"SCANNER_TIMEOUT"|"WORKER_SHUTDOWN_ABORTED"){super(code)}}
function safeFailure(error:unknown){if(error instanceof WorkerExternalIoTimeout)return error.code;const message=error instanceof Error?error.message:"";if(/integrity/i.test(message))return"STORAGE_INTEGRITY_FAILURE";if(/ENOENT/i.test(message))return"STORAGE_OBJECT_MISSING";if(/abort/i.test(message))return"WORKER_SHUTDOWN_ABORTED";return"SCANNER_OR_STORAGE_FAILURE"}
