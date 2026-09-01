export type PollWorkload={name:string;poll:()=>Promise<{processed:number}|unknown>};
import {failureCategory,metrics,operationalLog} from "../infrastructure/observability/telemetry.js";
export class WorkerLoop{
  private stopping=false;
  private wake:undefined|(()=>void);
  lastSuccessfulPoll:string|null=null;
  constructor(private readonly workloads:PollWorkload[],private readonly intervalMs:number){}
  stop(){this.stopping=true;this.wake?.()}
  async run(){
    while(!this.stopping){
      for(const workload of this.workloads){if(this.stopping)break;const started=performance.now();try{const result=await workload.poll();this.lastSuccessfulPoll=new Date().toISOString();metrics.counter("aims_worker_work_total",{workload:canonical(workload.name),outcome:"POLL_SUCCESS",failure_category:"NONE"},processed(result))}catch(error){const category=failureCategory(error);metrics.counter("aims_worker_work_total",{workload:canonical(workload.name),outcome:"POLL_FAILURE",failure_category:category});operationalLog("error","worker_poll_failed",{workload:canonical(workload.name),failure_category:category,safe_error_code:safeClass(error)})}finally{metrics.histogram("aims_worker_work_duration_seconds",{workload:canonical(workload.name)},(performance.now()-started)/1000)}}
      if(!this.stopping)await new Promise<void>(resolve=>{const timer=setTimeout(()=>{this.wake=undefined;resolve()},this.intervalMs);this.wake=()=>{clearTimeout(timer);this.wake=undefined;resolve()}});
    }
  }
}
function safeClass(error:unknown){const code=typeof error==="object"&&error&&"code" in error?String((error as {code:unknown}).code):"WORKLOAD_FAILURE";return /^[A-Z0-9_]{1,64}$/.test(code)?code:"WORKLOAD_FAILURE"}
function canonical(value:string){return value==="document_scan"?"DOCUMENT_SCAN":value==="telegram_outbox"?"TELEGRAM_DELIVERY":"UNKNOWN"}
function processed(value:unknown){return typeof value==="object"&&value&&"processed" in value&&typeof (value as {processed:unknown}).processed==="number"?Math.max(1,(value as {processed:number}).processed):1}
