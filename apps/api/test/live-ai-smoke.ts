import { OpenAiCompatibleProvider } from '../src/infrastructure/ai/openai-compatible-provider.js';
const key=process.env.OPENAI_API_KEY;if(!key){console.log('SKIPPED: OPENAI_API_KEY is not configured');process.exit(0)}
const pdf=new TextEncoder().encode('%PDF-1.7\nSynthetic invoice Vendor TEST MYR 1.00\n%%EOF');
const started=Date.now();const result=await new OpenAiCompatibleProvider(key,process.env.OPENAI_MODEL??'gpt-5-mini',process.env.OPENAI_BASE_URL).analyzeDocuments({request:{payee:'Vendor TEST',amount:'1.00',currency:'MYR',dueDate:'2026-09-01'},documents:[{id:'00000000-0000-4000-8000-000000000111',version:1,filename:'synthetic.pdf',mimeType:'application/pdf',data:pdf}]});
console.log(JSON.stringify({provider:result.provider,model:result.model,latencyMs:Date.now()-started,inputTokens:result.inputTokens,outputTokens:result.outputTokens,totalTokens:result.totalTokens,schemaValid:true}));
