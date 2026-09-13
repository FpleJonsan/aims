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
const names=['RequesterRequestExperience','RequesterDocuments','RequesterSubmittedDetail','RequesterDetailOverview','formatMoney','formatDate'];
const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text??'')).map(n=>n.getText(ast));
const constants=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['stages','statusStage'].includes(d.name.getText(ast)))).map(n=>n.getText(ast));
const imports=source.split('\n').find(line=>line.includes('UIProvider as UiProvider'))!.replace('"./components/ui"','"./app/components/ui/components"');
const helpers=source.split('\n').find(line=>line.includes('import { clarificationActionable'))!.replace('"./lib/requester-presentation"','"./app/lib/requester-presentation"');
const require=createRequire(import.meta.url);
const output=await build({stdin:{contents:`${imports}\n${helpers}\nconst useState=value=>[value,()=>{}];\n${constants.join('\n')}\n${declarations.join('\n')}\nexport {RequesterRequestExperience,RequesterDocuments,RequesterSubmittedDetail,RequesterDetailOverview};`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const ui=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const item={id:'synthetic',status:'DRAFT',payee:'Synthetic Vendor',category:'Operations',purpose:'UI migration verification',amount:'100.00',currency:'MYR',dueDate:'2026-09-30',paymentMethod:'BANK_TRANSFER',paymentDetails:'Synthetic reference',remark:'Test',documents:[],audit:[]};
const noop=()=>{};const props={item,form:item,field:noop,fieldErrors:{},busy:false,notice:'',submittedTicket:null,confirming:false,setConfirming:noop,save:noop,reviewSubmission:noop,confirmSubmission:noop,upload:noop,remove:noop,api:noop,changed:noop,back:noop};
type Node={props?:{children?:unknown;onClick?:()=>void;onSubmit?:()=>void;type?:string;busy?:boolean;onChange?:(event:{target:{value:string}})=>void;id?:string}};
function nodes(tree:unknown):Node[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return [];const node=tree as Node;return [node,...nodes(node.props?.children)];}
function text(tree:unknown):string{if(Array.isArray(tree))return tree.map(text).join(' ');if(tree==null||typeof tree==='boolean')return '';if(typeof tree==='object')return text((tree as Node).props?.children);return String(tree);}
test('draft uses official labelled fields, required semantics, helper and error associations',()=>{
 const html=render(ui.RequesterRequestExperience({...props,fieldErrors:{payee:'Payee required',paymentMethod:'Choose method'}}));
 for(const id of ['payee','category','purpose','amount','currency','dueDate','paymentMethod','paymentDetails','remark'])assert.match(html,new RegExp(`for="request-${id}"`));
 assert.match(html,/aria-describedby="request-payee-error"/);assert.match(html,/id="request-payee-error" role="alert"/);
 assert.match(html,/aria-describedby="request-paymentMethod-error"/);assert.match(html,/aria-describedby="request-purpose-helper"/);
 assert.match(html,/<input[^>]*disabled=""[^>]*value="Your assigned department"/);
 assert.match(html,/novalidate=""|noValidate=""/);
 const headings=['PAYMENT DETAILS','PAYMENT METHOD','SUPPORTING DOCUMENTS','REVIEW &amp; SUBMIT'];for(let i=1;i<headings.length;i++)assert.ok(html.indexOf(headings[i])>html.indexOf(headings[i-1]));
});
test('save and review keep distinct submission semantics and field updates',()=>{
 const events:string[]=[];const tree=ui.RequesterRequestExperience({...props,save:()=>events.push('save'),reviewSubmission:()=>events.push('review'),field:(name:string,value:string)=>events.push(`${name}:${value}`)});
 const all=nodes(tree);all.find(n=>n.props?.onSubmit)?.props?.onSubmit?.();
 const review=all.find(n=>text(n)==='Review and Submit →');assert.equal(review?.props?.type,'button');review?.props?.onClick?.();
 all.find(n=>n.props?.id==='request-payee')?.props?.onChange?.({target:{value:'Updated Vendor'}});
 assert.deepEqual(events,['save','review','payee:Updated Vendor']);
 const save=all.find(n=>text(n)==='Save Draft');assert.equal(save?.props?.type,'submit');
 const busy=render(ui.RequesterRequestExperience({...props,busy:true}));assert.match(busy,/aria-busy="true"/);assert.match(busy,/disabled=""/);
});
test('confirmation retains exact handlers and labelled dialog',()=>{
 const events:string[]=[];const tree=ui.RequesterRequestExperience({...props,confirming:true,setConfirming:()=>events.push('edit'),confirmSubmission:()=>events.push('submit')});
 const html=render(tree);assert.match(html,/role="dialog" aria-modal="true" aria-labelledby="submit-title"/);
 for(const label of ['Continue Editing','Submit Request'])nodes(tree).find(n=>text(n)===label)?.props?.onClick?.();
 assert.deepEqual(events,['edit','submit']);
});
test('documents preserve upload contract, worker statuses and removal callback',()=>{
 for(const status of ['QUARANTINED','SCANNING','CLEAN','REJECTED','SCAN_FAILED']){
  let removed='';const tree=ui.RequesterDocuments({item:{...item,documents:[{id:'doc',original_filename:'evidence.pdf',size_bytes:1024,security_status:status}]},editable:true,busy:false,upload:noop,remove:(id:string)=>{removed=id}});
  const html=render(tree);assert.match(html,/name="file"/);assert.match(html,/accept="application\/pdf,image\/jpeg,image\/png"/);assert.match(html,/name="documentType"/);assert.match(html,/role="status"/);
  nodes(tree).find(n=>text(n)==='Remove')?.props?.onClick?.();assert.equal(removed,'doc');
 }
 const locked=render(ui.RequesterDocuments({item,editable:false,busy:false,upload:noop}));assert.doesNotMatch(locked,/<form/);assert.match(locked,/No documents attached/);
});
test('submitted detail preserves values, history and read-only information',()=>{
 const submitted={...item,status:'SUBMITTED',ticketNumber:'PAY-TEST',submittedAt:'2026-09-01',audit:[{id:'event',action:'REQUEST_SUBMITTED',occurred_at:'2026-09-01'}]};
 const html=render(ui.RequesterSubmittedDetail({...props,item:submitted}));
 for(const text of ['PAY-TEST','Synthetic Vendor','MYR 100.00','Request history','Submitted'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/Save Draft|Review and Submit|<textarea|<input/);
 const clarification=render(ui.RequesterSubmittedDetail({...props,item:{...submitted,status:'NEEDS_CLARIFICATION',clarifications:[{id:'clarification',type:'VALIDATION',status:'OPEN',question:'Provide evidence',requestedAt:'2026-09-01'}]}}));
 assert.match(clarification,/for="clarification-response"/);assert.match(clarification,/Provide evidence/);
});
test('request composition only references frozen tokens and introduces no design literals',async()=>{
 const css=await readFile('app/request-ui.css','utf8'),tokens=await readFile('app/design-system/tokens.css','utf8');
 for(const [,token] of css.matchAll(/var\((--aims-[\w-]+)\)/g))assert.ok(tokens.includes(`${token}:`),token);
 postcss.parse(css).walkDecls(d=>{assert.doesNotMatch(d.value,/#[0-9a-f]{3,8}\b|\b\d+(?:px|rem|em|ms)\b/i)});
});
