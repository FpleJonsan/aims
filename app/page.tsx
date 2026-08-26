"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useCallback, useEffect, useState } from "react";
import "./day1.css";

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
    | "REJECTED";
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
  documents?: Array<{
    id: string;
    original_filename: string;
    size_bytes: string;
    version: number;
  }>;
  audit?: Array<{ id: string; action: string; occurred_at: string }>;
};
type Api = (path: string, init?: RequestInit) => Promise<unknown>;
type DashboardFilterState = { dateFrom:string;dateTo:string;departmentId:string;category:string };
type DashboardDrill =
  | { view:"REPORTING_REQUESTS"; reportView:"PENDING_APPROVAL"|"RISK_ATTENTION"; filters:DashboardFilterState }
  | { view:"FINANCE_CONTROL"; status:"FINANCE_HOLD"; filters:DashboardFilterState }
  | { view:"PAYMENT_QUEUE"; status:"READY_FOR_PAYMENT"; filters:DashboardFilterState }
  | { view:"PAYMENT_HISTORY"; filters:Record<string,string> };

export default function Home() {
  const [user, setUser] = useState<string | null>(null),
    [items, setItems] = useState<Item[]>([]),
    [selected, setSelected] = useState<Item | null>(null),
    [notice, setNotice] = useState(""),
    [showPaymentHistory, setShowPaymentHistory] = useState(false),
    [showDashboard, setShowDashboard] = useState(false),
    [dashboardDrill, setDashboardDrill] = useState<DashboardDrill|null>(null);
  const api = useCallback(
    async (path: string, init?: RequestInit): Promise<unknown> => {
      if (!user) throw Error("Sign in required");
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          "x-aims-user": user,
          ...(init?.body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
          ...init?.headers,
        },
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string | string[];
      };
      if (!response.ok)
        throw Error(
          Array.isArray(data.message)
            ? data.message.join(", ")
            : (data.message ?? "Request failed"),
        );
      return data;
    },
    [user],
  );
  const refresh = useCallback(async () => {
    if (user === "demo.approver") {
      const rows = (
        (await api("/approvals")) as { items: Array<Record<string, unknown>> }
      ).items;
      setItems(
        rows.map((x) => ({
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
    } else if (user === "demo.finance") {
      const control = (
        (await api("/finance-control")) as {
          items: Array<Record<string, unknown>>;
        }
      ).items;
      const payment = (
        (await api("/payment-queue")) as {
          items: Array<Record<string, unknown>>;
        }
      ).items;
      setItems(
        [
          ...control.map(financeQueueItem),
          ...payment.map(paymentQueueItem),
        ].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i),
      );
    } else if (user)
      setItems(
        ((await api("/payment-requests?pageSize=50")) as { items: Item[] })
          .items,
      );
  }, [api, user]);
  useEffect(() => {
    let active = true;
    void api(
      user === "demo.approver"
        ? "/approvals"
        : user === "demo.finance"
          ? "/finance-control"
          : "/payment-requests?pageSize=50",
    )
      .then((data) => {
        if (active) {
          const rows = (data as { items: Array<Record<string, unknown>> })
            .items;
          setItems(
            user === "demo.approver"
              ? rows.map((x) => ({
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
                }))
              : user === "demo.finance"
                ? rows.map(financeQueueItem)
                : (rows as unknown as Item[]),
          );
        }
      })
      .catch((e) => {
        if (active) setNotice(msg(e));
      });
    return () => {
      active = false;
    };
  }, [api, user]);
  async function initiate() {
    try {
      const item = (await api("/payment-requests", {
        method: "POST",
        body: "{}",
      })) as Item;
      setSelected(item);
      await refresh();
    } catch (e) {
      setNotice(msg(e));
    }
  }
  async function open(id: string) {
    try {
      setSelected((await api(`/payment-requests/${id}`)) as Item);
    } catch (e) {
      setNotice(msg(e));
    }
  }
  if (!user) return <Login onLogin={setUser} />;
  return (
    <main className="appShell">
      <aside className="sideNav">
        <Brand />
        <nav>
          <b>▦ Requests</b>
          <span>
            ◫ Validation <i>Ready</i>
          </span>
          <span>
            ◫ Finance Context <i>Ready</i>
          </span>
          <span>
            ◫ System Policy <i>Ready</i>
          </span>
          <span>
            ◫ Approval <i>Ready</i>
          </span>
          <span>
            ◫ Final Finance Control <i>Ready</i>
          </span>
        </nav>
        <button onClick={() => setUser(null)}>Sign out</button>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <small>DAY 7 · FINAL FINANCE CONTROL</small>
            <h1>
              {user === "demo.approver"
                ? "Approval inbox"
                : user === "demo.finance"
                  ? "Finance Control queue"
                  : "Payment requests"}
            </h1>
          </div>
          {user === "demo.requester" && (
            <button className="primary" onClick={initiate}>
              ＋ New request
            </button>
          )}
          {user === "demo.finance" && (
            <div className="headerActions">
              <button
                className="secondary"
                onClick={() => {
                  setShowPaymentHistory(false);
                  setShowDashboard(false);
                  setDashboardDrill(null);
                }}
              >
                Work queue
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setSelected(null);
                  setShowDashboard(false);
                  setShowPaymentHistory(true);
                  setDashboardDrill(null);
                }}
              >
                Payment History
              </button>
              <button
                className="primary"
                onClick={() => {
                  setSelected(null);
                  setShowPaymentHistory(false);
                  setShowDashboard(true);
                  setDashboardDrill(null);
                }}
              >
                Finance Dashboard
              </button>
            </div>
          )}
        </header>
        <div className="stageRail">
          {stages.map((s, i) => (
            <div className="available" key={s}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <b>{s}</b>
              <small>Available</small>
            </div>
          ))}
        </div>
        {notice && <p className="notice">{notice}</p>}
        {showDashboard && user === "demo.finance" ? (
          <FinanceDashboard api={api} onDrill={(drill) => {
            setDashboardDrill(drill);
            setShowDashboard(false);
            setShowPaymentHistory(drill.view === "PAYMENT_HISTORY");
          }} />
        ) : showPaymentHistory && user === "demo.finance" ? (
          <PaymentHistory api={api} user={user} initialFilters={dashboardDrill?.view === "PAYMENT_HISTORY" ? dashboardDrill.filters : {}} />
        ) : dashboardDrill?.view === "REPORTING_REQUESTS" ? (
          <ReportingRequestDrill api={api} drill={dashboardDrill} back={()=>setDashboardDrill(null)} />
        ) : dashboardDrill?.view === "FINANCE_CONTROL" || dashboardDrill?.view === "PAYMENT_QUEUE" ? (
          <OperationalDrill api={api} drill={dashboardDrill} open={open} back={()=>setDashboardDrill(null)} />
        ) : selected ? (
          <Editor
            item={selected}
            user={user}
            api={api}
            changed={async () => {
              setSelected(
                (await api(`/payment-requests/${selected.id}`)) as Item,
              );
              await refresh();
            }}
            back={() => {
              setSelected(null);
              void refresh();
            }}
          />
        ) : (
          <List
            items={items}
            open={open}
            empty={initiate}
            canCreate={user === "demo.requester"}
          />
        )}
      </section>
    </main>
  );
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
  return <section><button className="back" onClick={back}>← Finance Dashboard</button>{notice&&<p className="notice">{notice}</p>}<List items={rows} open={open} empty={()=>Promise.resolve()} canCreate={false}/></section>;
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
  const cards: Array<{label:string;value:string;view?:DashboardDrill["view"];reportView?:"PENDING_APPROVAL"|"RISK_ATTENTION"}> = [
    {label:"Active budget",value:summary.financial.budget},{label:"Actual spending",value:summary.financial.actual},
    {label:"Active committed",value:summary.financial.committed},{label:"Available budget",value:summary.financial.available},
    {label:"Paid",value:summary.payments.paid_amount,view:"PAYMENT_HISTORY"},{label:"Ready for payment",value:String(summary.financeControl.ready),view:"PAYMENT_QUEUE"},
    {label:"Finance holds",value:String(summary.financeControl.holds),view:"FINANCE_CONTROL"},{label:"Pending approval",value:String(summary.requests.PENDING_APPROVAL?.count??0),view:"REPORTING_REQUESTS",reportView:"PENDING_APPROVAL"},
    {label:"High / critical risk",value:String((summary.risk.HIGH??0)+(summary.risk.CRITICAL??0)),view:"REPORTING_REQUESTS",reportView:"RISK_ATTENTION"},
  ];
  return (
    <section className="dashboard">
      <header className="dashboardHero">
        <div>
          <small>11 · FINANCE DASHBOARD</small>
          <h2>Financial position & control</h2>
          <p>
            Authoritative live reporting · snapshot{" "}
            {new Date(summary.dataSnapshotAsOf).toLocaleString()}
          </p>
        </div>
        <span>SYSTEM CALCULATED</span>
      </header>
      {notice && <p className="notice">{notice}</p>}
      <div className="dashboardFilters" aria-label="Finance dashboard filters">
        <input aria-label="From date" type="date" value={filters.dateFrom} onChange={(e)=>setFilters(x=>({...x,dateFrom:e.target.value}))}/>
        <input aria-label="To date" type="date" value={filters.dateTo} onChange={(e)=>setFilters(x=>({...x,dateTo:e.target.value}))}/>
        <select aria-label="Department" value={filters.departmentId} onChange={(e)=>setFilters(x=>({...x,departmentId:e.target.value}))}>
          <option value="">All authorized departments</option>
          {scope?.departments.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <input aria-label="Category" placeholder="Category" value={filters.category} onChange={(e)=>setFilters(x=>({...x,category:e.target.value}))}/>
        <button className="secondary" onClick={()=>setFilters({dateFrom:"",dateTo:"",departmentId:"",category:""})}>Clear</button>
      </div>
      <small>One authorized filter context applies throughout. Budget position remains live; dated metrics use the displayed source semantics.</small>
      <div className="kpiGrid">
        {cards.map(({label, value, view, reportView}) => view ? (
          <button className="kpiCard" key={label} onClick={()=>onDrill(view==="REPORTING_REQUESTS"?{view,reportView:reportView!,filters}:view==="PAYMENT_HISTORY"?{view,filters:{...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)),status:"PAID"}}:view==="FINANCE_CONTROL"?{view,status:"FINANCE_HOLD",filters}:{view,status:"READY_FOR_PAYMENT",filters})}>
            <small>{label}</small>
            <b>{value}</b>
          </button>
        ):(<article key={label}><small>{label}</small><b>{value}</b></article>))}
      </div>
      <div className="dashboardGrid">
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
            trend.map((x: any) => (
              <div className="trendRow" key={x.month}>
                <b>{x.month}</b>
                <span>{x.amount}</span>
              </div>
            ))
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
      <section className="card"><header><div><small>TOP PAYEES</small><h3>Paid concentration</h3></div></header>
        {summary.vendors.length ? summary.vendors.map((x:any)=><button className="payeeDrill" key={x.payee} onClick={()=>onDrill({view:"PAYMENT_HISTORY",filters:{...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)),search:x.payee,status:"PAID"}})}><b>{x.payee}</b><span>{x.payment_count} payments · {x.amount}</span></button>):<p>NO DATA IN SELECTED RANGE</p>}
      </section>
      <section className="card aiWatch">
        <header>
          <div>
            <small>12 · AI FINANCE INTELLIGENCE</small>
            <h3>Finance Watch</h3>
          </div>
          <button className="primary" onClick={() => void generateWatch()}>
            Refresh AI insights
          </button>
        </header>
        <p>
          <b>AI INTERPRETATION</b> · generated only from the deterministic
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
        ) : (
          <p>NO AI INSIGHTS GENERATED</p>
        )}
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
        <small>
          Controlled analytics tools only · no arbitrary SQL · no bank details.
        </small>
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
        {rows.map((row) => (
          <button key={row.id} onClick={() => void open(row.id)}>
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

function Login({ onLogin }: { onLogin: (id: string) => void }) {
  return (
    <main className="login">
      <section>
        <div className="loginBrand">A</div>
        <p>AIMAZING INTELLIGENT MANAGEMENT SYSTEM</p>
        <h1>
          Payment control,
          <br />
          <em>with accountability.</em>
        </h1>
        <p className="copy">
          A secure local identity adapter provides the Day 1 request workflow.
          Production requires a trusted identity proxy.
        </p>
        <div>
          <button onClick={() => onLogin("demo.requester")}>
            Continue as requester →
          </button>
          <button className="secondary" onClick={() => onLogin("demo.finance")}>
            View as finance
          </button>
          <button
            className="secondary"
            onClick={() => onLogin("demo.approver")}
          >
            View approval inbox
          </button>
        </div>
        <small>
          LOCAL DEVELOPMENT IDENTITIES · NO PASSWORDS OR TOKENS STORED
        </small>
      </section>
      <aside>
        <p>DAY 1 SCOPE</p>
        {[
          "Authenticated shell",
          "Request initiation",
          "Request capture",
          "Document foundation",
          "Submit to SUBMITTED",
          "Audit history",
        ].map((x, i) => (
          <div key={x}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <b>{x}</b>
          </div>
        ))}
        <footer>Validation and all later stages remain inactive.</footer>
      </aside>
    </main>
  );
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
}: {
  items: Item[];
  open: (id: string) => void;
  empty: () => void;
  canCreate: boolean;
}) {
  return (
    <section className="card">
      <header>
        <div>
          <small>REQUEST REGISTER</small>
          <h2>Current requests</h2>
        </div>
        <span>{items.length} records</span>
      </header>
      {items.length ? (
        <div className="table">
          {items.map((x) => (
            <button key={x.id} onClick={() => open(x.id)}>
              <span className="ticket">
                {x.ticketNumber ?? "Draft · no ticket"}
              </span>
              <span>
                <b>{x.payee ?? "Untitled request"}</b>
                <small>{x.purpose ?? "Capture not completed"}</small>
              </span>
              <span>{x.amount ? `${x.currency} ${x.amount}` : "—"}</span>
              {x.humanFinalRisk && <span>Human risk: {x.humanFinalRisk}</span>}
              <i className={x.status.toLowerCase()}>{x.status}</i>
              <strong>Open →</strong>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>No payment requests yet</h3>
          <p>Initiate a request to create a controlled draft context.</p>
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
  api,
  changed,
  back,
}: {
  item: Item;
  user: string;
  api: Api;
  changed: () => Promise<void>;
  back: () => void;
}) {
  const [form, setForm] = useState(item),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const draft = item.status === "DRAFT";
  const field = (name: keyof Item, value: string) =>
    setForm((x) => ({ ...x, [name]: value }));
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (e) {
      setNotice(msg(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
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
      setNotice("Draft saved.");
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
        <i className={item.status.toLowerCase()}>{item.status}</i>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {item.status !== "DRAFT" && (
        <ValidationPanel item={item} user={user} api={api} changed={changed} />
      )}
      {[
        "VALIDATING",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) && (
        <FinanceContextPanel item={item} user={user} api={api} />
      )}
      {[
        "VALIDATING",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) && (
        <FinancialAnalysisPanel item={item} user={user} api={api} />
      )}
      {item.status === "VALIDATING" && user === "demo.finance" && (
        <FinancialHumanReview item={item} api={api} />
      )}
      {[
        "VALIDATING",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) && (
        <PolicyDecisionPanel item={item} user={user} api={api} />
      )}
      {[
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
      {[
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) &&
        user === "demo.finance" && (
          <FinanceControlPanel item={item} api={api} changed={changed} />
        )}
      {["READY_FOR_PAYMENT", "PAID"].includes(item.status) &&
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
                Capture facts only. Business Validation starts on Day 2.
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
          <section>
            <small>SUPPORTING DOCUMENTS</small>
            {(draft || item.status === "NEEDS_CLARIFICATION") && (
              <form className="upload" onSubmit={upload}>
                <input
                  name="file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  required
                />
                <input
                  name="documentType"
                  placeholder="Document type (optional)"
                />
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
                {draft && <button onClick={() => remove(d.id)}>×</button>}
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
          <select value={risk} onChange={(e) => setRisk(e.target.value)}>
            <option>LOW</option>
            <option>MEDIUM</option>
            <option>HIGH</option>
            <option>CRITICAL</option>
          </select>
          <select
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
      <select value={risk} onChange={(event) => setRisk(event.target.value)}>
        <option>LOW</option>
        <option>MEDIUM</option>
        <option>HIGH</option>
        <option>CRITICAL</option>
      </select>
      <select
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
    async () =>
      setData(
        (await api(`/payment-requests/${item.id}/policy-evaluation`)) as View,
      ),
    [api, item.id],
  );
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/policy-evaluation`)
      .then((v) => {
        if (active) setData(v as View);
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
  label,
  value,
  set,
  disabled,
  wide,
}: {
  label: string;
  value: string | null;
  set: (v: string) => void;
  disabled: boolean;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "wide" : ""}>
      {label}
      {wide ? (
        <textarea
          value={value ?? ""}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
        />
      ) : (
        <input
          value={value ?? ""}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
        />
      )}
    </label>
  );
}
function msg(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}
