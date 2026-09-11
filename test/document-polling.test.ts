import assert from 'node:assert/strict';
import test from 'node:test';
import {pollDocuments} from '../app/lib/document-polling.ts';

for(const terminal of ['CLEAN','REJECTED','SCAN_FAILED']) {
 test(`pending automatically refreshes to ${terminal} and stops`,async()=>{
  const seen:string[]=[];let reads=0;
  const result=await pollDocuments({signal:new AbortController().signal,intervalMs:1,
   read:async()=>[{id:'document',security_status:++reads===1?'QUARANTINED':terminal}],
   update:documents=>{seen.push(documents[0].security_status!)} });
  assert.equal(result,'complete');assert.deepEqual(seen,['QUARANTINED',terminal]);assert.equal(reads,2);
 });
}
test('timeout is bounded and a fresh retry can observe CLEAN',async()=>{
 const keepAlive=setTimeout(()=>{},1000);
 try {
  assert.equal(await pollDocuments({signal:new AbortController().signal,timeoutMs:10,intervalMs:1,read:async()=>[{id:'slip',security_status:'SCANNING'}],update:()=>{}}),'timeout');
  assert.equal(await pollDocuments({signal:new AbortController().signal,read:async()=>[{id:'slip',security_status:'CLEAN'}],update:()=>{}}),'complete');
 }finally{clearTimeout(keepAlive)}
});
test('request switch or unmount cancels an in-flight read without stale updates',async()=>{
 const controller=new AbortController();let updates=0;
 let release!:()=>void;
 const pending=pollDocuments({signal:controller.signal,read:async()=>{await new Promise<void>(resolve=>{release=resolve});return [{id:'old',security_status:'CLEAN'}]},update:()=>{updates++}});
 controller.abort();release();assert.equal(await pending,'cancelled');assert.equal(updates,0);
});
test('replacing polling cancels the old loop and observes the new upload once',async()=>{
 const old=new AbortController();let oldReads=0;let newReads=0;
 const pending=pollDocuments({signal:old.signal,read:async()=>{oldReads++;return [{id:'old',security_status:'SCANNING'}]},update:()=>{old.abort()}});
 assert.equal(await pending,'cancelled');
 assert.equal(await pollDocuments({signal:new AbortController().signal,read:async()=>{newReads++;return [{id:'new',security_status:'CLEAN'}]},update:()=>{}}),'complete');
 assert.equal(oldReads,1);assert.equal(newReads,1);
});
test('network errors are surfaced for retry',async()=>{
 await assert.rejects(pollDocuments({signal:new AbortController().signal,read:async()=>{throw new Error('offline')},update:()=>assert.fail('no update')}),/offline/);
});
test('deadline also aborts an in-flight backend refresh',async()=>{
 const keepAlive=setTimeout(()=>{},1000);let aborted=false;
 try{
  const result=await pollDocuments({signal:new AbortController().signal,timeoutMs:10,
   read:async()=>[{id:'document',security_status:'SCANNING'}],
   update:async(_documents,signal)=>{await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason)},{once:true}))}});
  assert.equal(result,'timeout');assert.equal(aborted,true);
 }finally{clearTimeout(keepAlive)}
});
