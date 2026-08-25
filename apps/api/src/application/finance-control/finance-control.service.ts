/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { PaymentRequestService } from "../payment-requests/payment-request.service.js";
import { fingerprintEvidence } from "../policy/policy.service.js";
import { decimalToMinor } from "../../domain/finance-context.js";
import {
  classifyDuplicate,
  type FinanceControlCheckCode,
} from "../../domain/finance-control.js";
import type {
  FinanceConfirmationDto,
  FinanceFinalizeDto,
  FinanceHoldResolutionDto,
} from "./finance-control.dto.js";

type CheckResult = {
  code: FinanceControlCheckCode;
  source: "SYSTEM" | "FINANCE_USER";
  result: "PASS" | "FAIL" | "REVIEW_REQUIRED";
  detail?: object;
};
const UPSTREAM_CODES = new Set<FinanceControlCheckCode>([
  "REQUEST_NOT_APPROVED",
  "REQUEST_REVISION_CHANGED",
  "APPROVAL_NOT_CURRENT",
  "APPROVAL_ROUTE_INCOMPLETE",
  "APPROVER_AUTHORITY_INVALID",
  "EVIDENCE_MISMATCH",
  "REQUIRED_EVIDENCE_MISSING",
  "AMOUNT_CHANGED",
  "PAYEE_CHANGED",
  "CURRENCY_CHANGED",
  "DEPARTMENT_OR_CATEGORY_CHANGED",
  "PAYMENT_DETAILS_CHANGED",
  "VALIDATION_STALE",
  "FINANCE_CONTEXT_STALE",
  "FINANCIAL_ANALYSIS_STALE",
  "POLICY_DECISION_STALE",
  "COMMITMENT_MISSING",
  "COMMITMENT_NOT_ACTIVE",
  "COMMITMENT_AMOUNT_MISMATCH",
  "COMMITMENT_CURRENCY_MISMATCH",
  "COMMITMENT_BUDGET_INVALID",
]);

@Injectable()
export class FinanceControlService {
  constructor(
    private readonly db: Postgres,
    private readonly requests: PaymentRequestService,
  ) {}

  private async authorize(c: any, actor: Principal, request: any) {
    const q = await c.query(
      `SELECT 1 FROM finance_control_authorities f JOIN users u ON u.id=f.user_id AND u.active
      WHERE f.user_id=$1 AND f.active AND (f.scope='ORGANIZATION' OR f.department_id=$2)
      AND (f.allow_self_control OR $1<>$3)`,
      [actor.id, request.departmentId, request.createdBy],
    );
    if (!q.rowCount)
      throw new ForbiddenException(
        "Finance Controller authority is required; self-control is prohibited",
      );
  }

  async start(id: string, actor: Principal, correlationId: string) {
    return this.db.financeTransaction(actor.id, correlationId, async (c) => {
      const request = await this.requests.lockRequest(c, id);
      await this.authorize(c, actor, request);
      const current = await c.query<any>(
        "SELECT * FROM finance_control_runs WHERE payment_request_id=$1 AND is_current FOR UPDATE",
        [id],
      );
      if (current.rowCount) return this.present(c, current.rows[0]);
      if (request.status !== "APPROVED")
        throw new ConflictException(
          "Only an APPROVED request may enter Final Finance Control",
        );
      const facts = await this.eligibleFacts(c, id);
      if (!facts)
        throw new ConflictException(
          "Current Approval and active commitment are required for Final Finance Control",
        );
      const fingerprint = await this.fingerprint(c, id);
      if (fingerprint !== facts.evidence_fingerprint)
        throw new ConflictException("Approval evidence is stale");
      const duplicateStatus = await this.duplicateStatus(c, id, request);
      const version = (
        await c.query(
          "SELECT COALESCE(max(run_version),0)+1 version FROM finance_control_runs WHERE payment_request_id=$1",
          [id],
        )
      ).rows[0].version;
      const runId = randomUUID();
      await c.query(
        `INSERT INTO finance_control_runs(id,payment_request_id,run_version,request_revision,validation_run_id,finance_context_snapshot_id,
       financial_analysis_run_id,policy_decision_run_id,approval_case_id,commitment_id,evidence_fingerprint,approved_payee,approved_amount,approved_currency,
       approved_department_id,approved_category,approved_payment_method,approved_payment_details_hash,duplicate_status,
       duplicate_checked_at,duplicate_check_version,duplicate_evidence_fingerprint,status,started_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),1,$11,'CHECKING',$20)`,
        [
          runId,
          id,
          version,
          request.rowVersion,
          facts.validation_run_id,
          facts.finance_context_snapshot_id,
          facts.financial_analysis_run_id,
          facts.policy_decision_run_id,
          facts.approval_case_id,
          facts.commitment_id,
          fingerprint,
          request.payee,
          request.amount,
          request.currency,
          request.departmentId,
          request.category,
          request.paymentMethod,
          this.hash(request.paymentDetails ?? ""),
          duplicateStatus,
          actor.id,
        ],
      );
      await c.query(
        "UPDATE payment_requests SET status='FINANCE_CHECK',updated_at=now(),row_version=row_version+1 WHERE id=$1",
        [id],
      );
      await this.requests.audit(
        c,
        actor.id,
        "FINANCE_CONTROL_STARTED",
        id,
        "APPROVED",
        "FINANCE_CHECK",
        correlationId,
        {
          financeControlRunId: runId,
          runVersion: Number(version),
          duplicateStatus,
        },
      );
      return this.present(
        c,
        (
          await c.query("SELECT * FROM finance_control_runs WHERE id=$1", [
            runId,
          ])
        ).rows[0],
      );
    });
  }

  async confirm(
    runId: string,
    input: FinanceConfirmationDto,
    actor: Principal,
    correlationId: string,
  ) {
    return this.db.financeTransaction(actor.id, correlationId, async (c) => {
      const request = await this.requests.lockRequest(
          c,
          await this.runRequestId(c, runId),
        ),
        run = await this.lockRun(c, runId);
      await this.authorize(c, actor, request);
      if (
        !run.is_current ||
        run.status !== "CHECKING" ||
        request.status !== "FINANCE_CHECK"
      )
        throw new ConflictException(
          "Finance Control run is not accepting confirmations",
        );
      await c.query(
        `INSERT INTO finance_control_confirmations(id,finance_control_run_id,code,confirmed,confirmed_by)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(finance_control_run_id,code) DO UPDATE SET confirmed=EXCLUDED.confirmed,confirmed_by=EXCLUDED.confirmed_by,confirmed_at=now()`,
        [randomUUID(), runId, input.code, input.confirmed, actor.id],
      );
      await this.requests.audit(
        c,
        actor.id,
        "FINANCE_CONTROL_CONFIRMATION_RECORDED",
        request.id,
        "FINANCE_CHECK",
        "FINANCE_CHECK",
        correlationId,
        {
          financeControlRunId: runId,
          checkCode: input.code,
          confirmed: input.confirmed,
        },
      );
      return { runId, code: input.code, confirmed: input.confirmed };
    });
  }

  async finalize(
    runId: string,
    input: FinanceFinalizeDto,
    actor: Principal,
    correlationId: string,
  ) {
    return this.db.financeTransaction(
      actor.id,
      correlationId,
      async (c) => {
        const request = await this.requests.lockRequest(
            c,
            await this.runRequestId(c, runId),
          ),
          run = await this.lockRun(c, runId);
        await this.authorize(c, actor, request);
        if (run.payment_request_id !== request.id)
          throw new ConflictException("Finance Control run identity mismatch");
        if (run.completed_command_key) {
          if (
            run.completed_command_key === input.commandKey &&
            run.completed_command_type === "FINALIZE"
          )
            return this.finalizeReplay(c, run);
          throw new ConflictException(
            "Finance Control run was finalized by a different command",
          );
        }
        const commandUsed = await c.query(
          "SELECT 1 FROM finance_control_runs WHERE completed_command_key=$1 AND id<>$2",
          [input.commandKey, runId],
        );
        if (commandUsed.rowCount)
          throw new ConflictException(
            "Finalize command key belongs to another Finance Control run",
          );
        if (
          !run.is_current ||
          run.status !== "CHECKING" ||
          request.status !== "FINANCE_CHECK"
        )
          throw new ConflictException("Finance Control run is not finalizable");
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtext('AIMS_DUPLICATE_CONTROL'))",
        );
        const refreshedDuplicateStatus = await this.duplicateStatus(
            c,
            request.id,
            request,
          ),
          duplicateFingerprint = await this.fingerprint(c, request.id);
        await c.query(
          `UPDATE finance_control_runs SET duplicate_status=$2,duplicate_checked_at=now(),
          duplicate_check_version=duplicate_check_version+1,duplicate_evidence_fingerprint=$3 WHERE id=$1`,
          [runId, refreshedDuplicateStatus, duplicateFingerprint],
        );
        run.duplicate_status = refreshedDuplicateStatus;
        run.duplicate_checked_at = new Date();
        run.duplicate_check_version = Number(run.duplicate_check_version) + 1;
        run.duplicate_evidence_fingerprint = duplicateFingerprint;
        const checks = await this.checks(c, request, run),
          failed = checks.filter((x) => x.result !== "PASS");
        for (const check of checks)
          await c.query(
            `INSERT INTO finance_control_checks(id,finance_control_run_id,code,source,result,safe_detail,checked_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              randomUUID(),
              runId,
              check.code,
              check.source,
              check.result,
              JSON.stringify(check.detail ?? {}),
              check.source === "FINANCE_USER" ? actor.id : null,
            ],
          );
        if (failed.length) {
          const upstream = failed.some((x) => UPSTREAM_CODES.has(x.code));
          await this.requests.audit(
            c,
            actor.id,
            "FINANCE_CONTROL_CHECK_FAILED",
            request.id,
            "FINANCE_CHECK",
            upstream ? "SUBMITTED" : "FINANCE_HOLD",
            correlationId,
            {
              financeControlRunId: runId,
              failedCheckCodes: failed.map((x) => x.code),
            },
          );
          if (upstream) {
            await c.query(
              "UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false,finalized_by=$2,finalized_at=now(),completed_command_key=$3,completed_command_type='FINALIZE' WHERE id=$1",
              [runId, actor.id, input.commandKey],
            );
            await this.invalidateUpstream(
              c,
              request,
              run,
              actor,
              correlationId,
              failed.map((x) => x.code),
            );
            await this.requests.audit(
              c,
              actor.id,
              "FINANCE_CONTROL_SUPERSEDED",
              request.id,
              "FINANCE_CHECK",
              "SUBMITTED",
              correlationId,
              {
                financeControlRunId: runId,
                failedCheckCodes: failed.map((x) => x.code),
              },
            );
            return {
              idempotent: false,
              result: "EXCEPTION",
              returnUpstream: true,
              failedCheckCodes: failed.map((x) => x.code),
            };
          }
          await c.query(
            "UPDATE finance_control_runs SET status='HOLD',finalized_by=$2,finalized_at=now(),completed_command_key=$3,completed_command_type='FINALIZE' WHERE id=$1",
            [runId, actor.id, input.commandKey],
          );
          await c.query(
            `INSERT INTO finance_control_exceptions(id,finance_control_run_id,failed_check_codes,reason,required_resolution,created_by)
         VALUES($1,$2,$3,'One or more deterministic or Finance-confirmed controls failed','RECHECK',$4)`,
            [
              randomUUID(),
              runId,
              JSON.stringify(failed.map((x) => x.code)),
              actor.id,
            ],
          );
          await c.query(
            "UPDATE payment_requests SET status='FINANCE_HOLD',updated_at=now(),row_version=row_version+1 WHERE id=$1",
            [request.id],
          );
          await this.requests.audit(
            c,
            actor.id,
            "FINANCE_CONTROL_HOLD_CREATED",
            request.id,
            "FINANCE_CHECK",
            "FINANCE_HOLD",
            correlationId,
            {
              financeControlRunId: runId,
              failedCheckCodes: failed.map((x) => x.code),
            },
          );
          await this.requests.audit(
            c,
            actor.id,
            "FINANCE_CONTROL_COMPLETED",
            request.id,
            "FINANCE_CHECK",
            "FINANCE_HOLD",
            correlationId,
            { financeControlRunId: runId, result: "EXCEPTION" },
          );
          return {
            idempotent: false,
            result: "EXCEPTION",
            financeHold: true,
            failedCheckCodes: failed.map((x) => x.code),
          };
        }
        await c.query("SELECT complete_finance_control_pass($1,$2)", [
          runId,
          input.commandKey,
        ]);
        await this.requests.audit(
          c,
          actor.id,
          "FINANCE_CONTROL_PASSED",
          request.id,
          "FINANCE_CHECK",
          "READY_FOR_PAYMENT",
          correlationId,
          { financeControlRunId: runId },
        );
        await this.requests.audit(
          c,
          actor.id,
          "FINANCE_CONTROL_COMPLETED",
          request.id,
          "FINANCE_CHECK",
          "READY_FOR_PAYMENT",
          correlationId,
          { financeControlRunId: runId, result: "PASS" },
        );
        await this.requests.audit(
          c,
          actor.id,
          "READY_FOR_PAYMENT_SET",
          request.id,
          "FINANCE_CHECK",
          "READY_FOR_PAYMENT",
          correlationId,
          { financeControlRunId: runId },
        );
        return { idempotent: false, result: "PASS", readyForPayment: true };
      },
      input.commandKey,
    );
  }

  async resolve(
    runId: string,
    input: FinanceHoldResolutionDto,
    actor: Principal,
    correlationId: string,
  ) {
    if (!input.note.trim())
      throw new BadRequestException(
        "Finance Hold resolution note must contain non-whitespace characters",
      );
    return this.db.financeTransaction(actor.id, correlationId, async (c) => {
      const request = await this.requests.lockRequest(
          c,
          await this.runRequestId(c, runId),
        ),
        run = await this.lockRun(c, runId);
      await this.authorize(c, actor, request);
      if (
        !run.is_current ||
        run.status !== "HOLD" ||
        request.status !== "FINANCE_HOLD"
      )
        throw new ConflictException("Current Finance Hold is required");
      const exception = await c.query<any>(
        "SELECT * FROM finance_control_exceptions WHERE finance_control_run_id=$1 AND status='OPEN' FOR UPDATE",
        [runId],
      );
      if (!exception.rowCount)
        throw new NotFoundException("Open Finance Hold not found");
      await c.query(
        "UPDATE finance_control_exceptions SET status='RESOLVED',resolved_by=$2,resolved_at=now(),resolution_note=$3 WHERE id=$1",
        [exception.rows[0].id, actor.id, input.note.trim()],
      );
      await c.query(
        "UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false WHERE id=$1",
        [runId],
      );
      const newId = randomUUID(),
        version = Number(run.run_version) + 1;
      await c.query(
        `INSERT INTO finance_control_runs(id,payment_request_id,run_version,request_revision,validation_run_id,finance_context_snapshot_id,financial_analysis_run_id,
       policy_decision_run_id,approval_case_id,commitment_id,evidence_fingerprint,approved_payee,approved_amount,approved_currency,approved_department_id,approved_category,
       approved_payment_method,approved_payment_details_hash,duplicate_status,duplicate_checked_at,duplicate_check_version,duplicate_evidence_fingerprint,status,started_by)
       SELECT $1,payment_request_id,$2,$4,validation_run_id,finance_context_snapshot_id,financial_analysis_run_id,policy_decision_run_id,approval_case_id,
       commitment_id,evidence_fingerprint,approved_payee,approved_amount,approved_currency,approved_department_id,approved_category,approved_payment_method,
       approved_payment_details_hash,duplicate_status,now(),1,evidence_fingerprint,'CHECKING',$3 FROM finance_control_runs WHERE id=$5`,
        [newId, version, actor.id, request.rowVersion, runId],
      );
      await c.query(
        "UPDATE payment_requests SET status='FINANCE_CHECK',updated_at=now(),row_version=row_version+1 WHERE id=$1",
        [request.id],
      );
      await this.requests.audit(
        c,
        actor.id,
        "FINANCE_CONTROL_HOLD_RESOLVED",
        request.id,
        "FINANCE_HOLD",
        "FINANCE_CHECK",
        correlationId,
        {
          previousFinanceControlRunId: runId,
          financeControlRunId: newId,
          resolution: "RECHECK",
        },
      );
      return this.present(
        c,
        (
          await c.query("SELECT * FROM finance_control_runs WHERE id=$1", [
            newId,
          ])
        ).rows[0],
      );
    });
  }

  async get(requestId: string, actor: Principal) {
    const request = await this.readAuthorizationRequest(requestId);
    await this.authorize(this.db.pool, actor, request);
    const q = await this.db.pool.query<any>(
      "SELECT * FROM finance_control_runs WHERE payment_request_id=$1 AND is_current",
      [requestId],
    );
    return q.rowCount
      ? this.present(this.db.pool, q.rows[0])
      : {
          run: null,
          checks: [],
          confirmations: [],
          exception: null,
          readyForPayment: false,
        };
  }
  async history(requestId: string, actor: Principal) {
    const request = await this.readAuthorizationRequest(requestId);
    await this.authorize(this.db.pool, actor, request);
    return {
      items: (
        await this.db.pool.query(
          "SELECT id,run_version,status,duplicate_status,duplicate_checked_at,duplicate_check_version,started_by,started_at,finalized_by,finalized_at,is_current FROM finance_control_runs WHERE payment_request_id=$1 ORDER BY run_version DESC",
          [requestId],
        )
      ).rows,
    };
  }
  async list(actor: Principal) {
    const q = await this.db.pool.query(
      `SELECT pr.id,pr.ticket_number,pr.payee,pr.amount,pr.currency,pr.department_id,pr.due_date,pr.status,
    f.id finance_control_run_id,f.status finance_control_status,ra.final_risk FROM payment_requests pr
    JOIN users u ON u.id=$1 AND u.active JOIN finance_control_authorities a ON a.user_id=u.id AND a.active AND (a.scope='ORGANIZATION' OR a.department_id=pr.department_id)
    LEFT JOIN finance_control_runs f ON f.payment_request_id=pr.id AND f.is_current
    JOIN approval_cases ac ON ac.payment_request_id=pr.id AND ac.is_current JOIN financial_risk_assessments ra ON ra.analysis_run_id=ac.financial_analysis_run_id
    WHERE pr.created_by<>$1 AND pr.status IN('APPROVED','FINANCE_CHECK','FINANCE_HOLD','READY_FOR_PAYMENT') ORDER BY pr.due_date,pr.ticket_number`,
      [actor.id],
    );
    return { items: q.rows };
  }

  private async eligibleFacts(c: any, id: string) {
    return (
      (
        await c.query(
          `SELECT ac.id approval_case_id,ac.validation_run_id,ac.finance_context_snapshot_id,ac.financial_analysis_run_id,ac.policy_decision_run_id,
   ac.evidence_fingerprint,bc.id commitment_id FROM approval_cases ac JOIN validation_runs v ON v.id=ac.validation_run_id AND v.is_current AND v.status='COMPLETED'
   JOIN finance_context_snapshots fc ON fc.id=ac.finance_context_snapshot_id AND fc.is_current AND fc.status='COMPLETED'
   JOIN financial_analysis_runs fa ON fa.id=ac.financial_analysis_run_id AND fa.is_current AND fa.status='FINALIZED'
   JOIN policy_decision_runs pd ON pd.id=ac.policy_decision_run_id AND pd.is_current AND pd.status='CURRENT' AND pd.ready_for_approval
   JOIN budget_commitments bc ON bc.approval_case_id=ac.id AND bc.status='ACTIVE' AND bc.source='APPROVAL'
   WHERE ac.payment_request_id=$1 AND ac.is_current AND ac.status='APPROVED'`,
          [id],
        )
      ).rows[0] ?? null
    );
  }
  private async readAuthorizationRequest(id: string) {
    const q = await this.db.pool.query(
      `SELECT id,department_id "departmentId",created_by "createdBy" FROM payment_requests WHERE id=$1`,
      [id],
    );
    if (!q.rowCount) throw new NotFoundException("Payment request not found");
    return q.rows[0];
  }
  private async fingerprint(c: any, id: string) {
    const docs = (
      await c.query(
        "SELECT id,logical_document_id,version,document_type,sha256 FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL ORDER BY logical_document_id,version,id",
        [id],
      )
    ).rows;
    return fingerprintEvidence(docs);
  }
  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
  private async duplicateStatus(c: any, id: string, r: any) {
    const hash = await c.query(
      `SELECT 1 FROM payment_documents d JOIN payment_documents other ON other.sha256=d.sha256 AND other.payment_request_id<>d.payment_request_id AND other.removed_at IS NULL
    JOIN payment_requests pr ON pr.id=other.payment_request_id AND pr.status NOT IN('DRAFT','REJECTED','CANCELLED') WHERE d.payment_request_id=$1 AND d.removed_at IS NULL LIMIT 1`,
      [id],
    );
    if (hash.rowCount) return "CONFIRMED_DUPLICATE";
    const similar = await c.query(
      "SELECT 1 FROM payment_requests WHERE id<>$1 AND payee=$2 AND amount=$3 AND currency=$4 AND status NOT IN('DRAFT','REJECTED','CANCELLED') LIMIT 1",
      [id, r.payee, r.amount, r.currency],
    );
    return classifyDuplicate(false, Boolean(similar.rowCount));
  }
  private async invalidateUpstream(
    c: any,
    request: any,
    run: any,
    actor: Principal,
    correlationId: string,
    failed: FinanceControlCheckCode[],
  ) {
    await c.query(
      "UPDATE finance_control_exceptions SET status='SUPERSEDED' WHERE finance_control_run_id=$1 AND status='OPEN'",
      [run.id],
    );
    await c.query(
      "UPDATE approval_cases SET status='SUPERSEDED',is_current=false,completed_at=COALESCE(completed_at,now()) WHERE id=$1 AND is_current",
      [run.approval_case_id],
    );
    await c.query(
      "UPDATE approval_steps SET status='CLOSED',completed_at=COALESCE(completed_at,now()) WHERE approval_case_id=$1 AND status IN('ACTIVE','WAITING')",
      [run.approval_case_id],
    );
    await c.query(
      "UPDATE approval_action_tokens SET status='REVOKED' WHERE approval_case_id=$1 AND status='ACTIVE'",
      [run.approval_case_id],
    );
    await c.query(
      "UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE approval_case_id=$1 AND status='PENDING'",
      [run.approval_case_id],
    );
    await c.query(
      `UPDATE budget_commitments SET status='RELEASED',released_at=now(),release_reason='FINANCE_CONTROL_UPSTREAM_FAILURE',
      release_reference_type='FINANCE_CONTROL_RUN',release_reference_id=$2 WHERE id=$1 AND status='ACTIVE'`,
      [run.commitment_id, run.id],
    );
    await c.query(
      "UPDATE policy_decision_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=$1 AND is_current",
      [request.id],
    );
    await c.query(
      "UPDATE policy_exceptions SET status='SUPERSEDED' WHERE payment_request_id=$1 AND status='OPEN'",
      [request.id],
    );
    await c.query(
      "UPDATE financial_analysis_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=$1 AND is_current",
      [request.id],
    );
    await c.query(
      "UPDATE finance_context_snapshots SET status='SUPERSEDED',is_current=false WHERE payment_request_id=$1 AND is_current",
      [request.id],
    );
    await c.query(
      "UPDATE validation_runs SET status='SUPERSEDED',is_current=false WHERE payment_request_id=$1 AND is_current",
      [request.id],
    );
    await c.query(
      "UPDATE payment_requests SET status='SUBMITTED',updated_at=now(),row_version=row_version+1 WHERE id=$1",
      [request.id],
    );
    await this.requests.audit(
      c,
      actor.id,
      "FINANCE_CONTROL_RETURNED_UPSTREAM",
      request.id,
      "FINANCE_CHECK",
      "SUBMITTED",
      correlationId,
      { financeControlRunId: run.id, failedCheckCodes: failed },
    );
  }
  private async lockRun(c: any, id: string) {
    const q = await c.query(
      "SELECT * FROM finance_control_runs WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!q.rowCount)
      throw new NotFoundException("Finance Control run not found");
    return q.rows[0];
  }
  private async runRequestId(c: any, id: string) {
    const q = await c.query(
      "SELECT payment_request_id FROM finance_control_runs WHERE id=$1",
      [id],
    );
    if (!q.rowCount)
      throw new NotFoundException("Finance Control run not found");
    return q.rows[0].payment_request_id;
  }
  private async checks(c: any, request: any, run: any): Promise<CheckResult[]> {
    const facts = await c.query(
      `SELECT ac.status approval_status,ac.is_current approval_current,ac.source,ac.request_revision,ac.evidence_fingerprint,
      v.status validation_status,v.is_current validation_current,fc.status context_status,fc.is_current context_current,fa.status analysis_status,fa.is_current analysis_current,
      pd.status policy_status,pd.is_current policy_current,pd.required_evidence,bc.status commitment_status,bc.amount_minor,bc.currency commitment_currency,
      bc.budget_id,bc.budget_version_id,b.status budget_status,bv.status budget_version_status
      FROM approval_cases ac LEFT JOIN validation_runs v ON v.id=ac.validation_run_id LEFT JOIN finance_context_snapshots fc ON fc.id=ac.finance_context_snapshot_id
      LEFT JOIN financial_analysis_runs fa ON fa.id=ac.financial_analysis_run_id LEFT JOIN policy_decision_runs pd ON pd.id=ac.policy_decision_run_id
      LEFT JOIN budget_commitments bc ON bc.id=$2 LEFT JOIN budgets b ON b.id=bc.budget_id LEFT JOIN budget_versions bv ON bv.id=bc.budget_version_id WHERE ac.id=$1`,
      [run.approval_case_id, run.commitment_id],
    );
    const f = facts.rows[0] ?? {},
      fingerprint = await this.fingerprint(c, request.id),
      amountMinor = decimalToMinor(String(request.amount)).toString();
    const route = (
      await c.query(
        `SELECT count(*) FILTER(WHERE mandatory AND status<>'APPROVED')::int incomplete,
      count(*) FILTER(WHERE mandatory AND status='APPROVED' AND NOT EXISTS(SELECT 1 FROM approval_actions aa JOIN approval_authorities au ON au.user_id=aa.actor_id AND au.active
       JOIN users u ON u.id=au.user_id AND u.active
       WHERE aa.approval_step_id=approval_steps.id AND aa.action='APPROVE' AND au.authority_role=approval_steps.required_role AND au.authority_scope=approval_steps.authority_scope
       AND (au.authority_scope='ORGANIZATION' OR au.department_id=$2)
       AND (au.minimum_amount_minor IS NULL OR au.minimum_amount_minor<=$3) AND (au.maximum_amount_minor IS NULL OR au.maximum_amount_minor>=$3)
       AND (approval_steps.minimum_amount_minor IS NULL OR approval_steps.minimum_amount_minor<=$3)
       AND (approval_steps.maximum_amount_minor IS NULL OR approval_steps.maximum_amount_minor>=$3)))::int invalid
      FROM approval_steps WHERE approval_case_id=$1`,
        [run.approval_case_id, request.departmentId, amountMinor],
      )
    ).rows[0];
    const required = Array.isArray(f.required_evidence)
        ? f.required_evidence
        : [],
      types = new Set(
        (
          await c.query(
            "SELECT document_type FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL",
            [request.id],
          )
        ).rows.map((x: any) => x.document_type),
      );
    const requiredMissing = required.some(
      (x: any) =>
        !types.has(typeof x === "string" ? x : (x.documentType ?? x.type)),
    );
    const confirmations = new Map(
      (
        await c.query(
          "SELECT code,confirmed FROM finance_control_confirmations WHERE finance_control_run_id=$1",
          [run.id],
        )
      ).rows.map((x: any) => [x.code, x.confirmed]),
    );
    const checks: CheckResult[] = [
      {
        code: "REQUEST_NOT_APPROVED",
        source: "SYSTEM",
        result: request.status === "FINANCE_CHECK" ? "PASS" : "FAIL",
      },
      {
        code: "REQUEST_REVISION_CHANGED",
        source: "SYSTEM",
        result:
          request.rowVersion === Number(run.request_revision) + 1
            ? "PASS"
            : "FAIL",
      },
      {
        code: "APPROVAL_NOT_CURRENT",
        source: "SYSTEM",
        result:
          f.approval_current && f.approval_status === "APPROVED"
            ? "PASS"
            : "FAIL",
      },
      {
        code: "APPROVAL_ROUTE_INCOMPLETE",
        source: "SYSTEM",
        result: Number(route.incomplete) === 0 ? "PASS" : "FAIL",
      },
      {
        code: "APPROVER_AUTHORITY_INVALID",
        source: "SYSTEM",
        result:
          f.source === "POLICY_AUTO_APPROVAL" || Number(route.invalid) === 0
            ? "PASS"
            : "FAIL",
      },
      {
        code: "EVIDENCE_MISMATCH",
        source: "SYSTEM",
        result:
          fingerprint === run.evidence_fingerprint &&
          fingerprint === f.evidence_fingerprint
            ? "PASS"
            : "FAIL",
      },
      {
        code: "REQUIRED_EVIDENCE_MISSING",
        source: "SYSTEM",
        result: requiredMissing ? "FAIL" : "PASS",
      },
      {
        code: "AMOUNT_CHANGED",
        source: "SYSTEM",
        result:
          String(request.amount) === String(run.approved_amount)
            ? "PASS"
            : "FAIL",
      },
      {
        code: "PAYEE_CHANGED",
        source: "SYSTEM",
        result: request.payee === run.approved_payee ? "PASS" : "FAIL",
      },
      {
        code: "CURRENCY_CHANGED",
        source: "SYSTEM",
        result: request.currency === run.approved_currency ? "PASS" : "FAIL",
      },
      {
        code: "DEPARTMENT_OR_CATEGORY_CHANGED",
        source: "SYSTEM",
        result:
          request.departmentId === run.approved_department_id &&
          request.category === run.approved_category
            ? "PASS"
            : "FAIL",
      },
      {
        code: "PAYMENT_DETAILS_CHANGED",
        source: "SYSTEM",
        result:
          request.paymentMethod === run.approved_payment_method &&
          this.hash(request.paymentDetails ?? "") ===
            run.approved_payment_details_hash
            ? "PASS"
            : "FAIL",
      },
      {
        code: "VALIDATION_STALE",
        source: "SYSTEM",
        result:
          f.validation_current && f.validation_status === "COMPLETED"
            ? "PASS"
            : "FAIL",
      },
      {
        code: "FINANCE_CONTEXT_STALE",
        source: "SYSTEM",
        result:
          f.context_current && f.context_status === "COMPLETED"
            ? "PASS"
            : "FAIL",
      },
      {
        code: "FINANCIAL_ANALYSIS_STALE",
        source: "SYSTEM",
        result:
          f.analysis_current && f.analysis_status === "FINALIZED"
            ? "PASS"
            : "FAIL",
      },
      {
        code: "POLICY_DECISION_STALE",
        source: "SYSTEM",
        result:
          f.policy_current && f.policy_status === "CURRENT" ? "PASS" : "FAIL",
      },
      {
        code: "COMMITMENT_MISSING",
        source: "SYSTEM",
        result: f.commitment_status ? "PASS" : "FAIL",
      },
      {
        code: "COMMITMENT_NOT_ACTIVE",
        source: "SYSTEM",
        result: f.commitment_status === "ACTIVE" ? "PASS" : "FAIL",
      },
      {
        code: "COMMITMENT_AMOUNT_MISMATCH",
        source: "SYSTEM",
        result: String(f.amount_minor) === amountMinor ? "PASS" : "FAIL",
      },
      {
        code: "COMMITMENT_CURRENCY_MISMATCH",
        source: "SYSTEM",
        result: f.commitment_currency === request.currency ? "PASS" : "FAIL",
      },
      {
        code: "COMMITMENT_BUDGET_INVALID",
        source: "SYSTEM",
        result:
          f.budget_status === "ACTIVE" && f.budget_version_status === "ACTIVE"
            ? "PASS"
            : "FAIL",
      },
      {
        code: "DUPLICATE_INVOICE",
        source: "SYSTEM",
        result:
          run.duplicate_status === "CONFIRMED_DUPLICATE"
            ? "FAIL"
            : run.duplicate_status === "POSSIBLE_DUPLICATE"
              ? "REVIEW_REQUIRED"
              : "PASS",
        detail: { classification: run.duplicate_status },
      },
      {
        code: "DUPLICATE_PAYMENT",
        source: "SYSTEM",
        result: "PASS",
        detail: { paymentRecordsAvailable: false },
      },
      {
        code: "PAYMENT_DETAILS_INCOMPLETE",
        source: "SYSTEM",
        result:
          request.payee?.trim() &&
          request.paymentMethod?.trim() &&
          request.paymentDetails?.trim()
            ? "PASS"
            : "FAIL",
      },
    ];
    for (const code of [
      "PAYEE_VERIFIED",
      "PAYMENT_METHOD_VERIFIED",
      "PAYMENT_DETAILS_VERIFIED",
      "SUPPORTING_DOCUMENTS_VERIFIED",
    ] as const)
      checks.push({
        code,
        source: "FINANCE_USER",
        result: confirmations.get(code) === true ? "PASS" : "FAIL",
      });
    if (run.duplicate_status === "POSSIBLE_DUPLICATE") {
      const confirmed =
        confirmations.get("POSSIBLE_DUPLICATE_REVIEWED") === true;
      checks.find((x) => x.code === "DUPLICATE_INVOICE")!.result = confirmed
        ? "PASS"
        : "FAIL";
      checks.push({
        code: "POSSIBLE_DUPLICATE_REVIEWED",
        source: "FINANCE_USER",
        result: confirmed ? "PASS" : "FAIL",
      });
    }
    return checks;
  }
  private async present(c: any, run: any) {
    return {
      run,
      checks: (
        await c.query(
          "SELECT code,source,result,safe_detail,checked_by,checked_at FROM finance_control_checks WHERE finance_control_run_id=$1 ORDER BY source,code",
          [run.id],
        )
      ).rows,
      confirmations: (
        await c.query(
          "SELECT code,confirmed,confirmed_by,confirmed_at FROM finance_control_confirmations WHERE finance_control_run_id=$1 ORDER BY code",
          [run.id],
        )
      ).rows,
      exception:
        (
          await c.query(
            "SELECT id,failed_check_codes,reason,required_resolution,status,created_at,resolved_at FROM finance_control_exceptions WHERE finance_control_run_id=$1",
            [run.id],
          )
        ).rows[0] ?? null,
      readyForPayment: run.status === "PASSED",
    };
  }
  private async finalizeReplay(c: any, run: any) {
    const view = await this.present(c, run);
    if (run.status === "PASSED")
      return {
        ...view,
        idempotent: true,
        result: "PASS",
        readyForPayment: true,
      };
    const failedCheckCodes =
      view.exception?.failed_check_codes ??
      view.checks
        .filter((check: any) => check.result !== "PASS")
        .map((check: any) => check.code);
    return {
      ...view,
      idempotent: true,
      result: "EXCEPTION",
      financeHold: run.status === "HOLD",
      returnUpstream: run.status === "SUPERSEDED",
      failedCheckCodes,
    };
  }
}
