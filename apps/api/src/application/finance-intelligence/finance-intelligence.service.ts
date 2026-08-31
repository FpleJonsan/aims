import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { Principal } from "../../domain/payment-request.js";
import {
  ASK_AIMS_PROMPT_VERSION,
  AskAimsOutputSchema,
  FINANCE_ANALYTICS_VERSION,
  FINANCE_WATCH_PROMPT_VERSION,
  FINANCE_INTELLIGENCE_RESPONSE_SCHEMA_VERSION,
  FinanceWatchOutputSchema,
  type InsightEvidence,
  payeeEvidenceReference,
  validateEvidence,
} from "../../domain/finance-intelligence.js";
import {
  AiProviderError,
  type FinanceIntelligenceProviderResult,
} from "../../infrastructure/ai/openai-compatible-provider.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { AI_PROVIDER } from "../validation/validation.service.js";
import {
  DashboardService,
  type ReportingScope,
} from "../dashboard/dashboard.service.js";
import type { DashboardFilterDto } from "../dashboard/dashboard.dto.js";
import type {
  AskAimsDto,
  IntelligenceFilterDto,
} from "./finance-intelligence.dto.js";
interface Provider {
  analyzeFinanceIntelligence(
    kind: "FINANCE_WATCH" | "ASK_AIMS",
    input: unknown,
  ): Promise<FinanceIntelligenceProviderResult>;
}

@Injectable()
export class FinanceIntelligenceService {
  constructor(
    private readonly db: Postgres,
    private readonly dashboard: DashboardService,
    @Inject(AI_PROVIDER) private readonly provider: Provider | null,
  ) {}
  protected async enabled(feature: string) {
    const q = await this.db.pool.query<{ feature: string; enabled: boolean }>(
      "SELECT feature,enabled FROM ai_feature_configuration WHERE feature IN('AI_MASTER',$1)",
      [feature],
    );
    const m = new Map(q.rows.map((x) => [x.feature, x.enabled]));
    return Boolean(m.get("AI_MASTER") && m.get(feature));
  }
  private filter(x: IntelligenceFilterDto) {
    return {
      dateFrom: x.dateFrom,
      dateTo: x.dateTo,
      departmentId: x.departmentId,
      category: x.category,
      page: 1,
      pageSize: 25,
    };
  }
  private evidence(
    summary: Awaited<ReturnType<DashboardService["summary"]>>,
    budget: Awaited<ReturnType<DashboardService["budget"]>>,
    trend: Awaited<ReturnType<DashboardService["trend"]>>,
    workflow: Awaited<ReturnType<DashboardService["workflow"]>>,
  ) {
    const items: InsightEvidence[] = [];
    for (const position of summary.financialPositions)
      for (const [k, v] of Object.entries(position))
        if (k !== "currency" && (k !== "utilisationBasisPoints" || v !== null))
          items.push({
            metric: `financial.${k}`,
            reference: `FINANCIAL_POSITION:${position.currency}:AUTHORIZED_SCOPE`,
            value:
              k === "utilisationBasisPoints"
                ? String(v)
                : `${position.currency} ${String(v)}`,
          });
    for (const x of budget.items.slice(0, 20))
      items.push({
        metric: "department.utilisationBasisPoints",
        reference: `DEPARTMENT:${String(x.department_id)}:${String(x.currency)}`,
        value: x.utilisationBasisPoints ?? "NO_DATA",
      });
    for (const x of trend.items.slice(0, 12))
      items.push({
        metric: "monthly.actual",
        reference: `MONTH:${String(x.month)}:${x.currency}`,
        value: `${x.currency} ${x.amount}`,
      });
    for (const [k, v] of Object.entries(workflow))
      items.push({
        metric: `workflow.${k}`,
        reference: "WORKFLOW:SELECTED_PERIOD",
        value: String(v),
      });
    for (const x of budget.items.slice(0, 20)) {
      const reference = `CATEGORY:${String(x.department_id)}:${safeKey(String(x.category))}:${String(x.currency)}`;
      for (const metric of [
        "budget",
        "actual",
        "committed",
        "available",
        "utilisationBasisPoints",
        "paidAmount",
        "paymentCount",
      ] as const)
        items.push({
          metric: `category.${metric}`,
          reference,
          value:
            metric === "utilisationBasisPoints" || metric === "paymentCount"
              ? String(x[metric] ?? "NO_DATA")
              : `${String(x.currency)} ${String(x[metric] ?? "NO_DATA")}`,
        });
    }
    const totalPaidByCurrency = new Map<string, bigint>();
    for (const x of summary.vendors) {
      const currency = String(x.currency);
      totalPaidByCurrency.set(
        currency,
        (totalPaidByCurrency.get(currency) ?? 0n) +
          decimalToMinor(String(x.amount)),
      );
    }
    for (const x of summary.vendors.slice(0, 20)) {
      const amount = decimalToMinor(String(x.amount));
      const currency = String(x.currency);
      const totalPaid = totalPaidByCurrency.get(currency) ?? 0n;
      const reference = `${payeeEvidenceReference(String(x.payee))}:${currency}`;
      items.push({
        metric: "payee.paidAmount",
        reference,
        value: `${currency} ${String(x.amount)}`,
      });
      items.push({
        metric: "payee.paymentCount",
        reference,
        value: Number(x.payment_count),
      });
      items.push({
        metric: "payee.shareBasisPoints",
        reference,
        value: totalPaid > 0n ? Number((amount * 10000n) / totalPaid) : 0,
      });
    }
    return items.slice(0, 80);
  }
  async watch(actor: Principal, input: IntelligenceFilterDto) {
    const filter = this.filter(input),
      scope = await this.dashboard.scope(actor, input.departmentId);
    if (!(await this.enabled("FINANCE_WATCH")))
      throw new ConflictException("AI Finance Watch is disabled");
    if (!this.provider)
      throw new ServiceUnavailableException("AI Finance Watch is unavailable");
    const [summary, budget, trend, workflow] = await Promise.all([
        this.dashboard.summary(actor, filter),
        this.dashboard.budget(actor, filter),
        this.dashboard.trend(actor, filter),
        this.dashboard.workflow(actor, filter),
      ]),
      catalog = this.evidence(summary, budget, trend, workflow),
      allowed = evidenceMap(catalog),
      id = randomUUID(),
      started = Date.now();
    let attempt: FinanceIntelligenceProviderResult | null = null;
    try {
      const result = await this.provider.analyzeFinanceIntelligence(
        "FINANCE_WATCH",
        {
          analyticsVersion: FINANCE_ANALYTICS_VERSION,
          period: summary.period,
          dataSnapshotAsOf: summary.dataSnapshotAsOf,
          dataQuality: {
            historyPeriods: trend.items.length,
            status:
              trend.items.length < 2 ? "INSUFFICIENT_HISTORY" : "SUFFICIENT",
          },
          evidenceCatalog: catalog,
          maxInsights: 20,
        },
      );
      attempt = result;
      const output = FinanceWatchOutputSchema.parse(result.output);
      for (const insight of output.insights) validateEvidence(insight, allowed);
      await this.db.transaction(async (c) => {
        await c.query(
          `INSERT INTO finance_insight_runs(id,requested_by,scope_department_id,scope_department_ids,period_from,period_to,source_analytics_version,data_snapshot_as_of,status,provider,model,prompt_version,input_tokens,output_tokens,total_tokens,latency_ms,context,result)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            id,
            actor.id,
            scope.departmentId,
            scope.departmentIds,
            input.dateFrom ?? null,
            input.dateTo ?? null,
            FINANCE_ANALYTICS_VERSION,
            summary.dataSnapshotAsOf,
            trend.items.length < 2 ? "INSUFFICIENT_DATA" : "COMPLETED",
            result.provider,
            result.model,
            FINANCE_WATCH_PROMPT_VERSION,
            result.inputTokens,
            result.outputTokens,
            result.totalTokens,
            result.latencyMs,
            JSON.stringify({
              period: summary.period,
              evidenceCatalog: catalog,
              responseSchemaVersion:
                FINANCE_INTELLIGENCE_RESPONSE_SCHEMA_VERSION,
              correlationId: id,
              actorId: actor.id,
              aiMode: "AI_ENABLED",
              providerAttempts: result.providerAttempts ?? 1,
              cost: "UNKNOWN",
            }),
            JSON.stringify(output),
          ],
        );
        await c.query(
          `INSERT INTO ai_usage_events(id,agent,provider,model,prompt_version,input_tokens,output_tokens,total_tokens,latency_ms,status,schema_valid,finance_insight_run_id,retry_count,estimated_cost)VALUES($1,'FINANCE_INSIGHT_AGENT',$2,$3,$4,$5,$6,$7,$8,'COMPLETED',true,$9,$10,NULL)`,
          [
            randomUUID(),
            result.provider,
            result.model,
            FINANCE_WATCH_PROMPT_VERSION,
            result.inputTokens,
            result.outputTokens,
            result.totalTokens,
            result.latencyMs,
            id,
            result.retryCount ?? 0,
          ],
        );
      });
      return {
        id,
        generatedAt: new Date().toISOString(),
        dataSnapshotAsOf: summary.dataSnapshotAsOf,
        period: summary.period,
        ...output,
      };
    } catch (error) {
      await this.persistWatchFailure({
        id,
        actor,
        scope,
        input,
        error,
        started,
        catalog,
        attempt,
      });
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : "Finance Watch failed",
      );
    }
  }
  async latest(actor: Principal, input: IntelligenceFilterDto) {
    const scope = await this.dashboard.scope(actor, input.departmentId),
      q = await this.db.pool.query(
        "SELECT id,status,result,generated_at,data_snapshot_as_of,period_from,period_to,failure_classification FROM finance_insight_runs WHERE(scope_department_ids IS NOT DISTINCT FROM $1)ORDER BY generated_at DESC LIMIT 1",
        [scope.departmentIds],
      );
    return q.rows[0] ?? null;
  }
  async history(actor: Principal, input: IntelligenceFilterDto) {
    const scope = await this.dashboard.scope(actor, input.departmentId),
      q = await this.db.pool.query(
        "SELECT id,run_version,status,provider,model,prompt_version,total_tokens,latency_ms,generated_at,data_snapshot_as_of,period_from,period_to,failure_classification FROM finance_insight_runs WHERE(scope_department_ids IS NOT DISTINCT FROM $1)ORDER BY generated_at DESC LIMIT 25",
        [scope.departmentIds],
      );
    return { items: q.rows };
  }
  async ask(actor: Principal, input: AskAimsDto) {
    const filter = this.filter(input),
      scope = await this.dashboard.scope(actor, input.departmentId);
    if (!(await this.enabled("ASK_AIMS")))
      throw new ConflictException("Ask AIMS is disabled");
    if (!this.provider)
      throw new ServiceUnavailableException("Ask AIMS is unavailable");
    const classification = classify(input.question),
      tools = await this.tools(actor, filter, classification),
      catalog = tools.evidenceCatalog,
      allowed = evidenceMap(catalog),
      id = randomUUID(),
      started = Date.now();
    let attempt: FinanceIntelligenceProviderResult | null = null;
    try {
      const result = await this.provider.analyzeFinanceIntelligence(
        "ASK_AIMS",
        {
          question: input.question,
          untrustedQuestion: true,
          classification,
          authorizedScope: {
            departmentId: scope.departmentId,
            departmentIds: scope.departmentIds,
          },
          authorizedProjection: {
            toolNames: tools.names,
            evidenceItemCount: catalog.length,
          },
          evidenceCatalog: catalog,
          limits: { maxToolCalls: 3, maxRowsPerTool: 20, maxEvidenceItems: 20 },
          prohibited: [
            "SQL",
            "bank references",
            "payment details",
            "system prompt",
            "workflow actions",
          ],
        },
      );
      attempt = result;
      const output = AskAimsOutputSchema.parse(result.output);
      validateEvidence(output, allowed);
      await this.db.transaction(async (c) => {
        await c.query(
          `INSERT INTO finance_ask_runs(id,asked_by,scope_department_id,scope_department_ids,question_hash,question_class,period_from,period_to,tool_names,provider,model,prompt_version,input_tokens,output_tokens,total_tokens,latency_ms,status,answer)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'COMPLETED',$17)`,
          [
            id,
            actor.id,
            scope.departmentId,
            scope.departmentIds,
            hashQuestion(input.question),
            classification,
            input.dateFrom ?? null,
            input.dateTo ?? null,
            JSON.stringify(tools.names),
            result.provider,
            result.model,
            ASK_AIMS_PROMPT_VERSION,
            result.inputTokens,
            result.outputTokens,
            result.totalTokens,
            result.latencyMs,
            JSON.stringify(output),
          ],
        );
        await c.query(
          `INSERT INTO ai_usage_events(id,agent,provider,model,prompt_version,input_tokens,output_tokens,total_tokens,latency_ms,status,schema_valid,finance_ask_run_id,retry_count,estimated_cost)VALUES($1,'ASK_AIMS',$2,$3,$4,$5,$6,$7,$8,'COMPLETED',true,$9,$10,NULL)`,
          [
            randomUUID(),
            result.provider,
            result.model,
            ASK_AIMS_PROMPT_VERSION,
            result.inputTokens,
            result.outputTokens,
            result.totalTokens,
            result.latencyMs,
            id,
            result.retryCount ?? 0,
          ],
        );
      });
      return { id, ...output };
    } catch (error) {
      await this.persistAskFailure({
        id,
        actor,
        scope,
        input,
        error,
        started,
        toolNames: tools.names,
        attempt,
      });
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : "Ask AIMS failed",
      );
    }
  }
  private async tools(
    actor: Principal,
    filter: DashboardFilterDto,
    classification: string,
  ) {
    const names: string[] = [],
      evidenceCatalog: InsightEvidence[] = [];
    if (
      ["BUDGET_PRESSURE", "DEPARTMENT_SPEND", "GENERAL"].includes(
        classification,
      )
    ) {
      names.push("getBudgetSummary");
      const budget = await this.dashboard.budget(actor, filter);
      for (const x of budget.items.slice(0, 20))
        evidenceCatalog.push({
          metric: "category.utilisationBasisPoints",
          reference: `CATEGORY:${String(x.department_id)}:${safeKey(String(x.category))}:${String(x.currency)}`,
          value: x.utilisationBasisPoints ?? "NO_DATA",
        });
    }
    if (classification === "BIGGEST_PAYMENTS") {
      names.push("getPaymentList");
      const payments = await this.dashboard.paymentHighlights(actor, filter);
      for (const x of payments)
        evidenceCatalog.push({
          metric: "payment.amount",
          reference: `PAYMENT:${String(x.id)}`,
          value: `${x.currency} ${x.amount}`,
        });
    }
    if (["VENDOR_SPEND", "GENERAL"].includes(classification)) {
      names.push("getPaymentSummary");
      const summary = await this.dashboard.summary(actor, filter);
      for (const x of summary.vendors.slice(0, 20))
        evidenceCatalog.push({
          metric: "vendor.paidAmount",
          reference: `${payeeEvidenceReference(String(x.payee))}:${String(x.currency)}`,
          value: `${String(x.currency)} ${String(x.amount)}`,
        });
    }
    if (["WORKFLOW_BOTTLENECK", "GENERAL"].includes(classification)) {
      names.push("getWorkflowMetrics");
      const workflow = await this.dashboard.workflow(actor, filter);
      for (const [k, v] of Object.entries(workflow))
        evidenceCatalog.push({
          metric: `workflow.${k}`,
          reference: "WORKFLOW:SELECTED_PERIOD",
          value: String(v),
        });
    }
    return {
      names: names.slice(0, 3),
      evidenceCatalog: evidenceCatalog.slice(0, 20),
    };
  }

  private async persistWatchFailure(x: {
    id: string;
    actor: Principal;
    scope: ReportingScope;
    input: IntelligenceFilterDto;
    error: unknown;
    started: number;
    catalog: InsightEvidence[];
    attempt: FinanceIntelligenceProviderResult | null;
  }) {
    const failure = classifyFailure(x.error),
      schemaValid = failure !== "STRUCTURED_OUTPUT_INVALID",
      evidenceValid = failure !== "EVIDENCE_VALIDATION_FAILED",
      latency = x.attempt?.latencyMs ?? Date.now() - x.started;
    await this.db.transaction(async (c) => {
      await c.query(
        `INSERT INTO finance_insight_runs(id,requested_by,scope_department_id,scope_department_ids,period_from,period_to,source_analytics_version,data_snapshot_as_of,status,provider,model,prompt_version,input_tokens,output_tokens,total_tokens,latency_ms,failure_code,failure_classification,schema_valid,evidence_valid,context)VALUES($1,$2,$3,$4,$5,$6,$7,now(),'FAILED',$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17,$18)`,
        [
          x.id,
          x.actor.id,
          x.scope.departmentId,
          x.scope.departmentIds,
          x.input.dateFrom ?? null,
          x.input.dateTo ?? null,
          FINANCE_ANALYTICS_VERSION,
          x.attempt?.provider ?? "configured",
          x.attempt?.model ?? "configured",
          FINANCE_WATCH_PROMPT_VERSION,
          x.attempt?.inputTokens ?? null,
          x.attempt?.outputTokens ?? null,
          x.attempt?.totalTokens ?? null,
          latency,
          failure,
          schemaValid,
          evidenceValid,
          JSON.stringify({
            evidenceCatalog: x.catalog,
            safeFailure: true,
            responseSchemaVersion: FINANCE_INTELLIGENCE_RESPONSE_SCHEMA_VERSION,
            correlationId: x.id,
            actorId: x.actor.id,
            aiMode: "PROVIDER_FAILURE_FALLBACK",
            cost: "UNKNOWN",
          }),
        ],
      );
      await c.query(
        `INSERT INTO ai_usage_events(id,agent,provider,model,prompt_version,input_tokens,output_tokens,total_tokens,latency_ms,status,schema_valid,finance_insight_run_id,failure_classification,retry_count,estimated_cost)VALUES($1,'FINANCE_INSIGHT_AGENT',$2,$3,$4,$5,$6,$7,$8,'FAILED',$9,$10,$11,$12,NULL)`,
        [
          randomUUID(),
          x.attempt?.provider ?? "configured",
          x.attempt?.model ?? "configured",
          FINANCE_WATCH_PROMPT_VERSION,
          x.attempt?.inputTokens ?? null,
          x.attempt?.outputTokens ?? null,
          x.attempt?.totalTokens ?? null,
          latency,
          schemaValid,
          x.id,
          failure,
          x.error instanceof AiProviderError ? x.error.retryCount : 0,
        ],
      );
    });
  }
  private async persistAskFailure(x: {
    id: string;
    actor: Principal;
    scope: ReportingScope;
    input: AskAimsDto;
    error: unknown;
    started: number;
    toolNames: string[];
    attempt: FinanceIntelligenceProviderResult | null;
  }) {
    const failure = classifyFailure(x.error),
      schemaValid = failure !== "STRUCTURED_OUTPUT_INVALID",
      evidenceValid = failure !== "EVIDENCE_VALIDATION_FAILED",
      latency = x.attempt?.latencyMs ?? Date.now() - x.started;
    await this.db.transaction(async (c) => {
      await c.query(
        `INSERT INTO finance_ask_runs(id,asked_by,scope_department_id,scope_department_ids,question_hash,question_class,period_from,period_to,tool_names,provider,model,prompt_version,input_tokens,output_tokens,total_tokens,latency_ms,status,failure_code,failure_classification,schema_valid,evidence_valid)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'FAILED',$17,$17,$18,$19)`,
        [
          x.id,
          x.actor.id,
          x.scope.departmentId,
          x.scope.departmentIds,
          hashQuestion(x.input.question),
          classify(x.input.question),
          x.input.dateFrom ?? null,
          x.input.dateTo ?? null,
          JSON.stringify(x.toolNames),
          x.attempt?.provider ?? "configured",
          x.attempt?.model ?? "configured",
          ASK_AIMS_PROMPT_VERSION,
          x.attempt?.inputTokens ?? null,
          x.attempt?.outputTokens ?? null,
          x.attempt?.totalTokens ?? null,
          latency,
          failure,
          schemaValid,
          evidenceValid,
        ],
      );
      await c.query(
        `INSERT INTO ai_usage_events(id,agent,provider,model,prompt_version,input_tokens,output_tokens,total_tokens,latency_ms,status,schema_valid,finance_ask_run_id,failure_classification,retry_count,estimated_cost)VALUES($1,'ASK_AIMS',$2,$3,$4,$5,$6,$7,$8,'FAILED',$9,$10,$11,$12,NULL)`,
        [
          randomUUID(),
          x.attempt?.provider ?? "configured",
          x.attempt?.model ?? "configured",
          ASK_AIMS_PROMPT_VERSION,
          x.attempt?.inputTokens ?? null,
          x.attempt?.outputTokens ?? null,
          x.attempt?.totalTokens ?? null,
          latency,
          schemaValid,
          x.id,
          failure,
          x.error instanceof AiProviderError ? x.error.retryCount : 0,
        ],
      );
    });
  }
}
function classify(question: string) {
  const q = question.toLowerCase();
  if (/sql|system prompt|bank reference|ignore.*rule/.test(q)) return "GENERAL";
  if (/approval|bottleneck|taking longer|cycle/.test(q))
    return "WORKFLOW_BOTTLENECK";
  if (/biggest payment|largest payment/.test(q)) return "BIGGEST_PAYMENTS";
  if (/vendor|payee/.test(q)) return "VENDOR_SPEND";
  if (/budget|pressure|limit/.test(q)) return "BUDGET_PRESSURE";
  if (/department|spend/.test(q)) return "DEPARTMENT_SPEND";
  return "GENERAL";
}
function safeKey(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "unknown"
  );
}
function decimalToMinor(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}
function evidenceMap(
  items: Array<{ metric: string; reference: string; value: string | number }>,
) {
  return new Map(
    items.map((x) => [`${x.metric}:${x.reference}`, String(x.value)]),
  );
}
function hashQuestion(question: string) {
  return createHash("sha256").update(question.slice(0, 500)).digest("hex");
}
function classifyFailure(error: unknown) {
  if (error instanceof AiProviderError) return error.details.classification;
  if (error instanceof ZodError) return "STRUCTURED_OUTPUT_INVALID";
  const m = error instanceof Error ? error.message : "";
  if (
    /FABRICATED_EVIDENCE|EVIDENCE_VALUE|SENSITIVE_EVIDENCE|VENDOR_EVIDENCE|CATEGORY_EVIDENCE/.test(
      m,
    )
  )
    return "EVIDENCE_VALIDATION_FAILED";
  if (/Zod|parse|schema|structured/i.test(m))
    return "STRUCTURED_OUTPUT_INVALID";
  if (/timeout|abort/i.test(m)) return "PROVIDER_TIMEOUT";
  if (/rate|429/i.test(m)) return "RATE_LIMIT";
  if (/model.*not|404/i.test(m)) return "MODEL_NOT_AVAILABLE";
  return "UNKNOWN_PROVIDER_ERROR";
}
