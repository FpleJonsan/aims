export type Workspace = "requester"|"finance";
export type FinanceView = "work-queue"|"approvals"|"finance-control"|"payment-queue"|"payment-history"|"dashboard"|"ai";
export type SessionEntitlements = {
  workspaces:{requester:boolean;finance:boolean};
  capabilities:{financeAnalysis:boolean;approval:boolean;financeControl:boolean;payment:boolean;reporting:boolean;policyAdmin:boolean};
};

export function allowedFinanceView(session:SessionEntitlements,view:FinanceView){
  const c=session.capabilities;
  return view==="work-queue"?c.financeAnalysis:view==="approvals"?c.approval:view==="finance-control"?c.financeControl:view==="payment-queue"?c.payment:view==="payment-history"?(c.payment||c.reporting):view==="dashboard"||view==="ai"?c.reporting:false;
}

export function defaultFinanceView(session:SessionEntitlements):FinanceView|null{
  return (["dashboard","work-queue","approvals","finance-control","payment-queue","payment-history"] as FinanceView[]).find(view=>allowedFinanceView(session,view))??null;
}

export function safeInternalPath(value:string|null|undefined){
  if(!value||!value.startsWith("/")||value.startsWith("//")||value.includes("\\")||/[\u0000-\u001f]/.test(value))return null;
  try {
    const parsed=new URL(value,"http://aims.local");
    if(parsed.origin!=="http://aims.local"||!parsed.pathname.startsWith("/"))return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return null; }
}

export function routeForSession(next:SessionEntitlements,requested:string,preferred:Workspace|null){
  const requestedPath=safeInternalPath(requested)??"/";
  if(requestedPath.startsWith("/requester")&&next.workspaces.requester)return {workspace:"requester" as const,path:requestedPath,financeView:null};
  if(requestedPath.startsWith("/finance/")&&next.workspaces.finance){
    const view=requestedPath.slice("/finance/".length).split(/[/?#]/)[0] as FinanceView;
    if(allowedFinanceView(next,view))return {workspace:"finance" as const,path:`/finance/${view}`,financeView:view};
  }
  if(preferred==="requester"&&next.workspaces.requester)return {workspace:"requester" as const,path:"/requester",financeView:null};
  const financeView=next.workspaces.finance?defaultFinanceView(next):null;
  if(financeView)return {workspace:"finance" as const,path:`/finance/${financeView}`,financeView};
  if(next.workspaces.requester)return {workspace:"requester" as const,path:"/requester",financeView:null};
  return {workspace:null,path:"/no-access",financeView:null};
}
