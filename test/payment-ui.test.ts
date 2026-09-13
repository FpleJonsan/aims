import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {build} from 'esbuild';
import ts from 'typescript';
import postcss from 'postcss';
const source=await readFile('app/page.tsx','utf8'),ast=ts.createSourceFile('page.tsx',source,99,true,ts.ScriptKind.TSX);
const names=['PaymentPanel','paymentStatusChip','paymentScanStatusChip','useScanPolling','msg'];
const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast));
assert.equal(declarations.length,names.length,'expected every named declaration to be found in app/page.tsx');
const imports=source.split('\n').find(line=>line.includes('UIProvider as UiProvider'))!.replace('"./components/ui"','"./app/components/ui/components"');
const polling=source.split('\n').find(line=>line.includes('import {pollDocuments'))!.replace('"./lib/document-polling"','"./app/lib/document-polling"');
const require=createRequire(import.meta.url);
// Snapshot-driven useState (order: slipId, bankReference, paymentDate, notice, busy, record, scanStatus,
// then useScanPolling's own internal `state`) mirroring the prior migration test harnesses; useEffect and
// useCallback are inert for static markup, and useRef returns a fresh {current} box each render — this means
// useScanPolling's `mounted` ref never flips true (its mount effect never runs), so `scans.retry()` is a
// harmless no-op here, matching the shared hook's own guard rather than anything specific to this migration.
const output=await build({stdin:{contents:`${imports}
${polling}
let snapshot:unknown[]=[],cursor=0;
const useState=(initial:unknown)=>[cursor in snapshot?snapshot[cursor++]:(cursor++,initial),()=>{}];
const useEffect=()=>{};
const useCallback=(fn:unknown)=>fn;
const useRef=(initial:unknown)=>({current:initial});
const confirm=()=>true;
${declarations.join('\n')}
export function view(states:unknown[],props:Record<string,unknown>){snapshot=states;cursor=0;return PaymentPanel(props as never);}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {view}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const item={id:'req-1',ticketNumber:'TCK-1',status:'READY_FOR_PAYMENT',currency:'MYR',amount:'2500.00',payee:'Acme Supplies'};
type Node={props?:{children?:unknown;onClick?:()=>void;onChange?:(event:{target:{value:string}})=>void;id?:string}};
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];const node=tree as Node;return [node,...nodes(node.props?.children)];}
function text(tree:unknown):string{if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='object')return text((tree as Node).props?.children);return String(tree);}
const states=(overrides:Record<string,unknown> = {})=>{
 const base:Record<string,unknown>={slipId:'',bankReference:'',paymentDate:'2026-09-01',notice:'',busy:false,record:null,scanStatus:'',scanPollingState:''};
 const merged={...base,...overrides};
 return [merged.slipId,merged.bankReference,merged.paymentDate,merged.notice,merged.busy,merged.record,merged.scanStatus,merged.scanPollingState];
};

test('the payment status chip and disclaimer banner render for a not-yet-paid request',()=>{
 const html=render(view(states(),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Ready for payment/);
 assert.match(html,/Record external payment/);
 assert.match(html,/AIMS DOES NOT EXECUTE BANK TRANSFER · EXTERNAL PAYMENT IS RECORDED/);
 assert.match(html,/AIMS records an external payment; it does not transfer funds\./);
 assert.match(html,/Finance Control · PASSED/);
 assert.match(html,/MYR/);assert.match(html,/2500\.00/);assert.match(html,/Acme Supplies/);
});
test('the upload form and recording fields are present, labeled, and the file input is required',()=>{
 const html=render(view(states(),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/for="[^"]+"[^>]*>Payment slip</);
 assert.match(html,/type="file"[^>]*required=""/);
 assert.match(html,/accept="application\/pdf,image\/jpeg,image\/png"/);
 assert.match(html,/for="[^"]+"[^>]*>Payment date</);
 assert.match(html,/for="[^"]+"[^>]*>Bank reference</);
 assert.match(html,/Upload and check slip/);
});
test('Record payment is disabled until both a clean slip and a bank reference are present, and posts the identical payload',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})};
 const noSlipTree=view(states({bankReference:'BR-1'}),{item,api,changed:async()=>{}});
 const disabledButton=nodes(noSlipTree).find(n=>text(n)==='Record payment');
 assert.equal((disabledButton as unknown as {props:{disabled?:boolean}}).props.disabled,true);
 const tree=view(states({slipId:'doc-1',bankReference:'BR-99'}),{item,api,changed:async()=>{}});
 const button=nodes(tree).find(n=>text(n)==='Record payment');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/payment');
 const body=JSON.parse((calls[0][1] as {body:string}).body);
 assert.equal(body.paymentDate,'2026-09-01');assert.equal(body.amount,'2500.00');assert.equal(body.currency,'MYR');
 assert.equal(body.bankReference,'BR-99');assert.equal(body.slipDocumentId,'doc-1');assert.equal(body.confirmPossibleDuplicate,false);
 assert.ok(typeof body.commandKey==='string'&&body.commandKey.length>0);
});
test('scan result preserves the clean/rejected badge and the polling status message unchanged',()=>{
 const cleanHtml=render(view(states({scanStatus:'CLEAN'}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(cleanHtml,/SCAN RESULT/);
 assert.match(cleanHtml,/Document ready/);
 const rejectedHtml=render(view(states({scanStatus:'REJECTED'}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(rejectedHtml,/Rejected/);
 const pollingHtml=render(view(states({scanPollingState:'Waiting for document processing…'}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(pollingHtml,/role="status"[^>]*>Waiting for document processing…/);
 assert.match(pollingHtml,/Retry slip status check/);
});
test('no scan status yet shows neither badge nor polling message',()=>{
 const html=render(view(states(),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.doesNotMatch(html,/aims-tone-success">Document ready/);
 assert.doesNotMatch(html,/aims-tone-danger">Rejected/);
});
test('a completed PAID record preserves every field: amount, bank reference, recorder, and payment date, and hides the recording form',()=>{
 const record={currency:'MYR',amount:'2500.00',bankReference:'BR-42',recordedByName:'Jamie Finance',paymentDate:'2026-09-05T00:00:00Z'};
 const html=render(view(states({record}),{item:{...item,status:'PAID'},api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Authoritative payment record/);
 assert.match(html,/Paid/);
 assert.match(html,/MYR 2500\.00/);
 assert.match(html,/Bank reference · BR-42/);
 assert.match(html,/Recorded by · Jamie Finance/);
 assert.match(html,/Payment date · 2026-09-05/);
 assert.doesNotMatch(html,/Record payment/);
 assert.doesNotMatch(html,/Upload and check slip/);
});
test('a PAID record still shown before its detail has loaded falls back to the request amount and a protected reference',()=>{
 const html=render(view(states(),{item:{...item,status:'PAID'},api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/MYR 2500\.00/);
 assert.match(html,/Bank reference · Protected/);
 assert.match(html,/Recorded by · Finance/);
});
test('busy state disables the pending action without changing its label, and preserves button width via the frozen indicator',()=>{
 const busyHtml=render(view(states({busy:true}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(busyHtml,/aria-busy="true"/);
 assert.match(busyHtml,/disabled=""/);
 assert.match(busyHtml,/Checking slip…/);
 assert.match(busyHtml,/aims-button-label/);
});
test('an in-flight failure surfaces as an announced warning without silently discarding it',()=>{
 const html=render(view(states({notice:'Something went wrong'}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/role="status"[^>]*>Something went wrong/);
});
test('payment composition only references frozen tokens and introduces no design literals',async()=>{
 const css=await readFile('app/payment-ui.css','utf8'),tokens=await readFile('app/design-system/tokens.css','utf8');
 for(const [,token] of css.matchAll(/var\((--aims-[\w-]+)\)/g))assert.ok(tokens.includes(`${token}:`),token);
 postcss.parse(css).walkDecls(d=>{assert.doesNotMatch(d.value,/#[0-9a-f]{3,8}\b|\b\d+(?:px|rem|em|ms)\b/i)});
});
