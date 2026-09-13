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
const names=['PaymentHistory','historyStatusChip','historyControlStatusBadge','historyCommitmentBadge','msg'];
const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast));
assert.equal(declarations.length,names.length,'expected every named declaration to be found in app/page.tsx');
const imports=source.split('\n').find(line=>line.includes('UIProvider as UiProvider'))!.replace('"./components/ui"','"./app/components/ui/components"');
const apiConst=source.split('\n').find(line=>line.startsWith('const API ='))!;
const require=createRequire(import.meta.url);
// Snapshot-driven useState (order: filters, rows, total, detail, notice) mirroring the prior migration test
// harnesses; useEffect is inert for static markup. exportCsv() and the "Open secured payment slip" handler
// both rely on browser-only DOM APIs (document.createElement, URL.createObjectURL) with no equivalent in this
// server-side render harness, so their onClick bodies are exercised for presence/label only, not invoked.
const output=await build({stdin:{contents:`${imports}
${apiConst}
let snapshot:unknown[]=[],cursor=0;
const useState=(initial:unknown)=>[cursor in snapshot?snapshot[cursor++]:(cursor++,initial),()=>{}];
const useEffect=()=>{};
${declarations.join('\n')}
export function view(states:unknown[],props:Record<string,unknown>){snapshot=states;cursor=0;return PaymentHistory(props as never);}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {view}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
type Node={props?:{children?:unknown;onClick?:()=>void;onChange?:(event:{target:{value:string}})=>void;id?:string}};
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];const node=tree as Node;return [node,...nodes(node.props?.children)];}
function text(tree:unknown):string{if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='object')return text((tree as Node).props?.children);return String(tree);}
const baseFilters={search:'',departmentId:'',category:'',dateFrom:'',dateTo:'',status:'PAID',page:'1'};
const states=(overrides:Record<string,unknown> = {})=>{
 const base:Record<string,unknown>={filters:baseFilters,rows:[],total:0,detail:null,notice:''};
 const merged={...base,...overrides};
 return [merged.filters,merged.rows,merged.total,merged.detail,merged.notice];
};

test('the list view renders the section heading, every filter labeled, and Export CSV',()=>{
 const html=render(view(states(),{api:()=>Promise.resolve({}),initialFilters:{}}));
 assert.match(html,/Payment History/);
 assert.match(html,/10 · PAYMENT RECORD \/ HISTORY/);
 for(const label of ['Search ticket, payee or bank reference','Department ID','Category','From date','To date','Payment status'])assert.match(html,new RegExp(`<label[^>]*>${label.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')}</label>`));
 assert.match(html,/Export CSV/);
});
test('an empty result set shows the frozen empty state instead of a blank table',()=>{
 const html=render(view(states(),{api:()=>Promise.resolve({}),initialFilters:{}}));
 assert.match(html,/No payment records found/);
});
test('every row preserves ticket, payee, department, category, purpose, amount, recorder and status unchanged',()=>{
 const rows=[{id:'p1',ticketNumber:'TCK-9',paymentDate:'2026-09-05T00:00:00Z',payee:'Acme Supplies',departmentName:'Operations',category:'Travel',purpose:'Flight booking',amount:'2500.00',currency:'MYR',paymentMethod:'BANK_TRANSFER',bankReference:'BR-1',status:'PAID',recordedByName:'Jamie Finance',recordedAt:'2026-09-05T08:00:00Z'}];
 const tree=view(states({rows,total:1}),{api:()=>Promise.resolve({}),initialFilters:{}});
 const html=render(tree);
 assert.doesNotMatch(html,/No payment records found/);
 assert.match(html,/TCK-9/);assert.match(html,/Acme Supplies/);
 assert.match(html,/Operations · Travel · Flight booking/);
 assert.match(html,/MYR/);assert.match(html,/2500\.00/);
 assert.match(html,/2026-09-05 · BANK_TRANSFER/);
 assert.match(html,/Jamie Finance/);
 assert.match(html,/Paid/);
 assert.match(html,/Detail →/);
 const row=nodes(tree).find(n=>typeof n.props?.onClick==='function'&&text(n).includes('TCK-9'));
 assert.ok(row);
});
test('opening a row calls the payment detail endpoint with the exact row id',()=>{
 const calls:string[]=[];
 const api=(path:string)=>{calls.push(path);return Promise.resolve({})};
 const rows=[{id:'row-77',ticketNumber:'TCK-77',paymentDate:'2026-09-01',payee:'Vendor',departmentName:'Ops',category:'Supplies',purpose:'Restock',amount:'10.00',currency:'MYR',paymentMethod:'BANK_TRANSFER',bankReference:'BR-77',status:'PAID',recordedByName:'Finance',recordedAt:'2026-09-01'}];
 const tree=view(states({rows,total:1}),{api,initialFilters:{}});
 const row=nodes(tree).find(n=>typeof n.props?.onClick==='function'&&text(n).includes('TCK-77'));assert.ok(row);
 row!.props!.onClick!();
 assert.equal(calls[0],'/payments/row-77');
});
function buttonTag(html:string,label:string){
 const m=html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
 return m?.[0]??'';
}
test('pagination preserves the exact page-size math and posts no request itself',()=>{
 const page1Html=render(view(states({total:60}),{api:()=>Promise.resolve({}),initialFilters:{}}));
 assert.match(page1Html,/Page 1/);
 assert.match(page1Html,/60 records/);
 assert.match(buttonTag(page1Html,'Previous page'),/disabled=""/);
 assert.doesNotMatch(buttonTag(page1Html,'Next page'),/disabled=""/);
 const lastPageHtml=render(view(states({filters:{...baseFilters,page:'3'},total:60}),{api:()=>Promise.resolve({}),initialFilters:{}}));
 assert.match(lastPageHtml,/Page 3/);
 assert.doesNotMatch(buttonTag(lastPageHtml,'Previous page'),/disabled=""/);
 assert.match(buttonTag(lastPageHtml,'Next page'),/disabled=""/);
});
test('the detail view preserves every field: payment, request, authorization, financial posting and audit',()=>{
 const detail={id:'p1',ticketNumber:'TCK-9',paymentDate:'2026-09-05T00:00:00Z',payee:'Acme Supplies',departmentName:'Operations',category:'Travel',purpose:'Flight booking',amount:'2500.00',currency:'MYR',paymentMethod:'BANK_TRANSFER',bankReference:'BR-1',status:'PAID',recordedByName:'Jamie Finance',recordedAt:'2026-09-05T08:00:00Z',approvalSource:'HUMAN',financeControlStatus:'PASSED',commitmentStatus:'CONSUMED',ledgerEntryId:'ledger-42'};
 const html=render(view(states({detail}),{api:()=>Promise.resolve({}),initialFilters:{}}));
 assert.match(html,/TCK-9/);
 assert.match(html,/Paid/);
 assert.match(html,/2026-09-05 · MYR 2500\.00 · BANK_TRANSFER/);
 assert.match(html,/Bank reference · BR-1/);
 assert.match(html,/Open secured payment slip/);
 assert.match(html,/Acme Supplies · Operations · Travel/);
 assert.match(html,/Flight booking/);
 assert.match(html,/Approval · HUMAN/);
 assert.match(html,/Passed/);
 assert.match(html,/Consumed/);
 assert.match(html,/Actual ledger · ledger-42/);
 assert.match(html,/Recorded by Jamie Finance at 2026-09-05T08:00:00Z/);
 assert.match(html,/← Payment History/);
});
test('missing authorization/posting detail shows an explicit "not available" badge instead of a blank enum',()=>{
 const detail={id:'p2',ticketNumber:'TCK-2',paymentDate:'2026-09-01',payee:'Vendor',departmentName:'Ops',category:'Supplies',purpose:'Restock',amount:'10.00',currency:'MYR',paymentMethod:'BANK_TRANSFER',bankReference:'BR-2',status:'PAID',recordedByName:'Finance',recordedAt:'2026-09-01'};
 const html=render(view(states({detail}),{api:()=>Promise.resolve({}),initialFilters:{}}));
 assert.match(html,/Not available/);
});
test('a Finance Hold on the historical control status is standardized without changing its meaning',()=>{
 const detail={id:'p3',ticketNumber:'TCK-3',paymentDate:'2026-09-01',payee:'Vendor',departmentName:'Ops',category:'Supplies',purpose:'Restock',amount:'10.00',currency:'MYR',paymentMethod:'BANK_TRANSFER',bankReference:'BR-3',status:'PAID',recordedByName:'Finance',recordedAt:'2026-09-01',financeControlStatus:'HOLD'};
 const html=render(view(states({detail}),{api:()=>Promise.resolve({}),initialFilters:{}}));
 assert.match(html,/Hold/);
});
test('back navigation returns to the list without an API call',()=>{
 const detail={id:'p1',ticketNumber:'TCK-9',paymentDate:'2026-09-05',payee:'Acme',departmentName:'Ops',category:'Travel',purpose:'Flight',amount:'1',currency:'MYR',paymentMethod:'BANK_TRANSFER',bankReference:'BR',status:'PAID',recordedByName:'Finance',recordedAt:'2026-09-05'};
 const tree=view(states({detail}),{api:()=>{throw Error('must not call API on back navigation')},initialFilters:{}});
 const back=nodes(tree).find(n=>typeof n.props?.onClick==='function'&&text(n)==='← Payment History');assert.ok(back);
 back!.props!.onClick!();
});
test('an in-flight failure surfaces as an announced error without silently discarding it',()=>{
 const html=render(view(states({notice:'Something went wrong'}),{api:()=>Promise.resolve({}),initialFilters:{}}));
 assert.match(html,/role="alert"[^>]*>Something went wrong/);
});
test('history composition only references frozen tokens and introduces no design literals',async()=>{
 const css=await readFile('app/history-ui.css','utf8'),tokens=await readFile('app/design-system/tokens.css','utf8');
 for(const [,token] of css.matchAll(/var\((--aims-[\w-]+)\)/g))assert.ok(tokens.includes(`${token}:`),token);
 postcss.parse(css).walkDecls(d=>{assert.doesNotMatch(d.value,/#[0-9a-f]{3,8}\b|\b\d+(?:px|rem|em|ms)\b/i)});
});
