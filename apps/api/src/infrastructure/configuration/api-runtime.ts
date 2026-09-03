import type { INestApplication } from "@nestjs/common";
import { operationalLog } from "../observability/telemetry.js";

export function configureTrustedProxy(app:INestApplication, trusted:ReadonlySet<string>):void {
  const express=app.getHttpAdapter().getInstance() as {set(name:string,value:unknown):void};
  express.set("trust proxy",(address:string)=>trusted.has(address));
}

export function installGracefulApiShutdown(
  app:INestApplication,
  graceMs:number,
  runtime:Pick<NodeJS.Process,"once">=process,
  terminate:(code:number)=>void=(code)=>process.exit(code),
):void {
  let closing=false;
  const shutdown=(signal:string)=>{
    if(closing)return;
    closing=true;
    const deadline=setTimeout(()=>{
      operationalLog("error","api_shutdown_deadline_exceeded",{operation:"API_SHUTDOWN",status:"FAILURE",signal});
      terminate(1);
    },graceMs);
    deadline.unref();
    void app.close().then(()=>clearTimeout(deadline),()=>{
      clearTimeout(deadline);
      operationalLog("error","api_shutdown_failed",{operation:"API_SHUTDOWN",status:"FAILURE",signal});
      terminate(1);
    });
  };
  runtime.once("SIGTERM",()=>shutdown("SIGTERM"));
  runtime.once("SIGINT",()=>shutdown("SIGINT"));
}
