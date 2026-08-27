"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./day1.css";
import { allowedFinanceView, defaultFinanceView, routeForSession, safeInternalPath, type FinanceView, type Workspace } from "./lib/session-ux";
import { clarificationActionable, friendlyActivity, requesterActivityVisible, requesterNeedsAction, requesterStatusPresentation, type RequesterStatus } from "./lib/requester-presentation";

const API = process.env.NEXT_PUBLIC_AIMS_API_URL ?? "http://localhost:3001";
const stages = [
  "Request Initiation",
  "Request Capture",
  "Validation",
  "Finance Context",
  "Financial Risk Analysis",
  "Policy & Decision",
  "Approval",
  "Final Finance Control",
  "Payment Processing",
  "Payment Record / History",
  "Finance Dashboard",
  "AI Finance Intelligence",
];
type Item = {
  id: string;
  ticketNumber: string | null;
  status:
    | "DRAFT"
    | "SUBMITTED"
    | "VALIDATING"
    | "NEEDS_CLARIFICATION"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "FINANCE_CHECK"
    | "FINANCE_HOLD"
    | "READY_FOR_PAYMENT"
    | "PAID"
    | "REJECTED"
    | "CANCELLED";
  payee: string | null;
  purpose: string | null;
  category: string | null;
  amount: string | null;
  currency: string | null;
  departmentId: string;
  dueDate: string | null;
  paymentMethod: string | null;
  paymentDetails: string | null;
  remark: string | null;
  humanFinalRisk?: string;
  submittedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  clarifications?: Array<{id:string;type:string;question:string;status:string;requestedAt:string;response?:string|null;respondedAt?:string|null}>;
  paymentSummary?: {paymentDate:string;status:string;amountMinor:string;currency:string;paymentMethod:string;recordedAt:string}|null;
  documents?: Array<{
    id: string;
    original_filename: string;
    size_bytes: string;
    version: number;
    document_type?: string;
    uploaded_at?: string;
  }>;
  audit?: Array<{ id: string; action: string; occurred_at: string }>;
};
type Api = (path: string, init?: RequestInit) => Promise<unknown>;
type Pagination = { page:number;pageSize:number;total:number;totalPages:number;hasNextPage:boolean;hasPreviousPage:boolean };
type DashboardFilterState = { dateFrom:string;dateTo:string;departmentId:string;category:string };
type DashboardDrill =
  | { view:"REPORTING_REQUESTS"; reportView:"PENDING_APPROVAL"|"RISK_ATTENTION"; filters:DashboardFilterState }
  | { view:"FINANCE_CONTROL"; status:"FINANCE_HOLD"; filters:DashboardFilterState }
  | { view:"PAYMENT_QUEUE"; status:"READY_FOR_PAYMENT"; filters:DashboardFilterState }
  | { view:"PAYMENT_HISTORY"; filters:Record<string,string> };
type PortalSession = {
  user:{id:string;subject:string;email:string;displayName:string;department:string};
  workspaces:{requester:boolean;finance:boolean};
  capabilities:{financeAnalysis:boolean;approval:boolean;financeControl:boolean;payment:boolean;reporting:boolean;policyAdmin:boolean};
};
type AuthPhase = "login"|"checking"|"ready"|"no-access"|"error";
type LocalIdentity = {subject:string;displayName:string;department:string;persona:string;workspaces:string[]};

const statusStage: Record<Item["status"], number> = {
  DRAFT: 1, SUBMITTED: 2, VALIDATING: 3, NEEDS_CLARIFICATION: 3,
  PENDING_APPROVAL: 6, APPROVED: 7, FINANCE_CHECK: 7, FINANCE_HOLD: 7,
  READY_FOR_PAYMENT: 8, PAID: 9, REJECTED: 6, CANCELLED:1,
};

function StatusChip({ status }: { status: string }) {
  const meta=requesterStatusPresentation[status as RequesterStatus];
  return <span className={`statusChip status-${meta?.tone??"neutral"}`}>{meta?.label??status.replaceAll("_", " ")}</span>;
}

function AuthorityBadge({ children, ai = false }: { children: ReactNode; ai?: boolean }) {
  return <span className={ai ? "authorityBadge aiAuthority" : "authorityBadge"}>{children}</span>;
}

function KpiCard({ label, value, detail, tone = "neutral", icon, onClick }: { label:string;value:string;detail:string;tone?:"neutral"|"success"|"warning"|"danger"|"info";icon:string;onClick?:()=>void }) {
  const content = <><span className="metricIcon" aria-hidden="true">{icon}</span><small>{label}</small><b>{value}</b><span className="metricDetail">{detail}</span></>;
  return onClick ? <button className={`kpiCard tone-${tone}`} onClick={onClick}>{content}</button> : <article className={`kpiCard tone-${tone}`}>{content}</article>;
}
function formatMoney(currency:string|null,value:string|null){return value?`${currency??""} ${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`.trim():"—"}
function formatDate(value:string|null|undefined){if(!value)return "—";const date=/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(`${value}T00:00:00`):new Date(value);return new Intl.DateTimeFormat("en-MY",{day:"2-digit",month:"short",year:"numeric"}).format(date)}

export default function Home() {
  const localLogin=process.env.NODE_ENV!=="production";
  const [user, setUser] = useState<string | null>(null),
    [authPhase,setAuthPhase]=useState<AuthPhase>(localLogin?"login":"checking"),
    [authMessage,setAuthMessage]=useState(""),
    [items, setItems] = useState<Item[]>([]),
    [selected, setSelected] = useState<Item | null>(null),
    [notice, setNotice] = useState(""),
    [showPaymentHistory, setShowPaymentHistory] = useState(false),
    [showDashboard, setShowDashboard] = useState(false),
    [session,setSession]=useState<PortalSession|null>(null),
    [workspace,setWorkspace]=useState<Workspace|null>(null),
    [financeView,setFinanceView]=useState<FinanceView>("dashboard"),
    [requesterHome,setRequesterHome]=useState(true),
    [requesterPaymentOnly,setRequesterPaymentOnly]=useState(false),
    [approvalPage, setApprovalPage] = useState(1),
    [approvalPagination, setApprovalPagination] = useState<Pagination|null>(null),
    [dashboardDrill, setDashboardDrill] = useState<DashboardDrill|null>(null);
  const authorizationRefresh=useRef(false);
  const clearProtectedState=useCallback(()=>{
    setItems([]);setSelected(null);setApprovalPagination(null);setDashboardDrill(null);
    setShowDashboard(false);setShowPaymentHistory(false);
  },[]);
  const api = useCallback(
    async (path: string, init?: RequestInit): Promise<unknown> => {
      if (localLogin&&!user) throw Error("Sign in required");
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          ...(user?{"x-aims-user":user}:{}),
          ...(init?.body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
          ...init?.headers,
        },
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string | string[];
      };
      const message=Array.isArray(data.message)?data.message.join(", "):(data.message??"Request failed");
      if(response.status===401)window.dispatchEvent(new CustomEvent("aims:unauthenticated",{detail:{message}}));
      if(response.status===403&&path!=="/session")window.dispatchEvent(new CustomEvent("aims:forbidden",{detail:{path}}));
      if (!response.ok)
        throw Error(message);
      return data;
    },
    [localLogin,user],
  );
  const applySession=useCallback((next:PortalSession,requestedPath:string,message="")=>{
    setSession(next);
    const stored=window.localStorage.getItem("aims.workspace");
    const preferred=stored==="requester"||stored==="finance"?stored:null;
    const destination=routeForSession(next,requestedPath,preferred);
    setWorkspace(destination.workspace);
    if(destination.financeView)setFinanceView(destination.financeView);
    setRequesterPaymentOnly(destination.workspace==="requester"&&destination.path.startsWith("/requester/payment-status"));
    setRequesterHome(destination.workspace==="requester"&&(destination.path==="/requester"||destination.path==="/requester/"));
    setShowDashboard(destination.workspace==="finance"&&destination.financeView==="dashboard");
    setShowPaymentHistory(destination.workspace==="finance"&&destination.financeView==="payment-history");
    setNotice(message);
    setAuthPhase(destination.workspace?"ready":"no-access");
    window.history.replaceState({},"",destination.path);
  },[]);
  const bootstrapSession=useCallback(async(requestedPath:string)=>{
    setAuthPhase("checking");setAuthMessage("");clearProtectedState();
    try {
      const next=await api("/session") as PortalSession;
      const savedRedirect=safeInternalPath(window.sessionStorage.getItem("aims.redirect"));
      window.sessionStorage.removeItem("aims.redirect");
      applySession(next,savedRedirect??requestedPath);
    } catch(error) {
      const message=msg(error);
      if(message==="Authentication required"||message.includes("Unknown or inactive")||message.includes("Production identity proxy"))return;
      setSession(null);setWorkspace(null);setAuthMessage("Unable to verify your AIMS session. Try again.");setAuthPhase("error");
    }
  },[api,applySession,clearProtectedState]);
  const refresh = useCallback(async () => {
    if (!session || !workspace) return;
    if (workspace === "requester") {
      const rows=(await api("/requester/requests?pageSize=50")) as {items:Array<Record<string,unknown>>};
      setItems(rows.items.map(requesterListItem));
    } else if (financeView === "approvals") {
      const rows = (
        (await api(`/approvals?page=${approvalPage}&pageSize=25`)) as { items: Array<Record<string, unknown>> } & Pagination
      );
      const items = rows.items;
      setApprovalPagination(rows);
      setItems(
        items.map((x) => ({
          id: String(x.payment_request_id),
          ticketNumber: String(x.ticket_number),
          status: "PENDING_APPROVAL",
          payee: String(x.payee),
          purpose: `Current step ${x.sequence} · ${x.required_role}`,
          amount: String(x.amount),
          currency: String(x.currency),
          departmentId: String(x.department_id),
          dueDate: String(x.due_date),
          category: null,
          paymentMethod: null,
          paymentDetails: null,
          remark: null,
          humanFinalRisk: String(x.final_risk),
        })),
      );
    } else {
      const control = financeView==="finance-control" ? (
        (await api("/finance-control")) as {
          items: Array<Record<string, unknown>>;
        }
      ).items : [];
      const payment = financeView==="payment-queue" ? (
        (await api("/payment-queue")) as {
          items: Array<Record<string, unknown>>;
        }
      ).items : [];
      const work = financeView==="work-queue" ? ((await api("/payment-requests?pageSize=50")) as {items:Item[]}).items : [];
      setItems(
        [
          ...work,
          ...control.map(financeQueueItem),
          ...payment.map(paymentQueueItem),
        ].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i),
      );
    }
  }, [api, session, workspace, approvalPage, financeView]);
  useEffect(() => {
    if (authPhase!=="ready" || !session || !workspace) return;
    let active = true;
    void Promise.resolve().then(refresh)
      .catch((e) => {
        if (active) setNotice(msg(e));
      });
    return () => {
      active = false;
    };
  }, [refresh, authPhase, session, workspace, approvalPage]);
  useEffect(()=>{
    if(localLogin&&!user)return;
    void Promise.resolve().then(()=>bootstrapSession(window.location.pathname+window.location.search));
  },[bootstrapSession,localLogin,user]);
  useEffect(()=>{
    const unauthenticated=(event:Event)=>{
      const detail=(event as CustomEvent<{message?:string}>).detail;
      const current=safeInternalPath(window.location.pathname+window.location.search);
      if(current&&current!=="/login")window.sessionStorage.setItem("aims.redirect",current);
      clearProtectedState();setSession(null);setWorkspace(null);setUser(null);
      setAuthMessage(detail?.message?.includes("inactive")?"Your AIMS account is currently inactive.":"Your session has expired. Please sign in again.");
      setAuthPhase("login");window.history.replaceState({},"","/login");
    };
    const forbidden=()=>{
      if(authorizationRefresh.current)return;
      authorizationRefresh.current=true;clearProtectedState();setAuthPhase("checking");setNotice("Your access changed. AIMS is refreshing your authorized workspace.");
      void fetch(`${API}/session`,{headers:{...(user?{"x-aims-user":user}:{})}}).then(async response=>{
        if(response.status===401){window.dispatchEvent(new CustomEvent("aims:unauthenticated"));return null;}
        if(!response.ok)throw Error("session-refresh-failed");
        return response.json() as Promise<PortalSession>;
      }).then(next=>{
        if(!next)return;
        applySession(next,window.location.pathname,"You no longer have access to that feature. Your workspace has been updated.");
      }).catch(()=>{setAuthMessage("Unable to verify your AIMS session. Try again.");setAuthPhase("error")}).finally(()=>{authorizationRefresh.current=false;});
    };
    window.addEventListener("aims:unauthenticated",unauthenticated);window.addEventListener("aims:forbidden",forbidden);
    return()=>{window.removeEventListener("aims:unauthenticated",unauthenticated);window.removeEventListener("aims:forbidden",forbidden)};
  },[user,applySession,clearProtectedState]);
  useEffect(()=>{
    if(authPhase!=="ready"||workspace!=="requester"||selected)return;
    const match=window.location.pathname.match(/^\/requester\/requests\/([0-9a-f-]{36})$/i);
    if(!match)return;
    let active=true;
    void api(`/requester/requests/${match[1]}`).then(value=>{
      if(active)setSelected(requesterDetailItem(value as {request:Record<string,unknown>;documents:Array<Record<string,unknown>>;activity:Array<Record<string,unknown>>;clarifications:Array<Record<string,unknown>>;payment:Record<string,unknown>|null}));
    }).catch(error=>{if(active)setNotice(msg(error))});
    return()=>{active=false};
  },[api,authPhase,workspace,selected]);
  async function initiate() {
    try {
      const item = (await api("/payment-requests", {
        method: "POST",
        body: "{}",
      })) as Item;
      setSelected(item);
      window.history.pushState({},"","/requester/requests/new");
      await refresh();
    } catch (e) {
      setNotice(msg(e));
    }
  }
  async function open(id: string) {
    try {
      if(workspace==="requester"){
        const safe=await api(`/requester/requests/${id}`) as {request:Record<string,unknown>;documents:Array<Record<string,unknown>>;activity:Array<Record<string,unknown>>;clarifications:Array<Record<string,unknown>>;payment:Record<string,unknown>|null};
        setSelected(requesterDetailItem(safe));
        window.history.pushState({},"",`/requester/requests/${id}`);
      } else setSelected((await api(`/payment-requests/${id}`)) as Item);
    } catch (e) {
      setNotice(msg(e));
    }
  }
  const signOut=()=>{
    if(!localLogin){
      const providerLogout=process.env.NEXT_PUBLIC_AIMS_LOGOUT_URL;
      if(providerLogout){clearProtectedState();setSession(null);setWorkspace(null);window.location.assign(providerLogout);return;}
      setNotice("Sign out must be completed through your organization identity provider. No provider logout URL is configured.");
      return;
    }
    clearProtectedState();window.localStorage.removeItem("aims.workspace");window.sessionStorage.removeItem("aims.redirect");
    setSession(null);setWorkspace(null);setUser(null);setAuthMessage("You have signed out of the local AIMS demo.");setAuthPhase("login");
    window.history.replaceState({},"","/login");
  };
  if (authPhase==="login")
    return (
      <Login
        local={localLogin}
        message={authMessage}
        onLogin={(identity) => {
          setNotice("");setAuthMessage("");setAuthPhase("checking");setUser(identity);
        }}
        onRetry={()=>void bootstrapSession("/")}
      />
    );
  if(authPhase==="checking")return <main className="portalLoading" aria-live="polite"><Brand/><span className="sessionSpinner" aria-hidden="true"/><h1>Checking your session…</h1><p>Confirming your identity and authorized workspace.</p></main>;
  if(authPhase==="error")return <SessionProblem message={authMessage} retry={()=>void bootstrapSession(window.location.pathname)}/>;
  if(authPhase==="no-access"||!session||!workspace)return <NoAccess session={session} signOut={signOut}/>;
  const financeTitles:Record<FinanceView,string>={"work-queue":"Work Queue",approvals:"Approval Inbox","finance-control":"Finance Control","payment-queue":"Payment Queue","payment-history":"Payment History",dashboard:"Finance Dashboard",ai:"AI Finance Intelligence"};
  const financeDescriptions:Record<FinanceView,string>={"work-queue":"General Finance review within your authorized scope.",approvals:"Requests on which you have actionable Approval authority.","finance-control":"The mandatory final controlled gate before payment readiness.","payment-queue":"Only requests you are authorized to record as externally paid.","payment-history":"Immutable historical payment records within your authorized scope.",dashboard:"Authoritative financial position and operational attention.",ai:"Read-only interpretation grounded in authorized finance evidence."};
  const pageTitle = workspace==="requester"?(requesterHome?"Requester Dashboard":requesterPaymentOnly?"Payment Status":"My Requests"):financeTitles[financeView];
  const currentStage = selected ? statusStage[selected.status] : -1;
  const profile = {initials:session.user.displayName.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase(),name:session.user.displayName,department:session.user.department};
  const goRequester=(home:boolean,paymentOnly=false)=>{setNotice("");setSelected(null);setRequesterHome(home);setRequesterPaymentOnly(paymentOnly);window.history.pushState({},"",home?"/requester":paymentOnly?"/requester/payment-status":"/requester/requests")};
  const goFinance=(view:FinanceView)=>{if(!allowedFinanceView(session,view))return;setNotice("");setSelected(null);setDashboardDrill(null);setFinanceView(view);setShowDashboard(view==="dashboard");setShowPaymentHistory(view==="payment-history");window.history.pushState({},"",`/finance/${view}`)};
  const switchWorkspace=(next:Workspace)=>{if(!session.workspaces[next])return;window.localStorage.setItem("aims.workspace",next);setWorkspace(next);setSelected(null);setItems([]);setDashboardDrill(null);if(next==="requester"){setRequesterHome(true);setShowDashboard(false);setShowPaymentHistory(false);window.history.pushState({},"","/requester")}else{const view=defaultFinanceView(session);if(view)goFinance(view)}};
  return (
    <main className="appShell">
      <aside className="sideNav">
        <Brand />
        <nav aria-label="Primary navigation" className="primaryNav">
          {workspace==="requester"?<>
            <button className={requesterHome&&!selected?"active":""} onClick={()=>goRequester(true)}><span>▦</span>Dashboard</button>
            <button className={!requesterHome&&!requesterPaymentOnly&&!selected?"active":""} onClick={()=>goRequester(false)}><span>☷</span>My Requests</button>
            <button onClick={()=>void initiate()}><span>＋</span>New Request</button>
            <button className={requesterPaymentOnly&&!selected?"active":""} onClick={()=>goRequester(false,true)}><span>◷</span>Payment Status</button>
          </>:<>
            {session.capabilities.reporting&&<button className={financeView==="dashboard"?"active":""} onClick={()=>goFinance("dashboard")}><span>▦</span>Dashboard</button>}
            {session.capabilities.financeAnalysis&&<button className={financeView==="work-queue"&&!selected?"active":""} onClick={()=>goFinance("work-queue")}><span>☷</span>Work Queue</button>}
            {session.capabilities.approval&&<button className={financeView==="approvals"?"active":""} onClick={()=>goFinance("approvals")}><span>✓</span>Approval Inbox</button>}
            {session.capabilities.financeControl&&<button className={financeView==="finance-control"?"active":""} onClick={()=>goFinance("finance-control")}><span>◆</span>Finance Control</button>}
            {session.capabilities.payment&&<button className={financeView==="payment-queue"?"active":""} onClick={()=>goFinance("payment-queue")}><span>→</span>Payment Queue</button>}
            {(session.capabilities.payment||session.capabilities.reporting)&&<button className={financeView==="payment-history"?"active":""} onClick={()=>goFinance("payment-history")}><span>◷</span>Payment History</button>}
            {session.capabilities.reporting&&<button className={financeView==="ai"?"active":""} onClick={()=>goFinance("ai")}><span>✦</span>AI Finance Intelligence</button>}
          </>}
        </nav>
        {workspace==="finance"&&<nav aria-label="AIMS workflow stages" className="workflowNav">
          <small>WORKFLOW</small>
          {stages.slice(0,10).map((stage,index)=><span key={stage}><i>{String(index+1).padStart(2,"0")}</i>{stage}</span>)}
        </nav>}
        {workspace==="finance"&&session.capabilities.reporting&&<nav aria-label="Reporting navigation" className="reportingNav">
          <small>REPORTING</small>
          <span><i>↗</i>Reports</span><span><i>◉</i>Budget & Spending</span><span><i>✦</i>AI Finance Intelligence</span>
        </nav>}
        <div className="userCard"><b>{profile.initials}</b><span><strong>{profile.name}</strong><small>{profile.department}</small><small>Current workspace: {workspace==="requester"?"Requester":"Finance"}</small></span></div>
        {session.workspaces.requester&&session.workspaces.finance&&<button className="workspaceSwitch" aria-label={`Switch from ${workspace} to ${workspace==="requester"?"Finance":"Requester"} workspace`} onClick={()=>switchWorkspace(workspace==="requester"?"finance":"requester")}>Switch to {workspace==="requester"?"Finance":"Requester"} Portal</button>}
        <button
          onClick={signOut}
        >
          Sign out
        </button>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <small>AIMS · PAYMENT & FINANCE CONTROL</small>
            <h1>{pageTitle}</h1>
            <p className="pageSubtitle">{workspace==="requester"?"Track your requests, required actions, and payment progress.":financeDescriptions[financeView]}</p>
          </div>
          {workspace === "requester" && (
            <button className="primary" onClick={initiate}>
              ＋ New request
            </button>
          )}
          {workspace === "finance" && (
            <div className="headerActions">
              {session.capabilities.financeAnalysis&&<button
                className="secondary"
                onClick={() => {
                  goFinance("work-queue");
                }}
              >
                Work queue
              </button>}
              {(session.capabilities.payment||session.capabilities.reporting)&&<button
                className="secondary"
                onClick={() => {
                  goFinance("payment-history");
                }}
              >
                Payment History
              </button>}
              {session.capabilities.reporting&&<button
                className="primary"
                onClick={() => {
                  goFinance("dashboard");
                }}
              >
                Finance Dashboard
              </button>}
            </div>
          )}
        </header>
        {workspace==="finance"&&<div className="stageRail" aria-label="12-stage AIMS workflow">
          {stages.map((s, i) => (
            <div className={currentStage < 0 ? "available" : i < currentStage ? "completed" : i === currentStage ? "current" : "future"} key={s}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <b>{s}</b>
              <small>{currentStage < 0 ? "Available" : i < currentStage ? "Completed" : i === currentStage ? "Current" : "Locked"}</small>
            </div>
          ))}
        </div>}
        {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
        {workspace==="finance"&&financeView==="payment-queue"&&<p className="controlNotice"><AuthorityBadge>PAYMENT RECORDING</AuthorityBadge><span>AIMS records externally executed payments. AIMS does not execute bank transfers.</span></p>}
        {workspace==="requester"&&requesterHome&&!selected?<RequesterDashboard api={api} open={open} newRequest={()=>void initiate()} viewAll={()=>goRequester(false)}/>:financeView==="ai"&&workspace==="finance"&&session.capabilities.reporting?<FinanceIntelligenceWorkspace api={api}/>:showDashboard && workspace === "finance" && session.capabilities.reporting ? (
          <FinanceDashboard api={api} onDrill={(drill) => {
            setDashboardDrill(drill);
            setShowDashboard(false);
            setShowPaymentHistory(drill.view === "PAYMENT_HISTORY");
          }} />
        ) : showPaymentHistory && workspace === "finance" && (session.capabilities.payment||session.capabilities.reporting) ? (
          <PaymentHistory api={api} user={session.user.subject} initialFilters={dashboardDrill?.view === "PAYMENT_HISTORY" ? dashboardDrill.filters : {}} />
        ) : dashboardDrill?.view === "REPORTING_REQUESTS" ? (
          <ReportingRequestDrill api={api} drill={dashboardDrill} back={()=>setDashboardDrill(null)} />
        ) : dashboardDrill?.view === "FINANCE_CONTROL" || dashboardDrill?.view === "PAYMENT_QUEUE" ? (
          <OperationalDrill api={api} drill={dashboardDrill} open={open} back={()=>setDashboardDrill(null)} />
        ) : selected ? (
          <Editor
            item={selected}
            user={session.user.subject}
            requesterView={workspace==="requester"}
            api={api}
            changed={async () => {
              if(workspace==="requester")await open(selected.id);
              else setSelected((await api(`/payment-requests/${selected.id}`)) as Item);
              await refresh();
            }}
            back={() => {
              setSelected(null);
              void refresh();
            }}
          />
        ) : (
          <>
            <List key={workspace==="requester"?(requesterPaymentOnly?"requester-payment":"requester-all"):`finance-${financeView}`} items={workspace==="requester"&&requesterPaymentOnly?items.filter(item=>item.status==="READY_FOR_PAYMENT"||item.status==="PAID"):items} open={open} empty={initiate} canCreate={workspace === "requester"&&!requesterPaymentOnly} requesterView={workspace==="requester"} paymentOnly={workspace==="requester"&&requesterPaymentOnly} api={workspace==="requester"?api:undefined}/>
            {workspace==="finance"&&session.capabilities.approval && approvalPagination && (
              <nav className="pagination" aria-label="Approval inbox pages">
                <button aria-label="Previous approval page" disabled={!approvalPagination.hasPreviousPage} onClick={() => setApprovalPage((page) => Math.max(1, page - 1))}>Previous</button>
                <span>Page {approvalPagination.page} of {Math.max(1, approvalPagination.totalPages)} · {approvalPagination.total} eligible approvals</span>
                <button aria-label="Next approval page" disabled={!approvalPagination.hasNextPage} onClick={() => setApprovalPage((page) => page + 1)}>Next</button>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function RequesterDashboard({api,open,newRequest,viewAll}:{api:Api;open:(id:string)=>Promise<void>;newRequest:()=>void;viewAll:()=>void}){
  const [summary,setSummary]=useState<{myRequests:number;drafts:number;awaitingReview:number;needsClarification:number;pendingApproval:number;approvedReady:number;readyForPayment:number;inProgress:number;paid:number}|null>(null),[recent,setRecent]=useState<Item[]>([]),[attention,setAttention]=useState<Item[]>([]),[notice,setNotice]=useState("");
  useEffect(()=>{let active=true;void Promise.all([api("/requester/dashboard"),api("/requester/requests?pageSize=5"),api("/requester/requests?pageSize=5&status=NEEDS_CLARIFICATION"),api("/requester/requests?pageSize=5&status=DRAFT")]).then(([s,r,clarifications,drafts])=>{if(active){setSummary(s as typeof summary);setRecent((r as {items:Array<Record<string,unknown>>}).items.map(requesterListItem));setAttention([...(clarifications as {items:Array<Record<string,unknown>>}).items,...(drafts as {items:Array<Record<string,unknown>>}).items].map(requesterListItem))}}).catch(e=>{if(active)setNotice(msg(e))});return()=>{active=false}},[api]);
  if(!summary)return <section className="card"><p>{notice||"Loading your requests…"}</p></section>;
  return <section className="requesterDashboard">
    <div className="requesterWelcome"><div><small>REQUESTER WORKSPACE</small><h2>My Requests</h2><p>Track payment requests and actions requiring your attention.</p></div><button className="primary" onClick={newRequest}>＋ New Request</button></div>
    <section className="attentionSection" aria-labelledby="attention-title"><div className="sectionHeading"><div><small>ACTION REQUIRED</small><h3 id="attention-title">Needs My Attention</h3></div><span>{summary.needsClarification+summary.drafts} open</span></div>{attention.length?<div className="attentionList">{attention.map(item=>{const clarification=item.status==="NEEDS_CLARIFICATION";return <article key={item.id}><span className="attentionIcon">!</span><div><StatusChip status={item.status}/><h4>{item.ticketNumber||"Draft request"} · {item.payee||"Payee not added"}</h4><p>{clarification?"Finance needs additional information before this request can continue.":"This draft has not been submitted to Finance."}</p><small>{clarification?"Open the request to review what Finance needs.":`Last updated ${formatDate(item.updatedAt)}`}</small></div><button className="primary" onClick={()=>void open(item.id)}>{clarification?"Respond":"Continue Request"}</button></article>})}</div>:<div className="quietEmpty"><b>You’re all caught up.</b><span>No requests currently need your action.</span></div>}</section>
    <section aria-label="Request summary"><div className="sectionHeading"><div><small>REQUEST SUMMARY</small><h3>Your requests at a glance</h3></div></div><div className="requesterMetrics">
      <KpiCard icon="☷" label="Total Requests" value={String(summary.myRequests)} detail="Requests you created"/>
      <KpiCard icon="!" label="Needs My Attention" value={String(summary.needsClarification+summary.drafts)} detail="Drafts and clarifications" tone="warning"/>
      <KpiCard icon="◷" label="In Progress" value={String(summary.inProgress)} detail="With Finance" tone="info"/>
      <KpiCard icon="✓" label="Waiting for Approval" value={String(summary.pendingApproval)} detail="With an approver" tone="warning"/>
      <KpiCard icon="→" label="Ready for Payment" value={String(summary.readyForPayment)} detail="Payment not yet recorded" tone="success"/>
      <KpiCard icon="●" label="Paid" value={String(summary.paid)} detail="Payment recorded" tone="success"/>
    </div></section>
    <section className="card"><header><div><small>RECENT REQUESTS</small><h3>Recently updated</h3></div><button className="textButton" onClick={viewAll}>View all requests →</button></header>{recent.length?<div className="requesterRecent requesterRecentDetailed">{recent.map(item=><button key={item.id} onClick={()=>void open(item.id)}><span><b>{item.ticketNumber||"Draft request"}</b><small>{item.payee||"Payee not added"} · {item.purpose||"Purpose not added"}</small></span><span>{formatMoney(item.currency,item.amount)}</span><span><StatusChip status={item.status}/><small>Next: {requesterStatusPresentation[item.status].action}</small></span><span>{formatDate(item.updatedAt)}</span><strong>View →</strong></button>)}</div>:<div className="emptyState"><b>You haven’t submitted any payment requests yet.</b><span>Create a request when you need Finance to process a payment.</span><button className="primary" onClick={newRequest}>Create Request</button></div>}</section>
  </section>
}

function ReportingRequestDrill({api,drill,back}:{api:Api;drill:Extract<DashboardDrill,{view:"REPORTING_REQUESTS"}>;back:()=>void}) {
  const [data,setData]=useState<{items:Array<Record<string,unknown>>;total:number}|null>(null),[notice,setNotice]=useState("");
  const query=new URLSearchParams({view:drill.reportView,...Object.fromEntries(Object.entries(drill.filters).filter(([,v])=>v))}).toString();
  useEffect(()=>{let active=true;void api(`/dashboard/requests?${query}`).then((x)=>{if(active)setData(x as {items:Array<Record<string,unknown>>;total:number})}).catch((e)=>{if(active)setNotice(msg(e))});return()=>{active=false}},[api,query]);
  return <section className="card reportingDrill"><button className="back" onClick={back}>← Finance Dashboard</button><header><div><small>REPORTING VIEW · READ ONLY</small><h2>{drill.reportView==="PENDING_APPROVAL"?"Pending Approval":"High / Critical Risk"}</h2></div></header>{notice&&<p className="notice">{notice}</p>}<p>{data?.total??0} authoritative records · reporting access does not grant Approval or Payment authority.</p><div className="table">{data?.items.map((x)=><div className="reportingRow" key={String(x.id)}><span className="ticket">{String(x.ticket_number)}</span><span><b>{String(x.payee)}</b><small>{String(x.department)} · {String(x.category)}</small></span><span>{String(x.currency)} {String(x.amount)}<small>{String(x.status)}</small></span><span><b>{String(x.final_risk??"—")}</b><small>{String(x.final_priority??"—")}</small></span></div>)}</div>{data&&!data.items.length&&<p>NO DATA IN SELECTED RANGE</p>}</section>;
}

function OperationalDrill({api,drill,open,back}:{api:Api;drill:Extract<DashboardDrill,{view:"FINANCE_CONTROL"|"PAYMENT_QUEUE"}>;open:(id:string)=>Promise<void>;back:()=>void}) {
  const [rows,setRows]=useState<Item[]>([]),[notice,setNotice]=useState("");
  useEffect(()=>{let active=true;const query=new URLSearchParams(Object.entries({departmentId:drill.filters.departmentId,category:drill.filters.category}).filter(([,v])=>v)).toString(),path=`${drill.view==="FINANCE_CONTROL"?"/finance-control":"/payment-queue"}?${query}`;void api(path).then((x)=>{if(!active)return;const raw=(x as {items:Array<Record<string,unknown>>}).items;const mapped=raw.map(drill.view==="FINANCE_CONTROL"?financeQueueItem:paymentQueueItem);setRows(mapped.filter((item)=>item.status===drill.status));}).catch((e)=>{if(active)setNotice(msg(e))});return()=>{active=false}},[api,drill]);
  return <section><button className="back" onClick={back}>← Finance Dashboard</button>{notice&&<p className="notice">{notice}</p>}<List items={rows} open={open} empty={()=>Promise.resolve()} canCreate={false} requesterView={false}/></section>;
}

function FinanceIntelligenceWorkspace({api}:{api:Api}){
  const [watch,setWatch]=useState<any>(null),[answer,setAnswer]=useState<any>(null),[question,setQuestion]=useState(""),[notice,setNotice]=useState("");
  const runWatch=async()=>{try{setNotice("");setWatch(await api("/finance-intelligence/watch",{method:"POST",body:"{}"}))}catch(e){setNotice(msg(e))}};
  const ask=async(e:FormEvent)=>{e.preventDefault();try{setNotice("");setAnswer(await api("/finance-intelligence/ask",{method:"POST",body:JSON.stringify({question})}))}catch(error){setNotice(msg(error))}};
  return <section className="aiWorkspace"><header><div><small>AI FINANCE INTELLIGENCE · READ ONLY</small><h2>Interpretation, grounded in authorized evidence</h2><p>AI can summarize and explain. It cannot approve, calculate authoritative balances, or change workflow state.</p></div><AuthorityBadge ai>AI INTERPRETATION</AuthorityBadge></header>{notice&&<div className="aiDisabled" role="status"><b>AI Finance Intelligence is unavailable.</b><span>The deterministic Finance Dashboard remains available.</span></div>}<div className="aiWorkspaceGrid"><section className="aiPanel"><div className="sectionHeading"><div><small>FINANCE WATCH</small><h3>Operational interpretation</h3></div><AuthorityBadge ai>AI INTERPRETATION</AuthorityBadge></div><p>Generate a bounded, evidence-backed reading of the current authorized finance position.</p><button className="aiButton" onClick={()=>void runWatch()}>Generate Finance Watch</button>{watch&&<article><h4>{String(watch.headline??"Finance Watch")}</h4><p>{String(watch.summary??watch.interpretation??"Interpretation generated from authorized evidence.")}</p></article>}</section><section className="aiPanel"><div className="sectionHeading"><div><small>ASK AIMS</small><h3>Ask about finance evidence</h3></div><AuthorityBadge ai>AI INTERPRETATION</AuthorityBadge></div><form onSubmit={ask}><label htmlFor="aims-question">Question</label><textarea id="aims-question" value={question} onChange={e=>setQuestion(e.target.value)} placeholder="What requires Finance attention?" required/><button className="aiButton">Ask AIMS</button></form>{answer&&<article><h4>Advisory response</h4><p>{String(answer.answer??answer.response??"Response generated from authorized evidence.")}</p></article>}</section></div><footer><AuthorityBadge>SYSTEM CALCULATED DATA REMAINS AUTHORITATIVE</AuthorityBadge><span>AI OFF preserves the complete deterministic workflow.</span></footer></section>;
}

function FinanceDashboard({ api, onDrill }: { api: Api; onDrill: (drill:DashboardDrill)=>void }) {
  const [summary, setSummary] = useState<any>(null),
    [budget, setBudget] = useState<any[]>([]),
    [trend, setTrend] = useState<any[]>([]),
    [workflow, setWorkflow] = useState<any>(null),
    [usage, setUsage] = useState<any>(null),
    [notice, setNotice] = useState(""),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<any>(null),
    [watch, setWatch] = useState<any>(null),
    [scope, setScope] = useState<{departments:Array<{id:string;name:string}>}|null>(null),
    [filters, setFilters] = useState<DashboardFilterState>({ dateFrom:"", dateTo:"", departmentId:"", category:"" });
  const query = new URLSearchParams(Object.entries(filters).filter(([,v])=>v)).toString();
  useEffect(() => {
    let active = true;
    void Promise.all([
      api(`/dashboard/finance-summary?${query}`),
      api(`/dashboard/budget?${query}`),
      api(`/dashboard/spending-trend?${query}`),
      api(`/dashboard/workflow?${query}`),
      api(`/dashboard/ai-usage?${query}`),
      api("/dashboard/reporting-scope"),
    ])
      .then(([s, b, t, w, u, reportingScope]) => {
        if (active) {
          setSummary(s);
          setBudget((b as any).items);
          setTrend((t as any).items);
          setWorkflow(w);
          setUsage(u);
          setScope(reportingScope as {departments:Array<{id:string;name:string}>});
        }
      })
      .catch((e) => {
        if (active) setNotice(msg(e));
      });
    return () => {
      active = false;
    };
  }, [api, query]);
  async function generateWatch() {
    try {
      setWatch(
        await api("/finance-intelligence/watch", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([,v])=>v))),
        }),
      );
    } catch (e) {
      setNotice(msg(e));
    }
  }
  async function ask() {
    try {
      setAnswer(
        await api("/finance-intelligence/ask", {
          method: "POST",
          body: JSON.stringify({ question, ...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)) }),
        }),
      );
    } catch (e) {
      setNotice(msg(e));
    }
  }
  if (!summary)
    return (
      <section className="card">
        <p>{notice || "Loading authoritative finance data…"}</p>
      </section>
    );
  const utilisation = summary.financial.utilisationBasisPoints === null ? null : summary.financial.utilisationBasisPoints / 100,
    availableNegative = String(summary.financial.available).startsWith("-"),
    numericAmount = (value: unknown) => Number(String(value).replace(/[^0-9.-]/g, "")) || 0,
    trendMaximum = Math.max(0, ...trend.map((entry: any) => numericAmount(entry.amount))),
    vendorMaximum = Math.max(0, ...summary.vendors.map((entry: any) => numericAmount(entry.amount)));
  const drill = (view:DashboardDrill["view"],reportView?:"PENDING_APPROVAL"|"RISK_ATTENTION") => onDrill(view==="REPORTING_REQUESTS"?{view,reportView:reportView!,filters}:view==="PAYMENT_HISTORY"?{view,filters:{...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)),status:"PAID"}}:view==="FINANCE_CONTROL"?{view,status:"FINANCE_HOLD",filters}:{view,status:"READY_FOR_PAYMENT",filters});
  return (
    <section className="dashboard">
      <header className="dashboardHero">
        <div>
          <small>11 · FINANCE DASHBOARD</small>
          <h2>Authoritative finance reporting</h2>
          <p>
            Live financial position and control · snapshot{" "}
            {new Date(summary.dataSnapshotAsOf).toLocaleString()}
          </p>
        </div>
        <AuthorityBadge>SYSTEM CALCULATED</AuthorityBadge>
      </header>
      {notice && <p className="notice">{notice}</p>}
      <div className="dashboardFilters" aria-label="Finance dashboard filters">
        <label><span>From</span><input type="date" value={filters.dateFrom} onChange={(e)=>setFilters(x=>({...x,dateFrom:e.target.value}))}/></label>
        <label><span>To</span><input type="date" value={filters.dateTo} onChange={(e)=>setFilters(x=>({...x,dateTo:e.target.value}))}/></label>
        <label><span>Department</span><select value={filters.departmentId} onChange={(e)=>setFilters(x=>({...x,departmentId:e.target.value}))}>
          <option value="">All authorized departments</option>
          {scope?.departments.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}
        </select></label>
        <label><span>Category</span><input placeholder="All categories" value={filters.category} onChange={(e)=>setFilters(x=>({...x,category:e.target.value}))}/></label>
        <button className="secondary" onClick={()=>setFilters({dateFrom:"",dateTo:"",departmentId:"",category:""})}>Clear</button>
      </div>
      <small>One authorized filter context applies throughout. Budget position remains live; dated metrics use the displayed source semantics.</small>
      {(filters.dateFrom || filters.dateTo) && (
        <p className="notice" role="status">
          Finance Control: current queue — live operational status, not date filtered.
        </p>
      )}
      <div className="sectionHeading"><div><small>FINANCIAL POSITION</small><h3>Live budget position</h3></div><span>Authoritative ledger</span></div>
      <div className="kpiGrid financialKpis">
        <KpiCard icon="▤" label="Active budget" value={summary.financial.budget} detail="Live approved budget" tone="info" />
        <KpiCard icon="↘" label="Actual spending" value={summary.financial.actual} detail="Authoritative ledger total" />
        <KpiCard icon="◇" label="Active committed" value={summary.financial.committed} detail="Reserved by approvals" tone="warning" />
        <KpiCard icon="◎" label="Available budget" value={summary.financial.available} detail={availableNegative?"Over committed":"Available to commit"} tone={availableNegative?"danger":"success"} />
      </div>
      <div className="sectionHeading"><div><small>OPERATIONAL FINANCE</small><h3>Current control workload</h3></div><span>Live operations</span></div>
      <div className="kpiGrid operationalKpis">
        <KpiCard icon="✓" label="Paid" value={summary.payments.paid_amount} detail={`${summary.payments.total_paid} payment records`} tone="success" onClick={()=>drill("PAYMENT_HISTORY")} />
        <KpiCard icon="→" label="Ready for payment" value={String(summary.financeControl.ready)} detail="Passed final control" tone="success" onClick={()=>drill("PAYMENT_QUEUE")} />
        <KpiCard icon="!" label="Finance holds" value={String(summary.financeControl.holds)} detail="Requires resolution" tone="warning" onClick={()=>drill("FINANCE_CONTROL")} />
        <KpiCard icon="◷" label="Pending approval" value={String(summary.requests.PENDING_APPROVAL?.count??0)} detail="Awaiting authority" onClick={()=>drill("REPORTING_REQUESTS","PENDING_APPROVAL")} />
        <KpiCard icon="▲" label="High / critical risk" value={String((summary.risk.HIGH??0)+(summary.risk.CRITICAL??0))} detail="Human final assessment" tone="danger" onClick={()=>drill("REPORTING_REQUESTS","RISK_ATTENTION")} />
      </div>
      <div className="dashboardGrid">
        <section className="card utilizationCard">
          <header><div><small>BUDGET UTILISATION</small><h3>Authoritative position</h3></div><AuthorityBadge>SYSTEM CALCULATED</AuthorityBadge></header>
          <div className="utilizationBody">
            <div className={`utilizationRing ${availableNegative?"overBudget":""}`} style={{"--utilization":Math.max(0,Math.min(utilisation??0,100))} as CSSProperties}><span><b>{utilisation===null?"—":`${utilisation.toFixed(1)}%`}</b><small>of budget used</small></span></div>
            <div className="metricLegend"><p><i className="actualDot"/>Actual spending <b>{summary.financial.actual}</b></p><p><i className="commitDot"/>Active committed <b>{summary.financial.committed}</b></p><p><i className="availableDot"/>Available budget <b>{summary.financial.available}</b></p>{availableNegative&&<strong>Budget is over committed</strong>}</div>
          </div>
        </section>
        <section className="card">
          <header>
            <div>
              <small>BUDGET PERFORMANCE</small>
              <h3>Department & category position</h3>
            </div>
          </header>
          <div className="budgetRows">
            {budget.length ? (
              budget.map((x: any) => (
                <button className="budgetDrill" key={`${x.department_id}-${x.category}`} onClick={()=>onDrill({view:"PAYMENT_HISTORY",filters:{departmentId:String(x.department_id),category:String(x.category),status:"PAID"}})}>
                  <span>
                    <b>{x.department}</b>
                    <small>{x.category}</small>
                  </span>
                  <span>
                    {x.currency} {x.actual} actual
                  </span>
                  <span>{x.available} available</span>
                  <strong
                    className={
                      x.utilisationBasisPoints >= 9000 ? "pressure" : ""
                    }
                  >
                    {x.utilisationBasisPoints === null
                      ? "NO DATA"
                      : `${(x.utilisationBasisPoints / 100).toFixed(1)}%`}
                  </strong>
                </button>
              ))
            ) : (
              <p>NO DATA IN SELECTED RANGE</p>
            )}
          </div>
        </section>
        <section className="card">
          <header>
            <div>
              <small>MONTHLY ACTUAL</small>
              <h3>Spending trend</h3>
            </div>
          </header>
          {trend.length ? (
            <div className="trendChart">{trend.map((x: any) => (
              <div className="trendRow" key={x.month}>
                <b>{x.month}</b>
                <i style={{width:`${Math.max(3, trendMaximum ? (numericAmount(x.amount)/trendMaximum)*100 : 0)}%`}}/><span>{x.amount}</span>
              </div>
            ))}</div>
          ) : (
            <p>NO PAYMENTS IN PERIOD</p>
          )}
          <small>Values come from Actual ledger posting dates.</small>
        </section>
        <section className="card">
          <header>
            <div>
              <small>WORKFLOW PRODUCTIVITY</small>
              <h3>Processing performance</h3>
            </div>
          </header>
          <p>
            Processed requests · <b>{workflow.processed}</b>
          </p>
          <p>
            Average request-to-paid ·{" "}
            <b>
              {workflow.avg_request_to_paid_seconds
                ? `${Math.round(Number(workflow.avg_request_to_paid_seconds) / 3600)} hours`
                : "NO DATA"}
            </b>
          </p>
          <p>
            AI-assisted validation · <b>{workflow.ai_validation}</b>
          </p>
          <p>
            Manual validation · <b>{workflow.manual_validation}</b>
          </p>
          <p>{workflow.timeSaved}</p>
        </section>
        <section className="card">
          <header>
            <div>
              <small>AI OPERATIONS</small>
              <h3>Usage & reliability</h3>
            </div>
          </header>
          <p>
            Calls · <b>{usage.calls}</b>
          </p>
          <p>
            Tokens · <b>{usage.total_tokens}</b>
          </p>
          <p>
            Average latency · <b>{usage.average_latency_ms} ms</b>
          </p>
          <p>
            Failures · <b>{usage.failures}</b>
          </p>
          <p>{usage.estimatedCost}</p>
        </section>
      </div>
      <section className="card topPayees"><header><div><small>TOP PAYEES</small><h3>Paid concentration</h3></div><button className="textButton" onClick={()=>drill("PAYMENT_HISTORY")}>View all →</button></header>
        {summary.vendors.length ? summary.vendors.slice(0,6).map((x:any,index:number)=><button className="payeeDrill" key={x.payee} onClick={()=>onDrill({view:"PAYMENT_HISTORY",filters:{...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)),search:x.payee,status:"PAID"}})}><span className="rank">{String(index+1).padStart(2,"0")}</span><span><b title={x.payee}>{x.payee}</b><i style={{width:`${Math.max(3, vendorMaximum ? (numericAmount(x.amount)/vendorMaximum)*100 : 0)}%`}}/></span><strong>{x.amount}<small>{x.payment_count} payments</small></strong></button>):<div className="emptyState"><b>No payment records</b><span>No paid transactions exist in the selected period.</span></div>}
      </section>
      <section className="card aiWatch">
        <header>
          <div>
            <small>12 · AI FINANCE INTELLIGENCE</small>
            <h3>Finance Watch</h3>
          </div>
          <button className="secondary aiButton" onClick={() => void generateWatch()}>
            Refresh AI insights
          </button>
        </header>
        <p>
          <AuthorityBadge ai>AI INTERPRETATION</AuthorityBadge> · generated only from the deterministic
          evidence catalog.
        </p>
        {watch?.insights?.length ? (
          watch.insights.map((x: any) => (
            <article key={x.title}>
              <span>{x.severity}</span>
              <b>{x.title}</b>
              <p>{x.summary}</p>
              <small>
                {x.evidence
                  .map((e: any) => `${e.metric}: ${e.value}`)
                  .join(" · ")}
              </small>
            </article>
          ))
        ) : <div className="emptyState aiEmpty"><b>No AI insights generated</b><span>Generate an evidence-backed interpretation of the current authorized finance context.</span><button className="secondary aiButton" onClick={() => void generateWatch()}>Generate insights</button></div>}
      </section>
      <section className="card askAims">
        <header>
          <div>
            <small>ASK AIMS</small>
            <h3>Finance copilot</h3>
          </div>
        </header>
        <div className="askForm">
          <input
            aria-label="Ask AIMS finance question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Which department has the highest budget pressure?"
            maxLength={500}
          />
          <button
            className="primary"
            disabled={question.trim().length < 2}
            onClick={() => void ask()}
          >
            Ask
          </button>
        </div>
        {answer && (
          <div>
            <p>{answer.answer}</p>
            <small>
              {answer.evidenceReferences
                ?.map((e: any) => `${e.metric}: ${e.value}`)
                .join(" · ")}
            </small>
          </div>
        )}
        <div className="assistantGuardrails"><span>Controlled analytics only</span><span>No arbitrary SQL</span><span>No bank details</span><span>Read-only</span></div>
      </section>
    </section>
  );
}

type PaymentRow = {
  id: string;
  ticketNumber: string;
  paymentDate: string;
  payee: string;
  departmentName: string;
  category: string;
  purpose: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  bankReference: string;
  status: string;
  recordedByName: string;
  recordedAt: string;
  approvalSource?: string;
  financeControlStatus?: string;
  commitmentStatus?: string;
  ledgerEntryId?: string;
};

function PaymentHistory({ api, user, initialFilters = {} }: { api: Api; user: string; initialFilters?: Record<string,string> }) {
  const [filters, setFilters] = useState({
    search: "",
    departmentId: "",
    category: "",
    dateFrom: "",
    dateTo: "",
    status: "PAID",
    page: "1", ...initialFilters,
  });
  const [rows, setRows] = useState<PaymentRow[]>([]),
    [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<PaymentRow | null>(null),
    [notice, setNotice] = useState("");
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value),
  ).toString();
  useEffect(() => {
    let active = true;
    void api(`/payments?${query}`)
      .then((value) => {
        if (!active) return;
        const result = value as { items: PaymentRow[]; total: number };
        setRows(result.items);
        setTotal(result.total);
      })
      .catch((error) => {
        if (active) setNotice(msg(error));
      });
    return () => {
      active = false;
    };
  }, [api, query]);
  async function open(id: string) {
    try {
      setDetail((await api(`/payments/${id}`)) as PaymentRow);
    } catch (error) {
      setNotice(msg(error));
    }
  }
  async function exportCsv() {
    const response = await fetch(`${API}/payments/export?${query}`, {
      headers: { "x-aims-user": user },
    });
    if (!response.ok) {
      setNotice("Payment export was denied.");
      return;
    }
    const url = URL.createObjectURL(await response.blob()),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aims-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const field = (name: keyof typeof filters, value: string) =>
    setFilters((x) => ({
      ...x,
      [name]: value,
      page: name === "page" ? value : "1",
    }));
  if (detail)
    return (
      <section className="card paymentHistory">
        <button className="back" onClick={() => setDetail(null)}>
          ← Payment History
        </button>
        <header>
          <div>
            <small>10 · PAYMENT RECORD / HISTORY</small>
            <h2>{detail.ticketNumber}</h2>
          </div>
          <i className="paid">PAID</i>
        </header>
        <div className="paymentDetail">
          <h3>Payment</h3>
          <p>
            {detail.paymentDate?.slice(0, 10)} · {detail.currency}{" "}
            {detail.amount} · {detail.paymentMethod}
          </p>
          <p>Bank reference · {detail.bankReference}</p>
          <a
            href={`${API}/payments/${detail.id}/slip`}
            onClick={(e) => {
              e.preventDefault();
              void fetch(`${API}/payments/${detail.id}/slip`, {
                headers: { "x-aims-user": user },
              }).then(async (r) => {
                if (!r.ok) throw Error("Slip access denied");
                const u = URL.createObjectURL(await r.blob());
                window.open(u, "_blank");
              });
            }}
          >
            Open secured payment slip
          </a>
          <h3>Request</h3>
          <p>
            {detail.payee} · {detail.departmentName} · {detail.category}
          </p>
          <p>{detail.purpose}</p>
          <h3>Authorization & control</h3>
          <p>Approval · {detail.approvalSource ?? "Approved"}</p>
          <p>Final Finance Control · {detail.financeControlStatus}</p>
          <h3>Financial posting</h3>
          <p>Commitment · {detail.commitmentStatus}</p>
          <p>Actual ledger · {detail.ledgerEntryId}</p>
          <h3>Audit</h3>
          <p>
            Recorded by {detail.recordedByName} at {detail.recordedAt}
          </p>
        </div>
      </section>
    );
  return (
    <section className="card paymentHistory">
      <header>
        <div>
          <small>10 · PAYMENT RECORD / HISTORY</small>
          <h2>Payment History</h2>
        </div>
        <button className="primary" onClick={() => void exportCsv()}>
          Export CSV
        </button>
      </header>
      {notice && <p className="notice">{notice}</p>}
      <div className="historyFilters">
        <input
          aria-label="Search ticket, payee or bank reference"
          placeholder="Ticket, payee or bank reference"
          value={filters.search}
          onChange={(e) => field("search", e.target.value)}
        />
        <input
          aria-label="Department ID"
          placeholder="Department ID"
          value={filters.departmentId}
          onChange={(e) => field("departmentId", e.target.value)}
        />
        <input
          aria-label="Category"
          placeholder="Category"
          value={filters.category}
          onChange={(e) => field("category", e.target.value)}
        />
        <input
          aria-label="From date"
          type="date"
          value={filters.dateFrom}
          onChange={(e) => field("dateFrom", e.target.value)}
        />
        <input
          aria-label="To date"
          type="date"
          value={filters.dateTo}
          onChange={(e) => field("dateTo", e.target.value)}
        />
        <select
          aria-label="Payment status"
          value={filters.status}
          onChange={(e) => field("status", e.target.value)}
        >
          <option value="PAID">PAID</option>
        </select>
      </div>
      <div className="table">
        {rows.map((row,index) => (
          <button key={`${row.id}-${index}`} onClick={() => void open(row.id)}>
            <span className="ticket">{row.ticketNumber}</span>
            <span>
              <b>{row.payee}</b>
              <small>
                {row.departmentName} · {row.category} · {row.purpose}
              </small>
            </span>
            <span>
              {row.currency} {row.amount}
              <small>
                {row.paymentDate?.slice(0, 10)} · {row.paymentMethod}
              </small>
            </span>
            <span>
              {row.recordedByName}
              <small>{row.recordedAt}</small>
            </span>
            <i className="paid">{row.status}</i>
            <strong>Detail →</strong>
          </button>
        ))}
      </div>
      <footer className="pagination">
        <span>{total} records</span>
        <button
          disabled={filters.page === "1"}
          onClick={() =>
            field("page", String(Math.max(1, Number(filters.page) - 1)))
          }
        >
          Previous
        </button>
        <button
          disabled={Number(filters.page) * 25 >= total}
          onClick={() => field("page", String(Number(filters.page) + 1))}
        >
          Next
        </button>
      </footer>
    </section>
  );
}

function Login({ onLogin,local,message,onRetry }: { onLogin:(id:string)=>void;local:boolean;message:string;onRetry:()=>void }) {
  const [identities,setIdentities]=useState<LocalIdentity[]>([]);
  const [loading,setLoading]=useState(local);
  const [identityError,setIdentityError]=useState("");
  const loadIdentities=useCallback(()=>{
    if(!local)return;
    setLoading(true);setIdentityError("");
    void fetch(`${API}/auth/local-identities`).then(async response=>{
      if(!response.ok)throw Error("Local identity service unavailable");
      return response.json() as Promise<{mode:string;identities:LocalIdentity[]}>;
    }).then(result=>setIdentities(result.identities)).catch(()=>setIdentityError("Unable to load approved demo identities. Check that the AIMS API is running." )).finally(()=>setLoading(false));
  },[local]);
  useEffect(()=>{void Promise.resolve().then(loadIdentities)},[loadIdentities]);
  return (
    <main className="login">
      <section className="loginStory">
        <Brand />
        <div className="loginMessage">
          <p>AIMAZING INTELLIGENT MANAGEMENT SYSTEM</p>
          <h1>Payment and finance control you can trust.</h1>
          <p className="copy">
            One controlled workflow for payment requests, validation, approval,
            final finance control, payment records, and authoritative reporting.
          </p>
          <div className="loginAssurances" aria-label="AIMS control principles">
            <span><b>12</b> distinct workflow stages</span>
            <span><b>Human</b> approval accountability</span>
            <span><b>Deterministic</b> finance controls</span>
          </div>
        </div>
        <small>AI is advisory. Finance authority remains deterministic and human-controlled.</small>
      </section>
      <aside className="loginAccess">
        <div className="loginCard">
          <header>
            <span className="loginLock" aria-hidden="true">A</span>
            <div><small>{local?"LOCAL DEVELOPMENT / DEMO LOGIN":"ORGANIZATION SIGN-IN"}</small><h2>Sign in to AIMS</h2></div>
          </header>
          <p>{local?"Choose a backend-approved synthetic identity. This selector is a local development adapter, not production authentication.":"AIMS uses your organization’s trusted identity provider. No local or fallback identity selector is available in production."}</p>
          {message&&<p className="authMessage" role="status" aria-live="polite">{message}</p>}
          {local?<>
            {loading?<div className="identityLoading" aria-live="polite">Loading approved demo identities…</div>:identityError?<div className="identityError" role="alert"><span>{identityError}</span><button onClick={loadIdentities}>Retry</button></div>:<div className="roleChoices" aria-label="Approved local demo identities">
              {identities.map(identity=><button key={identity.subject} onClick={()=>onLogin(identity.subject)}>
                <span className="roleIcon" aria-hidden="true">{identity.persona.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase()}</span>
                <span><b>{identity.persona}</b><small>{identity.displayName} · {identity.department}</small><small>{identity.workspaces.join(" + ")} workspace{identity.workspaces.length===1?"":"s"}</small></span>
                <strong aria-hidden="true">→</strong>
              </button>)}
            </div>}
            <div className="localAccessNote"><b>Local development only</b><span>Identity and authority are verified by the API. Frontend labels never grant access.</span></div>
          </>:<div className="productionAccess"><span>Secure identity proxy required</span><button className="primary" onClick={onRetry}>Check organization session</button></div>}
        </div>
        <footer>Authorized access only · Activity is auditable</footer>
      </aside>
    </main>
  );
}
function SessionProblem({message,retry}:{message:string;retry:()=>void}){
  return <main className="protectedState"><Brand/><section role="alert"><span className="stateIcon">!</span><h1>Unable to verify your session</h1><p>{message||"The AIMS session service is temporarily unavailable."}</p><button className="primary" onClick={retry}>Retry session check</button></section></main>;
}
function NoAccess({session,signOut}:{session:PortalSession|null;signOut:()=>void}){
  return <main className="protectedState"><Brand/><section><span className="stateIcon" aria-hidden="true">—</span><h1>No workspace access</h1><p>Your account{session?` (${session.user.displayName})`:""} is active, but no AIMS workspace is currently assigned.</p><p>Contact your system administrator or Finance administrator if this is unexpected.</p><button className="primary" onClick={signOut}>Sign out</button></section></main>;
}
function Brand() {
  return (
    <div className="brand">
      <span>A</span>
      <div>
        <b>AIMS</b>
        <small>Finance Control</small>
      </div>
    </div>
  );
}
function List({
  items,
  open,
  empty,
  canCreate,
  requesterView,
  paymentOnly=false,
  api,
}: {
  items: Item[];
  open: (id: string) => void;
  empty: () => void;
  canCreate: boolean;
  requesterView:boolean;
  paymentOnly?:boolean;
  api?:Api;
}) {
  const [requesterFilters,setRequesterFilters]=useState({search:"",status:"",dateFrom:"",dateTo:""});
  const [requesterRows,setRequesterRows]=useState(items);
  useEffect(()=>{if(!requesterView||!api)return;let active=true;const base={pageSize:"100",...Object.fromEntries(Object.entries(requesterFilters).filter(([,value])=>value))};const paymentStatuses=requesterFilters.status?[requesterFilters.status]:["READY_FOR_PAYMENT","PAID"],work=paymentOnly?Promise.all(paymentStatuses.map(status=>api(`/requester/requests?${new URLSearchParams({...base,status}).toString()}`))).then(results=>results.flatMap(result=>(result as {items:Array<Record<string,unknown>>}).items)):api(`/requester/requests?${new URLSearchParams(base).toString()}`).then(result=>(result as {items:Array<Record<string,unknown>>}).items);void work.then(rows=>{if(active)setRequesterRows(rows.map(requesterListItem))}).catch(()=>undefined);return()=>{active=false}},[api,paymentOnly,requesterFilters,requesterView]);
  const visibleItems=requesterView?(paymentOnly?requesterRows.filter(item=>item.status==="READY_FOR_PAYMENT"||item.status==="PAID"):requesterRows):items;
  return (
    <section className="card">
      <header>
        <div>
          <small>{requesterView?(paymentOnly?"PAYMENT STATUS":"MY REQUESTS"):"AUTHORIZED WORK QUEUE"}</small>
          <h2>{requesterView?(paymentOnly?"Ready and completed payments":"Payment requests"):"Current requests"}</h2>
        </div>
        <span>{visibleItems.length} records</span>
      </header>
      {requesterView&&<div className="requesterFilters" aria-label="Filter my requests"><label>Search<input value={requesterFilters.search} onChange={event=>setRequesterFilters(value=>({...value,search:event.target.value}))} placeholder="Ticket, payee or purpose"/></label><label>Status<select value={requesterFilters.status} onChange={event=>setRequesterFilters(value=>({...value,status:event.target.value}))}><option value="">All statuses</option>{Object.entries(requesterStatusPresentation).filter(([status])=>!paymentOnly||status==="READY_FOR_PAYMENT"||status==="PAID").map(([status,meta])=><option key={status} value={status}>{meta.label}</option>)}</select></label><label>From<input type="date" value={requesterFilters.dateFrom} onChange={event=>setRequesterFilters(value=>({...value,dateFrom:event.target.value}))}/></label><label>To<input type="date" value={requesterFilters.dateTo} onChange={event=>setRequesterFilters(value=>({...value,dateTo:event.target.value}))}/></label><button className="secondary" onClick={()=>setRequesterFilters({search:"",status:"",dateFrom:"",dateTo:""})}>Clear</button></div>}
      {visibleItems.length ? (
        <div className={`table ${requesterView?"requesterRequestList":""}`}>
          {visibleItems.map((x,index) => (
            <button className={requesterView&&requesterNeedsAction(x.status)?"requiresAction":""} key={`${x.id}-${index}`} onClick={() => open(x.id)}>
              <span className="ticket">
                {x.ticketNumber ?? "Draft · no ticket"}
              </span>
              <span>
                <b>{x.payee ?? "Untitled request"}</b>
                <small>{x.purpose ?? "Capture not completed"}</small>
                {requesterView&&<small>{x.submittedAt?`Submitted ${formatDate(x.submittedAt)}`:"Not submitted to Finance"}</small>}
              </span>
              <span>{formatMoney(x.currency,x.amount)}</span>
              {x.humanFinalRisk && <span>Human risk: {x.humanFinalRisk}</span>}
              <span className="requestProgress"><StatusChip status={x.status}/>{requesterView&&<><small>Next owner: {requesterStatusPresentation[x.status].owner}</small><small>{requesterStatusPresentation[x.status].action}</small></>}</span>
              {requesterView&&<span>{formatDate(x.updatedAt)}<small>Updated</small></span>}
              <strong>Open →</strong>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>{items.length?"No requests match these filters":paymentOnly?"No completed payments yet.":"You haven’t submitted any payment requests yet."}</h3>
          <p>{items.length?"Clear or change the filters to see more requests.":paymentOnly?"Requests will appear here when they are ready for payment or paid.":"Create a request when you need Finance to process a payment."}</p>
          {canCreate && (
            <button className="primary" onClick={empty}>
              Start first request
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Editor({
  item,
  user,
  requesterView,
  api,
  changed,
  back,
}: {
  item: Item;
  user: string;
  requesterView:boolean;
  api: Api;
  changed: () => Promise<void>;
  back: () => void;
}) {
  const [form, setForm] = useState(item),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [fieldErrors,setFieldErrors]=useState<Record<string,string>>({}),
    [confirming,setConfirming]=useState(false),
    [submittedTicket,setSubmittedTicket]=useState<string|null>(null);
  const draft = item.status === "DRAFT";
  const field = (name: keyof Item, value: string) =>
    setForm((x) => ({ ...x, [name]: value }));
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (e) {
      setNotice(requesterView?humanizeRequestError(e):msg(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await persistDraft();
  }
  async function persistDraft(successMessage="Draft saved. This request has not been submitted to Finance.") {
    await act(async () => {
      const {
        payee,
        purpose,
        category,
        amount,
        currency,
        dueDate,
        paymentMethod,
        paymentDetails,
        remark,
      } = form;
      await api(`/payment-requests/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          payee,
          purpose,
          category,
          amount,
          currency,
          dueDate,
          paymentMethod,
          paymentDetails,
          remark,
        }),
      });
      await changed();
      setNotice(successMessage);
    });
  }
  async function submit() {
    if (confirm("Submit this request as a controlled snapshot?"))
      await act(async () => {
        const x = (await api(`/payment-requests/${item.id}/submit`, {
          method: "POST",
          body: "{}",
        })) as Item;
        await changed();
        setNotice(`Submitted as ${x.ticketNumber}.`);
      });
  }
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    await act(async () => {
      await api(`/payment-requests/${item.id}/documents`, {
        method: "POST",
        body: new FormData(target),
      });
      await changed();
      target.reset();
      setNotice("Document attached.");
    });
  }
  async function remove(id: string) {
    await act(async () => {
      await api(`/payment-requests/${item.id}/documents/${id}`, {
        method: "DELETE",
      });
      await changed();
    });
  }
  function reviewRequesterSubmission(){
    const required:Record<string,string>={payee:"Enter the person or organization to be paid.",purpose:"Explain what this payment is for.",category:"Enter a payment category.",amount:"Enter a valid payment amount.",currency:"Select a currency.",dueDate:"Select when Finance should complete the payment.",paymentMethod:"Select a payment method.",paymentDetails:"Provide the information Finance needs to complete the payment."};
    const next=Object.fromEntries(Object.entries(required).filter(([name])=>!String(form[name as keyof Item]??"").trim()));
    if(form.amount&&!/^\d+(\.\d{1,4})?$/.test(form.amount)||Number(form.amount)<=0)next.amount="Enter a valid payment amount greater than zero.";
    setFieldErrors(next);
    if(Object.keys(next).length){setNotice("Complete the highlighted fields before reviewing your request.");requestAnimationFrame(()=>document.getElementById(`request-${Object.keys(next)[0]}`)?.focus());return;}
    setNotice("");setConfirming(true);
  }
  async function confirmRequesterSubmission(){
    setConfirming(false);
    await act(async()=>{
      const {payee,purpose,category,amount,currency,dueDate,paymentMethod,paymentDetails,remark}=form;
      await api(`/payment-requests/${item.id}`,{method:"PATCH",body:JSON.stringify({payee,purpose,category,amount,currency,dueDate,paymentMethod,paymentDetails,remark})});
      const submitted=await api(`/payment-requests/${item.id}/submit`,{method:"POST",body:"{}"}) as Item;
      setSubmittedTicket(submitted.ticketNumber??"Submitted request");await changed();
    });
  }
  if(requesterView)return <RequesterRequestExperience item={item} form={form} field={field} fieldErrors={fieldErrors} busy={busy} notice={notice} submittedTicket={submittedTicket} confirming={confirming} setConfirming={setConfirming} save={save} reviewSubmission={reviewRequesterSubmission} confirmSubmission={confirmRequesterSubmission} upload={upload} remove={remove} api={api} changed={changed} back={back}/>;
  return (
    <section className="editor">
      <button className="back" onClick={back}>
        ← Request register
      </button>
      <header>
        <div>
          <small>{item.ticketNumber ?? "REQUEST INITIATION"}</small>
          <h2>{item.payee || "New payment request"}</h2>
        </div>
        <StatusChip status={item.status}/>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {!requesterView&&item.status !== "DRAFT" && (
        <ValidationPanel item={item} user={user} api={api} changed={changed} />
      )}
      {!requesterView&&[
        "VALIDATING",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) && (
        <FinanceContextPanel item={item} user={user} api={api} />
      )}
      {!requesterView&&[
        "VALIDATING",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) && (
        <FinancialAnalysisPanel item={item} user={user} api={api} />
      )}
      {!requesterView&&item.status === "VALIDATING" && user === "demo.finance" && (
        <FinancialHumanReview item={item} api={api} />
      )}
      {!requesterView&&[
        "VALIDATING",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) && (
        <PolicyDecisionPanel item={item} user={user} api={api} />
      )}
      {!requesterView&&[
        "VALIDATING",
        "PENDING_APPROVAL",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
        "REJECTED",
        "NEEDS_CLARIFICATION",
      ].includes(item.status) && (
        <ApprovalPanel item={item} user={user} api={api} changed={changed} />
      )}
      {!requesterView&&[
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) &&
        user === "demo.finance" && (
          <FinanceControlPanel item={item} api={api} changed={changed} />
        )}
      {!requesterView&&["READY_FOR_PAYMENT", "PAID"].includes(item.status) &&
        user === "demo.finance" && (
          <PaymentPanel item={item} api={api} changed={changed} />
        )}
      <div className="editorGrid">
        <form className="capture" onSubmit={save}>
          <div className="formTitle">
            <span>02</span>
            <p>
              <b>Request Capture</b>
              <small>
                Capture facts only. Validation begins only after submission.
              </small>
            </p>
          </div>
          <div className="fields">
            <Field
              label="Payee"
              value={form.payee}
              set={(v) => field("payee", v)}
              disabled={!draft}
            />
            <Field
              label="Category"
              value={form.category}
              set={(v) => field("category", v)}
              disabled={!draft}
            />
            <Field
              label="Purpose"
              value={form.purpose}
              set={(v) => field("purpose", v)}
              disabled={!draft}
              wide
            />
            <Field
              label="Amount"
              value={form.amount}
              set={(v) => field("amount", v)}
              disabled={!draft}
            />
            <label>
              Currency
              <select
                value={form.currency ?? ""}
                onChange={(e) => field("currency", e.target.value)}
                disabled={!draft}
              >
                <option value="">Select</option>
                {["MYR", "USD", "SGD", "EUR", "GBP"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input
                type="date"
                value={form.dueDate ?? ""}
                onChange={(e) => field("dueDate", e.target.value)}
                disabled={!draft}
              />
            </label>
            <label>
              Payment method
              <select
                value={form.paymentMethod ?? ""}
                onChange={(e) => field("paymentMethod", e.target.value)}
                disabled={!draft}
              >
                <option value="">Select</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CARD">Corporate card</option>
                <option value="CASH">Cash</option>
              </select>
            </label>
            <Field
              label="Payment details"
              value={form.paymentDetails}
              set={(v) => field("paymentDetails", v)}
              disabled={!draft}
              wide
            />
            <Field
              label="Remark"
              value={form.remark}
              set={(v) => field("remark", v)}
              disabled={!draft}
              wide
            />
          </div>
          {draft && (
            <footer>
              <button disabled={busy}>Save draft</button>
              <button
                type="button"
                className="primary"
                onClick={submit}
                disabled={busy}
              >
                Submit request →
              </button>
            </footer>
          )}
        </form>
        <aside className="right">
          <section id="supporting-documents">
            <small>SUPPORTING DOCUMENTS</small>
            {(draft || item.status === "NEEDS_CLARIFICATION") && (
              <form className="upload" onSubmit={upload}>
                <label>Supporting document<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label>
                <label>Document type<input name="documentType" placeholder="Optional" /></label>
                <button disabled={busy}>Upload document</button>
                <small>PDF, JPG or PNG · maximum 10 MB</small>
              </form>
            )}
            {item.documents?.map((d) => (
              <div className="document" key={d.id}>
                <span>DOC</span>
                <p>
                  <b>{d.original_filename}</b>
                  <small>
                    v{d.version} · {Math.ceil(Number(d.size_bytes) / 1024)} KB
                  </small>
                </p>
                {draft && <button type="button" aria-label={`Remove ${d.original_filename}`} onClick={() => remove(d.id)}>×</button>}
              </div>
            ))}
            {!item.documents?.length && (
              <p className="muted">No documents attached.</p>
            )}
          </section>
          <section>
            <small>ACTIVITY</small>
            {item.audit?.map((a) => (
              <div className="activity" key={a.id}>
                <i />
                <p>
                  <b>{a.action.replaceAll("_", " ")}</b>
                  <small>{new Date(a.occurred_at).toLocaleString()}</small>
                </p>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </section>
  );
}

function RequesterRequestExperience({item,form,field,fieldErrors,busy,notice,submittedTicket,confirming,setConfirming,save,reviewSubmission,confirmSubmission,upload,remove,api,changed,back}:{item:Item;form:Item;field:(name:keyof Item,value:string)=>void;fieldErrors:Record<string,string>;busy:boolean;notice:string;submittedTicket:string|null;confirming:boolean;setConfirming:(value:boolean)=>void;save:(event:FormEvent)=>Promise<void>;reviewSubmission:()=>void;confirmSubmission:()=>Promise<void>;upload:(event:FormEvent<HTMLFormElement>)=>Promise<void>;remove:(id:string)=>Promise<void>;api:Api;changed:()=>Promise<void>;back:()=>void}){
  const draft=item.status==="DRAFT";
  if(submittedTicket)return <section className="requesterSuccess" role="status"><span aria-hidden="true">✓</span><small>REQUEST SUBMITTED</small><h2>{submittedTicket}</h2><p>Finance can now begin reviewing your request. If Finance needs more information, AIMS will highlight it in Needs My Attention.</p><div><button className="primary" onClick={()=>void changed()}>View Request</button><button onClick={back}>Back to My Requests</button></div></section>;
  return <section className="requesterRequestExperience">
    <button className="back" onClick={back}>← My Requests</button>
    <header className="requesterRequestHeader"><div><small>{item.ticketNumber??"DRAFT · NOT SUBMITTED"}</small><h2>{draft?"New Payment Request":item.payee||"Payment request"}</h2><p>{draft?"Complete the sections below, attach supporting documents, then review before submitting.":item.purpose}</p></div><StatusChip status={item.status}/></header>
    {notice&&<p className="notice" role="status" aria-live="polite">{notice}</p>}
    {draft?<>
      <form className="requesterDraftForm" onSubmit={save} noValidate>
        <section><header><span>1</span><div><small>PAYMENT DETAILS</small><h3>What is this payment for?</h3></div></header><div className="fields">
          <Field id="request-payee" label="Payee / Payer" value={form.payee} set={value=>field("payee",value)} disabled={false} required error={fieldErrors.payee}/>
          <Field id="request-category" label="Category" value={form.category} set={value=>field("category",value)} disabled={false} required error={fieldErrors.category}/>
          <Field id="request-purpose" label="Purpose" help="Explain what this payment is for." value={form.purpose} set={value=>field("purpose",value)} disabled={false} required error={fieldErrors.purpose} wide/>
          <Field id="request-amount" label="Amount" value={form.amount} set={value=>field("amount",value)} disabled={false} required error={fieldErrors.amount}/>
          <label className={fieldErrors.currency?"fieldInvalid":""} htmlFor="request-currency"><span>Currency <b>Required</b></span><select id="request-currency" value={form.currency??""} onChange={event=>field("currency",event.target.value)} aria-invalid={Boolean(fieldErrors.currency)} aria-describedby={fieldErrors.currency?"request-currency-error":undefined}><option value="">Select currency</option>{["MYR","USD","SGD","EUR","GBP"].map(value=><option key={value}>{value}</option>)}</select>{fieldErrors.currency&&<small id="request-currency-error" role="alert">{fieldErrors.currency}</small>}</label>
          <label className={fieldErrors.dueDate?"fieldInvalid":""} htmlFor="request-dueDate"><span>Due Date <b>Required</b></span><small>When should Finance complete this payment?</small><input id="request-dueDate" type="date" value={form.dueDate??""} onChange={event=>field("dueDate",event.target.value)} aria-invalid={Boolean(fieldErrors.dueDate)} aria-describedby={fieldErrors.dueDate?"request-dueDate-error":undefined}/>{fieldErrors.dueDate&&<small id="request-dueDate-error" role="alert">{fieldErrors.dueDate}</small>}</label>
          <label><span>Department</span><small>Your assigned department will be used.</small><input value="Your assigned department" disabled/></label>
        </div></section>
        <section><header><span>2</span><div><small>PAYMENT METHOD</small><h3>How should Finance complete it?</h3></div></header><div className="fields">
          <label className={fieldErrors.paymentMethod?"fieldInvalid":""} htmlFor="request-paymentMethod"><span>Payment Method <b>Required</b></span><select id="request-paymentMethod" value={form.paymentMethod??""} onChange={event=>field("paymentMethod",event.target.value)} aria-invalid={Boolean(fieldErrors.paymentMethod)}><option value="">Select payment method</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Corporate card</option><option value="CASH">Cash</option></select>{fieldErrors.paymentMethod&&<small role="alert">{fieldErrors.paymentMethod}</small>}</label>
          <Field id="request-paymentDetails" label="Payment Details" help="Provide the information Finance needs to complete the external payment." value={form.paymentDetails} set={value=>field("paymentDetails",value)} disabled={false} required error={fieldErrors.paymentDetails} wide/>
          <Field id="request-remark" label="Remark" help="Add any additional context for Finance." value={form.remark} set={value=>field("remark",value)} disabled={false} optional wide/>
        </div></section>
        <footer><button disabled={busy}>Save Draft</button><span>Saving a draft does not submit it to Finance.</span></footer>
      </form>
      <RequesterDocuments item={item} editable upload={upload} remove={remove} busy={busy}/>
      <section className="requestReview"><header><span>4</span><div><small>REVIEW & SUBMIT</small><h3>Check your request</h3></div></header><div className="reviewSummary"><p><span>Payee</span><b>{form.payee||"Not added"}</b></p><p><span>Purpose</span><b>{form.purpose||"Not added"}</b></p><p><span>Amount</span><b>{formatMoney(form.currency,form.amount)}</b></p><p><span>Due date</span><b>{formatDate(form.dueDate)}</b></p><p><span>Documents</span><b>{item.documents?.length??0} attached</b></p></div><button className="primary" disabled={busy} onClick={reviewSubmission}>Review and Submit →</button></section>
      {confirming&&<div className="submitConfirmation" role="dialog" aria-modal="true" aria-labelledby="submit-title"><section><small>FINAL CONFIRMATION</small><h2 id="submit-title">Submit this request?</h2><p>After submission, Finance will begin reviewing the request. Editing becomes restricted. If corrections are needed later, Finance may request clarification or revised information.</p><div><button onClick={()=>setConfirming(false)}>Continue Editing</button><button className="primary" disabled={busy} onClick={()=>void confirmSubmission()}>Submit Request</button></div></section></div>}
    </>:<RequesterSubmittedDetail item={item} api={api} changed={changed} upload={upload} busy={busy}/>}
  </section>;
}

function RequesterDocuments({item,editable,upload,remove,busy}:{item:Item;editable:boolean;upload:(event:FormEvent<HTMLFormElement>)=>Promise<void>;remove?:(id:string)=>Promise<void>;busy:boolean}){
  return <section className="requesterDocuments" id="supporting-documents"><header><span>3</span><div><small>SUPPORTING DOCUMENTS</small><h3>Invoices and supporting files</h3><p>Upload invoices, quotations, contracts, or other relevant supporting documents.</p></div></header>{editable&&<form className="upload" onSubmit={upload}><label>Choose document<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required/></label><label>Document type <small>Optional</small><input name="documentType" placeholder="Invoice, quotation, contract…"/></label><button disabled={busy}>Upload Document</button><small>PDF, JPG or PNG · maximum 10 MB</small></form>}<div className="requesterDocumentList">{item.documents?.map(document=><article key={document.id}><span>DOC</span><div><b>{document.original_filename}</b><small>{document.document_type||"Supporting document"} · {Math.ceil(Number(document.size_bytes)/1024)} KB{document.uploaded_at?` · ${formatDate(document.uploaded_at)}`:""}</small></div>{editable&&remove&&<button aria-label={`Remove ${document.original_filename}`} onClick={()=>void remove(document.id)}>Remove</button>}</article>)}</div>{!item.documents?.length&&<div className="emptyState"><b>No documents attached</b><span>Add the files Finance needs to review this payment.</span></div>}{!editable&&<p className="documentLock">Documents are locked after submission unless Finance requests a replacement.</p>}</section>;
}

function RequesterSubmittedDetail({item,api,changed,upload,busy}:{item:Item;api:Api;changed:()=>Promise<void>;upload:(event:FormEvent<HTMLFormElement>)=>Promise<void>;busy:boolean}){
  const [response,setResponse]=useState(""),[responseNotice,setResponseNotice]=useState(""),[responding,setResponding]=useState(false);
  const active=item.clarifications?.find(value=>clarificationActionable(value.status)),history=item.clarifications??[],visibleActivity=item.audit?.filter(event=>requesterActivityVisible(event.action))??[];
  async function respond(){if(!active||!response.trim())return;setResponding(true);setResponseNotice("");try{const path=active.type==="APPROVAL"?`/payment-requests/${item.id}/approval-clarifications/${active.id}/respond`:active.type==="POLICY"?`/payment-requests/${item.id}/policy-clarifications/${active.id}/respond`:`/payment-requests/${item.id}/clarifications/${active.id}/respond`;await api(path,{method:"POST",body:JSON.stringify(active.type==="POLICY"?{justification:response.trim()}:{response:response.trim()})});setResponseNotice("Your response was submitted. Finance can continue reviewing the request.");setResponse("");await changed()}catch(error){setResponseNotice(humanizeRequestError(error))}finally{setResponding(false)}}
  return <div className="requesterSubmittedDetail"><RequesterDetailOverview item={item}/>{active&&<section className="clarificationPanel" aria-labelledby="clarification-title"><small>ACTION REQUIRED</small><h2 id="clarification-title">Finance needs information from you</h2><p>Your request cannot continue until you respond.</p><dl><div><dt>Requested by</dt><dd>{active.type==="APPROVAL"?"Approval team":active.type==="POLICY"?"Finance policy review":"Finance"}</dd></div><div><dt>Requested</dt><dd>{formatDate(active.requestedAt)}</dd></div><div><dt>Information needed</dt><dd>{active.question}</dd></div></dl><label htmlFor="clarification-response">Your response <b>Required</b></label><textarea id="clarification-response" value={response} onChange={event=>setResponse(event.target.value)} placeholder="Provide the requested information" maxLength={4000}/>{item.status==="NEEDS_CLARIFICATION"&&<RequesterDocuments item={item} editable upload={upload} busy={busy}/>}<button className="primary" disabled={responding||!response.trim()} onClick={()=>void respond()}>Submit Response</button>{responseNotice&&<p className="notice" role="status">{responseNotice}</p>}</section>}
    <section className="requestDetailsCard"><div className="sectionHeading"><div><small>REQUEST DETAILS</small><h3>Payment request</h3></div></div><dl><div><dt>Ticket</dt><dd>{item.ticketNumber}</dd></div><div><dt>Payee</dt><dd>{item.payee}</dd></div><div><dt>Purpose</dt><dd>{item.purpose}</dd></div><div><dt>Category</dt><dd>{item.category}</dd></div><div><dt>Amount</dt><dd>{formatMoney(item.currency,item.amount)}</dd></div><div><dt>Due date</dt><dd>{formatDate(item.dueDate)}</dd></div><div><dt>Payment method</dt><dd>{item.paymentMethod?.replaceAll("_"," ")}</dd></div><div><dt>Submitted</dt><dd>{formatDate(item.submittedAt)}</dd></div></dl></section>
    {!active&&<RequesterDocuments item={item} editable={false} upload={upload} busy={busy}/>}
    <section className="requesterStatusCard"><small>APPROVAL & FINANCE STATUS</small><h3>{requesterStatusPresentation[item.status].label}</h3><p>{item.status==="READY_FOR_PAYMENT"?"All required approval and Finance checks are complete. Payment has not yet been recorded.":item.status==="PAID"?"Finance has recorded the completed external payment in AIMS.":item.status==="REJECTED"?"This request was not approved. Review the requester-visible activity below for available information.":requesterStatusPresentation[item.status].action}</p></section>
    {history.length>0&&<section className="clarificationHistory"><small>CLARIFICATION HISTORY</small><h3>Conversation</h3>{history.map(entry=><article key={entry.id}><div><b>{entry.type==="APPROVAL"?"Approval team":entry.type==="POLICY"?"Finance policy review":"Finance"}</b><small>{formatDate(entry.requestedAt)}</small><p>{entry.question}</p></div>{entry.response&&<div className="requesterReply"><b>You</b><small>{formatDate(entry.respondedAt)}</small><p>{entry.response}</p></div>}{entry.status!=="OPEN"&&!entry.response&&<p className="staleClarification">This clarification is no longer active.</p>}</article>)}</section>}
    {visibleActivity.length>0&&<section className="requesterActivity"><small>ACTIVITY</small><h3>Request history</h3>{visibleActivity.map(event=><div className="activity" key={event.id}><i/><p><b>{friendlyActivity(event.action)}</b><small>{formatDate(event.occurred_at)}</small></p></div>)}</section>}
  </div>;
}

function RequesterDetailOverview({item}:{item:Item}){
  const meta=requesterStatusPresentation[item.status],current=statusStage[item.status];
  const groups=[{label:"Request Submitted",at:1},{label:"Validation",at:2},{label:"Financial Review",at:3},{label:"Approval",at:6},{label:"Final Finance Review",at:7},{label:"Payment",at:8}];
  return <section className="requesterDetailOverview" aria-label="Request progress and required actions">
    <div className="requesterSnapshot"><div><small>CURRENT STATUS</small><StatusChip status={item.status}/><p>{meta.action}</p></div><div><small>NEXT OWNER</small><b>{meta.owner}</b><p>{item.status==="PAID"?"No further action required.":meta.action}</p></div><div><small>REQUEST VALUE</small><b>{formatMoney(item.currency,item.amount)}</b><p>{item.payee||"Payee not added"}</p></div><div><small>SUBMITTED</small><b>{formatDate(item.submittedAt)}</b><p>{item.dueDate?`Due ${formatDate(item.dueDate)}`:"No due date"}</p></div></div>
    <div className="requesterJourney"><div className="sectionHeading"><div><small>PROGRESS</small><h3>Your request journey</h3></div><span>{meta.action}</span></div><div className="journeySummary" role="list" aria-label="Simplified request progress">{groups.map(group=><div role="listitem" key={group.label} className={current>group.at?"completed":current===group.at?"current":"upcoming"}><span>{current>group.at?"✓":""}</span><b>{group.label}</b></div>)}</div><details><summary>View all 12 AIMS stages</summary><div className="compactJourney" role="list">{stages.map((stage,index)=><div role="listitem" key={stage} className={index<current?"completed":index===current?item.status==="NEEDS_CLARIFICATION"||item.status==="FINANCE_HOLD"?"blocked":"current":"upcoming"}><span>{index<current?"✓":String(index+1).padStart(2,"0")}</span><b>{stage}</b></div>)}</div></details></div>
    {item.paymentSummary&&<section className="requesterPayment"><div><small>PAYMENT SUMMARY</small><h3>Paid</h3><p>Finance has recorded the completed external payment in AIMS.</p></div><dl><div><dt>Payment date</dt><dd>{formatDate(item.paymentSummary.paymentDate)}</dd></div><div><dt>Amount</dt><dd>{item.paymentSummary.currency} {(Number(item.paymentSummary.amountMinor)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div><div><dt>Method</dt><dd>{item.paymentSummary.paymentMethod.replaceAll("_"," ")}</dd></div><div><dt>Status</dt><dd><StatusChip status="PAID"/></dd></div></dl></section>}
  </section>;
}

function ValidationPanel({
  item,
  user,
  api,
  changed,
}: {
  item: Item;
  user: string;
  api: Api;
  changed: () => Promise<void>;
}) {
  type ValidationView = {
    current?: {
      source: string;
      status: string;
      overall_result?: string;
      confidence?: string;
      failure_code?: string;
    };
    findings?: Array<{
      id: string;
      code: string;
      check_status: string;
      severity: string;
      explanation: string;
      evidence: unknown[];
    }>;
    extractions?: Array<{ id: string; extraction: Record<string, unknown> }>;
    clarifications?: Array<{
      id: string;
      reason: string;
      required_response?: string;
      status: string;
    }>;
  };
  const [data, setData] = useState<ValidationView>({});
  const [remarks, setRemarks] = useState(""),
    [response, setResponse] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(
    async () =>
      setData(
        (await api(
          `/payment-requests/${item.id}/validation`,
        )) as ValidationView,
      ),
    [api, item.id],
  );
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/validation`)
      .then((value) => {
        if (active) setData(value as ValidationView);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function run(work: () => Promise<void>) {
    setNotice("");
    try {
      await work();
      await load();
      await changed();
    } catch (error) {
      setNotice(msg(error));
    }
  }
  const open = data.clarifications?.find((value) => value.status === "OPEN");
  const finalize = (overallResult: "PASS" | "CLARIFICATION_REQUIRED") =>
    run(async () => {
      await api(`/payment-requests/${item.id}/validation/manual`, {
        method: "POST",
        body: JSON.stringify({
          overallResult,
          remarks,
          requiredResponse:
            overallResult === "CLARIFICATION_REQUIRED" ? remarks : undefined,
          findings:
            overallResult === "PASS"
              ? []
              : [
                  {
                    code: "MISSING_INFORMATION",
                    status: "FAIL",
                    severity: "MEDIUM",
                    explanation: remarks,
                  },
                ],
        }),
      });
    });
  return (
    <section className="validationPanel">
      <header>
        <div>
          <small>03 · VALIDATION</small>
          <h3>Document & request validation</h3>
        </div>
        <span>
          {data.current?.overall_result ??
            data.current?.status ??
            "NOT STARTED"}
        </span>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {user === "demo.finance" && item.status === "SUBMITTED" && (
        <button
          className="primary"
          onClick={() =>
            run(async () => {
              await api(`/payment-requests/${item.id}/validation`, {
                method: "POST",
                body: "{}",
              });
            })
          }
        >
          Start validation
        </button>
      )}
      {data.current && (
        <div className="validationMeta">
          <b>{data.current.source}</b>
          <span>{data.current.status}</span>
          {data.current.confidence && (
            <span>
              Confidence {Math.round(Number(data.current.confidence) * 100)}%
            </span>
          )}
          {data.current.failure_code && (
            <span>AI unavailable · manual fallback ready</span>
          )}
        </div>
      )}
      {data.extractions?.map((value) => (
        <pre key={value.id}>{JSON.stringify(value.extraction, null, 2)}</pre>
      ))}
      {data.findings?.map((value) => (
        <article key={value.id}>
          <b>{value.code}</b>
          <i>
            {value.check_status} · {value.severity}
          </i>
          <p>{value.explanation}</p>
          <small>{value.evidence.length} evidence reference(s)</small>
        </article>
      ))}
      {user === "demo.finance" &&
        item.status === "VALIDATING" &&
        data.current?.status !== "COMPLETED" && (
          <div className="manualReview">
            <textarea
              placeholder="Validator remarks and evidence summary"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
            />
            <button onClick={() => finalize("PASS")}>Confirm PASS</button>
            <button onClick={() => finalize("CLARIFICATION_REQUIRED")}>
              Request clarification
            </button>
          </div>
        )}
      {user === "demo.requester" &&
        item.status === "NEEDS_CLARIFICATION" &&
        open && (
          <div className="manualReview">
            <p>
              <b>Clarification required</b>
              <br />
              {open.reason}
              <br />
              <small>{open.required_response}</small>
            </p>
            <textarea
              placeholder="Your response"
              value={response}
              onChange={(event) => setResponse(event.target.value)}
            />
            <button
              onClick={() =>
                run(async () => {
                  await api(
                    `/payment-requests/${item.id}/clarifications/${open.id}/respond`,
                    { method: "POST", body: JSON.stringify({ response }) },
                  );
                })
              }
            >
              Respond and resubmit
            </button>
          </div>
        )}
      {data.current?.overall_result === "PASS" && (
        <p className="readyMarker">
          Validation complete · Ready for Day 3 Finance Context. No automatic
          transition was performed.
        </p>
      )}
    </section>
  );
}
function FinanceContextPanel({
  item,
  user,
  api,
}: {
  item: Item;
  user: string;
  api: Api;
}) {
  type Money = { minor: string; decimal: string };
  type View = {
    status: string;
    exceptionCode?: string;
    fiscalYear?: number;
    category: string;
    requestCurrency: string;
    budgetCurrency?: string;
    originalBudget?: Money;
    revisedBudget?: Money;
    actual?: Money;
    committed?: Money;
    available?: Money;
    requestAmount: Money;
    projectedAvailable?: Money;
    historicalSummary?: Record<string, string | boolean>;
    readyForFinancialRiskAnalysis: boolean;
  };
  const [data, setData] = useState<View | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/finance-context`)
      .then((value) => {
        if (active) setData(value as View);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function calculate() {
    setBusy(true);
    setNotice("");
    try {
      setData(
        (await api(`/payment-requests/${item.id}/finance-context`, {
          method: "POST",
          body: "{}",
        })) as View,
      );
    } catch (error) {
      setNotice(msg(error));
    } finally {
      setBusy(false);
    }
  }
  const amount = (money?: Money) =>
    money ? `${data?.requestCurrency ?? "MYR"} ${money.decimal}` : "—";
  return (
    <section className="financeContextPanel">
      <header>
        <div>
          <small>04 · FINANCE CONTEXT</small>
          <h3>Authoritative financial context</h3>
        </div>
        <span>SYSTEM CALCULATED</span>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {!data && user === "demo.finance" && (
        <button className="primary" disabled={busy} onClick={calculate}>
          {busy ? "Calculating…" : "Calculate Finance Context"}
        </button>
      )}
      {!data && user !== "demo.finance" && (
        <p className="muted">Finance Context has not been calculated.</p>
      )}
      {data && (
        <>
          <div className="financeStatus">
            <b>{data.status}</b>
            <span>Fiscal year {data.fiscalYear ?? "—"}</span>
            <span>{data.category}</span>
          </div>
          {data.exceptionCode ? (
            <>
              <p className="financeException">
                <b>Finance Context exception</b>
                <br />
                {data.exceptionCode.replaceAll("_", " ")} · Finance attention is
                required before Stage 5.
              </p>
              {user === "demo.finance" && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setData(
                        (await api(
                          `/payment-requests/${item.id}/finance-context/recalculate`,
                          { method: "POST", body: "{}" },
                        )) as View,
                      );
                    } catch (error) {
                      setNotice(msg(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Recalculate after correction
                </button>
              )}
            </>
          ) : (
            <>
              <div className="financeGrid">
              {[
                  ["Original budget", amount(data.originalBudget)],
                  ["Revised budget", amount(data.revisedBudget)],
                  ["Actual spending", amount(data.actual)],
                  ["Active commitments", amount(data.committed)],
                  ["Available budget", amount(data.available)],
                  ["Current request", amount(data.requestAmount)],
                  ["Projected available", amount(data.projectedAvailable)],
                ].map(([label, value]) => (
                  <article key={label}>
                    <small>{label}</small>
                    <b>{value}</b>
                  </article>
                ))}
              </div>
              <p className="financeFormula">
                AVAILABLE = REVISED − ACTUAL − ACTIVE COMMITMENTS
              </p>
            </>
          )}
          {data.readyForFinancialRiskAnalysis && (
            <p className="readyMarker">
              Finance Context complete · Ready for Day 4 Financial Risk
              Analysis. No automatic transition was performed.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function FinancialAnalysisPanel({
  item,
  user,
  api,
}: {
  item: Item;
  user: string;
  api: Api;
}) {
  type Agent = {
    agent: string;
    status: string;
    result?: {
      summary?: string;
      confidence?: number;
      findings?: Array<{
        code: string;
        explanation: string;
        evidenceReferences: unknown[];
      }>;
    };
    failure_code?: string;
  };
  type View = {
    id: string;
    source: string;
    status: string;
    ai_assessment?: {
      riskLevel?: string;
      priority?: string;
      urgency?: string;
      summary?: string;
      disagreements?: string[];
    };
    final_risk?: string;
    final_priority?: string;
    agents: Agent[];
    readyForPolicyEvaluation: boolean;
  };
  const [data, setData] = useState<View | null>(null),
    [notice, setNotice] = useState(""),
    [risk, setRisk] = useState("MEDIUM"),
    [priority, setPriority] = useState("NORMAL");
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/financial-analysis`)
      .then((v) => {
        if (active) setData(v as View);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function start() {
    try {
      const value = (await api(
        `/payment-requests/${item.id}/financial-analysis`,
        { method: "POST", body: "{}" },
      )) as View | { mode: string };
      if ("id" in value) setData(value);
      else
        setNotice(
          value.mode === "MANUAL"
            ? "AI Assistance: Disabled · Complete the manual assessment."
            : "AI assistance unavailable · Continue manually.",
        );
    } catch (e) {
      setNotice(msg(e));
    }
  }
  async function manual() {
    try {
      setData(
        (await api(`/payment-requests/${item.id}/financial-analysis/manual`, {
          method: "POST",
          body: JSON.stringify({
            riskLevel: risk,
            priority,
            urgency: priority,
            riskFlags: [],
            financialAssessment: "Finance Context reviewed by Finance.",
            spendingAssessment: "Authoritative historical metrics reviewed.",
            complianceRemarks: "Current Validation and evidence reviewed.",
            evidenceReferences: [
              {
                source: "FINANCE_CONTEXT",
                reference: "current Finance Context snapshot",
                field: "projected_available_amount_minor",
              },
            ],
            remarks: "Manual financial assessment",
          }),
        })) as View,
      );
    } catch (e) {
      setNotice(msg(e));
    }
  }
  return (
    <section className="financialAnalysisPanel">
      <header>
        <div>
          <small>05 · FINANCIAL RISK ANALYSIS</small>
          <h3>Evidence-backed financial intelligence</h3>
        </div>
        <span>{data?.status ?? "NOT STARTED"}</span>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {!data && user === "demo.finance" && (
        <div className="analysisActions">
          <button onClick={start}>Start AI-assisted analysis</button>
          <select aria-label="Manual final risk" value={risk} onChange={(e) => setRisk(e.target.value)}>
            <option>LOW</option>
            <option>MEDIUM</option>
            <option>HIGH</option>
            <option>CRITICAL</option>
          </select>
          <select
            aria-label="Manual final priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option>LOW</option>
            <option>NORMAL</option>
            <option>HIGH</option>
            <option>URGENT</option>
          </select>
          <button onClick={manual}>Complete manually</button>
        </div>
      )}
      {data && (
        <>
          <div className="agentGrid">
            {data.agents.map((a) => (
              <article key={a.agent}>
                <small>{a.agent.replaceAll("_", " ")}</small>
                <b>{a.status}</b>
                <p>
                  {a.result?.summary ??
                    (a.failure_code
                      ? "AI assistance unavailable."
                      : "No result")}
                </p>
                <em>
                  {a.result?.findings?.length ?? 0} evidence-backed finding(s)
                </em>
              </article>
            ))}
          </div>
          {data.ai_assessment && (
            <div className="consolidated">
              <small>AI RECOMMENDATION</small>
              <h4>
                {data.ai_assessment.riskLevel} RISK ·{" "}
                {data.ai_assessment.priority} PRIORITY
              </h4>
              <p>{data.ai_assessment.summary}</p>
              {data.ai_assessment.disagreements?.map((x) => (
                <p key={x}>Disagreement: {x}</p>
              ))}
            </div>
          )}
          {data.status === "FINALIZED" && (
            <div className="humanFinal">
              <small>HUMAN FINAL ASSESSMENT</small>
              <h4>
                {data.final_risk} RISK · {data.final_priority} PRIORITY
              </h4>
            </div>
          )}
          {data.readyForPolicyEvaluation && (
            <p className="readyMarker">
              Financial Risk Analysis finalized · Ready for Day 5 Policy
              Evaluation. No automatic transition was performed.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function FinancialHumanReview({ item, api }: { item: Item; api: Api }) {
  type View = {
    id: string;
    status: string;
    ai_assessment?: { riskLevel?: string; priority?: string };
  };
  const [data, setData] = useState<View | null>(null),
    [risk, setRisk] = useState("MEDIUM"),
    [priority, setPriority] = useState("NORMAL"),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/financial-analysis`)
      .then((value) => {
        if (active) setData(value as View);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  if (data?.status !== "AWAITING_HUMAN_REVIEW") return null;
  async function finalize() {
    if (!data) return;
    try {
      await api(
        `/payment-requests/${item.id}/financial-analysis/${data.id}/finalize`,
        {
          method: "POST",
          body: JSON.stringify({
            riskLevel: risk,
            priority,
            urgency: priority,
            riskFlags: [],
            financialAssessment: "Finance Context reviewed by Finance.",
            spendingAssessment: "Authoritative historical metrics reviewed.",
            complianceRemarks: "Current Validation and evidence reviewed.",
            evidenceReferences: [
              {
                source: "FINANCE_CONTEXT",
                reference: "current Finance Context snapshot",
                field: "projected_available_amount_minor",
              },
            ],
            remarks: "Human final assessment",
            overrideReason:
              data.ai_assessment &&
              (data.ai_assessment.riskLevel !== risk ||
                data.ai_assessment.priority !== priority)
                ? "Finance reviewer adjusted the AI recommendation."
                : undefined,
          }),
        },
      );
      setData(
        (await api(`/payment-requests/${item.id}/financial-analysis`)) as View,
      );
    } catch (error) {
      setNotice(msg(error));
    }
  }
  return (
    <section className="humanFinal">
      <small>HUMAN REVIEW · ACCOUNTABLE FINAL ASSESSMENT</small>
      {notice && <p className="notice">{notice}</p>}
      <select aria-label="Human final risk" value={risk} onChange={(event) => setRisk(event.target.value)}>
        <option>LOW</option>
        <option>MEDIUM</option>
        <option>HIGH</option>
        <option>CRITICAL</option>
      </select>
      <select
        aria-label="Human final priority"
        value={priority}
        onChange={(event) => setPriority(event.target.value)}
      >
        <option>LOW</option>
        <option>NORMAL</option>
        <option>HIGH</option>
        <option>URGENT</option>
      </select>
      <button onClick={finalize}>Finalize assessment</button>
    </section>
  );
}
function PolicyDecisionPanel({
  item,
  user,
  api,
}: {
  item: Item;
  user: string;
  api: Api;
}) {
  type Step = {
    sequence: number;
    requiredRole: string;
    authorityScope: string;
    reason: string;
  };
  type View = {
    id: string;
    result: string;
    policy_code?: string;
    policy_version?: number;
    matched_rule_ids: string[];
    approval_required: boolean;
    approval_plan: Step[];
    required_evidence: string[];
    escalation?: string;
    auto_approval_eligible: boolean;
    ready_for_approval: boolean;
    stale: boolean;
    exception_id?: string;
    exception_code?: string;
    exception_reason?: string;
    required_justification?: string;
    requested_role?: string;
    exception_status?: string;
  };
  const [data, setData] = useState<View | null>(null),
    [notice, setNotice] = useState(""),
    [justification, setJustification] = useState("");
  const load = useCallback(
    async () => {
      try {
        setData(
          (await api(`/payment-requests/${item.id}/policy-evaluation`)) as View,
        );
      } catch {
        const history = (await api(
          `/payment-requests/${item.id}/policy-evaluation/history`,
        )) as View[];
        setData(history[0] ?? null);
      }
    },
    [api, item.id],
  );
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        return (await api(
          `/payment-requests/${item.id}/policy-evaluation`,
        )) as View;
      } catch {
        const history = (await api(
          `/payment-requests/${item.id}/policy-evaluation/history`,
        )) as View[];
        return history[0] ?? null;
      }
    })()
      .then((v) => {
        if (active) setData(v);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function evaluate() {
    setNotice("");
    try {
      await api(`/payment-requests/${item.id}/policy-evaluation`, {
        method: "POST",
        body: "{}",
      });
      await load();
    } catch (error) {
      setNotice(msg(error));
    }
  }
  async function respond() {
    if (!data?.exception_id) return;
    setNotice("");
    try {
      await api(
        `/payment-requests/${item.id}/policy-clarifications/${data.exception_id}/respond`,
        { method: "POST", body: JSON.stringify({ justification }) },
      );
      setNotice("Justification recorded. Policy re-evaluation is required.");
      await load();
    } catch (error) {
      setNotice(msg(error));
    }
  }
  return (
    <section className="policyPanel">
      <header>
        <div>
          <small>06 · SYSTEM POLICY</small>
          <h3>Policy &amp; Decision</h3>
        </div>
        <span>{data?.result ?? "NOT EVALUATED"}</span>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {!data && user === "demo.finance" && (
        <button className="primary" onClick={evaluate}>
          Evaluate active policy
        </button>
      )}
      {data && (
        <>
          <div className="financeStatus">
            <b>
              {data.policy_code ?? "No applicable policy"}
              {data.policy_version ? ` · v${data.policy_version}` : ""}
            </b>
            <span>{data.stale ? "STALE" : "CURRENT"}</span>
            <span>Matched rules: {data.matched_rule_ids?.length ?? 0}</span>
          </div>
          <div className="financeGrid">
            <article>
              <small>Approval required</small>
              <b>{data.approval_required ? "YES" : "NO"}</b>
            </article>
            <article>
              <small>Auto-approval eligible</small>
              <b>{data.auto_approval_eligible ? "YES" : "NO"}</b>
            </article>
            <article>
              <small>Ready for Approval</small>
              <b>{data.ready_for_approval ? "YES" : "NO"}</b>
            </article>
          </div>
          {data.approval_plan?.length > 0 && (
            <div className="consolidated">
              <small>APPROVAL PLAN · ROLE REQUIREMENTS ONLY</small>
              {data.approval_plan.map((s) => (
                <p key={`${s.sequence}-${s.requiredRole}`}>
                  <b>
                    {s.sequence}. {s.requiredRole}
                  </b>{" "}
                  · {s.authorityScope}
                  <br />
                  {s.reason}
                </p>
              ))}
            </div>
          )}
          {data.required_evidence?.length > 0 && (
            <p>
              <b>Required evidence:</b> {data.required_evidence.join(", ")}
            </p>
          )}
          {data.escalation && (
            <p>
              <b>Escalation:</b> {data.escalation}
            </p>
          )}
          {data.result === "JUSTIFICATION_REQUIRED" && (
            <div className="financeException">
              <b>{data.exception_code?.replaceAll("_", " ")}</b>
              <p>{data.exception_reason}</p>
              <small>
                Required from {data.requested_role}:{" "}
                {data.required_justification}
              </small>
              {data.exception_status === "OPEN" && (
                <>
                  <textarea
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Controlled policy justification"
                  />
                  <button onClick={respond}>Submit justification</button>
                </>
              )}
            </div>
          )}
          {data.exception_status === "JUSTIFIED" && user === "demo.finance" && (
            <button onClick={evaluate}>Re-evaluate policy</button>
          )}
          {data.ready_for_approval && (
            <p className="readyMarker">
              System Policy complete · ready to create the controlled Approval
              case.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function ApprovalPanel({
  item,
  user,
  api,
  changed,
}: {
  item: Item;
  user: string;
  api: Api;
  changed: () => Promise<void>;
}) {
  type Step = {
    id: string;
    sequence: number;
    required_role: string;
    authority_scope: string;
    reason: string;
    status: string;
    completed_at?: string;
  };
  type View = {
    case: null | {
      id: string;
      status: string;
      policy_decision_run_id: string;
      source: string;
    };
    steps: Step[];
    readyForFinanceControl: boolean;
    commitmentStatus?: string;
    detail?: Record<string, unknown>;
    evidence?: Array<Record<string, unknown>>;
    history?: Array<Record<string, unknown>>;
  };
  const [data, setData] = useState<View | null>(null),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState("");
  const load = useCallback(
    async () =>
      setData((await api(`/payment-requests/${item.id}/approval`)) as View),
    [api, item.id],
  );
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/approval`)
      .then((v) => {
        if (active) setData(v as View);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function create() {
    try {
      await api(`/payment-requests/${item.id}/approval`, {
        method: "POST",
        body: "{}",
      });
      await load();
      await changed();
    } catch (e) {
      setNotice(msg(e));
    }
  }
  async function action(
    step: Step,
    kind: "APPROVE" | "REJECT" | "REQUEST_CLARIFICATION",
  ) {
    try {
      await api(
        `/payment-requests/${item.id}/approval/steps/${step.id}/actions`,
        {
          method: "POST",
          body: JSON.stringify({
            commandKey: crypto.randomUUID(),
            action: kind,
            reason: kind === "APPROVE" ? undefined : reason,
            requiredResponse:
              kind === "REQUEST_CLARIFICATION"
                ? "Provide the requested information; the request will return to Validation."
                : undefined,
          }),
        },
      );
      setReason("");
      await load();
      await changed();
    } catch (e) {
      setNotice(msg(e));
    }
  }
  const active = data?.steps.find((s) => s.status === "ACTIVE");
  return (
    <section className="policyPanel">
      <header>
        <div>
          <small>07 · HUMAN ACCOUNTABILITY</small>
          <h3>Approval</h3>
        </div>
        <span>{data?.case?.status ?? "NOT STARTED"}</span>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {!data?.case && user === "demo.finance" && (
        <button className="primary" onClick={create}>
          Create Approval case
        </button>
      )}
      {data?.case && (
        <>
          <p>
            <b>System Policy reference:</b> {data.case.policy_decision_run_id}
          </p>
          <p>
            <b>Source:</b> {data.case.source}
          </p>
          <p>
            <b>Commitment:</b> {data.commitmentStatus ?? "NOT AVAILABLE"}
          </p>
          {data.detail && (
            <div className="financeGrid">
              <article>
                <small>FINANCE CONTEXT · DETERMINISTIC</small>
                <b>Available: {String(data.detail.available_amount_minor)}</b>
                <span>
                  Projected:{" "}
                  {String(data.detail.projected_available_amount_minor)}
                </span>
              </article>
              <article>
                <small>AI ANALYSIS · ADVISORY</small>
                <b>{data.detail.ai_assessment ? "Available" : "Not used"}</b>
              </article>
              <article>
                <small>HUMAN FINAL ASSESSMENT · ACCOUNTABLE</small>
                <b>{String(data.detail.final_risk)}</b>
                <span>{String(data.detail.final_priority)}</span>
              </article>
              <article>
                <small>SYSTEM POLICY · DETERMINISTIC</small>
                <b>{String(data.detail.policy_result)}</b>
              </article>
            </div>
          )}
          <div className="consolidated">
            <small>EVIDENCE</small>
            {data.evidence?.map((e) => (
              <p key={String(e.id)}>
                {String(e.original_filename)} ·{" "}
                {String(e.document_type ?? "UNCLASSIFIED")} · v
                {String(e.version)}
              </p>
            ))}
          </div>
          <div className="consolidated">
            <small>SEQUENTIAL APPROVAL ROUTE</small>
            {data.steps.map((s) => (
              <p key={s.id}>
                <b>
                  {s.sequence}. {s.required_role}
                </b>{" "}
                · {s.authority_scope} · {s.status}
                <br />
                {s.reason}
              </p>
            ))}
          </div>
          <div className="consolidated">
            <small>APPROVAL HISTORY</small>
            {data.history?.length ? (
              data.history.map((h, i) => (
                <p key={i}>
                  {String(h.action)} · {String(h.channel)} ·{" "}
                  {String(h.required_role ?? "Policy")}
                </p>
              ))
            ) : (
              <p>No completed actions.</p>
            )}
          </div>
          {active && user === "demo.approver" && (
            <div className="financeException">
              <b>Current approval step</b>
              <p>{active.required_role} · Human decision</p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason required for reject or clarification"
              />
              <button onClick={() => action(active, "APPROVE")}>Approve</button>
              <button onClick={() => action(active, "REQUEST_CLARIFICATION")}>
                Request clarification
              </button>
              <button onClick={() => action(active, "REJECT")}>Reject</button>
            </div>
          )}
          {data.readyForFinanceControl && (
            <p className="readyMarker">
              Approval complete · ready for Final Finance Control.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function FinanceControlPanel({
  item,
  api,
  changed,
}: {
  item: Item;
  api: Api;
  changed: () => Promise<void>;
}) {
  type Check = {
    code: string;
    source: string;
    result: string;
    safe_detail?: object;
  };
  type Confirmation = { code: string; confirmed: boolean };
  type Run = {
    id: string;
    run_version: number;
    status: string;
    duplicate_status: string;
    evidence_fingerprint: string;
  };
  type View = {
    run: Run | null;
    checks: Check[];
    confirmations: Confirmation[];
    exception: null | {
      failed_check_codes: string[];
      reason: string;
      status: string;
    };
    readyForPayment: boolean;
  };
  type History = {
    id: string;
    run_version: number;
    status: string;
    is_current: boolean;
  };
  const [data, setData] = useState<View | null>(null),
    [history, setHistory] = useState<History[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const load = useCallback(async () => {
    setData(
      (await api(`/payment-requests/${item.id}/finance-control`)) as View,
    );
    setHistory(
      (
        (await api(`/payment-requests/${item.id}/finance-control/history`)) as {
          items: History[];
        }
      ).items,
    );
  }, [api, item.id]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api(`/payment-requests/${item.id}/finance-control`),
      api(`/payment-requests/${item.id}/finance-control/history`),
    ])
      .then(([view, runs]) => {
        if (active) {
          setData(view as View);
          setHistory((runs as { items: History[] }).items);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
      await load();
      await changed();
    } catch (error) {
      setNotice(msg(error));
    } finally {
      setBusy(false);
    }
  }
  const confirmations = [
    ["PAYEE_VERIFIED", "Payee identity verified"],
    ["PAYMENT_METHOD_VERIFIED", "Payment method verified"],
    ["PAYMENT_DETAILS_VERIFIED", "Payment details verified"],
    ["SUPPORTING_DOCUMENTS_VERIFIED", "Supporting documents verified"],
    ...(data?.run?.duplicate_status === "POSSIBLE_DUPLICATE"
      ? [["POSSIBLE_DUPLICATE_REVIEWED", "Possible duplicate reviewed"]]
      : []),
  ];
  const confirmed = new Set(
    data?.confirmations.filter((x) => x.confirmed).map((x) => x.code),
  );
  return (
    <section className="financeControlPanel">
      <header>
        <div>
          <small>08 · FINAL FINANCE CONTROL</small>
          <h3>Independent pre-payment verification</h3>
        </div>
        <span>{data?.run?.status ?? "NOT STARTED"}</span>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {!data?.run && item.status === "APPROVED" && (
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api(`/payment-requests/${item.id}/finance-control`, {
                method: "POST",
                body: "{}",
              });
            })
          }
        >
          Start Final Finance Control
        </button>
      )}
      {data?.run && (
        <>
          <div className="financeStatus">
            <b>Run v{data.run.run_version}</b>
            <span>
              Duplicate: {data.run.duplicate_status.replaceAll("_", " ")}
            </span>
            <span>Evidence: {data.run.evidence_fingerprint.slice(0, 12)}…</span>
          </div>
          {data.run.status === "CHECKING" && (
            <div className="controlConfirmations">
              {confirmations.map(([code, label]) => (
                <button
                  key={code}
                  disabled={busy || confirmed.has(code)}
                  onClick={() =>
                    run(async () => {
                      await api(`/finance-control/${data.run!.id}/checks`, {
                        method: "POST",
                        body: JSON.stringify({ code, confirmed: true }),
                      });
                    })
                  }
                >
                  <b>{confirmed.has(code) ? "✓" : "○"}</b> {label}
                </button>
              ))}
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`/finance-control/${data.run!.id}/finalize`, {
                      method: "POST",
                      body: JSON.stringify({ commandKey: crypto.randomUUID() }),
                    });
                  })
                }
              >
                Run deterministic controls
              </button>
            </div>
          )}
          {data.checks.length > 0 && (
            <div className="controlChecks">
              {data.checks.map((check) => (
                <p key={check.code}>
                  <b>{check.result}</b>
                  <span>{check.code.replaceAll("_", " ")}</span>
                  <small>{check.source}</small>
                </p>
              ))}
            </div>
          )}
          {data.run.status === "HOLD" && (
            <div className="financeException">
              <b>Finance Hold</b>
              <p>{data.exception?.reason}</p>
              <small>{data.exception?.failed_check_codes?.join(", ")}</small>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Resolution note required"
              />
              <button
                disabled={busy || !note.trim()}
                onClick={() =>
                  run(async () => {
                    await api(`/finance-control/${data.run!.id}/hold/resolve`, {
                      method: "POST",
                      body: JSON.stringify({ resolution: "RECHECK", note }),
                    });
                    setNote("");
                  })
                }
              >
                Resolve and recheck
              </button>
            </div>
          )}
          {data.readyForPayment && (
            <p className="readyMarker">
              Final Finance Control passed · READY FOR PAYMENT. Payment
              Processing is not implemented in Day 7.
            </p>
          )}
        </>
      )}
      <div className="controlHistory">
        <small>CONTROL HISTORY</small>
        {history.length ? (
          history.map((run) => (
            <p key={run.id}>
              v{run.run_version} · {run.status}
              {run.is_current ? " · CURRENT" : ""}
            </p>
          ))
        ) : (
          <p>No completed control runs.</p>
        )}
      </div>
    </section>
  );
}

function PaymentPanel({
  item,
  api,
  changed,
}: {
  item: Item;
  api: Api;
  changed: () => Promise<void>;
}) {
  const [slipId, setSlipId] = useState(""),
    [bankReference, setBankReference] = useState(""),
    [paymentDate, setPaymentDate] = useState(
      new Date().toISOString().slice(0, 10),
    ),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [record, setRecord] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (item.status === "PAID")
      void api(
        `/payments?search=${encodeURIComponent(item.ticketNumber ?? "")}`,
      )
        .then((x) =>
          setRecord(
            (x as { items: Record<string, unknown>[] }).items[0] ?? null,
          ),
        )
        .catch(() => undefined);
  }, [api, item.status, item.ticketNumber]);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = (await api(`/payment-requests/${item.id}/payment-slip`, {
        method: "POST",
        body: new FormData(e.currentTarget),
      })) as { id: string };
      setSlipId(result.id);
      setNotice("Payment slip secured and ready for recording.");
    } catch (error) {
      setNotice(msg(error));
    } finally {
      setBusy(false);
    }
  }
  async function pay() {
    if (
      !confirm(
        "Confirm that Finance executed this payment externally and record it as PAID?",
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/payment-requests/${item.id}/payment`, {
        method: "POST",
        body: JSON.stringify({
          commandKey: crypto.randomUUID(),
          paymentDate,
          amount: item.amount,
          currency: item.currency,
          bankReference,
          slipDocumentId: slipId,
          confirmPossibleDuplicate: false,
        }),
      });
      setNotice("External payment recorded atomically as PAID.");
      await changed();
    } catch (error) {
      setNotice(msg(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="paymentPanel">
      <header>
        <div>
          <small>09 · PAYMENT PROCESSING</small>
          <h3>
            {item.status === "PAID"
              ? "Authoritative payment record"
              : "Record external payment"}
          </h3>
        </div>
        <span>{item.status}</span>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {item.status === "PAID" ? (
        <div className="paymentSummary">
          <b>
            {String(record?.currency ?? item.currency)}{" "}
            {String(record?.amount ?? item.amount)}
          </b>
          <span>
            Bank reference · {String(record?.bankReference ?? "Protected")}
          </span>
          <span>
            Recorded by · {String(record?.recordedByName ?? "Finance")}
          </span>
          <span>
            Payment date · {String(record?.paymentDate ?? "—").slice(0, 10)}
          </span>
        </div>
      ) : (
        <>
          <div className="paymentSummary">
            <b>
              {item.currency} {item.amount}
            </b>
            <span>{item.payee}</span>
            <span>Finance Control · PASSED</span>
            <span>
              AIMS records an external payment; it does not transfer funds.
            </span>
          </div>
          <form className="paymentForm" onSubmit={upload}>
            <label>
              Payment slip
              <input
                name="file"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                required
              />
            </label>
            <button disabled={busy}>Secure slip</button>
          </form>
          <div className="paymentForm">
            <label>
              Payment date
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </label>
            <label>
              Bank reference
              <input
                value={bankReference}
                onChange={(e) => setBankReference(e.target.value)}
                maxLength={200}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !slipId || !bankReference.trim()}
              onClick={pay}
            >
              Record payment
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function financeQueueItem(x: Record<string, unknown>): Item {
  return {
    id: String(x.id),
    ticketNumber: String(x.ticket_number),
    status: String(x.status) as Item["status"],
    payee: String(x.payee),
    purpose: `Final Finance Control · ${String(x.finance_control_status ?? "NOT STARTED")}`,
    category: null,
    amount: String(x.amount),
    currency: String(x.currency),
    departmentId: String(x.department_id),
    dueDate: String(x.due_date),
    paymentMethod: null,
    paymentDetails: null,
    remark: null,
    humanFinalRisk: String(x.final_risk),
  };
}
function requesterListItem(x:Record<string,unknown>):Item{
  return {id:String(x.id),ticketNumber:x.ticket_number?String(x.ticket_number):null,status:String(x.status) as Item["status"],payee:x.payee?String(x.payee):null,purpose:x.purpose?String(x.purpose):null,category:null,amount:x.amount?String(x.amount):null,currency:x.currency?String(x.currency):null,departmentId:"",dueDate:x.due_date?String(x.due_date).slice(0,10):null,paymentMethod:null,paymentDetails:null,remark:null,submittedAt:x.submitted_at?String(x.submitted_at):null,createdAt:x.created_at?String(x.created_at):null,updatedAt:x.updated_at?String(x.updated_at):null};
}
function requesterDetailItem(safe:{request:Record<string,unknown>;documents:Array<Record<string,unknown>>;activity:Array<Record<string,unknown>>;clarifications?:Array<Record<string,unknown>>;payment?:Record<string,unknown>|null}):Item{
  const x=safe.request;
  return {...requesterListItem(x),category:x.category?String(x.category):null,departmentId:String(x.department_id),paymentMethod:x.payment_method?String(x.payment_method):null,paymentDetails:x.payment_details?String(x.payment_details):null,remark:x.remark?String(x.remark):null,documents:safe.documents.map(d=>({id:String(d.id),original_filename:String(d.original_filename),size_bytes:String(d.size_bytes),version:Number(d.version),document_type:d.document_type?String(d.document_type):undefined,uploaded_at:d.uploaded_at?String(d.uploaded_at):undefined})),audit:safe.activity.map(a=>({id:`${String(a.occurred_at)}-${String(a.action)}`,action:String(a.action),occurred_at:String(a.occurred_at)})),clarifications:(safe.clarifications??[]).map(c=>({id:String(c.id),type:String(c.clarification_type),question:String(c.question),status:String(c.status),requestedAt:String(c.requested_at),response:c.response?String(c.response):null,respondedAt:c.responded_at?String(c.responded_at):null})),paymentSummary:safe.payment?{paymentDate:String(safe.payment.payment_date).slice(0,10),status:String(safe.payment.status),amountMinor:String(safe.payment.amount_minor),currency:String(safe.payment.currency),paymentMethod:String(safe.payment.payment_method),recordedAt:String(safe.payment.recorded_at)}:null};
}

function paymentQueueItem(x: Record<string, unknown>): Item {
  return {
    id: String(x.id),
    ticketNumber: String(x.ticket_number),
    status: "READY_FOR_PAYMENT",
    payee: String(x.payee),
    purpose: "Payment Processing · Ready to record external payment",
    category: String(x.category),
    amount: String(x.amount),
    currency: String(x.currency),
    departmentId: String(x.department_id),
    dueDate: String(x.due_date),
    paymentMethod: String(x.payment_method),
    paymentDetails: null,
    remark: null,
  };
}

function Field({
  id,
  label,
  help,
  value,
  set,
  disabled,
  wide,
  required,
  optional,
  error,
}: {
  id?:string;
  label: string;
  help?:string;
  value: string | null;
  set: (v: string) => void;
  disabled: boolean;
  wide?: boolean;
  required?:boolean;
  optional?:boolean;
  error?:string;
}) {
  const describedBy=[help&&id?`${id}-help`:null,error&&id?`${id}-error`:null].filter(Boolean).join(" ")||undefined;
  return (
    <label className={`${wide ? "wide" : ""} ${error?"fieldInvalid":""}`} htmlFor={id}>
      <span>{label} {required&&<b>Required</b>}{optional&&<em>Optional</em>}</span>
      {help&&<small id={id?`${id}-help`:undefined}>{help}</small>}
      {wide ? (
        <textarea
          id={id}
          value={value ?? ""}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      ) : (
        <input
          id={id}
          value={value ?? ""}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      )}
      {error&&<small id={id?`${id}-error`:undefined} role="alert">{error}</small>}
    </label>
  );
}
function humanizeRequestError(error:unknown){
  const value=msg(error).toLowerCase();
  if(value.includes("missing required"))return "Complete all required fields before submitting your request.";
  if(value.includes("amount"))return "Enter a valid payment amount.";
  if(value.includes("due date"))return "Enter a valid due date.";
  if(value.includes("currency"))return "Select a valid currency.";
  if(value.includes("document"))return "Check the selected document and try again.";
  if(value.includes("forbidden")||value.includes("permitted"))return "You can no longer perform this action. Refresh the request to see its current status.";
  return "AIMS could not complete that action. Review the information and try again.";
}
function msg(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}
