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
const names=['FinanceControlPanel','financeControlStatusLabel','financeControlStatusChip','financeControlCheckResultBadge','financeControlDuplicateBadge','msg'];
const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast));
assert.equal(declarations.length,names.length,'expected every named declaration to be found in app/page.tsx');
const imports=source.split('\n').find(line=>line.includes('UIProvider as UiProvider'))!.replace('"./components/ui"','"./app/components/ui/components"');
const require=createRequire(import.meta.url);
// Snapshot-driven useState (order: data, history, notice, busy, note) mirroring the prior migration test
// harnesses; useEffect and useCallback are inert for static markup. `crypto` comes from the Node global.
const output=await build({stdin:{contents:`${imports}
let snapshot:unknown[]=[],cursor=0;
const useState=(initial:unknown)=>[cursor in snapshot?snapshot[cursor++]:(cursor++,initial),()=>{}];
const useEffect=()=>{};
const useCallback=(fn:unknown)=>fn;
${declarations.join('\n')}
export function view(states:unknown[],props:Record<string,unknown>){snapshot=states;cursor=0;return FinanceControlPanel(props as never);}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {view}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const item={id:'req-1',status:'APPROVED'};
type Node={props?:{children?:unknown;onClick?:()=>void;onChange?:(event:{target:{value:string}})=>void;id?:string}};
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];const node=tree as Node;return [node,...nodes(node.props?.children)];}
function text(tree:unknown):string{if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='object')return text((tree as Node).props?.children);return String(tree);}
const states=(overrides:Record<string,unknown> = {})=>{
 const base:Record<string,unknown>={data:null,history:[],notice:'',busy:false,note:''};
 const merged={...base,...overrides};
 return [merged.data,merged.history,merged.notice,merged.busy,merged.note];
};
const run={id:'run-1',run_version:2,status:'CHECKING',duplicate_status:'NO_DUPLICATE',evidence_fingerprint:'abcdef0123456789'};

test('before a run exists and the request is not yet Approved, the empty state replaces any action',()=>{
 const html=render(view(states(),{item:{id:'req-1',status:'VALIDATING'},api:()=>{throw Error('must not call API')},changed:async()=>{}}));
 assert.match(html,/Final Finance Control has not started yet/);
 assert.doesNotMatch(html,/Start Final Finance Control/);
 assert.match(html,/Not started/);
});
test('once Approved with no run yet, Start Final Finance Control triggers the exact same POST as before migration',()=>{
 const calls:Array<[string,unknown]>=[];
 const tree=view(states(),{item,api:(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})},changed:async()=>{}});
 const html=render(tree);
 assert.doesNotMatch(html,/has not started yet/);
 const button=nodes(tree).find(n=>text(n)==='Start Final Finance Control');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/finance-control');
 assert.deepEqual(calls[0][1],{method:'POST',body:'{}'});
});
test('an active run header status is standardized without changing the underlying status',()=>{
 const html=render(view(states({data:{run:{...run,status:'PASSED'},checks:[],confirmations:[],exception:null,readyForPayment:false},history:[]}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Passed/);
});
test('run metadata preserves the version, humanizes the duplicate status, and truncates the evidence fingerprint unchanged',()=>{
 const data={run,checks:[],confirmations:[],exception:null,readyForPayment:false};
 const html=render(view(states({data}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Run v2/);
 assert.match(html,/No duplicate/);
 assert.match(html,/Evidence: abcdef012345…/);
});
test('while CHECKING, every confirmation renders with its checkmark state, and confirming posts the identical payload',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})};
 const data={run,checks:[],confirmations:[{code:'PAYEE_VERIFIED',confirmed:true}],exception:null,readyForPayment:false};
 const tree=view(states({data}),{item,api,changed:async()=>{}});
 const html=render(tree);
 assert.match(html,/✓ Payee identity verified/);
 assert.match(html,/○ Payment method verified/);
 assert.doesNotMatch(html,/Possible duplicate reviewed/);
 const button=nodes(tree).find(n=>typeof n.props?.onClick==='function'&&text(n).includes('Payment method verified'));assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/finance-control/run-1/checks');
 assert.deepEqual(JSON.parse((calls[0][1] as {body:string}).body),{code:'PAYMENT_METHOD_VERIFIED',confirmed:true});
});
test('a possible duplicate adds its own confirmation requirement instead of hiding the duplicate signal',()=>{
 const data={run:{...run,duplicate_status:'POSSIBLE_DUPLICATE'},checks:[],confirmations:[],exception:null,readyForPayment:false};
 const html=render(view(states({data}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Possible duplicate reviewed/);
 assert.match(html,/Possible duplicate/);
});
test('Run deterministic controls posts a finalize command while CHECKING',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})};
 const data={run,checks:[],confirmations:[],exception:null,readyForPayment:false};
 const tree=view(states({data}),{item,api,changed:async()=>{}});
 const button=nodes(tree).find(n=>text(n)==='Run deterministic controls');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/finance-control/run-1/finalize');
 assert.equal(JSON.parse((calls[0][1] as {body:string}).body).commandKey!==undefined,true);
});
test('financial evidence preserves every check result, code and source unchanged',()=>{
 const data={run:{...run,status:'PASSED'},checks:[
  {code:'REQUEST_NOT_APPROVED',source:'SYSTEM',result:'PASS'},
  {code:'DUPLICATE_INVOICE',source:'SYSTEM',result:'REVIEW_REQUIRED'},
  {code:'AMOUNT_CHANGED',source:'FINANCE_USER',result:'FAIL'},
 ],confirmations:[],exception:null,readyForPayment:false};
 const html=render(view(states({data}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/FINANCIAL EVIDENCE/);
 assert.match(html,/REQUEST NOT APPROVED/);assert.match(html,/SYSTEM/);
 assert.match(html,/DUPLICATE INVOICE/);assert.match(html,/Review required/);
 assert.match(html,/AMOUNT CHANGED/);assert.match(html,/Fail/);assert.match(html,/FINANCE_USER/);
});
test('the evidence card is absent until at least one check exists',()=>{
 const data={run,checks:[],confirmations:[],exception:null,readyForPayment:false};
 const html=render(view(states({data}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.doesNotMatch(html,/FINANCIAL EVIDENCE/);
});
test('a HOLD preserves the exact reason and failed check codes, and Resolve and recheck is disabled until a note is entered',()=>{
 const data={run:{...run,status:'HOLD'},checks:[],confirmations:[],exception:{failed_check_codes:['AMOUNT_CHANGED','DUPLICATE_INVOICE'],reason:'Amount differs from the approved request.',status:'OPEN'},readyForPayment:false};
 const emptyNoteHtml=render(view(states({data}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(emptyNoteHtml,/Finance Hold/);
 assert.match(emptyNoteHtml,/Amount differs from the approved request\./);
 assert.match(emptyNoteHtml,/AMOUNT CHANGED, DUPLICATE INVOICE/);
 assert.match(emptyNoteHtml,/for="finance-control-note"/);
 const emptyTree=view(states({data}),{item,api:()=>Promise.resolve({}),changed:async()=>{}});
 const disabledResolve=nodes(emptyTree).find(n=>text(n)==='Resolve and recheck');
 assert.equal(disabledResolve!.props && (disabledResolve as unknown as {props:{disabled?:boolean}}).props.disabled,true);
});
test('Resolve and recheck posts the identical resolution payload once a note is present',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})};
 const data={run:{...run,status:'HOLD'},checks:[],confirmations:[],exception:{failed_check_codes:['AMOUNT_CHANGED'],reason:'Amount differs.',status:'OPEN'},readyForPayment:false};
 const tree=view(states({data,note:'Confirmed with the requester.'}),{item,api,changed:async()=>{}});
 const button=nodes(tree).find(n=>text(n)==='Resolve and recheck');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/finance-control/run-1/hold/resolve');
 assert.deepEqual(JSON.parse((calls[0][1] as {body:string}).body),{resolution:'RECHECK',note:'Confirmed with the requester.'});
});
test('readiness for payment shows the exact ready marker text unchanged',()=>{
 const data={run:{...run,status:'PASSED'},checks:[],confirmations:[],exception:null,readyForPayment:true};
 const html=render(view(states({data}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Final Finance Control passed · READY FOR PAYMENT\.\s*Payment\s*\n?\s*Processing is not implemented in Day 7\./);
});
test('control history preserves every run version, humanized status and current marker unchanged',()=>{
 const history=[{id:'h1',run_version:1,status:'SUPERSEDED',is_current:false},{id:'h2',run_version:2,status:'PASSED',is_current:true}];
 const html=render(view(states({history}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/v1 · Superseded/);
 assert.match(html,/v2 · Passed · CURRENT/);
});
test('an empty control history shows the frozen empty state instead of an invented event',()=>{
 const html=render(view(states({history:[]}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/No completed control runs/);
});
test('busy state disables the pending action without changing its label',()=>{
 const busyHtml=render(view(states({busy:true}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(busyHtml,/aria-busy="true"/);
 assert.match(busyHtml,/disabled=""/);
 assert.match(busyHtml,/Start Final Finance Control/);
});
test('an in-flight failure surfaces as an announced error without silently discarding it',()=>{
 const html=render(view(states({notice:'Something went wrong'}),{item,api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/role="alert"[^>]*>Something went wrong/);
});
test('finance control composition only references frozen tokens and introduces no design literals',async()=>{
 const css=await readFile('app/finance-control-ui.css','utf8'),tokens=await readFile('app/design-system/tokens.css','utf8');
 for(const [,token] of css.matchAll(/var\((--aims-[\w-]+)\)/g))assert.ok(tokens.includes(`${token}:`),token);
 postcss.parse(css).walkDecls(d=>{assert.doesNotMatch(d.value,/#[0-9a-f]{3,8}\b|\b\d+(?:px|rem|em|ms)\b/i)});
});
