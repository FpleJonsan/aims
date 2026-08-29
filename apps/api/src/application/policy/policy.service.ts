/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomUUID } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Principal } from "../../domain/payment-request.js";
import {
  ApprovalStepSchema,
  PolicyConditionsSchema,
  PolicyRuleSchema,
  evaluatePolicy,
  validateNoAmbiguity,
  type PolicyFacts,
} from "../../domain/policy.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { PaymentRequestService } from "../payment-requests/payment-request.service.js";
import type {
  CreatePolicyRuleDto,
  CreatePolicySetDto,
  CreatePolicyVersionDto,
  PolicyJustificationDto,
} from "./policy.dto.js";

@Injectable()
export class PolicyService {
  constructor(
    private readonly db: Postgres,
    private readonly requests: PaymentRequestService,
  ) {}
  private finance(a: Principal) {
    if (!a.roles.includes("FINANCE"))
      throw new ForbiddenException("Finance permission required");
  }
  private admin(a: Principal) {
    if (!a.roles.includes("ADMIN"))
      throw new ForbiddenException("Admin permission required");
  }
  private async policyAudit(
    c: any,
    actorId: string,
    action: string,
    entityType: "POLICY_SET" | "POLICY_VERSION" | "POLICY_RULE",
    entityId: string,
    correlationId: string,
    metadata: object,
  ) {
    await c.query(
      `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        actorId,
        action,
        entityType,
        entityId,
        correlationId,
        JSON.stringify(metadata),
      ],
    );
  }
  async evaluate(id: string, actor: Principal, correlationId: string) {
    this.finance(actor);
    return this.db.transaction(async (c) => {
      await c.query("SELECT id FROM payment_requests WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      const factsResult = await c.query<any>(
        `SELECT p.*,v.id validation_id,f.id context_id,f.request_amount_minor policy_amount_minor,a.id analysis_id,ra.final_risk,ra.final_priority,ra.risk_flags
   FROM payment_requests p
   JOIN validation_runs v ON v.payment_request_id=p.id AND v.is_current AND v.status='COMPLETED' AND v.overall_result='PASS' AND v.request_revision=p.row_version
   JOIN finance_context_snapshots f ON f.payment_request_id=p.id AND f.is_current AND f.status='COMPLETED' AND f.request_revision=p.row_version
   JOIN financial_analysis_runs a ON a.payment_request_id=p.id AND a.is_current AND a.status='FINALIZED' AND a.request_revision=p.row_version AND a.finance_context_snapshot_id=f.id
   JOIN financial_risk_assessments ra ON ra.analysis_run_id=a.id WHERE p.id=$1`,
        [id],
      );
      if (!factsResult.rowCount)
        throw new ConflictException(
          "Current Validation, Finance Context and finalized human Financial Analysis are required",
        );
      const f = factsResult.rows[0];
      const docs = await c.query<any>(
        `SELECT id,logical_document_id,version,document_type,sha256 FROM payment_documents
         WHERE payment_request_id=$1 AND removed_at IS NULL AND security_status='CLEAN'
         ORDER BY logical_document_id,version,id`,
        [id],
      );
      const evidenceFingerprint = fingerprintEvidence(docs.rows);
      const versions =
        await c.query<any>(`SELECT pv.*,ps.code set_code,ps.name set_name FROM policy_versions pv JOIN policy_sets ps ON ps.id=pv.policy_set_id
   WHERE pv.status='ACTIVE' AND ps.status='ACTIVE' AND pv.effective_from<=now() AND (pv.effective_to IS NULL OR pv.effective_to>now()) FOR SHARE`);
      if (versions.rowCount !== 1) {
        if (versions.rowCount > 1)
          throw new ConflictException("Ambiguous active policy configuration");
        return this.noPolicy(
          c,
          id,
          f,
          evidenceFingerprint,
          actor,
          correlationId,
        );
      }
      const version = versions.rows[0];
      const existing = await c.query<any>(
        `SELECT d.*,e.id existing_exception_id,e.exception_code existing_exception_code,e.status existing_exception_status
         FROM policy_decision_runs d LEFT JOIN policy_exceptions e ON e.policy_decision_run_id=d.id
         WHERE d.payment_request_id=$1 AND d.is_current FOR UPDATE OF d`,
        [id],
      );
      if (
        existing.rowCount &&
        existing.rows[0].request_revision === f.row_version &&
        existing.rows[0].validation_run_id === f.validation_id &&
        existing.rows[0].finance_context_snapshot_id === f.context_id &&
        existing.rows[0].financial_analysis_run_id === f.analysis_id &&
        existing.rows[0].policy_version_id === version.id &&
        existing.rows[0].evidence_fingerprint === evidenceFingerprint &&
        existing.rows[0].existing_exception_status !== "JUSTIFIED"
      )
        return this.present(existing.rows[0], true);
      if (existing.rowCount)
        await this.supersede(c, existing.rows[0], actor, correlationId);
      const rows = await c.query<any>(
        "SELECT * FROM policy_rules WHERE policy_version_id=$1 AND enabled ORDER BY priority,code",
        [version.id],
      );
      const rules = rows.rows.map(this.rule);
      validateNoAmbiguity(rules);
      const facts: PolicyFacts = {
        amountMinor: BigInt(f.policy_amount_minor),
        currency: f.currency,
        departmentId: f.department_id,
        category: f.category,
        paymentMethod: f.payment_method,
        riskLevel: f.final_risk,
        priority: f.final_priority,
        riskFlags: (f.risk_flags ?? []).map((x: any) =>
          typeof x === "string" ? x : x.code,
        ),
        evidenceTypes: [
          ...new Set(
            docs.rows.flatMap((d: any) =>
              d.document_type ? [d.document_type] : [],
            ),
          ),
        ],
      };
      const effectiveRules =
        existing.rows[0]?.existing_exception_status === "JUSTIFIED"
          ? rules.filter(
              (rule) =>
                rule.exceptionCode !== existing.rows[0].existing_exception_code,
            )
          : rules;
      const result = evaluatePolicy(effectiveRules, facts),
        decisionId = randomUUID(),
        policyExceptionId = randomUUID(),
        exceptionCode =
          result.exception?.exceptionCode ??
          (result.missingEvidence.length ? "REQUIRED_EVIDENCE_MISSING" : null),
        exceptionReason =
          result.exception?.exceptionReason ??
          (result.missingEvidence.length
            ? `Missing required evidence: ${result.missingEvidence.join(", ")}`
            : null);
      const input = {
        requestRevision: f.row_version,
        amountMinor: facts.amountMinor.toString(),
        currency: f.currency,
        departmentId: f.department_id,
        category: f.category,
        paymentMethod: f.payment_method,
        validationRunId: f.validation_id,
        financeContextSnapshotId: f.context_id,
        financialAnalysisRunId: f.analysis_id,
        humanFinalRisk: f.final_risk,
        humanFinalPriority: f.final_priority,
        riskFlags: facts.riskFlags,
        evidenceTypes: facts.evidenceTypes,
        evidenceFingerprint,
        policyJustificationExceptionId:
          existing.rows[0]?.existing_exception_status === "JUSTIFIED"
            ? existing.rows[0].existing_exception_id
            : null,
      };
      await this.requests.audit(
        c,
        actor.id,
        "POLICY_EVALUATION_STARTED",
        id,
        "VALIDATING",
        "VALIDATING",
        correlationId,
        {
          policySetId: version.policy_set_id,
          policyVersionId: version.id,
          requestRevision: f.row_version,
        },
      );
      await c.query(
        `INSERT INTO policy_decision_runs(id,payment_request_id,request_revision,validation_run_id,finance_context_snapshot_id,financial_analysis_run_id,policy_set_id,policy_version_id,policy_effective_from,policy_effective_to,evaluation_version,evaluated_input,evidence_fingerprint,matched_rule_ids,result,approval_required,approval_plan,required_evidence,escalation,notification_metadata,auto_approval_eligible,ready_for_approval,evaluated_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          decisionId,
          id,
          f.row_version,
          f.validation_id,
          f.context_id,
          f.analysis_id,
          version.policy_set_id,
          version.id,
          version.effective_from,
          version.effective_to,
          version.evaluation_version,
          JSON.stringify(input),
          evidenceFingerprint,
          JSON.stringify(result.matched.map((r) => r.id)),
          result.result,
          result.approvalRequired,
          JSON.stringify(result.approvalPlan),
          JSON.stringify(result.requiredEvidence),
          result.matched.find((r) => r.escalation)?.escalation ?? null,
          JSON.stringify(
            Object.assign(
              {},
              ...result.matched.map((r) => r.notificationMetadata),
            ),
          ),
          result.autoApprovalEligible,
          result.result === "PASS",
          actor.id,
        ],
      );
      if (result.result === "JUSTIFICATION_REQUIRED")
        await c.query(
          `INSERT INTO policy_exceptions(id,policy_decision_run_id,payment_request_id,clarification_type,exception_code,reason,required_justification,requested_role) VALUES($1,$2,$3,'POLICY',$4,$5,$6,$7)`,
          [
            policyExceptionId,
            decisionId,
            id,
            exceptionCode,
            exceptionReason,
            "Provide a controlled business justification and re-run policy evaluation",
            result.exception?.justificationRole ?? "FINANCE",
          ],
        );
      if (result.result === "JUSTIFICATION_REQUIRED")
        await this.requests.audit(
          c,
          actor.id,
          "POLICY_JUSTIFICATION_REQUESTED",
          id,
          "VALIDATING",
          "VALIDATING",
          correlationId,
          {
            decisionId,
            exceptionId: policyExceptionId,
            policyVersionId: version.id,
          },
        );
      await this.requests.audit(
        c,
        actor.id,
        result.result === "PASS"
          ? "POLICY_EVALUATION_COMPLETED"
          : "POLICY_EVALUATION_EXCEPTION",
        id,
        "VALIDATING",
        "VALIDATING",
        correlationId,
        {
          decisionId,
          policySetId: version.policy_set_id,
          policyVersionId: version.id,
          matchedRuleIds: result.matched.map((r) => r.id),
        },
      );
      const created = await c.query(
        `SELECT d.*,ps.code policy_code,pv.version policy_version,e.id exception_id,e.exception_code,e.reason exception_reason,e.required_justification,e.requested_role,e.justification,e.status exception_status,true inputs_current
         FROM policy_decision_runs d LEFT JOIN policy_sets ps ON ps.id=d.policy_set_id LEFT JOIN policy_versions pv ON pv.id=d.policy_version_id LEFT JOIN policy_exceptions e ON e.policy_decision_run_id=d.id WHERE d.id=$1`,
        [decisionId],
      );
      return { ...created.rows[0], stale: false };
    });
  }
  async justify(
    id: string,
    exceptionId: string,
    input: PolicyJustificationDto,
    actor: Principal,
    correlationId: string,
  ) {
    await this.requests.get(id, actor);
    return this.db.transaction(async (c) => {
      const e = await c.query<any>(
        "SELECT * FROM policy_exceptions WHERE id=$1 AND payment_request_id=$2 FOR UPDATE",
        [exceptionId, id],
      );
      if (!e.rowCount || e.rows[0].status !== "OPEN")
        throw new ConflictException("Policy clarification is not open");
      const allowed =
        e.rows[0].requested_role === "REQUESTER"
          ? actor.roles.includes("REQUESTER")
          : actor.roles.includes(e.rows[0].requested_role);
      if (!allowed)
        throw new ForbiddenException(
          "Not authorized to supply this justification",
        );
      await c.query(
        "UPDATE policy_exceptions SET justification=$2,supplied_by=$3,supplied_at=now(),status='JUSTIFIED' WHERE id=$1",
        [exceptionId, input.justification.trim(), actor.id],
      );
      await this.requests.audit(
        c,
        actor.id,
        "POLICY_JUSTIFICATION_SUBMITTED",
        id,
        "VALIDATING",
        "VALIDATING",
        correlationId,
        {
          exceptionId,
          decisionId: e.rows[0].policy_decision_run_id,
          reevaluationRequired: true,
        },
      );
      return {
        status: "JUSTIFIED",
        reevaluationRequired: true,
        returnTo:
          e.rows[0].exception_code === "REQUIRED_EVIDENCE_MISSING"
            ? "VALIDATION"
            : "POLICY",
      };
    });
  }
  async get(id: string, actor: Principal, history: boolean) {
    await this.requests.get(id, actor);
    const q = await this.db.pool.query<any>(
      `SELECT d.*,ps.code policy_code,pv.version policy_version,e.id exception_id,e.exception_code,e.reason exception_reason,e.required_justification,e.requested_role,e.justification,e.status exception_status,
  EXISTS(SELECT 1 FROM payment_requests p JOIN validation_runs v ON v.payment_request_id=p.id AND v.is_current AND v.status='COMPLETED' AND v.overall_result='PASS' AND v.request_revision=p.row_version JOIN finance_context_snapshots f ON f.payment_request_id=p.id AND f.is_current AND f.status='COMPLETED' AND f.request_revision=p.row_version JOIN financial_analysis_runs a ON a.payment_request_id=p.id AND a.is_current AND a.status='FINALIZED' AND a.request_revision=p.row_version AND a.finance_context_snapshot_id=f.id WHERE p.id=d.payment_request_id AND p.row_version=d.request_revision AND v.id=d.validation_run_id AND f.id=d.finance_context_snapshot_id AND a.id=d.financial_analysis_run_id) inputs_current
  FROM policy_decision_runs d LEFT JOIN policy_sets ps ON ps.id=d.policy_set_id LEFT JOIN policy_versions pv ON pv.id=d.policy_version_id LEFT JOIN policy_exceptions e ON e.policy_decision_run_id=d.id WHERE d.payment_request_id=$1 ${history ? "" : "AND d.is_current"} ORDER BY d.evaluated_at DESC`,
      [id],
    );
    if (!history && !q.rowCount)
      throw new NotFoundException("Policy decision not found");
    const activeEvidence = await this.db.pool.query<any>(
      `SELECT id,logical_document_id,version,document_type,sha256 FROM payment_documents
       WHERE payment_request_id=$1 AND removed_at IS NULL AND security_status='CLEAN' ORDER BY logical_document_id,version,id`,
      [id],
    );
    const currentFingerprint = fingerprintEvidence(activeEvidence.rows);
    const out = q.rows.map((r) => {
      const evidenceCurrent = r.evidence_fingerprint === currentFingerprint;
      return {
        ...r,
        stale: !r.inputs_current || !evidenceCurrent || !r.is_current,
        ready_for_approval:
          r.ready_for_approval &&
          r.inputs_current &&
          evidenceCurrent &&
          r.is_current,
      };
    });
    return history ? out : out[0];
  }
  async list(actor: Principal) {
    this.admin(actor);
    return (
      await this.db.pool.query(
        `SELECT ps.*,COALESCE(json_agg(pv ORDER BY pv.version DESC) FILTER(WHERE pv.id IS NOT NULL),'[]') versions FROM policy_sets ps LEFT JOIN policy_versions pv ON pv.policy_set_id=ps.id GROUP BY ps.id ORDER BY ps.code`,
      )
    ).rows;
  }
  async createSet(
    input: CreatePolicySetDto,
    actor: Principal,
    correlationId: string,
  ) {
    this.admin(actor);
    const id = randomUUID();
    await this.db.transaction(async (c) => {
      await c.query(
        "INSERT INTO policy_sets(id,code,name,description,created_by) VALUES($1,$2,$3,$4,$5)",
        [id, input.code, input.name, input.description ?? null, actor.id],
      );
      await this.policyAudit(
        c,
        actor.id,
        "POLICY_SET_CREATED",
        "POLICY_SET",
        id,
        correlationId,
        { code: input.code },
      );
    });
    return { id };
  }
  async createVersion(
    setId: string,
    input: CreatePolicyVersionDto,
    actor: Principal,
    correlationId: string,
  ) {
    this.admin(actor);
    return this.db.transaction(async (c) => {
      await c.query("SELECT id FROM policy_sets WHERE id=$1 FOR UPDATE", [
        setId,
      ]);
      const v = await c.query<{ version: number }>(
        "SELECT COALESCE(max(version),0)+1 version FROM policy_versions WHERE policy_set_id=$1",
        [setId],
      );
      const id = randomUUID();
      await c.query(
        "INSERT INTO policy_versions(id,policy_set_id,version,effective_from,effective_to,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id,
          setId,
          v.rows[0].version,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          actor.id,
        ],
      );
      await this.policyAudit(
        c,
        actor.id,
        "POLICY_VERSION_CREATED",
        "POLICY_VERSION",
        id,
        correlationId,
        { policySetId: setId, version: v.rows[0].version },
      );
      return { id, version: v.rows[0].version };
    });
  }
  async addRule(
    versionId: string,
    input: CreatePolicyRuleDto,
    actor: Principal,
    correlationId: string,
  ) {
    this.admin(actor);
    const conditions = PolicyConditionsSchema.parse(input.conditions),
      steps = input.approvalSteps.map((s) => ApprovalStepSchema.parse(s));
    return this.db.transaction(async (c) => {
      const version = await c.query<any>(
        "SELECT id,policy_set_id,status FROM policy_versions WHERE id=$1 FOR UPDATE",
        [versionId],
      );
      if (!version.rowCount || version.rows[0].status !== "DRAFT")
        throw new ConflictException(
          "Rules may only be added to a draft version",
        );
      const id = randomUUID();
      await c.query(
        `INSERT INTO policy_rules(id,policy_version_id,code,name,priority,effect,conditions,approval_steps,required_evidence,escalation,notification_metadata,auto_approval_eligible,exception_code,exception_reason,justification_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id,
          versionId,
          input.code,
          input.name,
          input.priority,
          input.effect,
          JSON.stringify(conditions),
          JSON.stringify(steps),
          JSON.stringify(input.requiredEvidence),
          input.escalation ?? null,
          JSON.stringify(input.notificationMetadata ?? {}),
          input.autoApprovalEligible,
          input.exceptionCode ?? null,
          input.exceptionReason ?? null,
          input.justificationRole ?? null,
        ],
      );
      await this.policyAudit(
        c,
        actor.id,
        "POLICY_RULE_CREATED",
        "POLICY_RULE",
        id,
        correlationId,
        {
          policySetId: version.rows[0].policy_set_id,
          policyVersionId: versionId,
          ruleId: id,
        },
      );
      return { id };
    });
  }
  async activate(versionId: string, actor: Principal, correlationId: string) {
    this.admin(actor);
    return this.db.transaction(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('AIMS_GLOBAL_POLICY'))",
      );
      const version = await c.query<any>(
        "SELECT * FROM policy_versions WHERE id=$1 FOR UPDATE",
        [versionId],
      );
      if (!version.rowCount || version.rows[0].status !== "DRAFT")
        throw new ConflictException("Only a draft version can be activated");
      const rows = await c.query<any>(
        "SELECT * FROM policy_rules WHERE policy_version_id=$1 AND enabled",
        [versionId],
      );
      if (!rows.rowCount)
        throw new ConflictException(
          "Policy version requires at least one rule",
        );
      validateNoAmbiguity(rows.rows.map(this.rule));
      if (
        new Date(version.rows[0].effective_from) >=
        new Date(version.rows[0].effective_to ?? "9999-12-31")
      )
        throw new ConflictException("Invalid policy effective period");
      const retired = await c.query<any>(
        "UPDATE policy_versions SET status='RETIRED',retired_by=$1,retired_at=now() WHERE status='ACTIVE' RETURNING id,policy_set_id",
        [actor.id],
      );
      for (const old of retired.rows)
        await this.policyAudit(
          c,
          actor.id,
          "POLICY_VERSION_RETIRED",
          "POLICY_VERSION",
          old.id,
          correlationId,
          {
            policySetId: old.policy_set_id,
            policyVersionId: old.id,
            replacedBy: versionId,
          },
        );
      await c.query(
        "UPDATE policy_versions SET status='ACTIVE',activated_by=$2,activated_at=now() WHERE id=$1",
        [versionId, actor.id],
      );
      await this.policyAudit(
        c,
        actor.id,
        "POLICY_VERSION_ACTIVATED",
        "POLICY_VERSION",
        versionId,
        correlationId,
        { policySetId: version.rows[0].policy_set_id },
      );
      return { id: versionId, status: "ACTIVE" };
    });
  }
  async retire(versionId: string, actor: Principal, correlationId: string) {
    this.admin(actor);
    return this.db.transaction(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('AIMS_GLOBAL_POLICY'))",
      );
      const version = await c.query<any>(
        "SELECT * FROM policy_versions WHERE id=$1 FOR UPDATE",
        [versionId],
      );
      if (!version.rowCount || version.rows[0].status !== "ACTIVE")
        throw new ConflictException(
          "Only an active policy version can be retired",
        );
      await c.query(
        "UPDATE policy_versions SET status='RETIRED',retired_by=$2,retired_at=now() WHERE id=$1",
        [versionId, actor.id],
      );
      await this.policyAudit(
        c,
        actor.id,
        "POLICY_VERSION_RETIRED",
        "POLICY_VERSION",
        versionId,
        correlationId,
        {
          policySetId: version.rows[0].policy_set_id,
          policyVersionId: versionId,
        },
      );
      return {
        id: versionId,
        status: "RETIRED",
        futureEvaluation: "NO_APPLICABLE_POLICY",
      };
    });
  }
  private rule(r: any) {
    return PolicyRuleSchema.parse({
      id: r.id,
      code: r.code,
      priority: r.priority,
      effect: r.effect,
      conditions: r.conditions,
      approvalSteps: r.approval_steps,
      requiredEvidence: r.required_evidence,
      escalation: r.escalation,
      notificationMetadata: r.notification_metadata,
      autoApprovalEligible: r.auto_approval_eligible,
      exceptionCode: r.exception_code,
      exceptionReason: r.exception_reason,
      justificationRole: r.justification_role,
    });
  }
  private async supersede(
    c: any,
    d: any,
    actor: Principal,
    correlationId: string,
  ) {
    await c.query(
      "UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false WHERE id=$1",
      [d.id],
    );
    await c.query(
      "UPDATE policy_exceptions SET status='SUPERSEDED' WHERE policy_decision_run_id=$1 AND status='OPEN'",
      [d.id],
    );
    await this.requests.audit(
      c,
      actor.id,
      "POLICY_DECISION_SUPERSEDED",
      d.payment_request_id,
      "VALIDATING",
      "VALIDATING",
      correlationId,
      { decisionId: d.id },
    );
  }
  private async noPolicy(
    c: any,
    id: string,
    f: any,
    evidenceFingerprint: string,
    actor: Principal,
    correlationId: string,
  ) {
    const current = await c.query(
      "SELECT * FROM policy_decision_runs WHERE payment_request_id=$1 AND is_current FOR UPDATE",
      [id],
    );
    if (current.rowCount) {
      const row = current.rows[0];
      if (
        row.result === "NO_APPLICABLE_POLICY" &&
        row.request_revision === f.row_version &&
        row.validation_run_id === f.validation_id &&
        row.finance_context_snapshot_id === f.context_id &&
        row.financial_analysis_run_id === f.analysis_id &&
        row.evidence_fingerprint === evidenceFingerprint &&
        row.policy_version_id === null
      )
        return this.present(row, true);
    }
    if (current.rowCount)
      await this.supersede(c, current.rows[0], actor, correlationId);
    const decisionId = randomUUID();
    await c.query(
      `INSERT INTO policy_decision_runs(id,payment_request_id,request_revision,validation_run_id,finance_context_snapshot_id,financial_analysis_run_id,evaluation_version,evaluated_input,evidence_fingerprint,result,approval_required,ready_for_approval,evaluated_by) VALUES($1,$2,$3,$4,$5,$6,'policy-evaluator:v1',$7,$8,'NO_APPLICABLE_POLICY',false,false,$9)`,
      [
        decisionId,
        id,
        f.row_version,
        f.validation_id,
        f.context_id,
        f.analysis_id,
        JSON.stringify({ requestRevision: f.row_version, evidenceFingerprint }),
        evidenceFingerprint,
        actor.id,
      ],
    );
    await this.requests.audit(
      c,
      actor.id,
      "POLICY_EVALUATION_EXCEPTION",
      id,
      "VALIDATING",
      "VALIDATING",
      correlationId,
      { decisionId, reason: "NO_APPLICABLE_POLICY" },
    );
    return {
      id: decisionId,
      result: "NO_APPLICABLE_POLICY",
      readyForApproval: false,
    };
  }
  private present(r: any, reused: boolean) {
    return { ...r, reused, readyForApproval: r.ready_for_approval };
  }
}

export function fingerprintEvidence(
  rows: Array<{
    id: string;
    logical_document_id: string;
    version: number;
    document_type: string | null;
    sha256: string;
  }>,
): string {
  const canonical = rows.map((row) => ({
    id: row.id,
    logicalDocumentId: row.logical_document_id,
    version: Number(row.version),
    documentType: row.document_type ?? null,
    sha256: row.sha256,
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
