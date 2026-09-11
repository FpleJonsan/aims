import assert from 'node:assert/strict';
import test from 'node:test';
import {policyReadyForApproval} from '../app/lib/policy-ready.ts';
test('current backend readiness enables existing Approval operation',()=>{
 assert.equal(policyReadyForApproval({ready_for_approval:true,stale:false},null),true);
});
test('unready, stale and absent Policy cannot expose readiness',()=>{
 for(const policy of [null,{}, {ready_for_approval:false,stale:false},{ready_for_approval:true,stale:true},{ready_for_approval:true}])assert.equal(policyReadyForApproval(policy,null),false);
});
test('existing Approval case suppresses creation and repeated derivation is stable',()=>{
 const policy={ready_for_approval:true,stale:false};
 for(let i=0;i<3;i++){
 assert.equal(policyReadyForApproval(policy,{id:'existing'}),false);
 assert.equal(policyReadyForApproval(policy,null),true);
 }
 assert.deepEqual(policy,{ready_for_approval:true,stale:false});
});
