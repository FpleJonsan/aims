import type {FinanceView} from './session-ux';

const supported:Partial<Record<FinanceView,string[]>>={
 'dashboard':['dateFrom','dateTo','departmentId','category','reportView'],
 'finance-control':['departmentId','category'],
 'payment-queue':['departmentId','category'],
 'payment-history':['dateFrom','dateTo','departmentId','category','status','search'],
};
export function navigationFilters(view:FinanceView,search:string){
 const input=new URLSearchParams(search);
 return Object.fromEntries((supported[view]??[]).flatMap(key=>input.get(key)?[[key,input.get(key)!]]:[]));
}
export function financePath(view:FinanceView,filters:Record<string,string>={}){
 const query=new URLSearchParams(navigationFilters(view,new URLSearchParams(filters).toString())).toString();
 return `/finance/${view}${query?`?${query}`:''}`;
}
export function dashboardDestination(view:string,reportView?:string):FinanceView{
 return view==='FINANCE_CONTROL'?'finance-control':view==='PAYMENT_QUEUE'?'payment-queue':view==='PAYMENT_HISTORY'?'payment-history':reportView==='PENDING_APPROVAL'?'approvals':'dashboard';
}
