/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
import { classifyAimsEnvironment } from "../../infrastructure/configuration/aims-environment.js";
import { PaymentRequestService } from "../payment-requests/payment-request.service.js";
import { fingerprintEvidence } from "../policy/policy.service.js";
import type {
  ApprovalActionDto,
  ApprovalClarificationResponseDto,
  TelegramBindingDto,
} from "./approval.dto.js";

@Injectable()
export class ApprovalService {
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
      const caseId = randomUUID();
      await c.query(
        `INSERT INTO approval_cases(id,payment_request_id,request_revision,validation_run_id,finance_context_snapshot_id,financial_analysis_run_id,policy_decision_run_id,policy_version_id,evidence_fingerprint,approval_plan,source,status,created_by,completed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
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
      const duplicate = await c.query<any>(
        "SELECT * FROM approval_actions WHERE command_key=$1",
        [input.commandKey],
      );
      if (duplicate.rowCount) {
        if (duplicate.rows[0].actor_id !== actor.id)
          throw new ForbiddenException(
            "Idempotency key belongs to another actor",
          );
        return { idempotent: true, action: duplicate.rows[0] };
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
      if (!(await this.authorized(c, actor, request, step)))
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
          },
        );
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
          },
        );
      } else
        await this.advance(
          c,
          id,
          request.createdBy,
          request.departmentId,
          step,
          actor,
          correlationId,
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
        JOIN approval_authorities aa ON aa.user_id=u.id AND aa.active AND aa.authority_role=s.required_role AND aa.authority_scope=s.authority_scope
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
       LEFT JOIN approval_authorities aa ON aa.user_id=actor_user.id AND aa.active AND aa.authority_role=s.required_role AND aa.authority_scope=s.authority_scope
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
  async bindTelegram(
    input: TelegramBindingDto,
    actor: Principal,
    correlationId: string,
  ) {
    this.admin(actor);
    assertTelegramId(input.telegramUserId);
    assertTelegramId(input.telegramChatId);
    if (
      isProductionRuntime() &&
      input.telegramUserId !== input.telegramChatId
    )
      throw new BadRequestException(
        "Telegram approval bindings require the user's private chat",
      );
    return this.db.retryableTransaction(async (c) => {
      const user = await c.query("SELECT 1 FROM users WHERE id=$1 AND active", [
        input.userId,
      ]);
      if (!user.rowCount)
        throw new BadRequestException("Active user not found");
      const revoked = await c.query(
        "UPDATE telegram_identity_bindings SET status='REVOKED',revoked_at=now() WHERE user_id=$1 AND status='ACTIVE' RETURNING id",
        [input.userId],
      );
      for (const prior of revoked.rows) {
        await c.query(
          "UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE telegram_binding_id=$1 AND status='PENDING'",
          [prior.id],
        );
        await c.query(
          `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata) VALUES($1,$2,'TELEGRAM_IDENTITY_REVOKED','TELEGRAM_IDENTITY_BINDING',$3,$4,$5)`,
          [
            randomUUID(),
            actor.id,
            prior.id,
            correlationId,
            JSON.stringify({ userId: input.userId, replaced: true }),
          ],
        );
      }
      if (revoked.rowCount) {
        await c.query(
          "UPDATE approval_action_tokens SET status='REVOKED' WHERE recipient_user_id=$1 AND status='ACTIVE'",
          [input.userId],
        );
        await c.query(
          `UPDATE notification_outbox o SET status='FAILED_RETRYABLE',next_attempt_at=now(),
           claimed_at=NULL,claim_token=NULL,claimed_by=NULL,last_error_code='IDENTITY_REBOUND'
           FROM approval_steps s JOIN approval_cases ac ON ac.id=s.approval_case_id
           WHERE o.aggregate_id=s.id AND o.recipient_user_id=$1 AND s.status='ACTIVE'
             AND ac.is_current AND o.status IN('SENT','FAILED_RETRYABLE','PROCESSING')`,
          [input.userId],
        );
      }
      const id = randomUUID();
      await c.query(
        "INSERT INTO telegram_identity_bindings(id,user_id,telegram_user_id,telegram_chat_id,status,created_by) VALUES($1,$2,$3,$4,'ACTIVE',$5)",
        [
          id,
          input.userId,
          input.telegramUserId,
          input.telegramChatId,
          actor.id,
        ],
      );
      await c.query(
        `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
        VALUES($1,$2,'TELEGRAM_IDENTITY_BOUND','TELEGRAM_IDENTITY_BINDING',$3,$4,$5)`,
        [
          randomUUID(),
          actor.id,
          id,
          correlationId,
          JSON.stringify({ userId: input.userId }),
        ],
      );
      await c.query(
        `UPDATE notification_outbox o SET status='FAILED_RETRYABLE',next_attempt_at=now(),
         claimed_at=NULL,claim_token=NULL,claimed_by=NULL,last_error_code='IDENTITY_REBOUND'
         FROM approval_steps s JOIN approval_cases ac ON ac.id=s.approval_case_id
         WHERE o.aggregate_id=s.id AND o.recipient_user_id=$1 AND s.status='ACTIVE'
           AND ac.is_current AND o.status='FAILED_TERMINAL' AND o.last_error_code='IDENTITY_REVOKED'`,
        [input.userId],
      );
      return { id, userId: input.userId, status: "ACTIVE" };
    });
  }

  async createTelegramBindingChallenge(
    userId: string,
    actor: Principal,
    correlationId: string,
  ) {
    this.admin(actor);
    if (process.env.TELEGRAM_APPROVAL_ENABLED !== "true")
      throw new ConflictException("Telegram approval channel is disabled");
    const secret = process.env.TELEGRAM_CALLBACK_SECRET;
    if (!secret)
      throw new ConflictException("Telegram callback configuration is unavailable");
    const id = randomUUID(),
      token = `${id}.${createHmac("sha256", secret).update(id).digest("base64url").slice(0, 24)}`,
      tokenHash = createHash("sha256").update(token).digest("hex"),
      expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await this.db.retryableTransaction(async(c)=>{
      await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
      const generation=await c.query<{generation:string}>("SELECT generation FROM aims_recovery_generation WHERE singleton");
      const user=await c.query("SELECT 1 FROM users WHERE id=$1 AND active",[userId]);
      if(!user.rowCount)throw new BadRequestException("Active user not found");
      await c.query(
        `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
         VALUES($1,$2,'TELEGRAM_BINDING_CHALLENGE_CREATED','TELEGRAM_IDENTITY_BINDING',$3,$4,$5)`,
        [randomUUID(),actor.id,id,correlationId,JSON.stringify({userId,tokenHash,expiresAt,recoveryGeneration:generation.rows[0].generation})],
      );
    });
    return { challenge: `/bind ${token}`, expiresAt };
  }

  async revokeTelegram(
    userId: string,
    actor: Principal,
    correlationId: string,
  ) {
    this.admin(actor);
    return this.db.retryableTransaction(async (c) => {
      const revoked = await c.query<any>(
        "UPDATE telegram_identity_bindings SET status='REVOKED',revoked_at=now() WHERE user_id=$1 AND status='ACTIVE' RETURNING id",
        [userId],
      );
      if (!revoked.rowCount)
        throw new NotFoundException("Active Telegram binding not found");
      for (const binding of revoked.rows)
        await c.query(
          "UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE telegram_binding_id=$1 AND status='PENDING'",
          [binding.id],
        );
      await c.query(
        "UPDATE approval_action_tokens SET status='REVOKED' WHERE recipient_user_id=$1 AND status='ACTIVE'",
        [userId],
      );
      await c.query(
        `UPDATE notification_outbox o SET status='FAILED_TERMINAL',last_error_code='IDENTITY_REVOKED',
         claimed_at=NULL,claim_token=NULL,claimed_by=NULL
         FROM approval_steps s JOIN approval_cases ac ON ac.id=s.approval_case_id
         WHERE o.aggregate_id=s.id AND o.recipient_user_id=$1 AND s.status='ACTIVE'
           AND ac.is_current AND o.status IN('PENDING','FAILED_RETRYABLE','PROCESSING')`,
        [userId],
      );
      for (const binding of revoked.rows)
        await c.query(
          `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
           VALUES($1,$2,'TELEGRAM_IDENTITY_REVOKED','TELEGRAM_IDENTITY_BINDING',$3,$4,$5)`,
          [
            randomUUID(),
            actor.id,
            binding.id,
            correlationId,
            JSON.stringify({ userId, explicit: true }),
          ],
        );
      return { userId, status: "REVOKED" };
    });
  }

  async telegramWebhook(secret: string | undefined, body: unknown) {
    if (process.env.TELEGRAM_APPROVAL_ENABLED !== "true")
      return { ok: false, disabled: true };
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || !secret || !safeEqual(secret, expected))
      throw new ForbiddenException("Invalid Telegram webhook secret");
    const update = validateTelegramUpdate(body),
      updateId = update.update_id;
    const claim = await this.db.retryableTransaction(async (c) => {
      const existing = await c.query<any>(
        "SELECT * FROM telegram_webhook_updates WHERE update_id=$1 FOR UPDATE",
        [updateId],
      );
      if (!existing.rowCount) {
        await c.query(
          "INSERT INTO telegram_webhook_updates(update_id,status,attempts,locked_at)VALUES($1,'PROCESSING',1,now())",
          [updateId],
        );
        return "CLAIMED";
      }
      const row = existing.rows[0];
      if (row.status === "COMPLETED") return "COMPLETED";
      if (row.status === "FAILED_TERMINAL") return "TERMINAL";
      if (
        row.status === "PROCESSING" &&
        row.locked_at &&
        Date.now() - new Date(row.locked_at).getTime() < 120000
      )
        return "PROCESSING";
      await c.query(
        "UPDATE telegram_webhook_updates SET status='PROCESSING',attempts=attempts+1,locked_at=now(),last_error_code=NULL WHERE update_id=$1",
        [updateId],
      );
      return "CLAIMED";
    });
    if (claim === "COMPLETED") return { ok: true, idempotent: true };
    if (claim === "TERMINAL") return { ok: false, terminal: true };
    if (claim === "PROCESSING") return { ok: true, processing: true };
    try {
      const result = await this.processTelegramUpdate(update);
      await this.db.pool.query(
        "UPDATE telegram_webhook_updates SET status='COMPLETED',completed_at=now(),locked_at=NULL WHERE update_id=$1",
        [updateId],
      );
      return result;
    } catch (error) {
      const terminal =
        typeof (error as any)?.getStatus === "function" &&
        (error as any).getStatus() < 500;
      await this.db.pool.query(
        "UPDATE telegram_webhook_updates SET status=$2,locked_at=NULL,last_error_code=$3 WHERE update_id=$1",
        [
          updateId,
          terminal ? "FAILED_TERMINAL" : "FAILED_RETRYABLE",
          (error instanceof Error ? error.name : "WEBHOOK_FAILURE").slice(
            0,
            64,
          ),
        ],
      );
      throw error;
    }
  }

  private async processTelegramUpdate(update: any) {
    const message = update?.message;
    if (typeof message?.text === "string" && message.text.startsWith("/bind "))
      return this.consumeTelegramBindingChallenge(message);
    if (
      typeof message?.text === "string" &&
      typeof message?.from?.id === "number"
    ) {
      const pending = await this.db.retryableTransaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
        const generation=await c.query<{generation:string}>("SELECT generation FROM aims_recovery_generation WHERE singleton");
        const q = await c.query<any>(
          `SELECT i.*,b.telegram_chat_id,u.department_id,ARRAY(SELECT ur.role FROM user_roles ur WHERE ur.user_id=u.id)roles,ac.payment_request_id FROM telegram_pending_interactions i JOIN telegram_identity_bindings b ON b.id=i.telegram_binding_id AND b.status='ACTIVE' JOIN users u ON u.id=i.recipient_user_id AND u.active JOIN approval_cases ac ON ac.id=i.approval_case_id WHERE b.telegram_user_id=$1 AND b.telegram_chat_id=$2 AND i.status='PENDING' AND i.expires_at>now() FOR UPDATE OF i`,
          [message.from.id, message.chat?.id],
        );
        if (!q.rowCount)
          throw new ConflictException("No active Telegram interaction");
        const row = q.rows[0];
        return {...row,recovery_generation:generation.rows[0].generation};
      });
      const result = await this.act(
        pending.payment_request_id,
        pending.approval_step_id,
        {
          commandKey: pending.id,
          action: pending.action,
          reason: message.text.trim(),
          requiredResponse:
            pending.action === "REQUEST_CLARIFICATION"
              ? `Provide the requested information: ${message.text.trim()}`
              : undefined,
        },
        {
          id: pending.recipient_user_id,
          departmentId: pending.department_id,
          roles: pending.roles,
        },
        randomUUID(),
        "TELEGRAM",
        pending.recovery_generation,
      );
      await this.db.pool.query(
        "UPDATE telegram_pending_interactions SET status='CONSUMED',consumed_at=now() WHERE id=$1 AND status='PENDING'",
        [pending.id],
      );
      return result;
    }
    const callback = update?.callback_query;
    if (
      typeof callback?.data !== "string" ||
      typeof callback?.from?.id !== "number"
    )
      return { ok: true, ignored: true };
    const callbackChat = callback.message?.chat;
    if (
      isProductionRuntime() &&
      (!callbackChat ||
        callbackChat.type !== "private" ||
        callbackChat.id !== callback.from.id)
    )
      throw new ForbiddenException(
        "Telegram approval actions require the bound private chat",
      );
    const prepared = await this.db.retryableTransaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
      const generation=await c.query<{generation:string}>("SELECT generation FROM aims_recovery_generation WHERE singleton");
      const token = await c.query<any>(
        `SELECT t.*,ac.payment_request_id,b.id binding_id,b.user_id,u.department_id,ARRAY(SELECT ur.role FROM user_roles ur WHERE ur.user_id=u.id) roles
         FROM approval_action_tokens t JOIN approval_cases ac ON ac.id=t.approval_case_id
         JOIN telegram_identity_bindings b ON b.telegram_user_id=$2 AND ($3::bigint IS NULL OR b.telegram_chat_id=$3) AND b.status='ACTIVE' AND b.user_id=t.recipient_user_id
         JOIN users u ON u.id=b.user_id AND u.active
         WHERE t.token_hash=$1 AND t.issued_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton) FOR UPDATE OF t`,
        [
          createHash("sha256").update(callback.data).digest("hex"),
          callback.from.id,
          callbackChat?.id ?? null,
        ],
      );
      if (!token.rowCount)
        throw new ConflictException(
          "Telegram action token is invalid, expired, or used",
        );
      const row = token.rows[0];
      if (row.status === "CONSUMED" && row.action === "APPROVE") {
        const completed = await c.query(
          "SELECT 1 FROM approval_actions WHERE command_key=$1 AND actor_id=$2 AND action='APPROVE'",
          [row.id, row.user_id],
        );
        if (!completed.rowCount)
          throw new ConflictException(
            "Telegram action token is invalid, expired, or used",
          );
        return {
          duplicate: true,
          requestId: row.payment_request_id,
          stepId: row.approval_step_id,
          tokenId: row.id,
          action: row.action,
          principal: {
            id: row.user_id,
            departmentId: row.department_id,
            roles: row.roles,
          } as Principal,
          recoveryGeneration:generation.rows[0].generation,
        };
      }
      if (row.status !== "ACTIVE" || new Date(row.expires_at) <= new Date())
        throw new ConflictException(
          "Telegram action token is invalid, expired, or used",
        );
      if (row.status !== "ACTIVE")
        throw new ConflictException("Telegram action token is already used");
      if (row.action !== "APPROVE") {
        await c.query(
          "UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE telegram_binding_id=$1 AND status='PENDING'",
          [row.binding_id],
        );
        await c.query(
          "UPDATE approval_action_tokens SET used_at=now(),used_by=$2,status='CONSUMED' WHERE id=$1",
          [row.id, row.user_id],
        );
        const interactionId = randomUUID();
        await c.query(
          "INSERT INTO telegram_pending_interactions(id,telegram_binding_id,recipient_user_id,approval_case_id,approval_step_id,action,status,expires_at)VALUES($1,$2,$3,$4,$5,$6,'PENDING',now()+interval '10 minutes')",
          [
            interactionId,
            row.binding_id,
            row.user_id,
            row.approval_case_id,
            row.approval_step_id,
            row.action,
          ],
        );
        return {
          pending: true,
          action: row.action,
          interactionId,
          chatId: callback.message?.chat?.id,
        };
      }
      return {
        requestId: row.payment_request_id,
        stepId: row.approval_step_id,
        tokenId: row.id,
        action: row.action,
        principal: {
          id: row.user_id,
          departmentId: row.department_id,
          roles: row.roles,
        } as Principal,
        recoveryGeneration:generation.rows[0].generation,
      };
    });
    if ((prepared as any).pending)
      return {
        method: "sendMessage",
        chat_id: (prepared as any).chatId,
        text:
          (prepared as any).action === "REJECT"
            ? "Reply with the rejection reason within 10 minutes."
            : "Reply with the clarification reason and requested information within 10 minutes.",
        reply_markup: { force_reply: true },
      };
    const command = prepared as {
      requestId: string;
      stepId: string;
      tokenId: string;
      principal: Principal;
      recoveryGeneration:string;
    };
    const result = await this.act(
      command.requestId,
      command.stepId,
      { commandKey: command.tokenId, action: "APPROVE" },
      command.principal,
      randomUUID(),
      "TELEGRAM",
      command.recoveryGeneration,
    );
    await this.db.pool.query(
      "UPDATE approval_action_tokens SET used_at=COALESCE(used_at,now()),used_by=COALESCE(used_by,$2),status='CONSUMED' WHERE id=$1 AND status='ACTIVE'",
      [command.tokenId, command.principal.id],
    );
    return result;
  }

  private async consumeTelegramBindingChallenge(message: any) {
    if (
      message.chat?.type !== "private" ||
      message.chat?.id !== message.from?.id
    )
      throw new ForbiddenException("Telegram binding requires a private chat");
    const token = message.text.slice(6).trim();
    if (!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{24}$/.test(token))
      throw new BadRequestException("Invalid Telegram binding challenge");
    const [id, signature] = token.split("."),
      secret = process.env.TELEGRAM_CALLBACK_SECRET,
      expected = secret
        ? createHmac("sha256", secret)
            .update(id)
            .digest("base64url")
            .slice(0, 24)
        : "";
    if (!secret || !safeEqual(signature, expected))
      throw new ForbiddenException("Invalid Telegram binding challenge");
    const created = await this.db.retryableTransaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [id]);
      await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
      const generation=await c.query<{generation:string}>("SELECT generation FROM aims_recovery_generation WHERE singleton");
      const q = await c.query<any>(
        `SELECT ae.actor_id,ae.correlation_id,ae.safe_metadata,u.department_id
         FROM audit_events ae JOIN users u ON u.id=ae.actor_id AND u.active
         WHERE ae.action='TELEGRAM_BINDING_CHALLENGE_CREATED' AND ae.entity_id=$1
           AND EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role='ADMIN')
         ORDER BY occurred_at DESC LIMIT 1`,
        [id],
      );
      if (!q.rowCount)
        throw new ConflictException("Telegram binding challenge is invalid");
      const metadata = q.rows[0].safe_metadata;
      if (
        metadata?.tokenHash !== createHash("sha256").update(token).digest("hex") ||
        metadata?.recoveryGeneration !== generation.rows[0].generation ||
        new Date(metadata?.expiresAt).getTime() <= Date.now()
      )
        throw new ConflictException("Telegram binding challenge is expired");
      const consumed = await c.query(
        "SELECT 1 FROM audit_events WHERE action='TELEGRAM_BINDING_CHALLENGE_CONSUMED' AND entity_id=$1",
        [id],
      );
      if (consumed.rowCount)
        throw new ConflictException("Telegram binding challenge is already used");
      await c.query(
        `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
         VALUES($1,$2,'TELEGRAM_BINDING_CHALLENGE_CONSUMED','TELEGRAM_IDENTITY_BINDING',$3,$4,$5)`,
        [
          randomUUID(),
          q.rows[0].actor_id,
          id,
          q.rows[0].correlation_id,
          JSON.stringify({ userId: metadata.userId }),
        ],
      );
      return {
        userId: metadata.userId as string,
        actorId: q.rows[0].actor_id as string,
        actorDepartmentId: q.rows[0].department_id as string,
        correlationId: q.rows[0].correlation_id as string,
      };
    });
    return this.bindTelegram(
      {
        userId: created.userId,
        telegramUserId: String(message.from.id),
        telegramChatId: String(message.chat.id),
      },
      {
        id: created.actorId,
        departmentId: created.actorDepartmentId,
        roles: ["ADMIN"],
      },
      created.correlationId,
    );
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
  private async fingerprint(c: any, id: string) {
    const d = (
      await c.query(
        "SELECT id,logical_document_id,version,document_type,sha256 FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL AND security_status='CLEAN' ORDER BY logical_document_id,version,id",
        [id],
      )
    ).rows;
    return fingerprintEvidence(d);
  }
  private async authorized(c: any, a: Principal, r: any, s: any) {
    if (a.id === r.createdBy) return false;
    const q = await c.query(
      `SELECT 1 FROM approval_authorities aa JOIN users u ON u.id=aa.user_id AND u.active WHERE aa.user_id=$1 AND aa.active AND aa.authority_role=$2 AND aa.authority_scope=$3 AND (aa.authority_scope='ORGANIZATION' OR aa.department_id=$4) AND (aa.minimum_amount_minor IS NULL OR aa.minimum_amount_minor<=$5) AND (aa.maximum_amount_minor IS NULL OR aa.maximum_amount_minor>=$5) AND ($6::bigint IS NULL OR $6<=$5) AND ($7::bigint IS NULL OR $7>=$5)`,
      [
        a.id,
        s.required_role,
        s.authority_scope,
        r.departmentId,
        (
          await c.query(
            "SELECT request_amount_minor FROM finance_context_snapshots WHERE id=$1",
            [s.finance_context_snapshot_id],
          )
        ).rows[0].request_amount_minor,
        s.minimum_amount_minor,
        s.maximum_amount_minor,
      ],
    );
    return Boolean(q.rowCount);
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
    s: any,
    a: Principal,
    correlationId: string,
  ) {
    await c.query(
      "UPDATE approval_steps SET status='APPROVED',completed_at=now() WHERE id=$1",
      [s.id],
    );
    const next = (
      await c.query(
        "SELECT * FROM approval_steps WHERE approval_case_id=$1 AND status='WAITING' ORDER BY sequence LIMIT 1 FOR UPDATE",
        [s.approval_case_id],
      )
    ).rows[0];
    if (next) {
      await c.query(
        "UPDATE approval_steps SET status='ACTIVE',activated_at=now() WHERE id=$1",
        [next.id],
      );
      const amount = (
        await c.query(
          "SELECT request_amount_minor FROM finance_context_snapshots WHERE id=$1",
          [s.finance_context_snapshot_id],
        )
      ).rows[0].request_amount_minor;
      await this.queueStep(c, id, requesterId, departmentId, amount, next, correlationId);
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
          nextStepId: next.id,
        },
      );
      await this.requests.audit(
        c,
        a.id,
        "APPROVAL_STEP_ACTIVATED",
        id,
        "PENDING_APPROVAL",
        "PENDING_APPROVAL",
        correlationId,
        { approvalCaseId: s.approval_case_id, stepId: next.id },
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
        { approvalCaseId: s.approval_case_id, readyForFinanceControl: true },
      );
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
    const users = await c.query(
      `SELECT DISTINCT aa.user_id FROM approval_authorities aa JOIN users u ON u.id=aa.user_id AND u.active JOIN telegram_identity_bindings t ON t.user_id=u.id AND t.status='ACTIVE' WHERE aa.active AND aa.authority_role=$1 AND aa.authority_scope=$2 AND (aa.authority_scope='ORGANIZATION' OR aa.department_id=$3) AND aa.user_id<>$4 AND (aa.minimum_amount_minor IS NULL OR aa.minimum_amount_minor<=$5) AND (aa.maximum_amount_minor IS NULL OR aa.maximum_amount_minor>=$5)`,
      [s.required_role, s.authority_scope, departmentId, requesterId, amount],
    );
    for (const u of users.rows)
      await c.query(
        "INSERT INTO notification_outbox(id,aggregate_type,aggregate_id,event_type,channel,recipient_user_id,payload) VALUES($1,'APPROVAL_STEP',$2,'APPROVAL_STEP_ACTIVATED','TELEGRAM',$3,$4) ON CONFLICT DO NOTHING",
        [
          randomUUID(),
          s.id,
          u.user_id,
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
          "SELECT id,original_filename,document_type,version,security_status FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL AND security_status='CLEAN' ORDER BY uploaded_at",
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

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function assertTelegramId(value: string): void {
  if (!/^[1-9][0-9]{0,15}$/.test(value))
    throw new BadRequestException("Telegram identifier is invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new BadRequestException("Telegram identifier is outside the safe range");
}

function validateTelegramUpdate(body: unknown): any {
  assertBoundedStructure(body, 0, { nodes: 0 });
  if (!isRecord(body))
    throw new BadRequestException("Telegram update must be an object");
  assertSafeTelegramNumber(body.update_id, "update ID", true);
  const message = body.message;
  const callback = body.callback_query;
  if (message !== undefined) validateTelegramMessage(message);
  if (callback !== undefined) {
    if (!isRecord(callback))
      throw new BadRequestException("Telegram callback is malformed");
    if (typeof callback.data !== "string" || Buffer.byteLength(callback.data) > 64)
      throw new BadRequestException("Telegram callback data is invalid");
    validateTelegramIdentity(callback.from, "callback user");
    if (
      isProductionRuntime() &&
      !isRecord(callback.message)
    )
      throw new BadRequestException("Telegram callback message is required");
    if (isRecord(callback.message)) validateTelegramChat(callback.message.chat);
  }
  return body;
}

function validateTelegramMessage(value: unknown): void {
  if (!isRecord(value))
    throw new BadRequestException("Telegram message is malformed");
  if (typeof value.text !== "string" || value.text.length < 1 || value.text.length > 2_000)
    throw new BadRequestException("Telegram message text is invalid");
  validateTelegramIdentity(value.from, "message user");
  validateTelegramChat(value.chat);
}

function validateTelegramIdentity(value: unknown, label: string): void {
  if (!isRecord(value))
    throw new BadRequestException(`Telegram ${label} is malformed`);
  assertSafeTelegramNumber(value.id, label, false);
}

function validateTelegramChat(value: unknown): void {
  if (!isRecord(value))
    throw new BadRequestException("Telegram chat is malformed");
  assertSafeTelegramNumber(value.id, "chat ID", false);
  if (
    isProductionRuntime() &&
    value.type !== "private"
  )
    throw new ForbiddenException("Telegram approval supports private chats only");
}

function assertSafeTelegramNumber(
  value: unknown,
  label: string,
  allowZero: boolean,
): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (allowZero ? value < 0 : value <= 0)
  )
    throw new BadRequestException(`Telegram ${label} is invalid`);
}

function assertBoundedStructure(
  value: unknown,
  depth: number,
  counter: { nodes: number },
): void {
  counter.nodes += 1;
  if (depth > 8 || counter.nodes > 128)
    throw new BadRequestException("Telegram update structure is too complex");
  if (Array.isArray(value)) {
    if (value.length > 32)
      throw new BadRequestException("Telegram update array is too large");
    for (const child of value) assertBoundedStructure(child, depth + 1, counter);
  } else if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 32)
      throw new BadRequestException("Telegram update object is too large");
    for (const [, child] of entries)
      assertBoundedStructure(child, depth + 1, counter);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProductionRuntime(): boolean {
  return classifyAimsEnvironment().protected;
}
