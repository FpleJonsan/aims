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
const names=['PolicyDecisionPanel','policyResultBadge','policyFreshnessBadge','policyFlagBadge','policyExceptionStatusBadge','msg'];
const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast));
assert.equal(declarations.length,names.length,'expected every named declaration to be found in app/page.tsx');
const imports=source.split('\n').find(line=>line.includes('UIProvider as UiProvider'))!.replace('"./components/ui"','"./app/components/ui/components"');
const require=createRequire(import.meta.url);
// Snapshot-driven useState (order: data, loading, notice, justification, busy) mirroring the
// validation migration test harness; useEffect and useCallback are inert for static markup.
const output=await build({stdin:{contents:`${imports}
let snapshot:unknown[]=[],cursor=0;
const useState=(initial:unknown)=>[cursor in snapshot?snapshot[cursor++]:(cursor++,initial),()=>{}];
const useEffect=()=>{};
const useCallback=(fn:unknown)=>fn;
${declarations.join('\n')}
export function view(states:unknown[],props:Record<string,unknown>){snapshot=states;cursor=0;return PolicyDecisionPanel(props as never);}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {view}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const item={id:'req-1',status:'VALIDATING'};
type Node={props?:{children?:unknown;onClick?:()=>void;onChange?:(event:{target:{value:string}})=>void;id?:string}};
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];const node=tree as Node;return [node,...nodes(node.props?.children)];}
function text(tree:unknown):string{if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='object')return text((tree as Node).props?.children);return String(tree);}
const states=(overrides:Record<string,unknown> = {})=>{
 const base:Record<string,unknown>={data:null,loading:false,notice:'',justification:'',busy:false};
 const merged={...base,...overrides};
 return [merged.data,merged.loading,merged.notice,merged.justification,merged.busy];
};
test('loading state shows a named status and hides both the evaluate action and the empty state',()=>{
 const html=render(view(states({loading:true}),{item,user:'demo.finance',api:()=>{throw Error('must not call API while loading')},completed:async()=>{}}));
 assert.match(html,/role="status" aria-label="Loading policy evaluation…"/);
 assert.doesNotMatch(html,/Evaluate active policy/);
 assert.doesNotMatch(html,/has not been evaluated/);
});
test('not-evaluated outcome badge and Evaluate active policy trigger the exact same POST as before migration',()=>{
 const calls:Array<[string,unknown]>=[];
 const tree=view(states(),{item,user:'demo.finance',api:(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})},completed:async()=>{}});
 const html=render(tree);
 assert.match(html,/Not evaluated/);
 const button=nodes(tree).find(n=>text(n)==='Evaluate active policy');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/policy-evaluation');
 assert.deepEqual(calls[0][1],{method:'POST',body:'{}'});
});
test('a non-finance viewer sees the empty state instead of an action they cannot take',()=>{
 const html=render(view(states(),{item,user:'demo.requester',api:()=>Promise.resolve({}),completed:async()=>{}}));
 assert.match(html,/Policy has not been evaluated yet/);
 assert.doesNotMatch(html,/Evaluate active policy/);
});
test('policy summary, approval requirements and matched rule count are preserved and standardized',()=>{
 const data={id:'d1',result:'PASS',policy_code:'PLC-STANDARD',policy_version:3,matched_rule_ids:['r1','r2'],approval_required:true,approval_plan:[{sequence:1,requiredRole:'FINANCE_LEAD',authorityScope:'DEPARTMENT',reason:'Amount exceeds department threshold'}],required_evidence:['INVOICE'],escalation:'Escalate to Finance Director after 3 business days',auto_approval_eligible:false,ready_for_approval:true,stale:false};
 const html=render(view(states({data}),{item,user:'demo.finance',api:()=>Promise.resolve({}),completed:async()=>{}}));
 assert.match(html,/PLC-STANDARD/);assert.match(html,/v3/);
 assert.match(html,/Current/);
 assert.match(html,/Matched rules: 2/);
 assert.match(html,/Approval required/);assert.match(html,/Auto-approval eligible/);assert.match(html,/Ready for Approval/);
 assert.match(html,/APPROVAL PLAN/);
 assert.match(html,/FINANCE_LEAD/);assert.match(html,/DEPARTMENT/);assert.match(html,/Amount exceeds department threshold/);
 assert.match(html,/Required evidence:.*INVOICE/);
 assert.match(html,/Escalate to Finance Director after 3 business days/);
 assert.match(html,/System Policy complete · ready to create the controlled Approval\s*\n?\s*case\./);
});
test('a stale evaluation and a policy with no approval plan or evidence render without inventing content',()=>{
 const data={id:'d2',result:'PASS',matched_rule_ids:[],approval_required:false,approval_plan:[],required_evidence:[],auto_approval_eligible:true,ready_for_approval:false,stale:true};
 const html=render(view(states({data}),{item,user:'demo.finance',api:()=>Promise.resolve({}),completed:async()=>{}}));
 assert.match(html,/No applicable policy/);
 assert.match(html,/Stale/);
 assert.match(html,/Matched rules: 0/);
 assert.doesNotMatch(html,/APPROVAL PLAN/);
 assert.doesNotMatch(html,/Required evidence/);
 assert.doesNotMatch(html,/ready to create the controlled Approval/);
});
test('a policy exception preserves the exact code, reason, and required justification, and posts the response unchanged',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})};
 const data={id:'d3',result:'JUSTIFICATION_REQUIRED',matched_rule_ids:['r3'],approval_required:false,approval_plan:[],required_evidence:[],auto_approval_eligible:false,ready_for_approval:false,stale:false,exception_id:'exc-1',exception_code:'HIGH_RISK_VENDOR',exception_reason:'Vendor flagged for enhanced due diligence.',required_justification:'Written approval from department head',requested_role:'FINANCE',exception_status:'OPEN'};
 const tree=view(states({data,justification:'Reviewed and approved by department head, see attached memo.'}),{item,user:'demo.finance',api,completed:async()=>{}});
 const html=render(tree);
 assert.match(html,/HIGH RISK VENDOR/);
 assert.match(html,/Vendor flagged for enhanced due diligence\./);
 assert.match(html,/Required from FINANCE: Written approval from department head/);
 assert.match(html,/Awaiting justification/);
 assert.match(html,/for="policy-justification"/);
 const submit=nodes(tree).find(n=>text(n)==='Submit justification');assert.ok(submit);submit!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/policy-clarifications/exc-1/respond');
 assert.deepEqual(JSON.parse((calls[0][1] as {body:string}).body),{justification:'Reviewed and approved by department head, see attached memo.'});
});
test('a justified exception hides the response form and offers re-evaluation to Finance only',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})};
 const data={id:'d4',result:'JUSTIFICATION_REQUIRED',matched_rule_ids:[],approval_required:false,approval_plan:[],required_evidence:[],auto_approval_eligible:false,ready_for_approval:false,stale:false,exception_code:'HIGH_RISK_VENDOR',exception_reason:'Vendor flagged.',exception_status:'JUSTIFIED'};
 const financeTree=view(states({data}),{item,user:'demo.finance',api,completed:async()=>{}});
 const financeHtml=render(financeTree);
 assert.doesNotMatch(financeHtml,/for="policy-justification"/);
 assert.match(financeHtml,/Justified/);
 const reEvaluate=nodes(financeTree).find(n=>text(n)==='Re-evaluate policy');assert.ok(reEvaluate);
 reEvaluate!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/policy-evaluation');
 const requesterHtml=render(view(states({data}),{item,user:'demo.requester',api,completed:async()=>{}}));
 assert.doesNotMatch(requesterHtml,/Re-evaluate policy/);
});
test('busy state disables the pending action without changing its label',()=>{
 const busyHtml=render(view(states({busy:true}),{item,user:'demo.finance',api:()=>Promise.resolve({}),completed:async()=>{}}));
 assert.match(busyHtml,/aria-busy="true"/);
 assert.match(busyHtml,/disabled=""/);
 assert.match(busyHtml,/Evaluate active policy/);
});
test('an in-flight failure surfaces as an announced error without silently discarding it',()=>{
 const html=render(view(states({notice:'Something went wrong'}),{item,user:'demo.finance',api:()=>Promise.resolve({}),completed:async()=>{}}));
 assert.match(html,/role="alert"[^>]*>Something went wrong/);
});
test('policy composition only references frozen tokens and introduces no design literals',async()=>{
 const css=await readFile('app/policy-ui.css','utf8'),tokens=await readFile('app/design-system/tokens.css','utf8');
 for(const [,token] of css.matchAll(/var\((--aims-[\w-]+)\)/g))assert.ok(tokens.includes(`${token}:`),token);
 postcss.parse(css).walkDecls(d=>{assert.doesNotMatch(d.value,/#[0-9a-f]{3,8}\b|\b\d+(?:px|rem|em|ms)\b/i)});
});
