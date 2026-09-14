import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { redactSensitiveData } from "../../infrastructure/configuration/secret-boundary.js";
import type { CancelApprovalDelegationDto, CreateApprovalDelegationDto, ListApprovalDelegationsDto } from "./approval-delegation.dto.js";
import { NotificationService } from "../notification/notification.service.js";

/** Narrow shape both `Postgres.pool` and a transaction's `PoolClient` satisfy. */
export interface Queryable {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

type DelegationRow = {
  id: string;
  delegate_from: string;
  delegate_to: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: "ACTIVE" | "CANCELLED";
  created_by: string;
  created_at: string;
  updated_at: string;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  effective_status: "SCHEDULED" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  delegate_from_name?: string;
  delegate_to_name?: string;
};

const EFFECTIVE_STATUS_SQL = `CASE
  WHEN d.status='CANCELLED' THEN 'CANCELLED'
  WHEN d.end_date < current_date THEN 'EXPIRED'
  WHEN d.start_date > current_date THEN 'SCHEDULED'
  ELSE 'ACTIVE'
END`;

/**
 * P20.5F — Approval Delegation. Effective state is always derived from
 * start_date/end_date/status at query time (never stored), so it can never
 * drift out of sync with the calendar. Delegation never rewrites history:
 * every approval_action still records the acting actor_id as today; this
 * service additionally exposes resolveDelegate() for ApprovalService to
 * substitute the delegate at authorization/notification time, and callers
 * are expected to record both the original and delegated approver in audit
 * metadata (see ApprovalService integration).
 */
@Injectable()
export class ApprovalDelegationService {
  constructor(
    private readonly database: Postgres,
    // Optional for the same reason as ApprovalService's — see its constructor comment.
    private readonly notifications?: NotificationService,
  ) {}

  async list(query: ListApprovalDelegationsDto) {
    const page = Number(query.page ?? 1),
      pageSize = Number(query.pageSize ?? 25);
    const result = await this.database.pool.query<DelegationRow & { total: string }>(
      `SELECT d.*, ${EFFECTIVE_STATUS_SQL} effective_status,
        uf.display_name delegate_from_name, ut.display_name delegate_to_name,
        count(*) OVER() total
       FROM approval_delegations d
       JOIN users uf ON uf.id=d.delegate_from
       JOIN users ut ON ut.id=d.delegate_to
       WHERE ($1::uuid IS NULL OR d.delegate_from=$1)
         AND ($2::uuid IS NULL OR d.delegate_to=$2)
         AND ($3::text IS NULL OR ${EFFECTIVE_STATUS_SQL}=$3)
       ORDER BY d.start_date DESC, d.created_at DESC
       LIMIT $4 OFFSET $5`,
      [query.delegateFrom ?? null, query.delegateTo ?? null, query.effectiveStatus ?? null, pageSize, (page - 1) * pageSize],
    );
    const total = result.rows[0] ? Number(result.rows[0].total) : 0;
    return {
      items: result.rows.map((row) => this.mapRow(row)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Module: Delegation history — includes cancelled and expired rows, with the audit trail. */
  async history(query: ListApprovalDelegationsDto) {
    const delegations = await this.list(query);
    const auditResult = await this.database.pool.query<{
      entity_id: string;
      action: string;
      actor_display_name_snapshot: string | null;
      occurred_at: string;
      safe_metadata: Record<string, unknown>;
    }>(
      `SELECT entity_id, action, actor_display_name_snapshot, occurred_at, safe_metadata
       FROM audit_events WHERE entity_type='APPROVAL_DELEGATION' AND entity_id = ANY($1::uuid[])
       ORDER BY occurred_at`,
      [delegations.items.map((item) => item.id)],
    );
    const byDelegation = new Map<string, typeof auditResult.rows>();
    for (const row of auditResult.rows) byDelegation.set(row.entity_id, [...(byDelegation.get(row.entity_id) ?? []), row]);
    return {
      ...delegations,
      items: delegations.items.map((item) => ({ ...item, auditTrail: byDelegation.get(item.id) ?? [] })),
    };
  }

  async get(id: string) {
    return this.getWithClient(this.database.pool, id);
  }

  /**
   * Same read as get(), but scoped to a caller-supplied client — required
   * when reading back a row this same transaction just wrote (this.database.pool
   * is a different connection and, under READ COMMITTED, cannot see an
   * uncommitted insert/update from the transaction's own client).
   */
  private async getWithClient(client: Queryable, id: string) {
    const result = await client.query<DelegationRow>(
      `SELECT d.*, ${EFFECTIVE_STATUS_SQL} effective_status, uf.display_name delegate_from_name, ut.display_name delegate_to_name
       FROM approval_delegations d JOIN users uf ON uf.id=d.delegate_from JOIN users ut ON ut.id=d.delegate_to
       WHERE d.id=$1`,
      [id],
    );
    if (!result.rowCount) throw new NotFoundException("Delegation not found");
    return this.mapRow(result.rows[0]);
  }

  async create(dto: CreateApprovalDelegationDto, actor: Principal, request: Request) {
    if (dto.delegateFrom === dto.delegateTo) throw new BadRequestException("Cannot delegate to self");
    if (dto.startDate > dto.endDate) throw new BadRequestException("Start date must be on or before end date");
    return this.database.transaction(async (client) => {
      const users = await client.query<{ id: string }>(`SELECT id FROM users WHERE id = ANY($1::uuid[]) AND active`, [
        [dto.delegateFrom, dto.delegateTo],
      ]);
      if (users.rowCount !== 2) throw new BadRequestException("Both users must be active");
      if (await this.wouldCreateCycle(client, dto.delegateFrom, dto.delegateTo))
        throw new ConflictException("This delegation would create a circular delegation chain");
      const id = randomUUID();
      await client.query(
        `INSERT INTO approval_delegations(id,delegate_from,delegate_to,start_date,end_date,reason,status,created_by)
         VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',$7)`,
        [id, dto.delegateFrom, dto.delegateTo, dto.startDate, dto.endDate, dto.reason, actor.id],
      );
      await this.audit(client, actor, "CREATED", request, { ...dto }, id);
      const created = await this.getWithClient(client, id);
      void this.notifications?.publish({
        eventType: "APPROVAL_DELEGATED",
        aggregateType: "APPROVAL_DELEGATION",
        aggregateId: id,
        recipientUserId: dto.delegateTo,
        correlationId: (request as Request & { correlationId?: string }).correlationId ?? "unavailable",
        variables: { delegateFromName: created.delegateFromName ?? "", endDate: dto.endDate },
      });
      return created;
    });
  }

  async cancel(id: string, dto: CancelApprovalDelegationDto, actor: Principal, request: Request) {
    return this.database.transaction(async (client) => {
      const existing = await client.query<DelegationRow>(`SELECT * FROM approval_delegations WHERE id=$1 FOR UPDATE`, [id]);
      if (!existing.rowCount) throw new NotFoundException("Delegation not found");
      if (existing.rows[0].status !== "ACTIVE") throw new ForbiddenException("Delegation is already cancelled");
      await client.query(
        `UPDATE approval_delegations SET status='CANCELLED', cancelled_by=$2, cancelled_at=now(), cancel_reason=$3, updated_at=now() WHERE id=$1`,
        [id, actor.id, dto.reason],
      );
      await this.audit(client, actor, "CANCELLED", request, { reason: dto.reason }, id);
      return this.getWithClient(client, id);
    });
  }

  /**
   * Follows an active delegation chain forward from `userId` as of
   * `asOfDate` (YYYY-MM-DD), capped at 10 hops (cycle prevention at create()
   * time makes a real cycle impossible, this is only a defensive bound).
   * Returns the final delegate (or `userId` unchanged if no delegation
   * applies) plus the chain walked, so callers can audit both identities.
   */
  async resolveDelegate(client: Queryable, userId: string, asOfDate: string): Promise<{ userId: string; chain: string[] }> {
    let current = userId;
    const chain: string[] = [];
    for (let hop = 0; hop < 10; hop++) {
      const next = await client.query<{ delegate_to: string }>(
        `SELECT delegate_to FROM approval_delegations
         WHERE delegate_from=$1 AND status='ACTIVE' AND start_date<=$2 AND end_date>=$2 LIMIT 1`,
        [current, asOfDate],
      );
      if (!next.rowCount) break;
      current = next.rows[0].delegate_to;
      chain.push(current);
    }
    return { userId: current, chain };
  }

  private async wouldCreateCycle(client: Queryable, from: string, to: string): Promise<boolean> {
    if (from === to) return true;
    const visited = new Set<string>([to]);
    let frontier = [to];
    for (let hop = 0; hop < 50 && frontier.length; hop++) {
      const edges = await client.query<{ delegate_to: string }>(
        `SELECT delegate_to FROM approval_delegations WHERE delegate_from = ANY($1::uuid[]) AND status='ACTIVE' AND end_date>=current_date`,
        [frontier],
      );
      const nextNodes = [...new Set(edges.rows.map((r) => r.delegate_to))];
      if (nextNodes.includes(from)) return true;
      frontier = nextNodes.filter((node) => !visited.has(node));
      for (const node of frontier) visited.add(node);
    }
    return false;
  }

  private mapRow(row: DelegationRow) {
    return {
      id: row.id,
      delegateFrom: row.delegate_from,
      delegateFromName: row.delegate_from_name ?? null,
      delegateTo: row.delegate_to,
      delegateToName: row.delegate_to_name ?? null,
      startDate: row.start_date,
      endDate: row.end_date,
      reason: row.reason,
      effectiveStatus: row.effective_status,
      cancelledAt: row.cancelled_at,
      cancelReason: row.cancel_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async audit(
    client: Queryable,
    actor: Principal,
    action: string,
    request: Request,
    metadata: Record<string, unknown>,
    entityId: string,
  ) {
    const actorRow = await client.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [actor.id]);
    const correlationId = (request as Request & { correlationId?: string }).correlationId ?? "unavailable";
    await client.query(
      `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata,source_ip,actor_role_snapshot,actor_display_name_snapshot)
       VALUES($1,$2,$3,'APPROVAL_DELEGATION',$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        actor.id,
        `APPROVAL_DELEGATION_${action}`,
        entityId,
        correlationId,
        JSON.stringify(redactSensitiveData(metadata)),
        request.ip ?? null,
        actor.roles,
        actorRow.rows[0]?.display_name ?? null,
      ],
    );
  }
}
