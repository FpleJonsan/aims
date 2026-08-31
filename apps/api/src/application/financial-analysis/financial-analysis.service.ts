/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  FINANCIAL_ANALYSIS_RESPONSE_SCHEMA_VERSION,
  deterministicMetrics,
  prompts,
  type AgentResult,
  type AggregatedResult,
} from "../../domain/financial-analysis.js";
import type { Principal } from "../../domain/payment-request.js";
import type {
  FinancialAgentProviderResult,
  OpenAiCompatibleProvider,
} from "../../infrastructure/ai/openai-compatible-provider.js";
import { AiProviderError } from "../../infrastructure/ai/openai-compatible-provider.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { PaymentRequestService } from "../payment-requests/payment-request.service.js";
import { AI_PROVIDER } from "../validation/validation.service.js";
import type { FinalizeFinancialAnalysisDto } from "./financial-analysis.dto.js";
type FinancialProvider = Pick<
  OpenAiCompatibleProvider,
  "analyzeFinancialAgent"
>;
@Injectable()
export class FinancialAnalysisService {
  constructor(
    private readonly db: Postgres,
    private readonly requests: PaymentRequestService,
    @Inject(AI_PROVIDER) private readonly provider: FinancialProvider | null,
  ) {}
  private authorize(a: Principal) {
    if (!a.roles.includes("FINANCE"))
      throw new ForbiddenException("Finance permission required");
  }
  async start(id: string, actor: Principal, correlationId: string) {
    this.authorize(actor);
    const eligible = await this.eligible(id);
    const flags = await this.db.pool.query<{
      feature: string;
      enabled: boolean;
    }>("SELECT feature,enabled FROM ai_feature_configuration");
    const enabled = new Map(flags.rows.map((r) => [r.feature, r.enabled]));
    const agents = [
      ["FINANCIAL_RISK", "FINANCIAL_RISK_ANALYSIS"],
      ["SPENDING_PATTERN", "SPENDING_PATTERN_ANALYSIS"],
      ["COMPLIANCE", "COMPLIANCE_ANALYSIS"],
    ] as const;
    if (
      !enabled.get("AI_MASTER") ||
      !agents.some(([, flag]) => enabled.get(flag))
    )
      return { mode: "MANUAL", requiresManualAssessment: true };
    if (!this.provider)
      return {
        mode: "AI_UNAVAILABLE_FALLBACK",
        requiresManualAssessment: true,
      };
    const run = await this.createRun(
      id,
      eligible,
      actor,
      "AI_ASSISTED",
      correlationId,
    );
    if (run.reused) return this.get(id, actor, false);
    const input = this.authoritativeInput(eligible);
    const evidenceCatalog = buildRiskEvidenceCatalog(input);
    const boundedInput = { ...input, evidenceCatalog };
    const results = await Promise.all(
      agents.map(async ([agent, flag]) =>
        enabled.get(flag)
          ? this.callAgent(
              run.id,
              agent,
              boundedInput,
              evidenceCatalog,
              correlationId,
              actor.id,
            )
          : this.skipped(run.id, agent),
      ),
    );
    const completed = results.filter(
      (r): r is { agent: string; result: FinancialAgentProviderResult } =>
        "result" in r,
    );
    let aggregate: FinancialAgentProviderResult | null = null;
    try {
      aggregate = await this.provider.analyzeFinancialAgent(
        "AGGREGATOR",
        {
          authoritativeFinanceContextId: eligible.context.id,
          evidenceCatalog,
          agentResults: completed.map((r) => ({
            agent: r.agent,
            result: r.result.output,
          })),
        },
        true,
      );
      validateRiskEvidence(aggregate.output, evidenceCatalog);
      await this.saveAgent(
        run.id,
        "AGGREGATOR",
        aggregate,
        prompts.AGGREGATOR,
        correlationId,
        actor.id,
      );
    } catch (error) {
      await this.failed(run.id, "AGGREGATOR", error, correlationId, actor.id);
    }
    await this.db.transaction(async (c) => {
      await c.query(
        "UPDATE financial_analysis_runs SET status='AWAITING_HUMAN_REVIEW' WHERE id=$1 AND status='PROCESSING'",
        [run.id],
      );
      await c.query(
        "INSERT INTO financial_risk_assessments(id,analysis_run_id,ai_assessment) VALUES($1,$2,$3)",
        [randomUUID(), run.id, JSON.stringify(aggregate?.output ?? null)],
      );
      await this.requests.audit(
        c,
        actor.id,
        "FINANCIAL_ANALYSIS_AGGREGATED",
        id,
        "VALIDATING",
        "VALIDATING",
        correlationId,
        {
          analysisId: run.id,
          completedAgents: completed.map((r) => r.agent),
          partialFailure:
            completed.length < agents.filter(([, f]) => enabled.get(f)).length,
        },
      );
    });
    return this.get(id, actor, false);
  }
  async manual(
    id: string,
    input: FinalizeFinancialAnalysisDto,
    actor: Principal,
    correlationId: string,
  ) {
    this.authorize(actor);
    const eligible = await this.eligible(id);
    const run = await this.createRun(
      id,
      eligible,
      actor,
      "MANUAL",
      correlationId,
      true,
    );
    await this.db.transaction(async (c) => {
      await c.query(
        `INSERT INTO financial_risk_assessments(id,analysis_run_id,final_risk,final_priority,final_urgency,suggested_deadline,risk_flags,financial_assessment,spending_assessment,compliance_remarks,evidence_references,remarks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          run.id,
          input.riskLevel,
          input.priority,
          input.urgency,
          input.suggestedDeadline ?? null,
          JSON.stringify(input.riskFlags),
          input.financialAssessment,
          input.spendingAssessment,
          input.complianceRemarks,
          JSON.stringify(input.evidenceReferences),
          input.remarks ?? null,
        ],
      );
      await c.query(
        "UPDATE financial_analysis_runs SET status='FINALIZED',finalized_by=$2,finalized_at=now() WHERE id=$1",
        [run.id, actor.id],
      );
      await this.requests.audit(
        c,
        actor.id,
        "MANUAL_FINANCIAL_ANALYSIS_COMPLETED",
        id,
        "VALIDATING",
        "VALIDATING",
        correlationId,
        { analysisId: run.id, financeContextId: eligible.context.id },
      );
    });
    return this.get(id, actor, false);
  }
  async finalize(
    id: string,
    analysisId: string,
    input: FinalizeFinancialAnalysisDto,
    actor: Principal,
    correlationId: string,
  ) {
    this.authorize(actor);
    return this.db.transaction(async (c) => {
      const run = await c.query<any>(
        "SELECT * FROM financial_analysis_runs WHERE id=$1 AND payment_request_id=$2 AND is_current FOR UPDATE",
        [analysisId, id],
      );
      if (!run.rowCount || run.rows[0].status !== "AWAITING_HUMAN_REVIEW")
        throw new ConflictException("Analysis is not awaiting review");
      const assessment = await c.query<any>(
        "SELECT ai_assessment FROM financial_risk_assessments WHERE analysis_run_id=$1",
        [analysisId],
      );
      const ai = assessment.rows[0]?.ai_assessment;
      const changed =
        ai &&
        (ai.riskLevel !== input.riskLevel || ai.priority !== input.priority);
      if (changed && !input.overrideReason?.trim())
        throw new ConflictException("Override reason is required");
      await c.query(
        `UPDATE financial_risk_assessments SET final_risk=$2,final_priority=$3,final_urgency=$4,suggested_deadline=$5,risk_flags=$6,financial_assessment=$7,spending_assessment=$8,compliance_remarks=$9,evidence_references=$10,remarks=$11,override_reason=$12 WHERE analysis_run_id=$1`,
        [
          analysisId,
          input.riskLevel,
          input.priority,
          input.urgency,
          input.suggestedDeadline ?? null,
          JSON.stringify(input.riskFlags),
          input.financialAssessment,
          input.spendingAssessment,
          input.complianceRemarks,
          JSON.stringify(input.evidenceReferences),
          input.remarks ?? null,
          input.overrideReason ?? null,
        ],
      );
      await c.query(
        "UPDATE financial_analysis_runs SET status='FINALIZED',finalized_by=$2,finalized_at=now() WHERE id=$1",
        [analysisId, actor.id],
      );
      await this.requests.audit(
        c,
        actor.id,
        changed
          ? "FINANCIAL_ANALYSIS_OVERRIDDEN"
          : "FINANCIAL_ANALYSIS_FINALIZED",
        id,
        "VALIDATING",
        "VALIDATING",
        correlationId,
        { analysisId },
      );
      return { readyForPolicyEvaluation: true, analysisId };
    });
  }
  async get(id: string, actor: Principal, history: boolean) {
    await this.requests.get(id, actor);
    const rows = await this.db.pool.query<any>(
      `SELECT r.*,a.*,EXISTS(SELECT 1 FROM finance_context_snapshots f WHERE f.id=r.finance_context_snapshot_id AND f.is_current AND f.status='COMPLETED') context_current FROM financial_analysis_runs r LEFT JOIN financial_risk_assessments a ON a.analysis_run_id=r.id WHERE r.payment_request_id=$1 ${history ? "" : "AND r.is_current"} ORDER BY r.created_at DESC`,
      [id],
    );
    if (!history && !rows.rowCount)
      throw new NotFoundException("Financial analysis not found");
    const output = [];
    for (const row of rows.rows) {
      const agents = await this.db.pool.query<any>(
        "SELECT agent,status,result,provider,model,input_tokens,output_tokens,total_tokens,latency_ms,failure_code FROM financial_agent_results WHERE analysis_run_id=$1 ORDER BY agent",
        [row.analysis_run_id ?? row.id],
      );
      output.push({
        ...row,
        agents: agents.rows,
        stale: !row.context_current,
        readyForPolicyEvaluation:
          row.status === "FINALIZED" && row.context_current,
      });
    }
    return history ? output : output[0];
  }
  private async eligible(id: string) {
    const request = await this.db.pool.query<any>(
      "SELECT * FROM payment_requests WHERE id=$1",
      [id],
    );
    if (!request.rowCount)
      throw new NotFoundException("Payment request not found");
    const validation = await this.db.pool.query<any>(
      "SELECT id FROM validation_runs WHERE payment_request_id=$1 AND is_current AND status='COMPLETED' AND overall_result='PASS' AND request_revision=$2",
      [id, request.rows[0].row_version],
    );
    const context = await this.db.pool.query<any>(
      "SELECT * FROM finance_context_snapshots WHERE payment_request_id=$1 AND is_current AND status='COMPLETED' AND request_revision=$2",
      [id, request.rows[0].row_version],
    );
    if (!validation.rowCount || !context.rowCount)
      throw new ConflictException(
        "Current Validation and Finance Context are required",
      );
    return {
      request: request.rows[0],
      validation: validation.rows[0],
      context: context.rows[0],
    };
  }
  private authoritativeInput(e: any) {
    const c = e.context;
    return {
      request: {
        id: e.request.id,
        revision: e.request.row_version,
        payee: e.request.payee,
        purpose: e.request.purpose,
        category: e.request.category,
        amount: e.request.amount,
        currency: e.request.currency,
        dueDate: e.request.due_date,
      },
      financeContext: {
        id: c.id,
        version: c.finance_context_version,
        calculationVersion: c.calculation_version,
        metrics: deterministicMetrics({
          revisedBudget: { minor: c.revised_amount_minor },
          actual: { minor: c.actual_amount_minor },
          committed: { minor: c.committed_amount_minor },
          available: { minor: c.available_amount_minor },
          requestAmount: { minor: c.request_amount_minor },
          projectedAvailable: { minor: c.projected_available_amount_minor },
          historicalSummary: c.historical_summary,
        }),
      },
      validation: { id: e.validation.id, result: "PASS" },
    };
  }
  private async createRun(
    id: string,
    e: any,
    actor: Principal,
    source: string,
    correlationId: string,
    supersede = false,
  ) {
    return this.db.transaction(async (c) => {
      await c.query("SELECT id FROM payment_requests WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      const current = await c.query<any>(
        "SELECT * FROM financial_analysis_runs WHERE payment_request_id=$1 AND is_current FOR UPDATE",
        [id],
      );
      if (
        current.rowCount &&
        !supersede &&
        current.rows[0].finance_context_snapshot_id === e.context.id
      )
        return { ...current.rows[0], reused: true };
      if (current.rowCount) {
        await c.query(
          "UPDATE financial_analysis_runs SET status='SUPERSEDED',is_current=false WHERE id=$1",
          [current.rows[0].id],
        );
        await this.requests.audit(
          c,
          actor.id,
          "FINANCIAL_ANALYSIS_SUPERSEDED",
          id,
          "VALIDATING",
          "VALIDATING",
          correlationId,
          { analysisId: current.rows[0].id },
        );
      }
      const version = await c.query<{ v: number }>(
        "SELECT COALESCE(max(analysis_version),0)+1 v FROM financial_analysis_runs WHERE payment_request_id=$1",
        [id],
      );
      const run = await c.query<any>(
        `INSERT INTO financial_analysis_runs(id,payment_request_id,request_revision,finance_context_snapshot_id,finance_context_version,analysis_version,source,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'PROCESSING',$8) RETURNING *`,
        [
          randomUUID(),
          id,
          e.request.row_version,
          e.context.id,
          e.context.finance_context_version,
          version.rows[0].v,
          source,
          actor.id,
        ],
      );
      await this.requests.audit(
        c,
        actor.id,
        "FINANCIAL_ANALYSIS_STARTED",
        id,
        "VALIDATING",
        "VALIDATING",
        correlationId,
        { analysisId: run.rows[0].id, financeContextId: e.context.id },
      );
      return { ...run.rows[0], reused: false };
    });
  }
  private async callAgent(
    runId: string,
    agent: string,
    input: unknown,
    catalog: RiskEvidenceCatalogEntry[],
    correlationId: string,
    actorId: string,
  ) {
    try {
      const result = await this.provider!.analyzeFinancialAgent(agent, input);
      validateRiskEvidence(result.output, catalog);
      await this.saveAgent(
        runId,
        agent,
        result,
        prompts[agent as keyof typeof prompts],
        correlationId,
        actorId,
      );
      return { agent, result };
    } catch (error) {
      await this.failed(runId, agent, error, correlationId, actorId);
      return { agent, failed: true };
    }
  }
  private async saveAgent(
    runId: string,
    agent: string,
    r: FinancialAgentProviderResult,
    prompt: string,
    correlationId: string,
    actorId: string,
  ) {
    await this.db.transaction(async (c) => {
      const inserted = await c.query(
        `INSERT INTO financial_agent_results(id,analysis_run_id,agent,status,prompt_version,result,provider,model,input_tokens,output_tokens,total_tokens,latency_ms) VALUES($1,$2,$3,'COMPLETED',$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(analysis_run_id,agent) DO NOTHING RETURNING id`,
        [
          randomUUID(),
          runId,
          agent,
          prompt,
          JSON.stringify(r.output),
          r.provider,
          r.model,
          r.inputTokens,
          r.outputTokens,
          r.totalTokens,
          r.latencyMs,
        ],
      );
      if (!inserted.rowCount) return;
      const run = await c.query<any>(
        "SELECT payment_request_id FROM financial_analysis_runs WHERE id=$1",
        [runId],
      );
      await c.query(
        `INSERT INTO ai_usage_events(id,payment_request_id,agent,provider,model,prompt_version,input_tokens,output_tokens,total_tokens,latency_ms,status,schema_valid,financial_analysis_run_id,retry_count,estimated_cost) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'COMPLETED',true,$11,$12,NULL)`,
        [
          randomUUID(),
          run.rows[0].payment_request_id,
          agent,
          r.provider,
          r.model,
          prompt,
          r.inputTokens,
          r.outputTokens,
          r.totalTokens,
          r.latencyMs,
          runId,
          r.retryCount ?? 0,
        ],
      );
      await this.requests.audit(
        c,
        null,
        "AI_AGENT_COMPLETED",
        run.rows[0].payment_request_id,
        "VALIDATING",
        "VALIDATING",
        correlationId,
        {
          analysisId: runId,
          agent,
          promptVersion: prompt,
          responseSchemaVersion: FINANCIAL_ANALYSIS_RESPONSE_SCHEMA_VERSION,
          correlationId,
          actorId,
          aiMode: "AI_ENABLED",
          providerAttempts: r.providerAttempts ?? 1,
          cost: "UNKNOWN",
        },
      );
    });
  }
  private async skipped(runId: string, agent: string) {
    await this.db.pool.query(
      `INSERT INTO financial_agent_results(id,analysis_run_id,agent,status,prompt_version) VALUES($1,$2,$3,'SKIPPED',$4) ON CONFLICT DO NOTHING`,
      [randomUUID(), runId, agent, prompts[agent as keyof typeof prompts]],
    );
    return { agent, skipped: true };
  }
  private async failed(
    runId: string,
    agent: string,
    error: unknown,
    correlationId: string,
    actorId: string,
  ) {
    await this.db.transaction(async (c) => {
      const failure =
        error instanceof Error ? error.name : "UNKNOWN_PROVIDER_ERROR";
      const prompt =
        prompts[agent as keyof typeof prompts] ?? prompts.AGGREGATOR;
      const inserted = await c.query(
        `INSERT INTO financial_agent_results(id,analysis_run_id,agent,status,prompt_version,failure_code) VALUES($1,$2,$3,'FAILED',$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
        [randomUUID(), runId, agent, prompt, failure],
      );
      if (!inserted.rowCount) return;
      const run = await c.query<any>(
        "SELECT payment_request_id FROM financial_analysis_runs WHERE id=$1",
        [runId],
      );
      const providerError = error instanceof AiProviderError ? error : null;
      await c.query(
        `INSERT INTO ai_usage_events(id,payment_request_id,agent,provider,model,prompt_version,status,schema_valid,financial_analysis_run_id,failure_classification,retry_count,estimated_cost) VALUES($1,$2,$3,'configured','configured',$4,'FAILED',false,$5,$6,$7,NULL)`,
        [
          randomUUID(),
          run.rows[0].payment_request_id,
          agent,
          prompt,
          runId,
          failure,
          providerError?.retryCount ?? 0,
        ],
      );
      await this.requests.audit(
        c,
        null,
        "AI_AGENT_FAILED",
        run.rows[0].payment_request_id,
        "VALIDATING",
        "VALIDATING",
        correlationId,
        {
          analysisId: runId,
          agent,
          failureCode: failure,
          responseSchemaVersion: FINANCIAL_ANALYSIS_RESPONSE_SCHEMA_VERSION,
          correlationId,
          actorId,
          aiMode: "PROVIDER_FAILURE_FALLBACK",
          providerAttempts: providerError?.providerAttempts ?? 1,
          cost: "UNKNOWN",
        },
      );
    });
  }
}

export interface RiskEvidenceCatalogEntry {
  source: string;
  reference: string;
  field: string;
  value: string;
}
export function buildRiskEvidenceCatalog(
  input: any,
): RiskEvidenceCatalogEntry[] {
  const entries: RiskEvidenceCatalogEntry[] = [];
  const requestReference = `REQUEST:${input.request.id}:REVISION:${input.request.revision}`;
  for (const field of ["amount", "currency", "category", "dueDate"])
    entries.push({
      source: "PAYMENT_REQUEST",
      reference: requestReference,
      field,
      value: String(input.request[field] ?? "UNKNOWN"),
    });
  const contextReference = `CONTEXT:${input.financeContext.id}:VERSION:${input.financeContext.version}`;
  for (const [field, value] of Object.entries(input.financeContext.metrics))
    if (typeof value !== "object")
      entries.push({
        source: "FINANCE_CONTEXT",
        reference: contextReference,
        field,
        value: String(value ?? "UNKNOWN"),
      });
  entries.push({
    source: "VALIDATION_FINDING",
    reference: `VALIDATION:${input.validation.id}`,
    field: "result",
    value: String(input.validation.result),
  });
  return entries.slice(0, 80);
}
export function validateRiskEvidence(
  output: AgentResult | AggregatedResult,
  catalog: RiskEvidenceCatalogEntry[],
) {
  const allowed = new Set(
    catalog.map((x) => `${x.source}:${x.reference}:${x.field}`),
  );
  for (const finding of output.findings)
    for (const evidence of finding.evidenceReferences)
      if (
        !allowed.has(
          `${evidence.source}:${evidence.reference}:${evidence.field}`,
        )
      )
        throw new Error("UNAUTHORIZED_RISK_EVIDENCE_REFERENCE");
  return output;
}
