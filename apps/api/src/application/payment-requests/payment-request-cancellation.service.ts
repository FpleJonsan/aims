import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  assertCancellationState,
  FINANCE_CANCELLABLE_STATUSES,
  REQUESTER_CANCELLABLE_STATUSES,
  type PaymentRequest,
  type Principal,
} from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import type { CancelPaymentRequestDto } from "./payment-request.dto.js";
import {
  mapRequest,
  PaymentRequestService,
} from "./payment-request.service.js";

@Injectable()
export class PaymentRequestCancellationService {
  constructor(
    private readonly database: Postgres,
    private readonly requests: PaymentRequestService,
  ) {}

  async cancel(
    requestId: string,
    input: CancelPaymentRequestDto,
    actor: Principal,
    correlationId: string,
  ): Promise<PaymentRequest> {
    const state = actor.roles.includes("REQUESTER")
      ? await this.database.pool.query<{
          status: PaymentRequest["status"];
          created_by: string;
          department_id: string;
          cancellation_previous_state: PaymentRequest["status"] | null;
        }>(
          `SELECT pr.status,pr.created_by,pr.department_id,
             (SELECT previous_state FROM audit_events ae
              WHERE ae.entity_type='PAYMENT_REQUEST' AND ae.entity_id=pr.id
                AND ae.action='REQUEST_CANCELLED' ORDER BY occurred_at DESC LIMIT 1)
             cancellation_previous_state
           FROM payment_requests pr WHERE pr.id=$1`,
          [requestId],
        )
      : null;
    const observedStatus =
      state?.rows[0]?.status === "CANCELLED"
        ? state.rows[0].cancellation_previous_state
        : state?.rows[0]?.status;
    const requesterPath =
      actor.roles.includes("REQUESTER") &&
      state?.rowCount === 1 &&
      state.rows[0].created_by === actor.id &&
      state.rows[0].department_id === actor.departmentId &&
      (observedStatus === "PAID" ||
        observedStatus === "REJECTED" ||
        observedStatus === "CANCELLED" ||
        REQUESTER_CANCELLABLE_STATUSES.includes(
          observedStatus as (typeof REQUESTER_CANCELLABLE_STATUSES)[number],
        ));
    const authorityPath = requesterPath ? "REQUESTER" : "FINANCE";
    const operation = (client: PoolClient) =>
      this.cancelInTransaction(
        client,
        requestId,
        input,
        actor,
        correlationId,
        authorityPath,
      );
    return actor.roles.includes("FINANCE") && !requesterPath
      ? this.database.financeTransaction(actor.id, correlationId, operation)
      : this.database.retryableTransaction(operation);
  }

  private async cancelInTransaction(
    client: PoolClient,
    requestId: string,
    input: CancelPaymentRequestDto,
    actor: Principal,
    correlationId: string,
    authorityPath: "REQUESTER" | "FINANCE",
  ): Promise<PaymentRequest> {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))",
    );
    const request = await this.requests.lockRequest(client, requestId);
    const reason = input.reason.trim();
    if (!reason) throw new ConflictException("CANCELLATION_REASON_REQUIRED");

    if (request.status === "CANCELLED") {
      const replay = await client.query<{
        reason: string;
        previous_state: PaymentRequest["status"];
      }>(
        `SELECT safe_metadata->>'reason' reason,previous_state FROM audit_events
         WHERE entity_type='PAYMENT_REQUEST' AND entity_id=$1
           AND action='REQUEST_CANCELLED' AND actor_id=$2
         ORDER BY occurred_at DESC`,
        [requestId, actor.id],
      );
      await this.authorize(
        client,
        actor,
        replay.rowCount
          ? { ...request, status: replay.rows[0].previous_state }
          : request,
        true,
        authorityPath,
      );
      const command = await client.query<{ reason: string }>(
        `SELECT safe_metadata->>'reason' reason FROM audit_events
         WHERE entity_type='PAYMENT_REQUEST' AND entity_id=$1
           AND action='REQUEST_CANCELLED' AND actor_id=$2
           AND safe_metadata->>'commandKey'=$3`,
        [requestId, actor.id, input.commandKey],
      );
      if (command.rowCount && command.rows[0].reason === reason) return request;
      if (command.rowCount)
        throw new ConflictException("CANCELLATION_IDEMPOTENCY_CONFLICT");
      throw new ConflictException("REQUEST_ALREADY_CANCELLED");
    }

    this.assertAuthorityPath(request.status, actor, authorityPath);
    await this.authorize(client, actor, request, true, authorityPath);
    try {
      assertCancellationState(request.status);
    } catch (error) {
      throw new ConflictException(
        error instanceof Error ? error.message : "CANCELLATION_NOT_PERMITTED",
      );
    }

    const payment = await client.query(
      "SELECT 1 FROM payments WHERE payment_request_id=$1 LIMIT 1",
      [requestId],
    );
    if (payment.rowCount)
      throw new ConflictException("PAID_REQUEST_CANNOT_BE_CANCELLED");

    const cases = await client.query<{ id: string }>(
      `UPDATE approval_cases SET status='SUPERSEDED',is_current=false,
         completed_at=COALESCE(completed_at,now())
       WHERE payment_request_id=$1 AND is_current RETURNING id`,
      [requestId],
    );
    const caseIds = cases.rows.map((row) => row.id);
    if (caseIds.length) {
      await client.query(
        `UPDATE approval_steps SET status='CLOSED',completed_at=COALESCE(completed_at,now())
         WHERE approval_case_id=ANY($1::uuid[]) AND status IN('ACTIVE','WAITING')`,
        [caseIds],
      );
      await client.query(
        `UPDATE approval_action_tokens SET status='REVOKED'
         WHERE approval_case_id=ANY($1::uuid[]) AND status='ACTIVE'`,
        [caseIds],
      );
      await client.query(
        `UPDATE telegram_pending_interactions SET status='CANCELLED'
         WHERE approval_case_id=ANY($1::uuid[]) AND status='PENDING'`,
        [caseIds],
      );
    }

    const financeCancellation = FINANCE_CANCELLABLE_STATUSES.includes(
      request.status as (typeof FINANCE_CANCELLABLE_STATUSES)[number],
    );
    if (financeCancellation) {
      await client.query(
        `UPDATE finance_control_runs SET status='SUPERSEDED',is_current=false
         WHERE payment_request_id=$1 AND is_current`,
        [requestId],
      );
      await client.query(
        `UPDATE finance_control_exceptions SET status='SUPERSEDED'
         WHERE status='OPEN' AND finance_control_run_id IN
           (SELECT id FROM finance_control_runs WHERE payment_request_id=$1)`,
        [requestId],
      );
    }
    const cancelled = await client.query(
      `UPDATE payment_requests SET status='CANCELLED',updated_at=now(),
         row_version=row_version+1 WHERE id=$1 RETURNING *`,
      [requestId],
    );
    const released = financeCancellation
      ? await client.query<{ id: string }>(
          `UPDATE budget_commitments SET status='RELEASED',released_at=now(),
             release_reason='REQUEST_CANCELLED',release_reference_type='PAYMENT_REQUEST',
             release_reference_id=$1
           WHERE payment_request_id=$1 AND source='APPROVAL' AND status='ACTIVE'
           RETURNING id`,
          [requestId],
        )
      : { rows: [] as Array<{ id: string }> };
    await this.requests.audit(
      client,
      actor.id,
      "REQUEST_CANCELLED",
      requestId,
      request.status,
      "CANCELLED",
      correlationId,
      {
        reason,
        commandKey: input.commandKey,
        approvalCaseIds: caseIds,
        releasedCommitmentIds: released.rows.map((row) => row.id),
      },
    );
    return mapRequest(cancelled.rows[0]);
  }

  private async authorize(
    client: PoolClient,
    actor: Principal,
    request: PaymentRequest,
    allowTerminalOwner = false,
    authorityPath: "REQUESTER" | "FINANCE" = "REQUESTER",
  ): Promise<void> {
    if (
      authorityPath === "REQUESTER" &&
      REQUESTER_CANCELLABLE_STATUSES.includes(
        request.status as (typeof REQUESTER_CANCELLABLE_STATUSES)[number],
      ) &&
      actor.roles.includes("REQUESTER") &&
      actor.id === request.createdBy &&
      actor.departmentId === request.departmentId
    ) {
      return;
    }
    if (
      allowTerminalOwner &&
      authorityPath === "REQUESTER" &&
      ["PAID", "REJECTED", "CANCELLED"].includes(request.status) &&
      actor.roles.includes("REQUESTER") &&
      actor.id === request.createdBy &&
      actor.departmentId === request.departmentId
    ) {
      return;
    }
    if (
      ((allowTerminalOwner &&
        ["PAID", "REJECTED", "CANCELLED"].includes(request.status)) ||
        FINANCE_CANCELLABLE_STATUSES.includes(
          request.status as (typeof FINANCE_CANCELLABLE_STATUSES)[number],
        )) &&
      actor.roles.includes("FINANCE")
      && authorityPath === "FINANCE"
    ) {
      const authority = await client.query(
        `SELECT 1 FROM finance_control_authorities f
         JOIN users u ON u.id=f.user_id AND u.active
         WHERE f.user_id=$1 AND f.active
           AND (f.scope='ORGANIZATION' OR f.department_id=$2)
           AND (f.allow_self_control OR $1<>$3)`,
        [actor.id, request.departmentId, request.createdBy],
      );
      if (authority.rowCount) return;
    }
    throw new ForbiddenException("REQUEST_CANCELLATION_NOT_AUTHORIZED");
  }

  private assertAuthorityPath(
    status: PaymentRequest["status"],
    actor: Principal,
    authorityPath: "REQUESTER" | "FINANCE",
  ): void {
    const requesterState = REQUESTER_CANCELLABLE_STATUSES.includes(
      status as (typeof REQUESTER_CANCELLABLE_STATUSES)[number],
    );
    const financeState = FINANCE_CANCELLABLE_STATUSES.includes(
      status as (typeof FINANCE_CANCELLABLE_STATUSES)[number],
    );
    if (
      (authorityPath === "REQUESTER" && financeState) ||
      (authorityPath === "FINANCE" && requesterState && actor.roles.includes("REQUESTER"))
    ) {
      throw new ConflictException("CANCELLATION_AUTHORITY_PATH_CHANGED_RETRY");
    }
  }
}
