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
const names=['FinancialAnalysisPanel','financialAnalysisStatusChip','agentStatusChip','riskLevelBadge','priorityBadge','msg'];
const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast));
assert.equal(declarations.length,names.length,'expected every named declaration to be found in app/page.tsx');
const imports=source.split('\n').find(line=>line.includes('UIProvider as UiProvider'))!.replace('"./components/ui"','"./app/components/ui/components"');
const require=createRequire(import.meta.url);
// Snapshot-driven useState (order: data, loading, notice, risk, priority, busy) mirroring the prior
// migration test harnesses; useEffect is inert for static markup.
const output=await build({stdin:{contents:`${imports}
let snapshot:unknown[]=[],cursor=0;
const useState=(initial:unknown)=>[cursor in snapshot?snapshot[cursor++]:(cursor++,initial),()=>{}];
const useEffect=()=>{};
${declarations.join('\n')}
export function view(states:unknown[],props:Record<string,unknown>){snapshot=states;cursor=0;return FinancialAnalysisPanel(props as never);}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {view}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const item={id:'req-1',status:'VALIDATING'};
type Node={props?:{children?:unknown;onClick?:()=>void;id?:string}};
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];const node=tree as Node;return [node,...nodes(node.props?.children)];}
function text(tree:unknown):string{if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='object')return text((tree as Node).props?.children);return String(tree);}
const states=(overrides:Record<string,unknown> = {})=>{
 const base:Record<string,unknown>={data:null,loading:false,notice:'',risk:'MEDIUM',priority:'NORMAL',busy:false};
 const merged={...base,...overrides};
 return [merged.data,merged.loading,merged.notice,merged.risk,merged.priority,merged.busy];
};
test('loading state shows a named status and hides both the start action and the empty state',()=>{
 const html=render(view(states({loading:true}),{item,user:'demo.finance',api:()=>{throw Error('must not call API while loading')}}));
 assert.match(html,/role="status" aria-label="Loading Financial Risk Analysis…"/);
 assert.doesNotMatch(html,/Start AI-assisted analysis/);
 assert.doesNotMatch(html,/has not started yet/);
});
test('not-started outcome badge, and Start AI-assisted analysis triggers the exact same POST as before migration',()=>{
 const calls:Array<[string,unknown]>=[];
 const tree=view(states(),{item,user:'demo.finance',api:(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({id:'run-1',source:'AI_ASSISTED',status:'PROCESSING',agents:[],readyForPolicyEvaluation:false})}});
 const html=render(tree);
 assert.match(html,/Not started/);
 const button=nodes(tree).find(n=>text(n)==='Start AI-assisted analysis');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/financial-analysis');
 assert.deepEqual(calls[0][1],{method:'POST',body:'{}'});
});
test('a non-finance viewer sees the empty state instead of an action they cannot take',()=>{
 const html=render(view(states(),{item,user:'demo.requester',api:()=>Promise.resolve({})}));
 assert.match(html,/Financial Risk Analysis has not started yet/);
 assert.doesNotMatch(html,/Start AI-assisted analysis/);
});
test('Complete manually posts the exact same fixed assessment payload with the selected risk and priority',()=>{
 const calls:Array<[string,unknown]>=[];
 const api=(path:string,init:unknown)=>{calls.push([path,init]);return Promise.resolve({id:'run-2',source:'MANUAL',status:'AWAITING_HUMAN_REVIEW',agents:[],readyForPolicyEvaluation:false})};
 const tree=view(states({risk:'HIGH',priority:'URGENT'}),{item,user:'demo.finance',api});
 const button=nodes(tree).find(n=>text(n)==='Complete manually');assert.ok(button);
 button!.props!.onClick!();
 assert.equal(calls[0][0],'/payment-requests/req-1/financial-analysis/manual');
 const body=JSON.parse((calls[0][1] as {body:string}).body);
 assert.equal(body.riskLevel,'HIGH');assert.equal(body.priority,'URGENT');assert.equal(body.urgency,'URGENT');
 assert.deepEqual(body.riskFlags,[]);
 assert.equal(body.financialAssessment,'Finance Context reviewed by Finance.');
 assert.equal(body.spendingAssessment,'Authoritative historical metrics reviewed.');
 assert.equal(body.complianceRemarks,'Current Validation and evidence reviewed.');
 assert.deepEqual(body.evidenceReferences,[{source:'FINANCE_CONTEXT',reference:'current Finance Context snapshot',field:'projected_available_amount_minor'}]);
 assert.equal(body.remarks,'Manual financial assessment');
});
test('each AI agent result is preserved verbatim with a standardized status and evidence count',()=>{
 const data={
  id:'run-3',source:'AI_ASSISTED',status:'AWAITING_HUMAN_REVIEW',
  agents:[
   {agent:'FINANCIAL_RISK',status:'COMPLETED',result:{summary:'Amount is within normal range for this department.',confidence:0.91,findings:[{code:'A',explanation:'x',evidenceReferences:[1]}]}},
   {agent:'SPENDING_PATTERN',status:'COMPLETED',result:{summary:'No unusual spending pattern detected.',confidence:0.8,findings:[]}},
   {agent:'COMPLIANCE',status:'FAILED',failure_code:'PROVIDER_TIMEOUT'},
  ],
  readyForPolicyEvaluation:false,
 };
 const html=render(view(states({data}),{item,user:'demo.finance',api:()=>Promise.resolve({})}));
 assert.match(html,/FINANCIAL RISK/);assert.match(html,/Amount is within normal range for this department\./);assert.match(html,/1 evidence-backed finding\(s\)/);
 assert.match(html,/SPENDING PATTERN/);assert.match(html,/No unusual spending pattern detected\./);assert.match(html,/0 evidence-backed finding\(s\)/);
 assert.match(html,/COMPLIANCE/);assert.match(html,/AI assistance unavailable\./);
 assert.match(html,/Completed/);assert.match(html,/Failed/);
});
test('the AI recommendation and human final assessment render as visually distinct cards, never merged',()=>{
 const data={
  id:'run-4',source:'AI_ASSISTED',status:'FINALIZED',
  ai_assessment:{riskLevel:'HIGH',priority:'URGENT',summary:'Elevated risk due to vendor history.',disagreements:['SPENDING_PATTERN flagged an anomaly COMPLIANCE did not.']},
  final_risk:'MEDIUM',final_priority:'NORMAL',
  agents:[],
  readyForPolicyEvaluation:true,
 };
 const html=render(view(states({data}),{item,user:'demo.finance',api:()=>Promise.resolve({})}));
 assert.match(html,/AI RECOMMENDATION/);
 assert.match(html,/Elevated risk due to vendor history\./);
 assert.match(html,/Disagreement: SPENDING_PATTERN flagged an anomaly COMPLIANCE did not\./);
 assert.match(html,/HUMAN FINAL ASSESSMENT/);
 const aiIndex=html.indexOf('AI RECOMMENDATION'),humanIndex=html.indexOf('HUMAN FINAL ASSESSMENT');
 assert.ok(aiIndex>=0&&humanIndex>aiIndex);
 const betweenCardsBoundary=html.indexOf('aims-card',html.indexOf('aims-card',aiIndex)+1);
 assert.ok(betweenCardsBoundary>0&&betweenCardsBoundary<humanIndex,'AI and human sections must be in separate Card elements');
 assert.match(html,/Financial Risk Analysis finalized · Ready for Day 5 Policy\s*\n?\s*Evaluation\. No automatic transition was performed\./);
});
test('busy state disables the pending actions without changing their labels',()=>{
 const busyHtml=render(view(states({busy:true}),{item,user:'demo.finance',api:()=>Promise.resolve({})}));
 assert.match(busyHtml,/aria-busy="true"/);
 assert.match(busyHtml,/disabled=""/);
 assert.match(busyHtml,/Start AI-assisted analysis/);
 assert.match(busyHtml,/Complete manually/);
});
test('an in-flight failure surfaces as an announced error without silently discarding it',()=>{
 const html=render(view(states({notice:'Something went wrong'}),{item,user:'demo.finance',api:()=>Promise.resolve({})}));
 assert.match(html,/role="alert"[^>]*>Something went wrong/);
});
test('AI-unavailable and AI-disabled fallback notices are preserved verbatim',()=>{
 const disabledHtml=render(view(states({notice:'AI Assistance: Disabled · Complete the manual assessment.'}),{item,user:'demo.finance',api:()=>Promise.resolve({})}));
 assert.match(disabledHtml,/AI Assistance: Disabled · Complete the manual assessment\./);
 const unavailableHtml=render(view(states({notice:'AI assistance unavailable · Continue manually.'}),{item,user:'demo.finance',api:()=>Promise.resolve({})}));
 assert.match(unavailableHtml,/AI assistance unavailable · Continue manually\./);
});
test('financial analysis composition only references frozen tokens and introduces no design literals',async()=>{
 const css=await readFile('app/financial-analysis-ui.css','utf8'),tokens=await readFile('app/design-system/tokens.css','utf8');
 for(const [,token] of css.matchAll(/var\((--aims-[\w-]+)\)/g))assert.ok(tokens.includes(`${token}:`),token);
 postcss.parse(css).walkDecls(d=>{assert.doesNotMatch(d.value,/#[0-9a-f]{3,8}\b|\b\d+(?:px|rem|em|ms)\b/i)});
});
