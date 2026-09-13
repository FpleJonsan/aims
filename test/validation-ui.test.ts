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
const names=['ValidationPanel','validationSourceBadge','validationRunStatusChip','validationOutcomeBadge','validationCheckStatusBadge','validationSeverityBadge','msg'];
const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast));
assert.equal(declarations.length,names.length,'expected every named declaration to be found in app/page.tsx');
const imports=source.split('\n').find(line=>line.includes('UIProvider as UiProvider'))!.replace('"./components/ui"','"./app/components/ui/components"');
const require=createRequire(import.meta.url);
// Snapshot-driven useState (order: data, loading, remarks, response, notice, busy) mirroring the
// dashboard/request migration test harnesses; useEffect and useCallback are inert for static markup.
const output=await build({stdin:{contents:`${imports}
let snapshot:unknown[]=[],cursor=0;
const useState=(initial:unknown)=>[cursor in snapshot?snapshot[cursor++]:(cursor++,initial),()=>{}];
const useEffect=()=>{};
const useCallback=(fn:unknown)=>fn;
${declarations.join('\n')}
export function view(states:unknown[],props:Record<string,unknown>){snapshot=states;cursor=0;return ValidationPanel(props as never);}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {view}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const item={id:'req-1',status:'VALIDATING'};
type Node={props?:{children?:unknown;onClick?:()=>void;onChange?:(event:{target:{value:string}})=>void;id?:string}};
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];const node=tree as Node;return [node,...nodes(node.props?.children)];}
function text(tree:unknown):string{if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='object')return text((tree as Node).props?.children);return String(tree);}
const states=(overrides:Record<string,unknown> = {})=>{
 const base:Record<string,unknown>={data:{},loading:false,remarks:'',response:'',notice:'',busy:false};
 const merged={...base,...overrides};
 return [merged.data,merged.loading,merged.remarks,merged.response,merged.notice,merged.busy];
};
test('loading state shows a named status and hides the not-yet-available start action',()=>{
 const html=render(view(states({loading:true}),{item:{...item,status:'SUBMITTED'},user:'demo.finance',api:()=>{throw Error('must not call API while loading')},changed:async()=>{}}));
 assert.match(html,/role="status" aria-label="Loading validation…"/);
 assert.doesNotMatch(html,/Start validation/);
});
test('not-started outcome badge and Start validation trigger the exact same POST as before migration',()=>{
 const calls:Array<[string,unknown]>=[];
 const tree=view(states(),{item:{...item,status:'SUBMITTED'},user:'demo.finance',api:(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})},changed:async()=>{}});
 const html=render(tree);
 assert.match(html,/Not started/);
 const button=nodes(tree).find(n=>text(n)==='Start validation');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/validation');
 assert.deepEqual(calls[0][1],{method:'POST',body:'{}'});
});
test('validation findings remain readable with standardized check-status, severity, and evidence counts',()=>{
 const findings=[
  {id:'f1',code:'AMOUNT_MISMATCH',check_status:'FAIL',severity:'HIGH',explanation:'Amount does not match the invoice.',evidence:[{a:1}]},
  {id:'f2',code:'EXTRACTION_UNCERTAIN',check_status:'WARNING',severity:'MEDIUM',explanation:'Low OCR confidence on due date.',evidence:[{a:1},{b:2}]},
  {id:'f3',code:'MISSING_DOCUMENT',check_status:'UNKNOWN',severity:'LOW',explanation:'No supporting document was found.',evidence:[{a:1}]},
  {id:'f4',code:'PAYEE_MISMATCH',check_status:'PASS',severity:'LOW',explanation:'Payee reconciled.',evidence:[{a:1}]},
 ];
 const html=render(view(states({data:{findings}}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Validation findings/);
 for(const finding of findings)for(const text of [finding.code,finding.explanation,`${finding.evidence.length} evidence reference`])assert.ok(html.includes(text),text);
 assert.match(html,/Fail/);assert.match(html,/Warning/);assert.match(html,/Unknown/);
 assert.match(html,/High/);assert.match(html,/Medium/);assert.match(html,/Low/);
});
test('extracted document information preserves every disclosed fact including nulls and structured evidence',()=>{
 const extractions=[{id:'e1',extraction:{payee:'Acme Supplies',invoiceDate:null,amount:{structured:true}}}];
 const html=render(view(states({data:{extractions}}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/EXTRACTED INFORMATION/);
 assert.match(html,/Acme Supplies/);
 assert.match(html,/Not found/);
 assert.match(html,/Structured evidence available/);
});
test('manual validator review posts the identical PASS and clarification payloads with entered remarks',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})};
 const tree=view(states({remarks:'Looks correct after manual review'}),{item:{...item,status:'VALIDATING'},user:'demo.finance',api,changed:async()=>{}});
 const html=render(tree);
 assert.match(html,/for="validation-remarks"/);
 assert.match(html,/Validation actions/);
 const pass=nodes(tree).find(n=>text(n)==='Confirm PASS');assert.ok(pass);pass!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/validation/manual');
 assert.deepEqual(JSON.parse((calls[0][1] as {body:string}).body),{overallResult:'PASS',remarks:'Looks correct after manual review',findings:[]});
 const clarify=nodes(tree).find(n=>text(n)==='Request clarification');assert.ok(clarify);clarify!.props!.onClick!();
 const secondBody=JSON.parse((calls[1][1] as {body:string}).body);
 assert.equal(secondBody.overallResult,'CLARIFICATION_REQUIRED');
 assert.equal(secondBody.requiredResponse,'Looks correct after manual review');
 assert.equal(secondBody.findings[0].explanation,'Looks correct after manual review');
});
test('requester clarification view shows the exact reason and required response, and responds with the typed value',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})};
 const clarifications=[{id:'c1',reason:'Invoice total does not match request amount',required_response:'Provide the corrected invoice or amend the amount',status:'OPEN'}];
 const tree=view(states({data:{clarifications},response:'Corrected invoice attached'}),{item:{...item,status:'NEEDS_CLARIFICATION'},user:'demo.requester',api,changed:async()=>{}});
 const html=render(tree);
 assert.match(html,/Clarification required/);
 assert.match(html,/Invoice total does not match request amount/);
 assert.match(html,/Provide the corrected invoice or amend the amount/);
 assert.match(html,/aria-labelledby="validation-clarification-title"/);
 assert.match(html,/id="validation-clarification-title"/);
 const respond=nodes(tree).find(n=>text(n)==='Respond and resubmit');assert.ok(respond);respond!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/clarifications/c1/respond');
 assert.deepEqual(JSON.parse((calls[0][1] as {body:string}).body),{response:'Corrected invoice attached'});
});
test('busy state disables the manual review actions without changing their labels',()=>{
 const busyHtml=render(view(states({busy:true}),{item:{...item,status:'VALIDATING'},user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(busyHtml,/aria-busy="true"/);
 assert.match(busyHtml,/disabled=""/);
 assert.match(busyHtml,/Confirm PASS/);
 assert.match(busyHtml,/Request clarification/);
});
test('a completed PASS outcome shows the exact ready marker text and hides manual review',()=>{
 const html=render(view(states({data:{current:{source:'MANUAL',status:'COMPLETED',overall_result:'PASS'}}}),{item:{...item,status:'VALIDATING'},user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Validation complete · Ready for Day 3 Finance Context\. No automatic\s*\n?\s*transition was performed\./);
 assert.doesNotMatch(html,/Confirm PASS/);
});
test('an in-flight failure surfaces as an announced error without silently discarding it',()=>{
 const html=render(view(states({notice:'Something went wrong'}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/role="alert"[^>]*>Something went wrong/);
});
test('validation composition only references frozen tokens and introduces no design literals',async()=>{
 const css=await readFile('app/validation-ui.css','utf8'),tokens=await readFile('app/design-system/tokens.css','utf8');
 for(const [,token] of css.matchAll(/var\((--aims-[\w-]+)\)/g))assert.ok(tokens.includes(`${token}:`),token);
 postcss.parse(css).walkDecls(d=>{assert.doesNotMatch(d.value,/#[0-9a-f]{3,8}\b|\b\d+(?:px|rem|em|ms)\b/i)});
});
