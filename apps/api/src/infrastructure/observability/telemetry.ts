import { redactSensitiveData } from "../configuration/secret-boundary.js";

export type MetricKind = "counter" | "gauge" | "histogram";
type Labels = Readonly<Record<string, string>>;
type Definition = { kind: MetricKind; help: string; labels: readonly string[]; buckets?: readonly number[] };

const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30] as const;
const DEFINITIONS = {
  aims_http_requests_total:{kind:"counter",help:"Completed API requests",labels:["method","route","status_class"]},
  aims_http_request_duration_seconds:{kind:"histogram",help:"API request duration",labels:["method","route"],buckets:DURATION_BUCKETS},
  aims_readiness_status:{kind:"gauge",help:"Readiness component state",labels:["component"]},
  aims_db_pool_connections:{kind:"gauge",help:"Database pool connections",labels:["pool","state"]},
  aims_db_operations_total:{kind:"counter",help:"Database operation outcomes",labels:["pool","operation","outcome","failure_category"]},
  aims_db_operation_duration_seconds:{kind:"histogram",help:"Database operation duration",labels:["pool","operation"],buckets:DURATION_BUCKETS},
  aims_worker_up:{kind:"gauge",help:"Worker process liveness",labels:[]},
  aims_worker_work_total:{kind:"counter",help:"Worker workload outcomes",labels:["workload","outcome","failure_category"]},
  aims_worker_work_duration_seconds:{kind:"histogram",help:"Worker workload duration",labels:["workload"],buckets:DURATION_BUCKETS},
  aims_worker_lease_recoveries_total:{kind:"counter",help:"Successfully reclaimed expired worker leases",labels:["workload"]},
  aims_worker_backlog:{kind:"gauge",help:"Current worker backlog",labels:["workload","state"]},
  aims_worker_oldest_pending_seconds:{kind:"gauge",help:"Age of oldest eligible work",labels:["workload"]},
  aims_domain_operations_total:{kind:"counter",help:"Bounded operational domain outcomes",labels:["operation","outcome","failure_category","channel"]},
  aims_domain_operation_duration_seconds:{kind:"histogram",help:"Operational domain duration",labels:["operation","channel"],buckets:DURATION_BUCKETS},
  aims_provider_operations_total:{kind:"counter",help:"External provider operation outcomes",labels:["provider","surface","outcome","failure_category"]},
  aims_provider_operation_duration_seconds:{kind:"histogram",help:"External provider operation duration",labels:["provider","surface"],buckets:DURATION_BUCKETS},
  aims_ai_tokens_total:{kind:"counter",help:"AI provider token usage when known",labels:["surface","direction"]},
} as const satisfies Record<string, Definition>;

export type MetricName = keyof typeof DEFINITIONS;
type Series = { value: number; buckets?: number[]; count?: number; sum?: number };

export class MetricsRegistry {
  private readonly series = new Map<string, Series>();
  private enabled = true;
  setEnabled(value:boolean){this.enabled=value}
  reset(){this.series.clear();this.enabled=true}
  counter(name:MetricName,labels:Labels={},amount=1){return this.record(name,labels,amount,"counter")}
  gauge(name:MetricName,labels:Labels,value:number){return this.record(name,labels,value,"gauge")}
  histogram(name:MetricName,labels:Labels,valueSeconds:number){return this.record(name,labels,valueSeconds,"histogram")}
  seriesCount(){return this.series.size}
  exposition(){
    try{
      const lines:string[]=[];
      for(const [name,definition] of Object.entries(DEFINITIONS)){
        lines.push(`# HELP ${name} ${definition.help}`,`# TYPE ${name} ${definition.kind}`);
        const matches=[...this.series.entries()].filter(([key])=>key.startsWith(`${name}|`));
        for(const [key,series] of matches){
          const labels=key.slice(name.length+1),suffix=labels?`{${labels}}`:"";
          if(definition.kind!=="histogram")lines.push(`${name}${suffix} ${series.value}`);
          else{
            const pairs=parseLabels(labels),buckets=definition.buckets??[];
            for(let i=0;i<buckets.length;i++)lines.push(`${name}_bucket${formatLabels({...pairs,le:String(buckets[i])})} ${series.buckets?.[i]??0}`);
            lines.push(`${name}_bucket${formatLabels({...pairs,le:"+Inf"})} ${series.count??0}`,`${name}_sum${suffix} ${series.sum??0}`,`${name}_count${suffix} ${series.count??0}`);
          }
        }
      }
      return `${lines.join("\n")}\n`;
    }catch{return "# AIMS metrics unavailable\n"}
  }
  private record(name:MetricName,labels:Labels,value:number,expected:MetricKind){
    try{
      if(!this.enabled||!Number.isFinite(value))return false;
      const definition:Definition=DEFINITIONS[name];
      if(!definition||definition.kind!==expected)return false;
      const keys=Object.keys(labels).sort(),allowed=[...definition.labels].sort();
      if(keys.length!==allowed.length||keys.some((key,index)=>key!==allowed[index]))return false;
      if(Object.entries(labels).some(([key,value])=>!safeLabelValue(key,value)))return false;
      const key=`${name}|${serializeLabels(labels,definition.labels)}`,current=this.series.get(key)??{value:0};
      if(expected==="counter")current.value+=value;
      else if(expected==="gauge")current.value=value;
      else{
        current.buckets??=definition.buckets!.map(()=>0);current.count=(current.count??0)+1;current.sum=(current.sum??0)+value;
        definition.buckets!.forEach((bucket,index)=>{if(value<=bucket)current.buckets![index]+=1});
      }
      this.series.set(key,current);return true;
    }catch{return false}
  }
}

export const metrics=new MetricsRegistry();

export type LogLevel="info"|"warn"|"error";
const LOG_KEYS=new Set(["event","correlation_id","operation","status","duration_ms","safe_error_code","route","method","status_code","workload","channel","provider","surface","failure_category","component"]);
let logSink:(line:string,level:LogLevel)=>void=(line,level)=>(level==="error"?process.stderr:process.stdout).write(`${line}\n`);
export function setTelemetryLogSink(sink:typeof logSink){logSink=sink}
export function resetTelemetryLogSink(){logSink=(line,level)=>(level==="error"?process.stderr:process.stdout).write(`${line}\n`)}
export function operationalLog(level:LogLevel,event:string,fields:Readonly<Record<string,unknown>>={}){
  try{
    const bounded=Object.fromEntries(Object.entries(fields).filter(([key,value])=>LOG_KEYS.has(key)&&value!==undefined&&value!==null).map(([key,value])=>[key,safeLogValue(key,value)]));
    const safe=redactSensitiveData({timestamp:new Date().toISOString(),level,service:"aims-api",process_type:process.env.AIMS_PROCESS_TYPE??"api",environment:process.env.AIMS_ENVIRONMENT??process.env.NODE_ENV??"development",event:boundedText(event),...bounded});
    logSink(JSON.stringify(safe),level);
  }catch{/* telemetry must never affect business execution */}
}

export function failureCategory(error:unknown){
  const status=typeof error==="object"&&error&&"getStatus" in error?Number((error as {getStatus():number}).getStatus()):0;
  const code=typeof error==="object"&&error&&"code" in error?String((error as {code:unknown}).code):"";
  const name=error instanceof Error?error.name:"";
  const message=error instanceof Error?error.message:"";
  if(status===401)return"AUTHENTICATION";if(status===403)return"AUTHORIZATION";if(status>=400&&status<500)return"VALIDATION";
  if(code==="40001"||/stale|concurr|serializ/i.test(message))return"CONCURRENCY";
  if(code==="55P03"||/lock timeout/i.test(message))return"TIMEOUT";
  if(code.startsWith("TELEGRAM_")||/telegram/i.test(name))return"TELEGRAM";
  if(/scanner/i.test(message))return"SCANNER";if(/storage/i.test(message))return"STORAGE";
  if(/ai|openai|provider/i.test(name))return"AI_PROVIDER";if(/config|required|configured/i.test(message))return"CONFIGURATION";
  if(/timeout|abort/i.test(message)||code==="57014")return"TIMEOUT";
  if(/database|postgres|connection|pool/i.test(message)||/^[0-9A-Z]{5}$/.test(code))return"DATABASE";
  return"INTERNAL";
}

export async function observeOperation<T>(operation:string,channel:string,correlationId:string|undefined,action:()=>Promise<T>){
  const started=performance.now();metrics.counter("aims_domain_operations_total",{operation,channel,outcome:"ATTEMPT",failure_category:"NONE"});
  try{const result=await action();metrics.counter("aims_domain_operations_total",{operation,channel,outcome:"SUCCESS",failure_category:"NONE"});return result}
  catch(error){const category=failureCategory(error);metrics.counter("aims_domain_operations_total",{operation,channel,outcome:"FAILURE",failure_category:category});operationalLog("warn","domain_operation_failed",{operation,channel,correlation_id:correlationId,failure_category:category,safe_error_code:safeErrorCode(error)});throw error}
  finally{metrics.histogram("aims_domain_operation_duration_seconds",{operation,channel},(performance.now()-started)/1000)}
}

export type PaymentTelemetryOutcome="SUCCESS"|"IDEMPOTENT_REPLAY"|"PAYLOAD_MISMATCH";
export async function observePaymentRecord<T>(correlationId:string|undefined,action:(record:(outcome:PaymentTelemetryOutcome)=>void)=>Promise<T>){
  const started=performance.now();let classified=false;
  metrics.counter("aims_domain_operations_total",{operation:"PAYMENT_RECORD",channel:"WEB",outcome:"ATTEMPT",failure_category:"NONE"});
  const record=(outcome:PaymentTelemetryOutcome)=>{classified=true;metrics.counter("aims_domain_operations_total",{operation:"PAYMENT_RECORD",channel:"WEB",outcome,failure_category:outcome==="PAYLOAD_MISMATCH"?"VALIDATION":"NONE"})};
  try{return await action(record)}
  catch(error){const category=classified?"VALIDATION":failureCategory(error);if(!classified)metrics.counter("aims_domain_operations_total",{operation:"PAYMENT_RECORD",channel:"WEB",outcome:"FAILURE",failure_category:category});operationalLog("warn","domain_operation_failed",{operation:"PAYMENT_RECORD",channel:"WEB",correlation_id:correlationId,failure_category:category,safe_error_code:classified?"IDEMPOTENCY_CONFLICT":safeErrorCode(error)});throw error}
  finally{metrics.histogram("aims_domain_operation_duration_seconds",{operation:"PAYMENT_RECORD",channel:"WEB"},(performance.now()-started)/1000)}
}

export function safeErrorCode(error:unknown){const value=typeof error==="object"&&error&&"code" in error?String((error as {code:unknown}).code):error instanceof Error?error.name:"UNKNOWN";return /^[A-Za-z0-9_.:-]{1,64}$/.test(value)?value:"UNKNOWN"}
function boundedText(value:string){return value.replace(/[\u0000-\u001f\u007f]/g," ").slice(0,160)}
function safeLogValue(key:string,value:unknown){
  if(typeof value!=="string")return value;
  if(key==="safe_error_code")return /^[A-Z0-9_]{1,64}$/.test(value)?value:"UNKNOWN";
  if(key==="correlation_id")return /^[A-Za-z0-9._:-]{1,128}$/.test(value)?value:"unavailable";
  return boundedText(value);
}
function safeLabel(value:string){return /^[A-Z0-9_./:-]{1,128}$/i.test(value)&&!/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(value)}
function safeLabelValue(key:string,value:string){
  if(!safeLabel(value))return false;
  if(key==="route")return value==="UNMATCHED"||(/^\/(?:[a-z-]+|:[a-zA-Z][a-zA-Z0-9]*)(?:\/(?:[a-z-]+|:[a-zA-Z][a-zA-Z0-9]*))*$/.test(value));
  const allowed:Record<string,readonly string[]>={
    method:["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS","OTHER"],status_class:["1XX","2XX","3XX","4XX","5XX"],
    pool:["APPLICATION","FINANCE","PAYMENT"],state:["TOTAL","IDLE","WAITING","PENDING","RETRYING","CLAIMED","TERMINAL","EXPIRED"],
    workload:["DOCUMENT_SCAN","TELEGRAM_DELIVERY","UNKNOWN"],channel:["WEB","TELEGRAM"],provider:["TELEGRAM","OPENAI_COMPATIBLE"],surface:["APPROVAL","RESPONSES"],direction:["INPUT","OUTPUT"],
    component:["postgresql","schema","financeExecutor","paymentExecutor","storage","malwareScanner","ai","telegram"],
    operation:["TRANSACTION","EXECUTOR_CALL","POOL","SERIALIZATION_RETRY","HTTP_FAILURE","AUTHENTICATION","AUTHORIZATION","LOGIN","SESSION_AUTHENTICATE","CSRF_ORIGIN","APPROVAL_CREATE","APPROVAL_ACTION","TELEGRAM_WEBHOOK","FINANCE_CONTROL_START","FINANCE_CONTROL_CONFIRM","FINANCE_CONTROL_FINALIZE","FINANCE_CONTROL_HOLD_RESOLVE","PAYMENT_SLIP_UPLOAD","PAYMENT_RECORD"],
    outcome:["ATTEMPT","SUCCESS","IDEMPOTENT_REPLAY","PAYLOAD_MISMATCH","FAILURE","RETRY","CLAIMED","POLL_SUCCESS","POLL_FAILURE","CLEAN","INFECTED","ERROR","RETRYABLE_FAILURE","TERMINAL_FAILURE"],
    failure_category:["NONE","AUTHENTICATION","AUTHORIZATION","VALIDATION","DATABASE","TIMEOUT","CONCURRENCY","STORAGE","SCANNER","TELEGRAM","AI_PROVIDER","CONFIGURATION","INTERNAL","TERMINAL","RATE_LIMIT","PROVIDER","STORAGE_TIMEOUT","SCANNER_TIMEOUT","WORKER_SHUTDOWN_ABORTED","STORAGE_INTEGRITY_FAILURE","STORAGE_OBJECT_MISSING","SCANNER_OR_STORAGE_FAILURE"],
  };
  return Boolean(allowed[key]?.includes(value));
}
function serializeLabels(labels:Labels,keys:readonly string[]){return keys.map(key=>`${key}="${escapeLabel(labels[key])}"`).join(",")}
function formatLabels(labels:Labels){const value=Object.keys(labels).sort().map(key=>`${key}="${escapeLabel(labels[key])}"`).join(",");return value?`{${value}}`:""}
function parseLabels(value:string){return Object.fromEntries(value?value.split(",").map(pair=>{const index=pair.indexOf("=");return[pair.slice(0,index),pair.slice(index+2,-1)]}):[])}
function escapeLabel(value:string){return value.replaceAll("\\","\\\\").replaceAll('"','\\"').replaceAll("\n","\\n")}
