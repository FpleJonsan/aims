export type PollWorkload={name:string;poll:()=>Promise<{processed:number}|unknown>};
export class WorkerLoop{
  private stopping=false;
  private wake:undefined|(()=>void);
  lastSuccessfulPoll:string|null=null;
  constructor(private readonly workloads:PollWorkload[],private readonly intervalMs:number){}
  stop(){this.stopping=true;this.wake?.()}
  async run(){
    while(!this.stopping){
      for(const workload of this.workloads){if(this.stopping)break;try{await workload.poll();this.lastSuccessfulPoll=new Date().toISOString()}catch(error){safeLog("worker_poll_failed",{workload:workload.name,classification:safeClass(error)})}}
      if(!this.stopping)await new Promise<void>(resolve=>{const timer=setTimeout(()=>{this.wake=undefined;resolve()},this.intervalMs);this.wake=()=>{clearTimeout(timer);this.wake=undefined;resolve()}});
    }
  }
}
function safeClass(error:unknown){const code=typeof error==="object"&&error&&"code" in error?String((error as {code:unknown}).code):"WORKLOAD_FAILURE";return /^[A-Z0-9_]{1,64}$/.test(code)?code:"WORKLOAD_FAILURE"}
function safeLog(event:string,data:Record<string,unknown>){process.stderr.write(`${JSON.stringify({timestamp:new Date().toISOString(),component:"aims-worker",event,...data})}\n`)}
