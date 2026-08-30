import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import type {DocumentMalwareScanner} from "../application/documents/document-quarantine-service.js";
import type {DocumentStorage} from "../infrastructure/storage/document-storage.js";
import type {WorkerConfig} from "./worker-config.js";

type ScanClaim={document_id:string;payment_request_id:string;document_version:number;document_sha256:string;document_type:string|null;storage_provider:string;storage_object_key:string;detected_mime_type:string;scan_attempt:number;claim_token:string;lease_expires_at:Date;correlation_id:string};

export class DocumentScanWorker{
  private lastSuccessfulJob:string|null=null;
  private stopping=false;
  private readonly activeControllers=new Set<AbortController>();
  constructor(private readonly pool:Pool,private readonly storage:DocumentStorage,private readonly scanner:DocumentMalwareScanner,private readonly config:WorkerConfig){}
  async pollBatch(){
    let processed=0;
    for(let i=0;i<this.config.batchSize&&!this.stopping;i+=1){const claim=await this.claim();if(!claim)break;await this.process(claim);processed+=1}
    return{processed,lastSuccessfulJob:this.lastSuccessfulJob,health:await this.health()};
  }
  private async claim(){
    const result=await this.pool.query<ScanClaim>("SELECT * FROM claim_next_payment_document_scan($1,$2,$3,$4)",[this.config.workerId,this.config.leaseSeconds,this.config.maximumAttempts,randomUUID()]);
    return result.rows[0]??null;
  }
  private async process(claim:ScanClaim){
    const started=Date.now();
    try{
      const data=await this.deadline("STORAGE_TIMEOUT",this.config.storageTimeoutMs,signal=>this.storage.readQuarantined(claim.storage_object_key,claim.document_sha256,signal));
      const scan=await this.deadline("SCANNER_TIMEOUT",this.config.scannerTimeoutMs,signal=>this.scanner.scan({key:claim.storage_object_key,sha256:claim.document_sha256,contentType:claim.detected_mime_type,data,signal}));
      if(scan.verdict==="CLEAN"){
        let activeKey:string|null=null;
        if(claim.document_type!=="PAYMENT_SLIP")activeKey=(await this.deadline("STORAGE_TIMEOUT",this.config.storageTimeoutMs,()=>this.storage.promoteQuarantined({quarantinedKey:claim.storage_object_key,destinationKey:`payment-requests/${claim.payment_request_id}/documents/${claim.document_id}`,expectedSha256:claim.document_sha256}))).key;
        await this.complete(claim,"CLEAN",null,0,scan.engine,scan.reference,null,activeKey);
      }else if(scan.verdict==="INFECTED")await this.complete(claim,"REJECTED",null,0,scan.engine,scan.reference,null,null);
      else await this.fail(claim,"SCANNER_UNAVAILABLE",scan.engine,scan.reference);
      this.lastSuccessfulJob=new Date().toISOString();
      safeLog("document_scan_completed",{workerId:this.config.workerId,documentId:claim.document_id,attempt:claim.scan_attempt,durationMs:Date.now()-started,result:scan.verdict,correlationId:claim.correlation_id});
    }catch(error){
      await this.fail(claim,safeFailure(error),null,null);
      safeLog("document_scan_failed",{workerId:this.config.workerId,documentId:claim.document_id,attempt:claim.scan_attempt,durationMs:Date.now()-started,result:"SCAN_FAILED",correlationId:claim.correlation_id});
    }
  }
  private fail(claim:ScanClaim,code:string,engine:string|null,reference:string|null){const terminal=claim.scan_attempt>=this.config.maximumAttempts;return this.complete(claim,"SCAN_FAILED",terminal?"TERMINAL":"RETRYABLE",terminal?0:this.config.retryDelaySeconds,engine,reference,code,null)}
  private async deadline<T>(code:"STORAGE_TIMEOUT"|"SCANNER_TIMEOUT",milliseconds:number,operation:(signal:AbortSignal)=>Promise<T>){
    const controller=new AbortController();this.activeControllers.add(controller);
    let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false;
    const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener("abort",()=>reject(new WorkerExternalIoTimeout(timedOut?code:"WORKER_SHUTDOWN_ABORTED")),{once:true}));
    try{return await Promise.race([operation(controller.signal),aborted,new Promise<never>(()=>{timer=setTimeout(()=>{timedOut=true;controller.abort()},milliseconds)})])}
    finally{if(timer)clearTimeout(timer);this.activeControllers.delete(controller)}
  }
  private async complete(claim:ScanClaim,status:string,disposition:string|null,retry:number,engine:string|null,reference:string|null,failure:string|null,activeKey:string|null){
    await this.pool.query("SELECT complete_payment_document_scan($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[claim.document_id,claim.document_version,claim.document_sha256,claim.scan_attempt,claim.claim_token,status,disposition,retry,engine,reference,failure,activeKey]);
  }
  async health(){const result=await this.pool.query("SELECT * FROM payment_document_scan_worker_health()");return result.rows[0]}
  stop(){this.stopping=true;for(const controller of this.activeControllers)controller.abort()}
  async close(){this.stop();await this.pool.end()}
}

class WorkerExternalIoTimeout extends Error{constructor(readonly code:"STORAGE_TIMEOUT"|"SCANNER_TIMEOUT"|"WORKER_SHUTDOWN_ABORTED"){super(code)}}
function safeFailure(error:unknown){if(error instanceof WorkerExternalIoTimeout)return error.code;const message=error instanceof Error?error.message:"";if(/integrity/i.test(message))return"STORAGE_INTEGRITY_FAILURE";if(/ENOENT/i.test(message))return"STORAGE_OBJECT_MISSING";if(/abort/i.test(message))return"WORKER_SHUTDOWN_ABORTED";return"SCANNER_OR_STORAGE_FAILURE"}
function safeLog(event:string,data:Record<string,unknown>){process.stdout.write(`${JSON.stringify({timestamp:new Date().toISOString(),component:"aims-worker",event,...data})}\n`)}
