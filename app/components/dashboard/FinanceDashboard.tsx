"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { AuthorityBadge, KpiCard } from "@/app/components/shared";
import type { DashboardDrill, DashboardFilterState, PortalApi } from "@/app/lib/types";
import type {
  BudgetRow,
  FinanceDashboardSummary,
  IntelligenceAnswer,
  IntelligenceWatch,
  TrendRow,
  WorkflowSummary,
  AiUsageSummary,
  FinancialPosition,
} from "@/app/lib/dashboard-types";
import { formatMoney, msg } from "@/app/lib/utils";

export function FinanceDashboard({ api, onDrill }: { api: PortalApi; onDrill: (drill:DashboardDrill)=>void }) {
  const [summary, setSummary] = useState<FinanceDashboardSummary | null>(null),
    [budget, setBudget] = useState<BudgetRow[]>([]),
    [trend, setTrend] = useState<TrendRow[]>([]),
    [workflow, setWorkflow] = useState<WorkflowSummary | null>(null),
    [usage, setUsage] = useState<AiUsageSummary | null>(null),
    [notice, setNotice] = useState(""),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<IntelligenceAnswer | null>(null),
    [watch, setWatch] = useState<IntelligenceWatch | null>(null),
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
          setSummary(s as FinanceDashboardSummary);
          setBudget((b as { items: BudgetRow[] }).items);
          setTrend((t as { items: TrendRow[] }).items);
          setWorkflow(w as WorkflowSummary);
          setUsage(u as AiUsageSummary);
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
        (await api("/finance-intelligence/watch", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([,v])=>v))),
        })) as IntelligenceWatch,
      );
    } catch (e) {
      setNotice(msg(e));
    }
  }
  async function ask() {
    try {
      setAnswer(
        (await api("/finance-intelligence/ask", {
          method: "POST",
          body: JSON.stringify({ question, ...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)) }),
        })) as IntelligenceAnswer,
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
  const workflowView = workflow ?? {};
  const usageView = usage ?? {};
  const numericAmount = (value: unknown) => Number(String(value).replace(/[^0-9.-]/g, "")) || 0,
    trendMaximum = new Map<string,number>(),
    vendorsByCurrency = Object.groupBy(summary.vendors,(entry)=>String(entry.currency)),
    trendByCurrency = Object.groupBy(trend,(entry)=>String(entry.currency));
  for(const entry of trend) trendMaximum.set(String(entry.currency),Math.max(trendMaximum.get(String(entry.currency))??0,numericAmount(entry.amount)));
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
      <div className="sectionHeading"><div><small>A · FINANCIAL POSITION</small><h3>Live budget position by currency</h3><span>Original-currency positions · no FX conversion</span></div><AuthorityBadge>SYSTEM CALCULATED</AuthorityBadge></div>
      {summary.financialPositions.length ? summary.financialPositions.map((position: FinancialPosition)=>{
        const availableNegative=String(position.available).startsWith("-");
        return <section className="currencyPosition" key={position.currency} aria-label={`${position.currency} financial position`}><h4>{position.currency}</h4><div className="kpiGrid financialKpis">
          <KpiCard icon="▤" label="Active budget" value={formatMoney(position.currency,position.budget)} detail="System calculated · live approved budget" tone="info" />
          <KpiCard icon="↘" label="Actual spending" value={formatMoney(position.currency,position.actual)} detail="System calculated · authoritative ledger" />
          <KpiCard icon="◇" label="Active committed" value={formatMoney(position.currency,position.committed)} detail="System calculated · active reservations" tone="warning" />
          <KpiCard icon="◎" label="Available budget" value={formatMoney(position.currency,position.available)} detail={`System calculated · ${availableNegative?"over committed":"available to commit"}`} tone={availableNegative?"danger":"success"} />
        </div></section>;
      }):<div className="emptyState"><b>No financial position available</b><span>No active budget or authoritative posting exists in this scope.</span></div>}
      <div className="sectionHeading"><div><small>B · NEEDS ATTENTION</small><h3>Priorities requiring action</h3></div><span>Live operational state</span></div>
      <div className="kpiGrid attentionKpis">
        <KpiCard icon="▲" label="High / critical risk" value={String((summary.risk.HIGH??0)+(summary.risk.CRITICAL??0))} detail="Human final assessment · review risk" tone="danger" onClick={()=>drill("REPORTING_REQUESTS","RISK_ATTENTION")} />
        <KpiCard icon="◷" label="Pending approval" value={String(summary.requests.PENDING_APPROVAL?.count??0)} detail="Awaiting authorized decision" tone="info" onClick={()=>drill("REPORTING_REQUESTS","PENDING_APPROVAL")} />
        <KpiCard icon="!" label="Finance holds" value={String(summary.financeControl.holds)} detail="Requires resolution" tone="warning" onClick={()=>drill("FINANCE_CONTROL")} />
        <KpiCard icon="→" label="Ready for payment" value={String(summary.financeControl.ready)} detail="Awaiting external payment recording" tone="info" onClick={()=>drill("PAYMENT_QUEUE")} />
      </div>
      <div className="sectionHeading"><div><small>C · OPERATIONS</small><h3>Current Finance activity</h3></div><span>Controlled workflow</span></div>
      <div className="kpiGrid operationsSummary">
        {summary.payments.amounts.length ? summary.payments.amounts.map((amount: { currency: string; paidAmount: string })=><KpiCard key={amount.currency} icon="✓" label={`Paid this period · ${amount.currency}`} value={formatMoney(amount.currency,amount.paidAmount)} detail="Immutable payment records · original currency" tone="success" onClick={()=>drill("PAYMENT_HISTORY")} />):<KpiCard icon="✓" label="Paid this period" value="—" detail="No payment records in this period" tone="success" onClick={()=>drill("PAYMENT_HISTORY")} />}
        <KpiCard icon="☷" label="Requests processed" value={String(workflowView.processed)} detail="Completed operational workload" tone="info" />
        <KpiCard icon="◉" label="Average request to paid" value={workflowView.avg_request_to_paid_seconds?`${Math.round(Number(workflowView.avg_request_to_paid_seconds)/3600)} h`:"—"} detail="Measured processing time" />
      </div>
      <div className="dashboardGrid">
        {summary.financialPositions.map((position: FinancialPosition)=>{const utilisation=position.utilisationBasisPoints===null?null:position.utilisationBasisPoints/100,availableNegative=String(position.available).startsWith("-");return <section className="card utilizationCard" key={position.currency}>
          <header><div><small>BUDGET UTILISATION</small><h3>Authoritative position</h3></div><AuthorityBadge>SYSTEM CALCULATED</AuthorityBadge></header>
          <div className="utilizationBody">
            <div className={`utilizationRing ${availableNegative?"overBudget":""}`} style={{"--utilization":Math.max(0,Math.min(utilisation??0,100))} as CSSProperties}><span><b>{utilisation===null?"—":`${utilisation.toFixed(1)}%`}</b><small>{position.currency} budget used</small></span></div>
            <div className="metricLegend"><p><i className="actualDot"/>Actual spending <b>{formatMoney(position.currency,position.actual)}</b></p><p><i className="commitDot"/>Active committed <b>{formatMoney(position.currency,position.committed)}</b></p><p><i className="availableDot"/>Available budget <b>{formatMoney(position.currency,position.available)}</b></p>{availableNegative&&<strong>Budget is over committed</strong>}</div>
          </div>
        </section>})}
        <section className="card">
          <header>
            <div>
              <small>BUDGET PERFORMANCE</small>
              <h3>Department & category position</h3>
            </div>
          </header>
          <div className="budgetRows">
            {budget.length ? (
              budget.map((x: BudgetRow) => (
                <button className="budgetDrill" key={`${x.department_id}-${x.category}`} onClick={()=>onDrill({view:"PAYMENT_HISTORY",filters:{departmentId:String(x.department_id),category:String(x.category),status:"PAID"}})}>
                  <span>
                    <b>{x.department}</b>
                    <small>{x.category}</small>
                  </span>
                  <span>
                    {formatMoney(String(x.currency??""),x.actual==null?null:String(x.actual))} actual
                  </span>
                  <span>{formatMoney(String(x.currency??""),x.available==null?null:String(x.available))} available</span>
                  <strong
                    className={
                      (x.utilisationBasisPoints ?? 0) >= 9000 ? "pressure" : ""
                    }
                  >
                    {x.utilisationBasisPoints == null
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
          {trend.length ? Object.entries(trendByCurrency).map(([currency,entries])=>(
            <div className="currencySeries" key={currency}><h4>{currency}</h4><div className="trendChart">{(entries??[]).map((x: TrendRow) => (
              <div className="trendRow" key={`${currency}-${x.month}`}>
                <b>{x.month}</b>
                <i style={{width:`${Math.max(3, trendMaximum.get(currency) ? (numericAmount(x.amount)/(trendMaximum.get(currency)??1))*100 : 0)}%`}}/><span>{formatMoney(currency,x.amount)}</span>
              </div>
            ))}</div></div>
          )) : (
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
            Processed requests · <b>{workflowView.processed}</b>
          </p>
          <p>
            Average request-to-paid ·{" "}
            <b>
              {workflowView.avg_request_to_paid_seconds
                ? `${Math.round(Number(workflowView.avg_request_to_paid_seconds) / 3600)} hours`
                : "NO DATA"}
            </b>
          </p>
          <p>
            AI-assisted validation · <b>{workflowView.ai_validation}</b>
          </p>
          <p>
            Manual validation · <b>{workflowView.manual_validation}</b>
          </p>
          <p>{workflowView.timeSaved}</p>
        </section>
        <section className="card">
          <header>
            <div>
              <small>AI OPERATIONS</small>
              <h3>Usage & reliability</h3>
            </div>
          </header>
          <p>
            Calls · <b>{usageView.calls}</b>
          </p>
          <p>
            Tokens · <b>{usageView.total_tokens}</b>
          </p>
          <p>
            Average latency · <b>{usageView.average_latency_ms} ms</b>
          </p>
          <p>
            Failures · <b>{usageView.failures}</b>
          </p>
          <p>{usageView.estimatedCost}</p>
        </section>
      </div>
      <section className="card topPayees"><header><div><small>TOP PAYEES</small><h3>Paid concentration</h3></div><button className="textButton" onClick={()=>drill("PAYMENT_HISTORY")}>View all →</button></header>
        {summary.vendors.length ? Object.entries(vendorsByCurrency).map(([currency,entries])=>{const currencyEntries=entries??[],maximum=Math.max(0,...currencyEntries.map((entry)=>numericAmount(entry.amount)));return <div className="currencyPayeeGroup" key={currency}><h4>{currency}</h4>{currencyEntries.slice(0,6).map((x,index:number)=><button className="payeeDrill" key={`${currency}-${x.payee}`} onClick={()=>onDrill({view:"PAYMENT_HISTORY",filters:{...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)),search:x.payee,status:"PAID"}})}><span className="rank">{String(index+1).padStart(2,"0")}</span><span><b title={x.payee}>{x.payee}</b><i style={{width:`${Math.max(3,maximum?(numericAmount(x.amount)/maximum)*100:0)}%`}}/></span><strong>{formatMoney(currency,x.amount)}<small>{x.payment_count} payments</small></strong></button>)}</div>}):<div className="emptyState"><b>No payment records</b><span>No paid transactions exist in the selected period.</span></div>}
      </section>
      <div className="sectionHeading"><div><small>D · INTELLIGENCE</small><h3>Advisory interpretation</h3></div><AuthorityBadge ai>AI ADVISORY</AuthorityBadge></div>
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
          watch.insights.map((x) => (
            <article key={x.title}>
              <span>{x.severity}</span>
              <b>{x.title}</b>
              <p>{x.summary}</p>
              <small>
                {x.evidenceReferences
                  ?.map((e) => `${e.metric}: ${e.value}`)
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
                ?.map((e) => `${e.metric}: ${e.value}`)
                .join(" · ")}
            </small>
          </div>
        )}
        <div className="assistantGuardrails"><span>Controlled analytics only</span><span>No arbitrary SQL</span><span>No bank details</span><span>Read-only</span></div>
      </section>
    </section>
  );
}
