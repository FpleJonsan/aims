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
const names=['ApprovalPanel','approvalStatusChip','approvalStepBadge','approvalCommitmentBadge','approvalRiskBadge','approvalPriorityBadge','approvalSourceLabel','approvalActionLabel','approvalChannelLabel','policyResultBadge','msg'];
const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast));
assert.equal(declarations.length,names.length,'expected every named declaration to be found in app/page.tsx');
const imports=source.split('\n').find(line=>line.includes('UIProvider as UiProvider'))!.replace('"./components/ui"','"./app/components/ui/components"');
const helpers=source.split('\n').find(line=>line.includes('import {policyReadyForApproval}'))!.replace('"./lib/policy-ready"','"./app/lib/policy-ready"');
const require=createRequire(import.meta.url);
// Snapshot-driven useState (order: policy, data, loading, notice, reason, busy) mirroring the
// validation/policy migration test harnesses; useEffect and useCallback are inert for static markup.
const output=await build({stdin:{contents:`${imports}
${helpers}
let snapshot:unknown[]=[],cursor=0;
const useState=(initial:unknown)=>[cursor in snapshot?snapshot[cursor++]:(cursor++,initial),()=>{}];
const useEffect=()=>{};
const useCallback=(fn:unknown)=>fn;
${declarations.join('\n')}
export function view(states:unknown[],props:Record<string,unknown>){snapshot=states;cursor=0;return ApprovalPanel(props as never);}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {view}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const item={id:'req-1',status:'PENDING_APPROVAL'};
type Node={props?:{children?:unknown;onClick?:()=>void;onChange?:(event:{target:{value:string}})=>void;id?:string}};
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];const node=tree as Node;return [node,...nodes(node.props?.children)];}
function text(tree:unknown):string{if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='object')return text((tree as Node).props?.children);return String(tree);}
const states=(overrides:Record<string,unknown> = {})=>{
 const base:Record<string,unknown>={policy:{ready_for_approval:true,stale:false},data:null,loading:false,notice:'',reason:'',busy:false};
 const merged={...base,...overrides};
 return [merged.policy,merged.data,merged.loading,merged.notice,merged.reason,merged.busy];
};
test('loading state shows a named status and hides both the create action and the empty state',()=>{
 const html=render(view(states({loading:true}),{item,user:'demo.finance',api:()=>{throw Error('must not call API while loading')},changed:async()=>{}}));
 assert.match(html,/role="status" aria-label="Loading approval…"/);
 assert.doesNotMatch(html,/Create Approval case/);
 assert.doesNotMatch(html,/has not started yet/);
});
test('not-started outcome badge, and Create Approval case triggers the exact same POST as before migration',()=>{
 const calls:Array<[string,unknown]>=[];
 const tree=view(states(),{item,user:'demo.finance',api:(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})},changed:async()=>{}});
 const html=render(tree);
 assert.match(html,/Not started/);
 const button=nodes(tree).find(n=>text(n)==='Create Approval case');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/approval');
 assert.deepEqual(calls[0][1],{method:'POST',body:'{}'});
});
test('when policy is not yet ready, the empty state replaces the action instead of showing nothing',()=>{
 const html=render(view(states({policy:{ready_for_approval:false}}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Approval has not started yet/);
 assert.doesNotMatch(html,/Create Approval case/);
});
test('a non-finance viewer never sees the create action even when policy is ready',()=>{
 const html=render(view(states(),{item,user:'demo.approver',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Approval has not started yet/);
 assert.doesNotMatch(html,/Create Approval case/);
});
test('case metadata, decision context, evidence and the sequential route are preserved and standardized',()=>{
 const data={
  case:{id:'c1',status:'PENDING',policy_decision_run_id:'pd-1',source:'HUMAN'},
  steps:[
   {id:'s1',sequence:1,required_role:'FINANCE_LEAD',authority_scope:'DEPARTMENT',reason:'Amount exceeds department threshold',status:'APPROVED'},
   {id:'s2',sequence:2,required_role:'FINANCE_DIRECTOR',authority_scope:'ORGANIZATION',reason:'Escalation required',status:'ACTIVE'},
  ],
  readyForFinanceControl:false,
  commitmentStatus:'ACTIVE',
  detail:{available_amount_minor:'500000',projected_available_amount_minor:'480000',ai_assessment:{summary:'ok'},final_risk:'HIGH',final_priority:'URGENT',policy_result:'PASS'},
  evidence:[{id:'e1',original_filename:'invoice.pdf',document_type:'INVOICE',version:1}],
  history:[{action:'APPROVE',channel:'WEB',required_role:'FINANCE_LEAD'}],
 };
 const html=render(view(states({data}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/pd-1/);
 assert.match(html,/Human/);
 assert.match(html,/Active/);
 assert.match(html,/Available: 500000/);assert.match(html,/Projected: 480000/);
 assert.match(html,/High/);assert.match(html,/Urgent/);
 assert.match(html,/invoice\.pdf/);assert.match(html,/INVOICE/);assert.match(html,/v1/);
 assert.match(html,/FINANCE_LEAD/);assert.match(html,/DEPARTMENT/);assert.match(html,/Amount exceeds department threshold/);
 assert.match(html,/FINANCE_DIRECTOR/);assert.match(html,/ORGANIZATION/);assert.match(html,/Escalation required/);
 assert.match(html,/Approved · Web · FINANCE_LEAD/);
});
test('an empty approval history shows the frozen empty state instead of an invented event',()=>{
 const data={case:{id:'c2',status:'PENDING',policy_decision_run_id:'pd-2',source:'HUMAN'},steps:[],readyForFinanceControl:false,evidence:[],history:[]};
 const html=render(view(states({data}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/No completed actions/);
});
test('the current approval step exposes Approve, Reject, and Request clarification, posting identical action payloads',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({})};
 const data={case:{id:'c3',status:'PENDING',policy_decision_run_id:'pd-3',source:'HUMAN'},steps:[{id:'step-1',sequence:1,required_role:'FINANCE_LEAD',authority_scope:'DEPARTMENT',reason:'Standard review',status:'ACTIVE'}],readyForFinanceControl:false,evidence:[],history:[]};
 const tree=view(states({data,reason:'Missing supporting documentation'}),{item,user:'demo.approver',api,changed:async()=>{}});
 const html=render(tree);
 assert.match(html,/Current approval step/);
 assert.match(html,/FINANCE_LEAD · Human decision/);
 assert.match(html,/for="approval-reason"/);
 const reject=nodes(tree).find(n=>text(n)==='Reject');assert.ok(reject);reject!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/approval/steps/step-1/actions');
 const rejectBody=JSON.parse((calls[0][1] as {body:string}).body);
 assert.equal(rejectBody.action,'REJECT');assert.equal(rejectBody.reason,'Missing supporting documentation');assert.equal(rejectBody.requiredResponse,undefined);
 const clarify=nodes(tree).find(n=>text(n)==='Request clarification');assert.ok(clarify);clarify!.props!.onClick!();
 const clarifyBody=JSON.parse((calls[1][1] as {body:string}).body);
 assert.equal(clarifyBody.action,'REQUEST_CLARIFICATION');
 assert.equal(clarifyBody.requiredResponse,'Provide the requested information; the request will return to Validation.');
 const approve=nodes(tree).find(n=>text(n)==='Approve');assert.ok(approve);approve!.props!.onClick!();
 const approveBody=JSON.parse((calls[2][1] as {body:string}).body);
 assert.equal(approveBody.action,'APPROVE');assert.equal(approveBody.reason,undefined);
});
test('the current approval step is hidden from non-approvers, and a non-active step shows no action form',()=>{
 const data={case:{id:'c4',status:'PENDING',policy_decision_run_id:'pd-4',source:'HUMAN'},steps:[{id:'step-2',sequence:1,required_role:'FINANCE_LEAD',authority_scope:'DEPARTMENT',reason:'Standard review',status:'WAITING'}],readyForFinanceControl:false,evidence:[],history:[]};
 const financeHtml=render(view(states({data}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.doesNotMatch(financeHtml,/Current approval step/);
 assert.match(financeHtml,/Waiting/);
});
test('a completed case with a REJECTED or CLARIFICATION outcome standardizes status without altering the decision',()=>{
 const rejected={case:{id:'c5',status:'REJECTED',policy_decision_run_id:'pd-5',source:'HUMAN'},steps:[],readyForFinanceControl:false,evidence:[],history:[{action:'REJECT',channel:'WEB',required_role:'FINANCE_LEAD'}]};
 const rejectedHtml=render(view(states({data:rejected}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(rejectedHtml,/Rejected · Web · FINANCE_LEAD/);
 const clarification={case:{id:'c6',status:'CLARIFICATION',policy_decision_run_id:'pd-6',source:'HUMAN'},steps:[],readyForFinanceControl:false,evidence:[],history:[]};
 const clarificationHtml=render(view(states({data:clarification}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(clarificationHtml,/Clarification requested/);
});
test('readiness for Finance Control shows the exact ready marker text unchanged',()=>{
 const data={case:{id:'c7',status:'APPROVED',policy_decision_run_id:'pd-7',source:'POLICY_AUTO_APPROVAL'},steps:[],readyForFinanceControl:true,evidence:[],history:[]};
 const html=render(view(states({data}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/Policy auto-approval/);
 assert.match(html,/Approval complete · ready for Final Finance Control\./);
});
test('busy state disables the pending action without changing its label',()=>{
 const busyHtml=render(view(states({busy:true}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(busyHtml,/aria-busy="true"/);
 assert.match(busyHtml,/disabled=""/);
 assert.match(busyHtml,/Create Approval case/);
});
test('an in-flight failure surfaces as an announced error without silently discarding it',()=>{
 const html=render(view(states({notice:'Something went wrong'}),{item,user:'demo.finance',api:()=>Promise.resolve({}),changed:async()=>{}}));
 assert.match(html,/role="alert"[^>]*>Something went wrong/);
});
test('approval composition only references frozen tokens and introduces no design literals',async()=>{
 const css=await readFile('app/approval-ui.css','utf8'),tokens=await readFile('app/design-system/tokens.css','utf8');
 for(const [,token] of css.matchAll(/var\((--aims-[\w-]+)\)/g))assert.ok(tokens.includes(`${token}:`),token);
 postcss.parse(css).walkDecls(d=>{assert.doesNotMatch(d.value,/#[0-9a-f]{3,8}\b|\b\d+(?:px|rem|em|ms)\b/i)});
});
