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
const names=['FinanceContextPanel','financeContextStatusChip','financeExceptionBadge','currencyLabel','msg'];
const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast));
assert.equal(declarations.length,names.length,'expected every named declaration to be found in app/page.tsx');
const imports=source.split('\n').find(line=>line.includes('UIProvider as UiProvider'))!.replace('"./components/ui"','"./app/components/ui/components"');
const require=createRequire(import.meta.url);
// Snapshot-driven useState (order: data, loading, notice, busy) mirroring the prior migration test harnesses;
// useEffect is inert for static markup.
const output=await build({stdin:{contents:`${imports}
let snapshot:unknown[]=[],cursor=0;
const useState=(initial:unknown)=>[cursor in snapshot?snapshot[cursor++]:(cursor++,initial),()=>{}];
const useEffect=()=>{};
${declarations.join('\n')}
export function view(states:unknown[],props:Record<string,unknown>){snapshot=states;cursor=0;return FinanceContextPanel(props as never);}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {view}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const item={id:'req-1',status:'VALIDATING'};
type Node={props?:{children?:unknown;onClick?:()=>void;id?:string}};
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];const node=tree as Node;return [node,...nodes(node.props?.children)];}
function text(tree:unknown):string{if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='object')return text((tree as Node).props?.children);return String(tree);}
const states=(overrides:Record<string,unknown> = {})=>{
 const base:Record<string,unknown>={data:null,loading:false,notice:'',busy:false};
 const merged={...base,...overrides};
 return [merged.data,merged.loading,merged.notice,merged.busy];
};
test('loading state shows a named status and hides both the calculate action and the empty state',()=>{
 const html=render(view(states({loading:true}),{item,user:'demo.finance',api:()=>{throw Error('must not call API while loading')}}));
 assert.match(html,/role="status" aria-label="Loading Finance Context…"/);
 assert.doesNotMatch(html,/Calculate Finance Context/);
 assert.doesNotMatch(html,/has not been calculated/);
});
test('Calculate Finance Context triggers the exact same POST as before migration',()=>{
 const calls:Array<[string,unknown]>=[];
 const tree=view(states(),{item,user:'demo.finance',api:(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})}});
 const button=nodes(tree).find(n=>text(n)==='Calculate Finance Context');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/finance-context');
 assert.deepEqual(calls[0][1],{method:'POST',body:'{}'});
});
test('a non-finance viewer sees the empty state instead of an action they cannot take',()=>{
 const html=render(view(states(),{item,user:'demo.requester',api:()=>Promise.resolve({})}));
 assert.match(html,/Finance Context has not been calculated/);
 assert.doesNotMatch(html,/Calculate Finance Context/);
});
test('a completed calculation preserves every budget figure, status, fiscal year and category unchanged',()=>{
 const data={
  status:'COMPLETED',fiscalYear:2026,category:'Operations',requestCurrency:'MYR',
  originalBudget:{minor:'12100000',decimal:'121,000.00'},
  revisedBudget:{minor:'12100000',decimal:'121,000.00'},
  actual:{minor:'2000000',decimal:'20,000.00'},
  committed:{minor:'500000',decimal:'5,000.00'},
  available:{minor:'9600000',decimal:'96,000.00'},
  requestAmount:{minor:'25000',decimal:'250.00'},
  projectedAvailable:{minor:'9350000',decimal:'93,500.00'},
  readyForFinancialRiskAnalysis:true,
 };
 const html=render(view(states({data}),{item,user:'demo.finance',api:()=>Promise.resolve({})}));
 assert.match(html,/Fiscal year 2026/);assert.match(html,/Operations/);
 assert.match(html,/Completed/);
 for(const [label,value] of [['Original budget','121,000.00'],['Revised budget','121,000.00'],['Actual spending','20,000.00'],['Active commitments','5,000.00'],['Available budget','96,000.00'],['Current request','250.00'],['Projected available','93,500.00']]){
  assert.ok(html.includes(label),label);assert.ok(html.includes(`MYR ${value}`),value);
 }
 assert.match(html,/AVAILABLE = REVISED − ACTUAL − ACTIVE COMMITMENTS/);
 assert.match(html,/Finance Context complete · Ready for Day 4 Financial Risk\s*\n?\s*Analysis\. No automatic transition was performed\./);
});
test('an exception preserves the exact code and message, and Recalculate posts the identical request',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})};
 const data={status:'EXCEPTION',exceptionCode:'STALE_VALIDATION',category:'Operations',requestCurrency:'MYR',requestAmount:{minor:'25000',decimal:'250.00'},readyForFinancialRiskAnalysis:false};
 const tree=view(states({data}),{item,user:'demo.finance',api});
 const html=render(tree);
 assert.match(html,/Finance Context exception/);
 assert.match(html,/Stale validation/);
 assert.match(html,/Finance attention is required before Stage 5\./);
 assert.doesNotMatch(html,/Original budget/);
 const button=nodes(tree).find(n=>text(n)==='Recalculate after correction');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/finance-context/recalculate');
 assert.deepEqual(calls[0][1],{method:'POST',body:'{}'});
});
test('a non-finance viewer never sees the recalculate action for an open exception',()=>{
 const data={status:'EXCEPTION',exceptionCode:'MISSING_APPLICABLE_BUDGET',category:'Operations',requestCurrency:'MYR',requestAmount:{minor:'25000',decimal:'250.00'},readyForFinancialRiskAnalysis:false};
 const html=render(view(states({data}),{item,user:'demo.requester',api:()=>Promise.resolve({})}));
 assert.match(html,/No applicable budget/);
 assert.doesNotMatch(html,/Recalculate after correction/);
});
test('every documented exception code maps to a readable label instead of a raw enum',()=>{
 const codes=['MISSING_APPLICABLE_BUDGET','INACTIVE_BUDGET','AMBIGUOUS_BUDGET_MAPPING','CURRENCY_CONTEXT_UNSUPPORTED','STALE_VALIDATION','INVALID_REQUEST_AMOUNT','INCONSISTENT_BUDGET_DATA'];
 for(const code of codes){
  const data={status:'EXCEPTION',exceptionCode:code,category:'Operations',requestCurrency:'MYR',requestAmount:{minor:'0',decimal:'0.00'},readyForFinancialRiskAnalysis:false};
  const html=render(view(states({data}),{item,user:'demo.finance',api:()=>Promise.resolve({})}));
  assert.doesNotMatch(html,new RegExp(code.replaceAll('_',' ')),code);
  assert.doesNotMatch(html,new RegExp(code),code);
 }
});
test('busy state disables the pending action without changing its label',()=>{
 const busyHtml=render(view(states({busy:true}),{item,user:'demo.finance',api:()=>Promise.resolve({})}));
 assert.match(busyHtml,/aria-busy="true"/);
 assert.match(busyHtml,/disabled=""/);
 assert.match(busyHtml,/Calculate Finance Context/);
});
test('an in-flight failure surfaces as an announced error without silently discarding it',()=>{
 const html=render(view(states({notice:'Something went wrong'}),{item,user:'demo.finance',api:()=>Promise.resolve({})}));
 assert.match(html,/role="alert"[^>]*>Something went wrong/);
});
test('finance context composition only references frozen tokens and introduces no design literals',async()=>{
 const css=await readFile('app/finance-context-ui.css','utf8'),tokens=await readFile('app/design-system/tokens.css','utf8');
 for(const [,token] of css.matchAll(/var\((--aims-[\w-]+)\)/g))assert.ok(tokens.includes(`${token}:`),token);
 postcss.parse(css).walkDecls(d=>{assert.doesNotMatch(d.value,/#[0-9a-f]{3,8}\b|\b\d+(?:px|rem|em|ms)\b/i)});
});
