import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import ts from 'typescript';
const source=await readFile('app/page.tsx','utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const dashboard=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='FinanceDashboard')!;
const money=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='formatMoney')!;
const imports=source.split('\n').find(line=>line.includes('UIProvider as UiProvider'))!.replace('"./components/ui"','"./app/components/ui/components"');
const require=createRequire(import.meta.url);
// Exercise the real Dashboard JSX with controlled hook snapshots; no application export or runtime change.
const output=await build({stdin:{contents:`${imports}
import {financePath} from './app/lib/dashboard-navigation';
let snapshot=[],cursor=0; const useState=initial=>[cursor in snapshot?snapshot[cursor++]: (cursor++,initial),()=>{}];
const useEffect=()=>{}; const msg=error=>error.message;
${money.getText(ast)}
${dashboard.getText(ast)}
export function view(states,props){snapshot=states;cursor=0;return FinanceDashboard(props);}`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {view}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const summary={dataSnapshotAsOf:'2026-09-01T00:00:00Z',financialPositions:[],risk:{HIGH:2,CRITICAL:1},requests:{PENDING_APPROVAL:{count:4}},financeControl:{holds:5,ready:6},payments:{amounts:[]},vendors:[]};
const workflow={processed:7,avg_request_to_paid_seconds:7200,ai_validation:2,manual_validation:5,timeSaved:'BASELINE NOT CONFIGURED'};
const usage={calls:3,tokens:40,average_latency_ms:20,failures:0,estimatedCost:'COST NOT CONFIGURED'};
const props={api:()=>{throw Error('Rendering must not make API calls')},initialFilters:{category:'Travel'},onDrill:()=>{}};
const states=(s:Record<string,unknown>=summary)=>[s,[],[],workflow,usage,'','',null,null,{departments:[]}];
type ElementSnapshot={props?:{children?:unknown;onClick?:()=>void}};
function nodes(tree:unknown):ElementSnapshot[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];const node=tree as ElementSnapshot;return [node,...nodes(node.props?.children)];}
function text(tree:unknown):string {if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='object')return text((tree as ElementSnapshot).props?.children);return String(tree);}
test('Dashboard loading and error states retain accessible feedback',()=>{
 assert.match(renderToStaticMarkup(view([],props)),/role="status" aria-label="Loading authoritative finance data…"/);
 const error=[null,[],[],null,null,'Unavailable'];
 assert.match(renderToStaticMarkup(view(error,props)),/role="alert"[^>]*>Unavailable/);
});
test('empty Dashboard keeps metrics, labelled filters and disabled Ask',()=>{
 const html=renderToStaticMarkup(view(states(),props));
 for(const value of ['No financial position available','No payment records','No AI insights generated','High / critical risk','Pending approval','Finance holds','Ready for payment'])assert.ok(html.includes(value),value);
 assert.match(html,/disabled=""[^>]*class="aims-button aims-button-primary"/);
 for(const label of ['From','To','Department','Category'])assert.match(html,new RegExp(`<label[^>]+>${label}</label>`));
 assert.doesNotMatch(html,/class="(?:card|kpiCard|dashboardFilters|authorityBadge)\b/);
});
test('metric values and all existing card drill payloads are preserved',()=>{
 const commands:Record<string,unknown>[]=[];
 const tree=view(states(),{...props,onDrill:(command:Record<string,unknown>)=>commands.push(command)});
 const buttons=nodes(tree).filter(n=>n.props?.onClick);
 const expectations=[['High / critical risk','3',{view:'REPORTING_REQUESTS',reportView:'RISK_ATTENTION'}],['Pending approval','4',{view:'REPORTING_REQUESTS',reportView:'PENDING_APPROVAL'}],['Finance holds','5',{view:'FINANCE_CONTROL',status:'FINANCE_HOLD'}],['Ready for payment','6',{view:'PAYMENT_QUEUE',status:'READY_FOR_PAYMENT'}],['Paid this period','—',{view:'PAYMENT_HISTORY',filters:{category:'Travel',status:'PAID'}}]] as const;
 for(const [label,value,expected] of expectations){const button=buttons.find(n=>text(n).includes(label));assert.ok(button,label);assert.ok(text(button).includes(value));button.props!.onClick!();const command=commands.at(-1);for(const [key,v] of Object.entries(expected))assert.deepEqual(command![key],v);assert.equal((command!.filters as Record<string,string>).category,'Travel');}
});
test('populated financial positions preserve original currency values',()=>{
 const s={...summary,financialPositions:[{currency:'MYR',budget:'121000',actual:'20000',committed:'5000',available:'96000',utilisationBasisPoints:2066}]};
 const html=renderToStaticMarkup(view(states(s),props));
 for(const amount of ['121,000.00','20,000.00','5,000.00','96,000.00'])assert.ok(html.includes(`MYR ${amount}`));
 assert.match(html,/<h3[^>]*>MYR<\/h3>/);
});
test('new library usage is confined to approved Dashboard, Request, Validation, Policy, Approval, Finance Context, and Financial Analysis surfaces',()=>{
 let rest=source.replace(dashboard.getText(ast),'');
 for(const name of ['RequesterRequestExperience','RequesterDocuments','RequesterSubmittedDetail','RequesterDetailOverview','ValidationPanel','PolicyDecisionPanel','ApprovalPanel','FinanceContextPanel','FinancialAnalysisPanel']){const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!;rest=rest.replace(fn.getText(ast),'');}
 for(const name of ['validationSourceBadge','validationRunStatusChip','validationOutcomeBadge','validationCheckStatusBadge','validationSeverityBadge','policyResultBadge','policyFreshnessBadge','policyFlagBadge','policyExceptionStatusBadge','approvalStatusChip','approvalStepBadge','approvalCommitmentBadge','approvalRiskBadge','approvalPriorityBadge','approvalSourceLabel','approvalActionLabel','approvalChannelLabel','financeContextStatusChip','financeExceptionBadge','currencyLabel','financialAnalysisStatusChip','agentStatusChip','riskLevelBadge','priorityBadge']){const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!;rest=rest.replace(fn.getText(ast),'');}
 rest=rest.replace(/if\(requesterView\)return <UiProvider[\s\S]*?<\/UiProvider>;/,'');
 rest=rest.replace(/workspace === "requester" && selected \? <UiProvider[\s\S]*?<\/UiProvider>/,'');
 const start=rest.indexOf('{workspace === "finance" && showDashboard && session.capabilities.reporting ? <UiProvider');
 const end=rest.indexOf('</UiProvider>',start)+13;
 assert.ok(start>=0);assert.doesNotMatch(rest.slice(0,start)+rest.slice(end),/<Ui[A-Z]/);
});
