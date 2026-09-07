type FetchLike = typeof fetch;

export class CorporateProviderTransport {
  constructor(
    private readonly endpoint:URL,
    private readonly timeoutMs:number=5_000,
    private readonly maximumBodyBytes:number=256_000,
    private readonly fetcher:FetchLike=fetch,
  ) {
    if(endpoint.protocol!=="https:"||endpoint.username||endpoint.password||endpoint.hash)
      throw new Error("CORPORATE_PROVIDER_ENDPOINT_INVALID");
    if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30_000)throw new Error("CORPORATE_PROVIDER_TIMEOUT_INVALID");
    if(!Number.isInteger(maximumBodyBytes)||maximumBodyBytes<1_024||maximumBodyBytes>1_048_576)throw new Error("CORPORATE_PROVIDER_BODY_LIMIT_INVALID");
  }

  async postForm(parameters:Readonly<Record<string,string>>,signal?:AbortSignal):Promise<unknown>{
    const timeout=AbortSignal.timeout(this.timeoutMs);
    const combined=signal?AbortSignal.any([timeout,signal]):timeout;
    let response:Response;
    try{
      response=await this.fetcher(this.endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","accept":"application/json"},body:new URLSearchParams(parameters),redirect:"error",signal:combined});
    }catch{throw new Error("CORPORATE_PROVIDER_REQUEST_FAILED")}
    if(response.status<200||response.status>=300)throw new Error("CORPORATE_PROVIDER_RESPONSE_REJECTED");
    const declared=Number(response.headers.get("content-length")??0);
    if(declared>this.maximumBodyBytes)throw new Error("CORPORATE_PROVIDER_RESPONSE_TOO_LARGE");
    if(!response.body)throw new Error("CORPORATE_PROVIDER_RESPONSE_INVALID");
    let reader:ReadableStreamDefaultReader<Uint8Array>;
    try{reader=response.body.getReader()}catch{throw new Error("CORPORATE_PROVIDER_REQUEST_FAILED")}
    const chunks:Uint8Array[]=[];let size=0;
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;if(!value)continue;size+=value.byteLength;if(size>this.maximumBodyBytes){try{await reader.cancel()}catch{/* preserve the bounded safe error */}throw new Error("CORPORATE_PROVIDER_RESPONSE_TOO_LARGE")}chunks.push(value)}
    }catch(error){
      if(error instanceof Error&&error.message==="CORPORATE_PROVIDER_RESPONSE_TOO_LARGE")throw error;
      throw new Error("CORPORATE_PROVIDER_REQUEST_FAILED");
    }finally{reader.releaseLock()}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
    try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw new Error("CORPORATE_PROVIDER_RESPONSE_INVALID")}
  }
}
