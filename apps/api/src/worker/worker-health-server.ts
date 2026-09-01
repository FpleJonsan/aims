import {createServer,type Server} from "node:http";
import {metrics,operationalLog} from "../infrastructure/observability/telemetry.js";

export type WorkerReadiness=()=>Promise<{status:"ready"|"not_ready";checks:Record<string,{status:"ready"|"not_ready"|"disabled";detail?:string}>}>;
export class WorkerHealthServer{
  private server:Server|undefined;
  constructor(private readonly port:number,private readonly readiness:WorkerReadiness){}
  async start(){await new Promise<void>((resolve,reject)=>{this.server=createServer(async(request,response)=>{
    response.setHeader("content-type","application/json; charset=utf-8");
    if(request.url==="/health/live"){response.end(JSON.stringify({status:"ok"}));return}
    if(request.url==="/health/ready"){const result=await safeReadiness(this.readiness);response.statusCode=result.status==="ready"?200:503;response.end(JSON.stringify(result));return}
    if(request.url==="/metrics"){response.setHeader("content-type","text/plain; version=0.0.4; charset=utf-8");response.end(metrics.exposition());return}
    response.statusCode=404;response.end(JSON.stringify({status:"not_found"}));
  }).once("error",reject).listen(this.port,"127.0.0.1",()=>resolve())});operationalLog("info","worker_health_started",{operation:"WORKER_HEALTH",status:"READY"})}
  async close(){if(!this.server)return;await new Promise<void>((resolve,reject)=>this.server!.close(error=>error?reject(error):resolve()))}
  addressPort(){const address=this.server?.address();return typeof address==="object"&&address?address.port:null}
}
async function safeReadiness(check:WorkerReadiness){try{return await check()}catch{return{status:"not_ready" as const,checks:{worker:{status:"not_ready" as const,detail:"readiness check failed"}}}}}
