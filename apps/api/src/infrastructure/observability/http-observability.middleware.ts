import type {NextFunction,Request,Response} from "express";
import {metrics,operationalLog} from "./telemetry.js";

export function httpObservabilityMiddleware(request:Request,response:Response,next:NextFunction){
  const started=performance.now();
  response.once("finish",()=>{
    const method=boundedMethod(request.method),route=safeRouteTemplate(request),statusClass=`${Math.floor(response.statusCode/100)}XX`,durationMs=Math.max(0,performance.now()-started);
    metrics.counter("aims_http_requests_total",{method,route,status_class:statusClass});
    metrics.histogram("aims_http_request_duration_seconds",{method,route},durationMs/1000);
    operationalLog(response.statusCode>=500?"error":response.statusCode>=400?"warn":"info","api_request_completed",{correlation_id:request.correlationId,operation:"HTTP_REQUEST",method,route,status:"COMPLETED",status_code:response.statusCode,duration_ms:Math.round(durationMs)});
  });
  next();
}

export function safeRouteTemplate(request:Pick<Request,"route"|"baseUrl">){
  const path=typeof request.route?.path==="string"?request.route.path:undefined;
  if(!path)return"UNMATCHED";
  const combined=`${request.baseUrl??""}${path}`.replace(/\/+/g,"/");
  return combined.startsWith("/")?combined:`/${combined}`;
}
function boundedMethod(value:string){return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(value)?value:"OTHER"}
