import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Principal } from "../../domain/payment-request.js";
import { FINANCE_ANALYTICS_VERSION } from "../../domain/finance-intelligence.js";
import { minorToDecimal } from "../../domain/finance-context.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import type { DashboardFilterDto, ReportingRequestFilterDto } from "./dashboard.dto.js";

export type ReportingScope = {
  departmentId: string | null;
  departmentIds: string[] | null;
  organizationWide: boolean;
};
type Row = Record<string, string | number | null>;

@Injectable()
export class DashboardService {
  constructor(private readonly db: Postgres) {}
  async scope(actor: Principal, requested?: string): Promise<ReportingScope> {
    const q = await this.db.pool.query<{
      scope: "ORGANIZATION" | "DEPARTMENT";
      department_id: string | null;
    }>(
      "SELECT a.scope,a.department_id FROM finance_reporting_authorities a JOIN users u ON u.id=a.user_id AND u.active WHERE a.user_id=$1 AND a.active",
      [actor.id],
    );
    if (!q.rowCount)
      throw new ForbiddenException("Finance Reporting authority is required");
    const organizationWide = q.rows.some((x) => x.scope === "ORGANIZATION");
    const allowed = [...new Set(q.rows
      .map((x) => x.department_id)
      .filter((x): x is string => Boolean(x)))].sort();
    if (requested && !organizationWide && !allowed.includes(requested))
      throw new ForbiddenException("Reporting department access denied");
    return {
      departmentId: requested ?? null,
      departmentIds: requested
        ? [requested]
        : organizationWide
          ? null
          : allowed,
      organizationWide,
    };
  }
  async reportingScope(actor: Principal) {
    const scope = await this.scope(actor);
    const q = await this.db.pool.query<{ id: string; name: string }>(
      "SELECT id,name FROM departments WHERE($1::uuid[] IS NULL OR id=ANY($1)) ORDER BY name",
      [scope.departmentIds],
    );
    return { ...scope, departments: q.rows };
  }
  async reportingRequests(actor: Principal, input: ReportingRequestFilterDto) {
    const scope = await this.scope(actor, input.departmentId), [from, to] = this.range(input);
    const riskAttention = input.view === "RISK_ATTENTION";
    const parameters = [scope.departmentIds, input.category ?? null, from, to, riskAttention, input.pageSize, (input.page - 1) * input.pageSize];
    const base = `FROM payment_requests pr JOIN departments d ON d.id=pr.department_id LEFT JOIN financial_analysis_runs far ON far.payment_request_id=pr.id AND far.is_current AND far.status='FINALIZED' LEFT JOIN financial_risk_assessments fra ON fra.analysis_run_id=far.id WHERE($1::uuid[] IS NULL OR pr.department_id=ANY($1))AND($2::text IS NULL OR pr.category=$2)AND($3::date IS NULL OR pr.submitted_at::date>=$3)AND($4::date IS NULL OR pr.submitted_at::date<=$4)AND(($5::boolean AND fra.final_risk IN('HIGH','CRITICAL'))OR(NOT $5::boolean AND pr.status='PENDING_APPROVAL'))`;
    const [rows, count] = await Promise.all([
      this.db.pool.query<Row>(`SELECT pr.id,pr.ticket_number,pr.payee,pr.amount,pr.currency,d.name department,pr.department_id,pr.category,fra.final_risk,fra.final_priority,pr.status,pr.created_at,pr.submitted_at ${base} ORDER BY COALESCE(pr.submitted_at,pr.created_at)DESC,pr.id LIMIT $6 OFFSET $7`, parameters),
      this.db.pool.query<{ total: number }>(`SELECT count(*)::int total ${base}`, parameters.slice(0,5)),
    ]);
    return { view: input.view, scope: { departmentId: scope.departmentId, departmentIds: scope.departmentIds }, period: { from, to, semantics: "submitted_at" }, items: rows.rows, total: count.rows[0].total, page: input.page, pageSize: input.pageSize };
  }
  private range(q: DashboardFilterDto) {
    if (q.dateFrom && q.dateTo && q.dateFrom > q.dateTo)
      throw new ForbiddenException("Invalid reporting date range");
    return [q.dateFrom ?? null, q.dateTo ?? null] as const;
  }
  async summary(actor: Principal, input: DashboardFilterDto) {
    const scope = await this.scope(actor, input.departmentId),
      ds = scope.departmentIds,
      [from, to] = this.range(input),
      category = input.category ?? null;
    const [
      financial,
      payments,
      requests,
      risk,
      approval,
      control,
      methods,
      vendors,
    ] = await Promise.all([
      this.db.pool.query<{ currency: string; budget: string; actual: string; committed: string }>(
        `WITH components AS(
          SELECT b.currency,bv.revised_amount_minor::bigint budget,0::bigint actual,0::bigint committed
          FROM budgets b JOIN budget_versions bv ON bv.budget_id=b.id AND bv.status='ACTIVE'
          WHERE b.status='ACTIVE' AND($1::uuid[] IS NULL OR b.department_id=ANY($1))AND($2::text IS NULL OR b.category=$2)
          UNION ALL
          SELECT le.currency,0::bigint,le.amount_minor::bigint,0::bigint
          FROM financial_ledger_entries le JOIN budgets b ON b.id=le.budget_id
          WHERE b.status='ACTIVE' AND($1::uuid[] IS NULL OR b.department_id=ANY($1))AND($2::text IS NULL OR b.category=$2)
          UNION ALL
          SELECT bc.currency,0::bigint,0::bigint,bc.amount_minor::bigint
          FROM budget_commitments bc JOIN budgets b ON b.id=bc.budget_id
          WHERE bc.status='ACTIVE' AND b.status='ACTIVE' AND($1::uuid[] IS NULL OR b.department_id=ANY($1))AND($2::text IS NULL OR b.category=$2)
        )SELECT currency,sum(budget)::bigint budget,sum(actual)::bigint actual,sum(committed)::bigint committed FROM components GROUP BY currency ORDER BY currency`,
        [ds, category],
      ),
      this.db.pool.query<Row>(
        `SELECT currency,count(*)::int total_paid,COALESCE(sum(amount_minor),0)::bigint paid_amount,count(*)FILTER(WHERE payment_date>=date_trunc('month',current_date))::int paid_this_month,COALESCE(sum(amount_minor)FILTER(WHERE payment_date>=date_trunc('month',current_date)),0)::bigint paid_amount_this_month FROM payments WHERE($1::uuid[] IS NULL OR department_id=ANY($1))AND($2::text IS NULL OR category=$2)AND($3::date IS NULL OR payment_date>=$3)AND($4::date IS NULL OR payment_date<=$4)GROUP BY currency ORDER BY currency`,
        [ds, category, from, to],
      ),
      this.db.pool.query<{ status: string; currency: string; count: number; amount: string }>(
        `SELECT status,currency,count(*)::int count,COALESCE(sum((amount*100)::bigint),0)::bigint amount FROM payment_requests WHERE($1::uuid[] IS NULL OR department_id=ANY($1))AND($2::text IS NULL OR category=$2)AND($3::date IS NULL OR submitted_at::date>=$3)AND($4::date IS NULL OR submitted_at::date<=$4)GROUP BY status,currency ORDER BY status,currency`,
        [ds, category, from, to],
      ),
      this.db.pool.query<{ final_risk: string; count: number }>(
        `SELECT final_risk,count(*)::int count FROM financial_risk_assessments fra JOIN financial_analysis_runs far ON far.id=fra.analysis_run_id JOIN payment_requests pr ON pr.id=far.payment_request_id WHERE far.is_current AND far.status='FINALIZED' AND fra.final_risk IS NOT NULL AND($1::uuid[] IS NULL OR pr.department_id=ANY($1))AND($2::text IS NULL OR pr.category=$2)AND($3::date IS NULL OR pr.submitted_at::date>=$3)AND($4::date IS NULL OR pr.submitted_at::date<=$4)GROUP BY final_risk`,
        [ds, category, from, to],
      ),
      this.db.pool.query<Row>(
        `WITH scoped_cases AS(SELECT ac.id,ac.created_at,ac.completed_at FROM approval_cases ac JOIN payment_requests pr ON pr.id=ac.payment_request_id WHERE($1::uuid[] IS NULL OR pr.department_id=ANY($1))AND($2::text IS NULL OR pr.category=$2)),actions AS(SELECT count(*)FILTER(WHERE aa.action='APPROVE')::int completed,count(*)FILTER(WHERE aa.action='REJECT')::int rejected,count(*)FILTER(WHERE aa.action='REQUEST_CLARIFICATION')::int clarification FROM approval_actions aa JOIN scoped_cases sc ON sc.id=aa.approval_case_id WHERE($3::date IS NULL OR aa.acted_at::date>=$3)AND($4::date IS NULL OR aa.acted_at::date<=$4)),cycles AS(SELECT COALESCE(avg(extract(epoch FROM(completed_at-created_at))),0)::bigint avg_seconds FROM scoped_cases WHERE completed_at IS NOT NULL AND($3::date IS NULL OR completed_at::date>=$3)AND($4::date IS NULL OR completed_at::date<=$4))SELECT * FROM actions CROSS JOIN cycles`,
        [ds, category, from, to],
      ),
      this.db.pool.query<Row>(
        `SELECT count(*)FILTER(WHERE f.status='CHECKING')::int pending,count(*)FILTER(WHERE f.status='HOLD')::int holds,count(*)FILTER(WHERE f.status='PASSED' AND pr.status='READY_FOR_PAYMENT')::int ready FROM finance_control_runs f JOIN payment_requests pr ON pr.id=f.payment_request_id WHERE f.is_current AND($1::uuid[] IS NULL OR pr.department_id=ANY($1))AND($2::text IS NULL OR pr.category=$2)`,
        [ds, category],
      ),
      this.db.pool.query<Row>(
        `SELECT payment_method,currency,count(*)::int count,sum(amount_minor)::bigint amount FROM payments WHERE($1::uuid[] IS NULL OR department_id=ANY($1))AND($2::text IS NULL OR category=$2)AND($3::date IS NULL OR payment_date>=$3)AND($4::date IS NULL OR payment_date<=$4)GROUP BY payment_method,currency ORDER BY currency,amount DESC`,
        [ds, category, from, to],
      ),
      this.db.pool.query<Row>(
        `SELECT payee,currency,count(*)::int payment_count,sum(amount_minor)::bigint amount FROM payments WHERE($1::uuid[] IS NULL OR department_id=ANY($1))AND($2::text IS NULL OR category=$2)AND($3::date IS NULL OR payment_date>=$3)AND($4::date IS NULL OR payment_date<=$4)GROUP BY payee,currency ORDER BY currency,amount DESC,payee LIMIT 100`,
        [ds, category, from, to],
      ),
    ]);
    const financialPositions = financial.rows.map((f) => {
      const budget = BigInt(f.budget), actual = BigInt(f.actual), committed = BigInt(f.committed), available = budget - actual - committed;
      return {currency:f.currency,budget:money(budget),actual:money(actual),committed:money(committed),available:money(available),utilisationBasisPoints:budget>0n?Number(((budget-available)*10000n)/budget):null};
    });
    const requestSummary:Record<string,{count:number;amounts:Array<{currency:string;amount:string}>}>={};
    for(const row of requests.rows){
      const entry=requestSummary[row.status]??={count:0,amounts:[]};
      entry.count+=row.count;entry.amounts.push({currency:row.currency,amount:money(row.amount)});
    }
    return {
      analyticsVersion: FINANCE_ANALYTICS_VERSION,
      dataSnapshotAsOf: new Date().toISOString(),
      scope: { departmentId: scope.departmentId, departmentIds: ds, category },
      period: {
        from,
        to,
        semantics: {
          financialPosition:
            "Live active fiscal budgets; date range does not alter balance-sheet position",
          payments: "payment_date",
          requests: "submitted_at",
          approvals:
            "action counts use acted_at; completed case cycle uses completed_at",
          financeControl:
            "live current operational state; not restricted by selected historical date range",
        },
      },
      financialPositions,
      payments: {
        total_paid: payments.rows.reduce((total,row)=>total+Number(row.total_paid),0),
        paid_this_month: payments.rows.reduce((total,row)=>total+Number(row.paid_this_month),0),
        amounts: payments.rows.map(row=>({currency:String(row.currency),paidAmount:money(row.paid_amount!),paidAmountThisMonth:money(row.paid_amount_this_month!)})),
        methods: methods.rows.map(amountRow),
      },
      vendors: vendors.rows.map(amountRow),
      requests: requestSummary,
      risk: Object.fromEntries(risk.rows.map((x) => [x.final_risk, x.count])),
      approval: approval.rows[0],
      financeControl: control.rows[0],
    };
  }
  async budget(actor: Principal, input: DashboardFilterDto) {
    const s = await this.scope(actor, input.departmentId),
      [from, to] = this.range(input);
    const q = await this.db.pool.query<Row>(
      `WITH actuals AS(SELECT budget_id,currency,sum(amount_minor)::bigint amount FROM financial_ledger_entries GROUP BY budget_id,currency),commitments AS(SELECT budget_id,currency,sum(amount_minor)::bigint amount FROM budget_commitments WHERE status='ACTIVE' GROUP BY budget_id,currency),payment_stats AS(SELECT department_id,category,currency,count(*)::int payment_count,sum(amount_minor)::bigint paid_amount FROM payments WHERE($3::date IS NULL OR payment_date>=$3)AND($4::date IS NULL OR payment_date<=$4)GROUP BY department_id,category,currency)SELECT b.department_id,d.name department,b.category,b.cost_centre,b.currency,bv.revised_amount_minor budget,COALESCE(a.amount,0)::bigint actual,COALESCE(c.amount,0)::bigint committed,COALESCE(ps.payment_count,0)::int payment_count,COALESCE(ps.paid_amount,0)::bigint paid_amount FROM budgets b JOIN departments d ON d.id=b.department_id JOIN budget_versions bv ON bv.budget_id=b.id AND bv.status='ACTIVE' LEFT JOIN actuals a ON a.budget_id=b.id AND a.currency=b.currency LEFT JOIN commitments c ON c.budget_id=b.id AND c.currency=b.currency LEFT JOIN payment_stats ps ON ps.department_id=b.department_id AND ps.category=b.category AND ps.currency=b.currency WHERE b.status='ACTIVE' AND($1::uuid[] IS NULL OR b.department_id=ANY($1))AND($2::text IS NULL OR b.category=$2)ORDER BY d.name,b.category,b.currency LIMIT 100`,
      [s.departmentIds, input.category ?? null, from, to],
    );
    return {
      items: q.rows.map((x) => {
        const b = BigInt(x.budget!),
          a = BigInt(x.actual!),
          c = BigInt(x.committed!),
          v = b - a - c;
        return {
          ...x,
          department_id: String(x.department_id),
          department: String(x.department),
          category: String(x.category),
          cost_centre: String(x.cost_centre),
          currency: String(x.currency),
          budget: money(b),
          actual: money(a),
          committed: money(c),
          available: money(v),
          paidAmount: money(x.paid_amount!),
          paymentCount: Number(x.payment_count),
          utilisationBasisPoints:
            b > 0n ? Number(((b - v) * 10000n) / b) : null,
        };
      }),
    };
  }
  async trend(actor: Principal, input: DashboardFilterDto) {
    const s = await this.scope(actor, input.departmentId),
      [f, t] = this.range(input);
    const q = await this.db.pool.query<{
      period_month: string;
      currency: string;
      amount: string;
    }>(
      `SELECT to_char(date_trunc('month',le.posted_at),'YYYY-MM')period_month,le.currency,sum(le.amount_minor)::bigint amount FROM financial_ledger_entries le JOIN budgets b ON b.id=le.budget_id WHERE($1::uuid[] IS NULL OR b.department_id=ANY($1))AND($2::text IS NULL OR b.category=$2)AND($3::date IS NULL OR le.posted_at::date>=$3)AND($4::date IS NULL OR le.posted_at::date<=$4)GROUP BY 1,le.currency ORDER BY le.currency,1 LIMIT 240`,
      [s.departmentIds, input.category ?? null, f, t],
    );
    return {
      items: q.rows.map((x) => ({
        month: x.period_month,
        currency: x.currency,
        amount: money(x.amount),
      })),
    };
  }
  async workflow(actor: Principal, input: DashboardFilterDto) {
    const s = await this.scope(actor, input.departmentId),
      [f, t] = this.range(input);
    const q = await this.db.pool.query<Row>(
      `SELECT count(*)FILTER(WHERE pr.status='PAID')::int processed,COALESCE(avg(extract(epoch FROM(p.recorded_at-pr.submitted_at))),0)::bigint avg_request_to_paid_seconds,count(*)FILTER(WHERE vr.source='AI_ASSISTED')::int ai_validation,count(*)FILTER(WHERE vr.source='MANUAL')::int manual_validation,count(*)FILTER(WHERE pr.status='NEEDS_CLARIFICATION')::int clarification FROM payment_requests pr LEFT JOIN payments p ON p.payment_request_id=pr.id LEFT JOIN validation_runs vr ON vr.payment_request_id=pr.id AND vr.is_current WHERE($1::uuid[] IS NULL OR pr.department_id=ANY($1))AND($2::text IS NULL OR pr.category=$2)AND($3::date IS NULL OR pr.submitted_at::date>=$3)AND($4::date IS NULL OR pr.submitted_at::date<=$4)`,
      [s.departmentIds, input.category ?? null, f, t],
    );
    return { ...q.rows[0], timeSaved: "BASELINE NOT CONFIGURED" };
  }
  async paymentHighlights(actor: Principal, input: DashboardFilterDto) {
    const s = await this.scope(actor, input.departmentId),
      [f, t] = this.range(input);
    const q = await this.db.pool.query<Row>(
      `SELECT id,ticket_number,payee,amount_minor,currency,payment_date FROM payments WHERE($1::uuid[] IS NULL OR department_id=ANY($1))AND($2::text IS NULL OR category=$2)AND($3::date IS NULL OR payment_date>=$3)AND($4::date IS NULL OR payment_date<=$4)ORDER BY currency,amount_minor DESC,id LIMIT 100`,
      [s.departmentIds, input.category ?? null, f, t],
    );
    return q.rows.map((x) => ({
      id: x.id,
      ticketNumber: x.ticket_number,
      payee: x.payee,
      amount: money(x.amount_minor!),
      currency: x.currency,
      paymentDate: x.payment_date,
    }));
  }
  async aiUsage(actor: Principal, input: DashboardFilterDto) {
    const s = await this.scope(actor, input.departmentId),
      [f, t] = this.range(input);
    const q = await this.db.pool.query<Row>(
      `SELECT count(*)::int calls,COALESCE(sum(input_tokens),0)::bigint input_tokens,COALESCE(sum(output_tokens),0)::bigint output_tokens,COALESCE(sum(total_tokens),0)::bigint total_tokens,COALESCE(avg(latency_ms),0)::bigint average_latency_ms,count(*)FILTER(WHERE status='FAILED')::int failures,count(*)FILTER(WHERE NOT schema_valid)::int schema_failures FROM ai_usage_events e WHERE($1::date IS NULL OR e.created_at::date>=$1)AND($2::date IS NULL OR e.created_at::date<=$2)AND($3::uuid[] IS NULL OR EXISTS(SELECT 1 FROM payment_requests pr WHERE pr.id=e.payment_request_id AND pr.department_id=ANY($3))OR EXISTS(SELECT 1 FROM finance_insight_runs i WHERE i.id=e.finance_insight_run_id AND i.scope_department_ids&&$3)OR EXISTS(SELECT 1 FROM finance_ask_runs a WHERE a.id=e.finance_ask_run_id AND a.scope_department_ids&&$3))`,
      [f, t, s.departmentIds],
    );
    return {
      ...q.rows[0],
      estimatedCost: "COST NOT CONFIGURED",
      latencySemantics:
        "Average includes successful and failed attempts when latency is available",
    };
  }
}
function money(v: string | number | bigint) {
  return minorToDecimal(BigInt(v));
}
function amountRow<T extends Row>(x: T): T & { amount: string } {
  return { ...x, amount: money(x.amount!) };
}
