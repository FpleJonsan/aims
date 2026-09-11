export function policyReadyForApproval(policy:{ready_for_approval?:boolean;stale?:boolean}|null,approvalCase:unknown){
 return !approvalCase&&policy?.ready_for_approval===true&&policy.stale===false;
}
