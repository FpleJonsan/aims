export interface ScanDocument {id:string;security_status?:string;document_type?:string}
/** One bounded worker-status observation; callers cancel before replacing it. */
export async function pollDocuments(options:{read:(signal:AbortSignal)=>Promise<ScanDocument[]>;update:(documents:ScanDocument[],signal:AbortSignal)=>Promise<void>|void;signal:AbortSignal;timeoutMs?:number;intervalMs?:number}) {
 const deadline=AbortSignal.timeout(options.timeoutMs??60000);
 const signal=AbortSignal.any([options.signal,deadline]);
 try{
  while(!signal.aborted){
   const documents=await options.read(signal);signal.throwIfAborted();
   await options.update(documents,signal);signal.throwIfAborted();
   if(!documents.some(d=>['QUARANTINED','SCANNING'].includes(d.security_status??'')))return 'complete' as const;
   await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason)};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},options.intervalMs??1000);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()});
  }
 }catch(error){if(options.signal.aborted)return 'cancelled' as const;if(deadline.aborted)return 'timeout' as const;throw error}
 return options.signal.aborted?'cancelled' as const:'timeout' as const;
}
