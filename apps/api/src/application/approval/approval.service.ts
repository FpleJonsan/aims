/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { PaymentRequestService } from "../payment-requests/payment-request.service.js";
import { fingerprintEvidence } from "../policy/policy.service.js";
import { ApprovalMatrixService } from "../approval-matrix/approval-matrix.service.js";
import { ApprovalDelegationService } from "../approval-delegation/approval-delegation.service.js";
import type { ApprovalMatrixFacts } from "../../domain/approval-matrix.js";
import type {
  ApprovalActionDto,
  ApprovalClarificationResponseDto,
} from "./approval.dto.js";
import type { NotificationService } from "../notification/notification.service.js";

@Injectable()
export class ApprovalService {
  constructor(
    private readonly db: Postgres,
    private readonly requests: PaymentRequestService,
    private readonly matrix: ApprovalMatrixService,
    private readonly delegations: ApprovalDelegationService,
    // Optional: absent in existing unit/integration test constructions (which
    // predate P20.5G and stay unchanged), always injected by Nest in the real
    // app. publish() never throws, so a missing instance is a silent no-op —
    // Approval's own state machine never depends on notification delivery.
    private readonly notifications?: NotificationService,
  ) {}
  private finance(a: Principal) {
    if (!a.roles.includes("FINANCE"))
      throw new ForbiddenException("Finance permission required");
  }
  private admin(a: Principal) {
    if (!a.roles.includes("ADMIN"))
      throw new ForbiddenException("Admin permission required");
  }

  async create(id: string, actor: Principal, correlationId: string) {
    this.finance(actor);
    return this.db.retryableTransaction(async (c) => {
      const request = await this.requests.lockRequest(c, id);
      const existing = await c.query<any>(
        "SELECT * FROM approval_cases WHERE payment_request_id=$1 AND is_current FOR UPDATE",
        [id],
      );
      if (existing.rowCount) return this.present(c, existing.rows[0], actor);
      if (request.status !== "VALIDATING")
        throw new ConflictException("Request is not ready to enter Approval");
      const eligible = await this.eligibility(c, id);
      if (!eligible)
        throw new ConflictException(
          "Validation, Finance Context, Financial Risk Analysis, Policy and approval routing must all be current and complete",
        );
      if (eligible.open_exception)
        throw new ConflictException(
          "Open Policy exception must be resolved and Policy re-evaluated",
        );
      const fingerprint = await this.fingerprint(c, id);
      if (fingerprint !== eligible.evidence_fingerprint)
        throw new ConflictException("Policy evidence is stale");
      const plan = Array.isArray(eligible.approval_plan)
        ? eligible.approval_plan
        : [];
      const automatic = eligible.auto_approval_eligible && plan.length === 0;
      if (!automatic && plan.length === 0)
        throw new ConflictException("Approval route is unresolved");
      // Policy stays the gate on whether approval applies at all (and on
      // auto-approval eligibility); when it does, the published Approval
      // Matrix — if any — is the Finance-Master-configurable source of how
      // many levels, which roles, and sequential vs parallel, without
      // Policy's own rule authoring changing. The winning matrix version is
      // pinned on the case so a later republish never affects this request.
      const matrixResolution =
        !automatic && plan.length
          ? await this.matrix.resolveForFacts(c, await this.matrixFacts(c, request, eligible))
          : null;
      const caseId = randomUUID();
      await c.query(
        `INSERT INTO approval_cases(id,payment_request_id,request_revision,validation_run_id,finance_context_snapshot_id,financial_analysis_run_id,policy_decision_run_id,policy_version_id,evidence_fingerprint,approval_plan,source,status,created_by,completed_at,approval_matrix_version_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          caseId,
          id,
          request.rowVersion,
          eligible.validation_run_id,
          eligible.finance_context_snapshot_id,
          eligible.financial_analysis_run_id,
          eligible.id,
          eligible.policy_version_id,
          fingerprint,
          JSON.stringify(plan),
          automatic ? "POLICY_AUTO_APPROVAL" : "HUMAN",
          automatic ? "APPROVED" : "PENDING",
          actor.id,
          automatic ? new Date() : null,
          matrixResolution?.versionId ?? null,
        ],
      );
      await this.requests.audit(
        c,
        actor.id,
        "APPROVAL_CASE_CREATED",
        id,
        "VALIDATING",
        automatic ? "APPROVED" : "PENDING_APPROVAL",
        correlationId,
        {
          approvalCaseId: caseId,
          policyDecisionRunId: eligible.id,
          source: automatic ? "POLICY_AUTO_APPROVAL" : "HUMAN",
        },
      );
      if (automatic) {
        await c.query(
          "INSERT INTO approval_actions(id,approval_case_id,action,channel,command_key) VALUES($1,$2,'POLICY_AUTO_APPROVE','POLICY_AUTO',$3)",
          [randomUUID(), caseId, randomUUID()],
        );
        await this.finalizeApprovalAndCreateCommitment(
          c,
          id,
          caseId,
          eligible.finance_context_snapshot_id,
          null,
          correlationId,
        );
        await this.requests.audit(
          c,
          null,
          "POLICY_AUTO_APPROVAL_COMPLETED",
          id,
          "VALIDATING",
          "APPROVED",
          correlationId,
          { approvalCaseId: caseId, deterministic: true },
        );
      } else if (matrixResolution) {
        // Matrix-routed plan: steps carry their own sequence and an
        // optional parallelGroup, so multiple steps can share one sequence
        // and activate together (parallel approval). advance() below is the
        // counterpart that waits for a group's threshold before progressing.
        const steps = matrixResolution.steps;
        const minSequence = Math.min(...steps.map((s) => s.sequence));
        for (const s of steps) {
          const stepId = randomUUID();
          const isFirst = s.sequence === minSequence;
          await c.query(
            `INSERT INTO approval_steps(id,approval_case_id,sequence,required_role,authority_scope,department_scope,minimum_amount_minor,maximum_amount_minor,mandatory,reason,parallel_group,required_approvals,status,activated_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              stepId,
              caseId,
              s.sequence,
              s.requiredRole,
              s.authorityScope,
              s.departmentScope ?? null,
              s.minimumAmountMinor ?? null,
              s.maximumAmountMinor ?? null,
              s.mandatory !== false,
              s.reason ?? `Approval matrix rule ${matrixResolution.rule.code}`,
              s.parallelGroup ?? null,
              s.requiredApprovals ?? null,
              isFirst ? "ACTIVE" : "WAITING",
              isFirst ? new Date() : null,
            ],
          );
          if (isFirst) {
            await this.queueStep(
              c,
              id,
              request.createdBy,
              request.departmentId,
              eligible.request_amount_minor,
              {
                id: stepId,
                approval_case_id: caseId,
                required_role: s.requiredRole,
                authority_scope: s.authorityScope,
                department_scope: s.departmentScope ?? null,
                minimum_amount_minor: s.minimumAmountMinor ?? null,
                maximum_amount_minor: s.maximumAmountMinor ?? null,
              },
              correlationId,
            );
            await this.requests.audit(
              c,
              actor.id,
              "APPROVAL_STEP_ACTIVATED",
              id,
              "VALIDATING",
              "PENDING_APPROVAL",
              correlationId,
              { approvalCaseId: caseId, stepId, matrixRuleCode: matrixResolution.rule.code },
            );
          }
        }
        await c.query(
          "UPDATE payment_requests SET status='PENDING_APPROVAL',updated_at=now(),row_version=row_version+1 WHERE id=$1",
          [id],
        );
      } else {
        for (let i = 0; i < plan.length; i++) {
          const p = plan[i],
            stepId = randomUUID();
          await c.query(
            `INSERT INTO approval_steps(id,approval_case_id,sequence,required_role,authority_scope,department_scope,minimum_amount_minor,maximum_amount_minor,mandatory,reason,status,activated_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              stepId,
              caseId,
              i + 1,
              p.requiredRole,
              p.authorityScope,
              p.departmentScope ?? null,
              p.minimumAmountMinor ?? null,
              p.maximumAmountMinor ?? null,
              p.mandatory !== false,
              p.reason ?? "Policy-required approval",
              i === 0 ? "ACTIVE" : "WAITING",
              i === 0 ? new Date() : null,
            ],
          );
          if (i === 0) {
            await this.queueStep(
              c,
              id,
              request.createdBy,
              request.departmentId,
              eligible.request_amount_minor,
              {
                id: stepId,
                approval_case_id: caseId,
                required_role: p.requiredRole,
                authority_scope: p.authorityScope,
                department_scope: p.departmentScope ?? null,
                minimum_amount_minor: p.minimumAmountMinor ?? null,
                maximum_amount_minor: p.maximumAmountMinor ?? null,
              },
              correlationId,
            );
            await this.requests.audit(
              c,
              actor.id,
              "APPROVAL_STEP_ACTIVATED",
              id,
              "VALIDATING",
              "PENDING_APPROVAL",
              correlationId,
              { approvalCaseId: caseId, stepId },
            );
          }
        }
        await c.query(
          "UPDATE payment_requests SET status='PENDING_APPROVAL',updated_at=now(),row_version=row_version+1 WHERE id=$1",
          [id],
        );
      }
      return this.present(
        c,
        (await c.query("SELECT * FROM approval_cases WHERE id=$1", [caseId]))
          .rows[0],
        actor,
      );
    });
  }

  async act(
    id: string,
    stepId: string,
    input: ApprovalActionDto,
    actor: Principal,
    correlationId: string,
    channel: "WEB" | "TELEGRAM" = "WEB",
    recoveryGeneration?: string,
  ) {
    return this.db.retryableTransaction(async (c) => {
      if(recoveryGeneration){
        await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
        const generation=await c.query("SELECT 1 FROM aims_recovery_generation WHERE singleton AND generation=$1",[recoveryGeneration]);
        if(!generation.rowCount)throw new ForbiddenException("Stale recovery generation authority");
      }
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `approval-command:${input.commandKey.toLowerCase()}`,
      ]);
      const duplicate = await c.query<any>(
        `SELECT a.*,ac.payment_request_id command_request_id,s.approval_case_id command_case_id,
          cl.required_response command_required_response
         FROM approval_actions a JOIN approval_cases ac ON ac.id=a.approval_case_id
         JOIN approval_steps s ON s.id=a.approval_step_id
         LEFT JOIN approval_clarifications cl ON cl.approval_case_id=a.approval_case_id AND cl.approval_step_id=a.approval_step_id
         WHERE a.command_key=$1`,
        [input.commandKey],
      );
      if (duplicate.rowCount) {
        const { command_request_id, command_case_id, command_required_response, ...action } = duplicate.rows[0];
        if (action.actor_id !== actor.id.toLowerCase() ||
            command_request_id !== id.toLowerCase() ||
            action.approval_case_id !== command_case_id ||
            action.approval_step_id !== stepId.toLowerCase() ||
            action.action !== input.action || action.channel !== channel ||
            action.reason !== (input.reason?.trim() ?? null) ||
            (input.action === "REQUEST_CLARIFICATION" && command_required_response !== input.requiredResponse?.trim())) {
          throw new ConflictException("Approval command key conflicts with the original command");
        }
        return { idempotent: true, action };
      }
      const request = await this.requests.lockRequest(c, id);
      const found = await c.query<any>(
        `SELECT s.*,ac.payment_request_id,ac.request_revision,ac.validation_run_id,ac.finance_context_snapshot_id,ac.financial_analysis_run_id,ac.policy_decision_run_id,ac.evidence_fingerprint,ac.status case_status,ac.is_current
        FROM approval_steps s JOIN approval_cases ac ON ac.id=s.approval_case_id WHERE s.id=$1 AND ac.payment_request_id=$2 FOR UPDATE OF s,ac`,
        [stepId, id],
      );
      if (!found.rowCount)
        throw new NotFoundException("Approval step not found");
      const step = found.rows[0];
      if (
        request.status !== "PENDING_APPROVAL" ||
        !step.is_current ||
        step.case_status !== "PENDING" ||
        step.status !== "ACTIVE"
      )
        throw new ConflictException("Approval step is not actionable");
      if (!(await this.stillCurrent(c, request, step))) {
        await this.supersede(
          c,
          id,
          step.approval_case_id,
          actor,
          correlationId,
        );
        throw new ConflictException(
          "Approval became stale and requires revalidation",
        );
      }
      const authz = await this.authorized(c, actor, request, step);
      if (!authz.authorized)
        throw new ForbiddenException(
          "Current approval authority is required; self-approval is prohibited",
        );
      if (input.action !== "APPROVE" && !input.reason?.trim())
        throw new BadRequestException("A reason is required");
      if (
        input.action === "REQUEST_CLARIFICATION" &&
        !input.requiredResponse?.trim()
      )
        throw new BadRequestException("A required response is required");
      await c.query(
        "INSERT INTO approval_actions(id,approval_case_id,approval_step_id,actor_id,action,reason,channel,command_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          step.approval_case_id,
          stepId,
          actor.id,
          input.action,
          input.reason?.trim() ?? null,
          channel,
          input.commandKey,
        ],
      );
      if (input.action === "REJECT") {
        await c.query(
          "UPDATE approval_steps SET status='CLOSED',completed_at=now() WHERE approval_case_id=$1 AND status IN('ACTIVE','WAITING')",
          [step.approval_case_id],
        );
        await c.query(
          "UPDATE approval_cases SET status='REJECTED',completed_at=now() WHERE id=$1",
          [step.approval_case_id],
        );
        await c.query(
          "UPDATE payment_requests SET status='REJECTED',updated_at=now(),row_version=row_version+1 WHERE id=$1",
          [id],
        );
        await this.requests.audit(
          c,
          actor.id,
          "APPROVAL_REJECTED",
          id,
          "PENDING_APPROVAL",
          "REJECTED",
          correlationId,
          {
            approvalCaseId: step.approval_case_id,
            stepId,
            reason: input.reason,
            delegatedFrom: authz.delegatedFrom,
          },
        );
        void this.notifications?.publish({
          eventType: "APPROVAL_REJECTED",
          aggregateType: "PAYMENT_REQUEST",
          aggregateId: id,
          recipientUserId: request.createdBy,
          correlationId,
          variables: { ticketNumber: request.ticketNumber ?? "", reason: input.reason ?? "" },
        });
      } else if (input.action === "REQUEST_CLARIFICATION") {
        const clarificationId = randomUUID();
        await c.query(
          "INSERT INTO approval_clarifications(id,approval_case_id,approval_step_id,payment_request_id,clarification_type,reason,required_response,requested_by) VALUES($1,$2,$3,$4,'APPROVAL',$5,$6,$7)",
          [
            clarificationId,
            step.approval_case_id,
            stepId,
            id,
            input.reason!.trim(),
            input.requiredResponse!.trim(),
            actor.id,
          ],
        );
        await c.query(
          "UPDATE approval_steps SET status='CLOSED',completed_at=now() WHERE approval_case_id=$1 AND status IN('ACTIVE','WAITING')",
          [step.approval_case_id],
        );
        await c.query(
          "UPDATE approval_cases SET status='CLARIFICATION',is_current=false,completed_at=now() WHERE id=$1",
          [step.approval_case_id],
        );
        await c.query(
          "UPDATE payment_requests SET status='NEEDS_CLARIFICATION',updated_at=now(),row_version=row_version+1 WHERE id=$1",
          [id],
        );
        await this.requests.audit(
          c,
          actor.id,
          "APPROVAL_CLARIFICATION_REQUESTED",
          id,
          "PENDING_APPROVAL",
          "NEEDS_CLARIFICATION",
          correlationId,
          {
            approvalCaseId: step.approval_case_id,
            stepId,
            clarificationId,
            clarificationType: "APPROVAL",
            delegatedFrom: authz.delegatedFrom,
          },
        );
        void this.notifications?.publish({
          eventType: "NEED_CLARIFICATION",
          aggregateType: "PAYMENT_REQUEST",
          aggregateId: id,
          recipientUserId: request.createdBy,
          correlationId,
          variables: { ticketNumber: request.ticketNumber ?? "", reason: input.reason ?? "" },
        });
      } else
        await this.advance(
          c,
          id,
          request.createdBy,
          request.departmentId,
          request.ticketNumber ?? "",
          step,
          actor,
          correlationId,
          authz.delegatedFrom,
        );
      return {
        idempotent: false,
        approval: await this.getWithin(c, id, actor),
      };
    });
  }

  async respond(
    id: string,
    clarificationId: string,
    input: ApprovalClarificationResponseDto,
    actor: Principal,
    correlationId: string,
  ) {
    return this.db.retryableTransaction(async (c) => {
      const request = await this.requests.lockRequest(c, id);
      if (
        request.status !== "NEEDS_CLARIFICATION" ||
        request.createdBy !== actor.id
      )
        throw new ForbiddenException("Clarification response is not permitted");
      const q = await c.query<any>(
        "SELECT * FROM approval_clarifications WHERE id=$1 AND payment_request_id=$2 AND status='OPEN' FOR UPDATE",
        [clarificationId, id],
      );
      if (!q.rowCount)
        throw new NotFoundException("Open approval clarification not found");
      await c.query(
        "INSERT INTO payment_request_revisions(id,payment_request_id,revision,snapshot,reason,created_by) VALUES($1,$2,$3,$4,'APPROVAL_CLARIFICATION',$5)",
        [
          randomUUID(),
          id,
          request.rowVersion,
          JSON.stringify(request),
          actor.id,
        ],
      );
      await c.query(
        "UPDATE approval_clarifications SET response=$2,responded_by=$3,responded_at=now(),status='RESPONDED' WHERE id=$1",
        [clarificationId, input.response.trim(), actor.id],
      );
      await c.query(
        "UPDATE validation_runs SET is_current=false,status='SUPERSEDED' WHERE payment_request_id=$1 AND is_current",
        [id],
      );
      await c.query(
        "UPDATE payment_requests SET status='SUBMITTED',updated_at=now(),row_version=row_version+1 WHERE id=$1",
        [id],
      );
      await this.requests.audit(
        c,
        actor.id,
        "APPROVAL_CLARIFICATION_RESPONDED",
        id,
        "NEEDS_CLARIFICATION",
        "SUBMITTED",
        correlationId,
        { clarificationId, returnTo: "VALIDATION" },
      );
      return {
        status: "SUBMITTED",
        requiresRevalidation: true,
        returnTo: "VALIDATION",
      };
    });
  }

  async get(id: string, actor: Principal) {
    const allowed = await this.db.pool.query(
      `SELECT 1 FROM payment_requests pr WHERE pr.id=$1 AND
       (pr.created_by=$2 OR $3::boolean OR EXISTS(SELECT 1 FROM approval_cases ac JOIN approval_steps s ON s.approval_case_id=ac.id
        JOIN finance_context_snapshots fc ON fc.id=ac.finance_context_snapshot_id JOIN users u ON u.id=$2 AND u.active
        JOIN approval_authorities aa ON aa.active AND aa.authority_role=s.required_role AND aa.authority_scope=s.authority_scope
          AND (aa.user_id=u.id OR aa.user_id IN (SELECT d.delegate_from FROM approval_delegations d WHERE d.delegate_to=u.id AND d.status='ACTIVE' AND d.start_date<=current_date AND d.end_date>=current_date AND d.delegate_from<>pr.created_by))
        WHERE ac.payment_request_id=pr.id AND ac.is_current AND ac.status='PENDING' AND s.status='ACTIVE' AND pr.status='PENDING_APPROVAL' AND pr.created_by<>$2
          AND (aa.authority_scope='ORGANIZATION' OR aa.department_id=pr.department_id)
          AND (aa.minimum_amount_minor IS NULL OR aa.minimum_amount_minor<=fc.request_amount_minor) AND (aa.maximum_amount_minor IS NULL OR aa.maximum_amount_minor>=fc.request_amount_minor)
          AND (s.minimum_amount_minor IS NULL OR s.minimum_amount_minor<=fc.request_amount_minor) AND (s.maximum_amount_minor IS NULL OR s.maximum_amount_minor>=fc.request_amount_minor)))`,
      [id, actor.id, actor.roles.includes("FINANCE")],
    );
    if (!allowed.rowCount)
      throw new NotFoundException("Payment request not found");
    return this.getWithin(this.db.pool, id, actor);
  }
  async list(actor: Principal, input: { page: number; pageSize: number } = { page: 1, pageSize: 25 }) {
    const broad = actor.roles.includes("FINANCE");
    const q = await this.db.pool.query(
      `WITH eligible AS (
       SELECT DISTINCT ac.id approval_case_id,ac.status,s.id step_id,s.sequence,s.required_role,s.status step_status,
       pr.id payment_request_id,pr.ticket_number,pr.payee,pr.amount,pr.currency,pr.department_id,pr.due_date,ra.final_risk
       FROM approval_cases ac JOIN payment_requests pr ON pr.id=ac.payment_request_id JOIN finance_context_snapshots fc ON fc.id=ac.finance_context_snapshot_id
       JOIN users actor_user ON actor_user.id=$1 AND actor_user.active
       JOIN financial_risk_assessments ra ON ra.analysis_run_id=ac.financial_analysis_run_id LEFT JOIN approval_steps s ON s.approval_case_id=ac.id
       LEFT JOIN approval_authorities aa ON aa.active AND aa.authority_role=s.required_role AND aa.authority_scope=s.authority_scope
        AND (aa.user_id=actor_user.id OR aa.user_id IN (SELECT d.delegate_from FROM approval_delegations d WHERE d.delegate_to=actor_user.id AND d.status='ACTIVE' AND d.start_date<=current_date AND d.end_date>=current_date AND d.delegate_from<>pr.created_by))
        AND (aa.authority_scope='ORGANIZATION' OR aa.department_id=pr.department_id)
        AND (aa.minimum_amount_minor IS NULL OR aa.minimum_amount_minor<=fc.request_amount_minor) AND (aa.maximum_amount_minor IS NULL OR aa.maximum_amount_minor>=fc.request_amount_minor)
        AND (s.minimum_amount_minor IS NULL OR s.minimum_amount_minor<=fc.request_amount_minor) AND (s.maximum_amount_minor IS NULL OR s.maximum_amount_minor>=fc.request_amount_minor)
       WHERE ($2::boolean OR (aa.user_id IS NOT NULL AND pr.created_by<>$1 AND ac.is_current AND ac.status='PENDING' AND pr.status='PENDING_APPROVAL'))
        AND (s.status='ACTIVE' OR $2::boolean)
       ), page_rows AS (
         SELECT * FROM eligible ORDER BY due_date,ticket_number LIMIT $3 OFFSET $4
       )
       SELECT page_rows.*,totals.total::int total
       FROM (SELECT count(*) total FROM eligible) totals
       LEFT JOIN page_rows ON true ORDER BY page_rows.due_date,page_rows.ticket_number`,
      [actor.id, broad, input.pageSize, (input.page - 1) * input.pageSize],
    );
    const total = Number(q.rows[0]?.total ?? 0),
      items = q.rows
        .filter((row) => row.approval_case_id !== null)
        .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "total"))),
      totalPages = Math.ceil(total / input.pageSize);
    return {
      items,
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages,
      hasNextPage: input.page < totalPages,
      hasPreviousPage: input.page > 1,
    };
  }
  private async eligibility(c: PoolClient, id: string) {
    const q = await c.query<any>(
      `SELECT p.id,p.approval_plan,p.auto_approval_eligible,p.policy_version_id,p.evidence_fingerprint,p.validation_run_id,p.finance_context_snapshot_id,p.financial_analysis_run_id,f.request_amount_minor,e.id open_exception
    FROM policy_decision_runs p JOIN validation_runs v ON v.id=p.validation_run_id AND v.is_current AND v.status='COMPLETED' AND v.overall_result='PASS'
    JOIN finance_context_snapshots f ON f.id=p.finance_context_snapshot_id AND f.is_current AND f.status='COMPLETED'
    JOIN financial_analysis_runs a ON a.id=p.financial_analysis_run_id AND a.is_current AND a.status='FINALIZED'
    LEFT JOIN policy_exceptions e ON e.policy_decision_run_id=p.id AND e.status='OPEN'
    WHERE p.payment_request_id=$1 AND p.is_current AND p.ready_for_approval AND p.request_revision=v.request_revision AND p.request_revision=f.request_revision AND p.request_revision=a.request_revision`,
      [id],
    );
    return q.rows[0] ?? null;
  }
  private async matrixFacts(c: PoolClient, request: any, eligible: any): Promise<ApprovalMatrixFacts> {
    const risk =
      (
        await c.query<{ final_risk: string | null; final_priority: string | null }>(
          "SELECT final_risk, final_priority FROM financial_risk_assessments WHERE analysis_run_id=$1",
          [eligible.financial_analysis_run_id],
        )
      ).rows[0] ?? {};
    const projects = await c.query<{ project_id: string }>(
      "SELECT DISTINCT project_id FROM claim_items WHERE payment_request_id=$1 AND internal_status='ACTIVE' AND project_id IS NOT NULL",
      [request.id],
    );
    const today = (await c.query<{ d: string }>("SELECT current_date::text d")).rows[0].d;
    return {
      amountMinor: BigInt(eligible.request_amount_minor),
      currency: request.currency ?? "",
      departmentId: request.departmentId,
      category: request.category ?? "",
      projectIds: projects.rows.map((row) => row.project_id),
      paymentMethod: request.paymentMethod ?? "",
      riskLevel: risk.final_risk ?? "",
      priority: risk.final_priority ?? "",
      claimCount: request.claimCount,
      asOfDate: today,
    };
  }
  private async fingerprint(c: any, id: string) {
    const d = (
      await c.query(
        "SELECT id,logical_document_id,version,document_type,sha256 FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL AND security_status='CLEAN' AND storage_binding_state='VERSION_BOUND' ORDER BY logical_document_id,version,id",
        [id],
      )
    ).rows;
    return fingerprintEvidence(d);
  }
  /**
   * A user acts either because they directly hold matching approval_authorities,
   * or because they are the current delegate of someone who does (an active
   * Approval Delegation, checked with the same role/scope/amount/department
   * matching rules as a direct grant). Self-approval is blocked for the
   * requester in both directions: neither the acting user nor the delegator
   * being substituted may be the request's own creator.
   */
  private async authorized(
    c: any,
    a: Principal,
    r: any,
    s: any,
  ): Promise<{ authorized: boolean; delegatedFrom: string | null }> {
    if (a.id === r.createdBy) return { authorized: false, delegatedFrom: null };
    const amount = (
      await c.query(
        "SELECT request_amount_minor FROM finance_context_snapshots WHERE id=$1",
        [s.finance_context_snapshot_id],
      )
    ).rows[0].request_amount_minor;
    const direct = await c.query(
      `SELECT 1 FROM approval_authorities aa JOIN users u ON u.id=aa.user_id AND u.active WHERE aa.user_id=$1 AND aa.active AND aa.authority_role=$2 AND aa.authority_scope=$3 AND (aa.authority_scope='ORGANIZATION' OR aa.department_id=$4) AND (aa.minimum_amount_minor IS NULL OR aa.minimum_amount_minor<=$5) AND (aa.maximum_amount_minor IS NULL OR aa.maximum_amount_minor>=$5) AND ($6::bigint IS NULL OR $6<=$5) AND ($7::bigint IS NULL OR $7>=$5)`,
      [a.id, s.required_role, s.authority_scope, r.departmentId, amount, s.minimum_amount_minor, s.maximum_amount_minor],
    );
    if (direct.rowCount) return { authorized: true, delegatedFrom: null };
    const today = (await c.query("SELECT current_date::text d")).rows[0].d;
    const delegated = await c.query(
      `SELECT d.delegate_from FROM approval_delegations d
       JOIN approval_authorities aa ON aa.user_id=d.delegate_from AND aa.active AND aa.authority_role=$2 AND aa.authority_scope=$3
         AND (aa.authority_scope='ORGANIZATION' OR aa.department_id=$4)
         AND (aa.minimum_amount_minor IS NULL OR aa.minimum_amount_minor<=$5) AND (aa.maximum_amount_minor IS NULL OR aa.maximum_amount_minor>=$5)
       JOIN users u ON u.id=d.delegate_from AND u.active
       WHERE d.delegate_to=$1 AND d.status='ACTIVE' AND d.start_date<=$8 AND d.end_date>=$8
         AND d.delegate_from<>$9 AND ($6::bigint IS NULL OR $6<=$5) AND ($7::bigint IS NULL OR $7>=$5)
       LIMIT 1`,
      [a.id, s.required_role, s.authority_scope, r.departmentId, amount, s.minimum_amount_minor, s.maximum_amount_minor, today, r.createdBy],
    );
    return delegated.rowCount
      ? { authorized: true, delegatedFrom: delegated.rows[0].delegate_from }
      : { authorized: false, delegatedFrom: null };
  }
  private async stillCurrent(c: any, r: any, s: any) {
    const e = await this.eligibility(c, r.id);
    return Boolean(
      e &&
        r.rowVersion === s.request_revision + 1 &&
        e.id === s.policy_decision_run_id &&
        e.validation_run_id === s.validation_run_id &&
        e.finance_context_snapshot_id === s.finance_context_snapshot_id &&
        e.financial_analysis_run_id === s.financial_analysis_run_id &&
        e.evidence_fingerprint === (await this.fingerprint(c, r.id)),
    );
  }
  private async supersede(
    c: any,
    id: string,
    caseId: string,
    a: Principal,
    correlationId: string,
  ) {
    await c.query(
      "UPDATE approval_cases SET status='SUPERSEDED',is_current=false,completed_at=now() WHERE id=$1",
      [caseId],
    );
    await c.query(
      "UPDATE approval_steps SET status='CLOSED',completed_at=now() WHERE approval_case_id=$1 AND status IN('ACTIVE','WAITING')",
      [caseId],
    );
    await c.query(
      "UPDATE payment_requests SET status='NEEDS_CLARIFICATION',updated_at=now(),row_version=row_version+1 WHERE id=$1",
      [id],
    );
    await this.requests.audit(
      c,
      a.id,
      "APPROVAL_SUPERSEDED",
      id,
      "PENDING_APPROVAL",
      "NEEDS_CLARIFICATION",
      correlationId,
      { approvalCaseId: caseId, returnTo: "VALIDATION" },
    );
  }
  private async advance(
    c: any,
    id: string,
    requesterId: string,
    departmentId: string,
    ticketNumber: string,
    s: any,
    a: Principal,
    correlationId: string,
    delegatedFrom: string | null = null,
  ) {
    await c.query(
      "UPDATE approval_steps SET status='APPROVED',completed_at=now() WHERE id=$1",
      [s.id],
    );
    // Parallel group: wait for the group's threshold (default: every step
    // in the group) before closing remaining siblings and progressing.
    if (s.parallel_group !== null && s.parallel_group !== undefined) {
      const group = await c.query(
        "SELECT status FROM approval_steps WHERE approval_case_id=$1 AND sequence=$2 AND parallel_group=$3",
        [s.approval_case_id, s.sequence, s.parallel_group],
      );
      const approvedCount = group.rows.filter((row: any) => row.status === "APPROVED").length;
      const required = s.required_approvals ?? group.rowCount;
      if (approvedCount < required) {
        await this.requests.audit(
          c,
          a.id,
          "APPROVAL_APPROVED",
          id,
          "PENDING_APPROVAL",
          "PENDING_APPROVAL",
          correlationId,
          {
            approvalCaseId: s.approval_case_id,
            stepId: s.id,
            parallelGroup: s.parallel_group,
            approvedCount,
            required,
            awaitingMoreParallelApprovals: true,
            delegatedFrom,
          },
        );
        return;
      }
      await c.query(
        "UPDATE approval_steps SET status='CLOSED',completed_at=now() WHERE approval_case_id=$1 AND sequence=$2 AND parallel_group=$3 AND status='ACTIVE'",
        [s.approval_case_id, s.sequence, s.parallel_group],
      );
    }
    const next = (
      await c.query(
        `SELECT * FROM approval_steps WHERE approval_case_id=$1 AND status='WAITING'
         AND sequence=(SELECT min(sequence) FROM approval_steps WHERE approval_case_id=$1 AND status='WAITING')
         ORDER BY id FOR UPDATE`,
        [s.approval_case_id],
      )
    ).rows;
    if (next.length) {
      const amount = (
        await c.query(
          "SELECT request_amount_minor FROM finance_context_snapshots WHERE id=$1",
          [s.finance_context_snapshot_id],
        )
      ).rows[0].request_amount_minor;
      for (const nextStep of next) {
        await c.query(
          "UPDATE approval_steps SET status='ACTIVE',activated_at=now() WHERE id=$1",
          [nextStep.id],
        );
        await this.queueStep(c, id, requesterId, departmentId, amount, nextStep, correlationId);
        await this.requests.audit(
          c,
          a.id,
          "APPROVAL_STEP_ACTIVATED",
          id,
          "PENDING_APPROVAL",
          "PENDING_APPROVAL",
          correlationId,
          { approvalCaseId: s.approval_case_id, stepId: nextStep.id },
        );
      }
      await this.requests.audit(
        c,
        a.id,
        "APPROVAL_APPROVED",
        id,
        "PENDING_APPROVAL",
        "PENDING_APPROVAL",
        correlationId,
        {
          approvalCaseId: s.approval_case_id,
          stepId: s.id,
          nextStepIds: next.map((row: any) => row.id),
          delegatedFrom,
        },
      );
    } else {
      await this.finalizeApprovalAndCreateCommitment(
        c,
        id,
        s.approval_case_id,
        s.finance_context_snapshot_id,
        a.id,
        correlationId,
      );
      await this.requests.audit(
        c,
        a.id,
        "APPROVAL_CASE_COMPLETED",
        id,
        "PENDING_APPROVAL",
        "APPROVED",
        correlationId,
        { approvalCaseId: s.approval_case_id, readyForFinanceControl: true, delegatedFrom },
      );
      void this.notifications?.publish({
        eventType: "APPROVAL_APPROVED",
        aggregateType: "PAYMENT_REQUEST",
        aggregateId: id,
        recipientUserId: requesterId,
        correlationId,
        variables: { ticketNumber },
      });
    }
  }
  private async finalizeApprovalAndCreateCommitment(
    c: any,
    requestId: string,
    caseId: string,
    contextId: string,
    actorId: string | null,
    correlationId: string,
  ) {
    const context = await c.query(
      `SELECT fc.*,bv.id current_budget_version_id FROM finance_context_snapshots fc
      JOIN budgets b ON b.id=fc.budget_id AND b.status='ACTIVE' JOIN budget_versions bv ON bv.id=fc.budget_version_id AND bv.status='ACTIVE'
      WHERE fc.id=$1 AND fc.is_current AND fc.status='COMPLETED'`,
      [contextId],
    );
    if (!context.rowCount)
      throw new ConflictException(
        "Current Finance Context budget identity is required for commitment",
      );
    const f = context.rows[0];
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      String(f.budget_id),
    ]);
    const inserted = await c.query(
      `INSERT INTO budget_commitments(id,budget_id,payment_request_id,request_revision,amount_minor,currency,status,finance_context_snapshot_id,budget_version_id,approval_case_id,source)
      SELECT $1,$2,$3,ac.request_revision,$4,$5,'ACTIVE',$6,$7,$8,'APPROVAL' FROM approval_cases ac WHERE ac.id=$8
      ON CONFLICT (approval_case_id) WHERE source='APPROVAL' DO NOTHING RETURNING id`,
      [
        randomUUID(),
        f.budget_id,
        requestId,
        f.request_amount_minor,
        f.request_currency,
        contextId,
        f.budget_version_id,
        caseId,
      ],
    );
    if (inserted.rowCount)
      await this.requests.audit(
        c,
        actorId,
        "BUDGET_COMMITMENT_CREATED",
        requestId,
        null,
        null,
        correlationId,
        {
          commitmentId: inserted.rows[0].id,
          approvalCaseId: caseId,
          budgetId: f.budget_id,
          financeContextSnapshotId: contextId,
        },
      );
    await c.query(
      "UPDATE approval_cases SET status='APPROVED',completed_at=COALESCE(completed_at,now()) WHERE id=$1",
      [caseId],
    );
    await c.query(
      "UPDATE payment_requests SET status='APPROVED',updated_at=now(),row_version=row_version+1 WHERE id=$1 AND status IN('VALIDATING','PENDING_APPROVAL')",
      [requestId],
    );
  }
  private async queueStep(
    c: any,
    requestId: string,
    requesterId: string,
    departmentId: string,
    amount: string,
    s: any,
    correlationId: string,
  ) {
    const holders = await c.query(
      `SELECT DISTINCT aa.user_id FROM approval_authorities aa JOIN users u ON u.id=aa.user_id AND u.active WHERE aa.active AND aa.authority_role=$1 AND aa.authority_scope=$2 AND (aa.authority_scope='ORGANIZATION' OR aa.department_id=$3) AND aa.user_id<>$4 AND (aa.minimum_amount_minor IS NULL OR aa.minimum_amount_minor<=$5) AND (aa.maximum_amount_minor IS NULL OR aa.maximum_amount_minor>=$5)`,
      [s.required_role, s.authority_scope, departmentId, requesterId, amount],
    );
    // Route notifications through any active delegation: a holder who has
    // delegated away receives nothing; their delegate does instead.
    const today = (await c.query("SELECT current_date::text d")).rows[0].d;
    const recipients = new Set<string>();
    for (const holder of holders.rows) {
      const resolved = await this.delegations.resolveDelegate(c, holder.user_id, today);
      if (resolved.userId !== requesterId) recipients.add(resolved.userId);
    }
    if (!recipients.size) return;
    const requestInfo = (
      await c.query(
        "SELECT ticket_number, currency FROM payment_requests WHERE id=$1",
        [requestId],
      )
    ).rows[0];
    for (const recipientUserId of recipients)
      void this.notifications?.publish({
        eventType: "APPROVAL_REQUESTED",
        aggregateType: "PAYMENT_REQUEST",
        aggregateId: requestId,
        recipientUserId,
        correlationId,
        variables: {
          ticketNumber: requestInfo?.ticket_number ?? "",
          currency: requestInfo?.currency ?? "",
          amount: String(amount),
        },
      });
    const bound = await c.query(
      `SELECT u.id FROM users u JOIN telegram_identity_bindings t ON t.user_id=u.id AND t.status='ACTIVE' WHERE u.id = ANY($1::uuid[]) AND u.active`,
      [[...recipients]],
    );
    for (const row of bound.rows)
      await c.query(
        "INSERT INTO notification_outbox(id,aggregate_type,aggregate_id,event_type,channel,recipient_user_id,payload) VALUES($1,'APPROVAL_STEP',$2,'APPROVAL_STEP_ACTIVATED','TELEGRAM',$3,$4) ON CONFLICT DO NOTHING",
        [
          randomUUID(),
          s.id,
          row.id,
          JSON.stringify({
            requestId,
            approvalCaseId: s.approval_case_id,
            stepId: s.id,
            correlationId,
          }),
        ],
      );
  }
  private async present(c: any, ac: any, actor: Principal) {
    const detail =
      (
        await c.query(
          `SELECT pr.ticket_number,pr.payee,pr.purpose,pr.amount,pr.currency,pr.department_id,pr.due_date,
      fc.revised_amount_minor,fc.available_amount_minor,fc.projected_available_amount_minor,ra.ai_assessment,ra.final_risk,ra.final_priority,
      pd.result policy_result,pd.approval_plan,pd.matched_rule_ids
      FROM approval_cases ac JOIN payment_requests pr ON pr.id=ac.payment_request_id JOIN finance_context_snapshots fc ON fc.id=ac.finance_context_snapshot_id
      JOIN financial_analysis_runs far ON far.id=ac.financial_analysis_run_id JOIN financial_risk_assessments ra ON ra.analysis_run_id=far.id
      JOIN policy_decision_runs pd ON pd.id=ac.policy_decision_run_id WHERE ac.id=$1`,
          [ac.id],
        )
      ).rows[0] ?? null;
    const commitment =
      (
        await c.query(
          "SELECT id,status,amount_minor,currency,budget_id,budget_version_id,finance_context_snapshot_id FROM budget_commitments WHERE approval_case_id=$1",
          [ac.id],
        )
      ).rows[0] ?? null;
    return {
      case: ac,
      steps: (
        await c.query(
          "SELECT * FROM approval_steps WHERE approval_case_id=$1 ORDER BY sequence",
          [ac.id],
        )
      ).rows,
      clarifications: (
        await c.query(
          "SELECT * FROM approval_clarifications WHERE approval_case_id=$1 ORDER BY requested_at",
          [ac.id],
        )
      ).rows,
      detail,
      evidence: (
        await c.query(
          "SELECT id,original_filename,document_type,version,security_status FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL AND security_status='CLEAN' AND storage_binding_state='VERSION_BOUND' ORDER BY uploaded_at",
          [ac.payment_request_id],
        )
      ).rows,
      history: (
        await c.query(
          "SELECT aa.action,aa.reason,aa.channel,aa.acted_at,aa.actor_id,s.sequence,s.required_role FROM approval_actions aa LEFT JOIN approval_steps s ON s.id=aa.approval_step_id WHERE aa.approval_case_id=$1 ORDER BY aa.acted_at",
          [ac.id],
        )
      ).rows,
      actorId: actor.id,
      commitment,
      commitmentStatus: commitment?.status ?? "NOT_CREATED",
      readyForFinanceControl:
        ac.status === "APPROVED" && commitment?.status === "ACTIVE",
    };
  }
  private async getWithin(c: any, id: string, actor: Principal) {
    const q = await c.query(
      "SELECT * FROM approval_cases WHERE payment_request_id=$1 ORDER BY created_at DESC LIMIT 1",
      [id],
    );
    return q.rowCount
      ? this.present(c, q.rows[0], actor)
      : {
          case: null,
          steps: [],
          clarifications: [],
          readyForFinanceControl: false,
        };
  }
}

// Telegram binding/webhook helpers moved to application/notification/ (P20.5G).
