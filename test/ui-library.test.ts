import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createElement as h} from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {build} from 'esbuild';
import postcss from 'postcss';
const require=createRequire(import.meta.url);
const output=await build({entryPoints:['app/components/ui/components.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',plugins:[{name:'react-instance',setup(b){b.onResolve({filter:/^react(\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const ui=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('every public component renders without an existing page',()=>{
 const cases:Record<string,Record<string,unknown>>={
 UIProvider:{children:'Content'},Typography:{children:'Text'},LoadingSpinner:{},Button:{children:'Save'},BusyButton:{children:'Save',busy:true},
 Card:{children:'Card'},CardHeader:{children:'Header'},CardBody:{children:'Body'},CardFooter:{children:'Footer'},Badge:{children:'Info'},StatusChip:{status:'CLEAN'},
 Alert:{title:'Notice',children:'Details'},EmptyState:{title:'No requests',children:'Nothing to show'},FormField:{id:'custom',label:'Label',children:h('input',{id:'custom'})},
 Input:{label:'Payee'},Textarea:{label:'Reason'},Select:{label:'Currency',children:h('option',null,'MYR')},PageHeader:{title:'Payments'},SectionHeader:{title:'Documents'},
 TableContainer:{label:'Payment records',children:h('table',null,h('tbody',null,h('tr',null,h('td',null,'10.00'))))},
 Pagination:{page:1,totalPages:2,total:2,hasPreviousPage:false,hasNextPage:true,onPrevious:()=>{},onNext:()=>{}}
 };
 assert.deepEqual(Object.keys(ui).sort(),Object.keys(cases).sort());
 for(const [name,props] of Object.entries(cases))assert.ok(render(h(ui[name],props)),name);
});
test('all typography, button and badge variants render',()=>{
 for(const variant of ['metadata','label','body','section','card','page','metric'])assert.match(render(h(ui.Typography,{variant},'Text')),new RegExp(`aims-type-${variant}`));
 for(const variant of ['primary','secondary','danger','text'])assert.match(render(h(ui.Button,{variant},'Save')),new RegExp(`aims-button-${variant}`));
 for(const tone of ['success','warning','danger','neutral','info','ai']){
  assert.match(render(h(ui.Badge,{tone},tone)),new RegExp(`aims-tone-${tone}`));
  assert.match(render(h(ui.Alert,{tone},tone)),new RegExp(`role="${tone==='danger'?'alert':'status'}"`));
 }
 for(const status of ['DRAFT','SUBMITTED','VALIDATING','NEEDS_CLARIFICATION','PENDING_APPROVAL','APPROVED','FINANCE_CHECK','FINANCE_HOLD','READY_FOR_PAYMENT','PAID','REJECTED','CANCELLED','QUARANTINED','SCANNING','CLEAN','SCAN_FAILED','HISTORICAL','PENDING','PROCESSING','COMPLETED','PASS','HOLD','FAILED'])assert.ok(render(h(ui.StatusChip,{status})));
});
test('fields associate labels, helpers and validation; preserve native states',()=>{
 for(const name of ['Input','Textarea','Select']){
  const html=render(h(ui[name],{id:name,label:'Required field',helper:'Help',error:'Invalid',success:'Valid',required:true,disabled:true,'aria-describedby':'external'},name==='Select'?h('option',null,'MYR'):undefined));
  assert.match(html,new RegExp(`for="${name}"`));assert.match(html,/aria-invalid="true"/);
  assert.match(html,new RegExp(`aria-describedby="external ${name}-helper ${name}-error"`));
  assert.match(html,/disabled=""/);assert.match(html,/required=""/);assert.doesNotMatch(html,/>Valid</);
 }
 assert.match(render(h(ui.Input,{label:'Reference',readOnly:true,success:'Verified'})),/readOnly=""/);
 const pair=render(h('div',null,h(ui.Input,{label:'One'}),h(ui.Input,{label:'Two'})));
 const ids=[...pair.matchAll(/<input[^>]* id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,2);
});
test('busy buttons retain identical label and reserved indicator markup',()=>{
 const normal=render(h(ui.Button,null,'Record payment'));const busy=render(h(ui.Button,{busy:true},'Record payment'));
 for(const html of [normal,busy]){assert.match(html,/aims-button-label">Record payment/);assert.match(html,/aims-button-indicator/)}
 assert.match(busy,/disabled=""/);assert.match(busy,/aria-busy="true"/);
});
test('pagination respects supplied boundaries, busy state and unknown totals',()=>{
 const props={page:1,hasPreviousPage:false,hasNextPage:true,onPrevious:()=>{},onNext:()=>{}};
 const normal=render(h(ui.Pagination,props));assert.equal((normal.match(/disabled=""/g)||[]).length,1);assert.doesNotMatch(normal,/records| of /);
 const busy=render(h(ui.Pagination,{...props,busy:true}));assert.equal((busy.match(/disabled=""/g)||[]).length,2);
});
test('CSS uses one token source, valid references, unique selectors and no literal design values',async()=>{
 const css=await readFile('app/components/ui/ui.css','utf8'),tokens=await readFile('app/design-system/tokens.css','utf8');
 const tokenNames=new Set([...tokens.matchAll(/(--aims-[\w-]+)\s*:/g)].map(m=>m[1]));
 for(const match of css.matchAll(/var\((--aims-[\w-]+)\)/g))assert.ok(tokenNames.has(match[1]),match[1]);
 assert.doesNotMatch(css,/#[0-9a-f]{3,8}\b|\b\d+(?:px|rem|em|ms)\b/i);
 const selectors=new Set<string>();postcss.parse(css).walkRules(rule=>{const key=`${rule.parent?.type==='atrule'?String((rule.parent as {params?:string}).params):''}:${rule.selector}`;assert.ok(!selectors.has(key),key);selectors.add(key)});
 assert.equal((css.match(/@import/g)||[]).length,1);
 for(const path of ['app/page.tsx','app/layout.tsx','app/globals.css','app/day1.css'])assert.doesNotMatch(await readFile(path,'utf8'),/components\/ui|ui\/ui.css/);
});
test('compact tables, success fields, heading semantics and spinner announcements render',()=>{
 assert.match(render(h(ui.TableContainer,{label:'History',density:'compact'})),/data-density="compact"/);
 assert.match(render(h(ui.Input,{id:'valid',label:'Payee',success:'Verified'})),/aria-describedby="valid-success"/);
 assert.match(render(h(ui.Typography,{as:'h3',variant:'section'},'Review')),/^<h3/);
 assert.match(render(h(ui.LoadingSpinner,{label:'Checking document'})),/role="status" aria-label="Checking document"/);
 assert.doesNotMatch(render(h(ui.LoadingSpinner,{decorative:true})),/role="status"/);
});
