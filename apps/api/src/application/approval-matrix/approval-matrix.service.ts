import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Principal } from "../../domain/payment-request.js";
import {
  ApprovalMatrixPayloadSchema,
  validateApprovalMatrixRules,
  type ApprovalMatrixFacts,
  type ApprovalMatrixPayload,
  type ApprovalMatrixRule,
} from "../../domain/approval-matrix.js";
import { resolveApprovalMatrix } from "../../domain/approval-matrix.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { redactSensitiveData } from "../../infrastructure/configuration/secret-boundary.js";
import type { ApprovalMatrixVersionRow, Queryable } from "./approval-matrix.types.js";

const DEFAULT_PAYLOAD: ApprovalMatrixPayload = { routingEnabled: true, rules: [] };

function diffChangedRuleCodes(current: ApprovalMatrixPayload, next: ApprovalMatrixPayload): string[] {
  const currentByCode = new Map(current.rules.map((rule) => [rule.code, rule]));
  const nextByCode = new Map(next.rules.map((rule) => [rule.code, rule]));
  const codes = new Set([...currentByCode.keys(), ...nextByCode.keys()]);
  const changed: string[] = [];
  for (const code of codes)
    if (JSON.stringify(currentByCode.get(code)) !== JSON.stringify(nextByCode.get(code))) changed.push(code);
  return changed.sort();
}

function affectedDepartmentsAndCategories(payload: ApprovalMatrixPayload) {
  const departmentIds = new Set<string>();
  const categories = new Set<string>();
  for (const rule of payload.rules) {
    for (const id of rule.conditions.departmentIds ?? []) departmentIds.add(id);
    for (const value of rule.conditions.categories?.values ?? []) categories.add(value);
  }
  return { departmentIds: [...departmentIds].sort(), categories: [...categories].sort() };
}

/**
 * P20.5F — Approval Matrix. Mirrors ConfigurationService's Draft -> Validate
 * -> Preview -> Publish -> Rollback -> Version History lifecycle exactly
 * (single global "row" instead of per-category), storing the whole rule set
 * as one versioned JSON payload so the rule shape can evolve without a
 * migration. resolveForFacts() is the read path ApprovalService calls when
 * creating an approval case; it never mutates anything.
 */
@Injectable()
export class ApprovalMatrixService {
  constructor(private readonly database: Postgres) {}

  async getActive(): Promise<{ version: number; payload: ApprovalMatrixPayload; publishedAt: string | null }> {
    const result = await this.database.pool.query<ApprovalMatrixVersionRow>(
      `SELECT * FROM approval_matrix_versions WHERE status='published' ORDER BY version DESC LIMIT 1`,
    );
    if (!result.rowCount) return { version: 0, payload: DEFAULT_PAYLOAD, publishedAt: null };
    const row = result.rows[0];
    return { version: row.version!, payload: ApprovalMatrixPayloadSchema.parse(row.payload), publishedAt: row.published_at };
  }

  async getDraft() {
    const result = await this.database.pool.query<ApprovalMatrixVersionRow>(
      `SELECT * FROM approval_matrix_versions WHERE status='draft'`,
    );
    if (!result.rowCount) return null;
    return this.mapRow(result.rows[0]);
  }

  async saveDraft(payload: Record<string, unknown>, actor: Principal, request: Request) {
    const parsed = this.parsePayload(payload);
    return this.database.transaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM approval_matrix_versions WHERE status='draft' FOR UPDATE`,
      );
      let id: string;
      if (existing.rowCount) {
        id = existing.rows[0].id;
        await client.query(`UPDATE approval_matrix_versions SET payload=$2, updated_at=now() WHERE id=$1`, [
          id,
          JSON.stringify(parsed),
        ]);
        await this.audit(client, actor, "DRAFT_UPDATED", request, {}, id);
      } else {
        id = randomUUID();
        await client.query(
          `INSERT INTO approval_matrix_versions(id,version,status,payload,changed_by,created_at,updated_at)
           VALUES($1,NULL,'draft',$2,$3,now(),now())`,
          [id, JSON.stringify(parsed), actor.id],
        );
        await this.audit(client, actor, "DRAFT_CREATED", request, {}, id);
      }
      return { id };
    });
  }

  async discardDraft(actor: Principal, request: Request) {
    await this.database.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `DELETE FROM approval_matrix_versions WHERE status='draft' RETURNING id`,
      );
      if (!result.rowCount) throw new NotFoundException("No draft to discard");
      await this.audit(client, actor, "DRAFT_DISCARDED", request, {}, result.rows[0].id);
    });
  }

  /**
   * Read-only: static rule validation plus a DB-backed missing-approver
   * check. Approval role codes (e.g. "AM", "DIRECTOR") are the same
   * freeform strings the existing Policy engine and approval_authorities
   * already use — there is no separate role catalogue constraining them
   * (the role-permission matrix's `roles` table is a deliberately orthogonal
   * fine-grained permission concept, per migration 064's own comment, and
   * does not govern who can approve what). So "missing role" here means
   * exactly what "missing approver" means: no active grant exists for a
   * step's role/scope combination, which would make the step unroutable.
   */
  async validate(payload: ApprovalMatrixPayload, client: Queryable = this.database.pool): Promise<string[]> {
    const errors = validateApprovalMatrixRules(payload.rules);
    if (!payload.rules.length) return errors;
    const authorities = (
      await client.query<{ authority_role: string; authority_scope: string }>(
        `SELECT DISTINCT authority_role, authority_scope FROM approval_authorities WHERE active`,
      )
    ).rows;
    const authorityKey = (role: string, scope: string) => `${role}::${scope}`;
    const authoritySet = new Set(authorities.map((a) => authorityKey(a.authority_role, a.authority_scope)));
    for (const rule of payload.rules) {
      if (!rule.active) continue;
      for (const step of rule.steps) {
        if (!authoritySet.has(authorityKey(step.requiredRole, step.authorityScope)))
          errors.push(
            `Rule ${rule.code}: no active approver is granted ${step.requiredRole}/${step.authorityScope} — this step is unroutable`,
          );
      }
    }
    return errors;
  }

  async preview() {
    const draft = await this.getDraft();
    if (!draft) throw new NotFoundException("No draft to preview");
    const current = await this.getActive();
    const draftPayload = ApprovalMatrixPayloadSchema.parse(draft.payload);
    const validationErrors = await this.validate(draftPayload);
    const nextVersionResult = await this.database.pool.query<{ max: number | null }>(
      `SELECT max(version) max FROM approval_matrix_versions WHERE status='published'`,
    );
    const nextVersion = (nextVersionResult.rows[0]?.max ?? 0) + 1;
    const currentAffected = affectedDepartmentsAndCategories(current.payload);
    const draftAffected = affectedDepartmentsAndCategories(draftPayload);
    return {
      currentVersion: current.payload,
      newVersion: draftPayload,
      changedRuleCodes: diffChangedRuleCodes(current.payload, draftPayload),
      affectedDepartments: [...new Set([...currentAffected.departmentIds, ...draftAffected.departmentIds])].sort(),
      affectedCategories: [...new Set([...currentAffected.categories, ...draftAffected.categories])].sort(),
      nextVersion,
      validationErrors,
      canPublish: validationErrors.length === 0,
    };
  }

  async publish(reason: string, actor: Principal, request: Request) {
    return this.database.transaction(async (client) => {
      const draftResult = await client.query<ApprovalMatrixVersionRow>(
        `SELECT * FROM approval_matrix_versions WHERE status='draft' FOR UPDATE`,
      );
      if (!draftResult.rowCount) throw new NotFoundException("No draft to publish");
      const draft = draftResult.rows[0];
      const draftPayload = this.parsePayload(draft.payload);
      const errors = await this.validate(draftPayload, client);
      if (errors.length) throw new BadRequestException(errors.join("; "));

      const previousResult = await client.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM approval_matrix_versions WHERE status='published' ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      );
      const previousPayload = previousResult.rows[0]?.payload ?? DEFAULT_PAYLOAD;
      const nextVersionResult = await client.query<{ max: number | null }>(
        `SELECT max(version) max FROM approval_matrix_versions WHERE status='published'`,
      );
      const nextVersion = (nextVersionResult.rows[0]?.max ?? 0) + 1;
      const actorRow = await client.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [actor.id]);
      await client.query(
        `UPDATE approval_matrix_versions
         SET status='published', version=$2, reason=$3, changed_by=$4,
             changed_by_display_name_snapshot=$5, changed_by_role_snapshot=$6,
             source_ip=$7, published_at=now(), updated_at=now()
         WHERE id=$1`,
        [draft.id, nextVersion, reason, actor.id, actorRow.rows[0]?.display_name ?? null, actor.roles, request.ip ?? null],
      );
      await this.audit(
        client,
        actor,
        "PUBLISHED",
        request,
        {
          version: nextVersion,
          reason,
          changedRuleCodes: diffChangedRuleCodes(this.parsePayload(previousPayload), draftPayload),
          oldValue: previousPayload,
          newValue: draftPayload,
        },
        draft.id,
      );
      return { version: nextVersion };
    });
  }

  async listVersions(page: number, pageSize: number) {
    const result = await this.database.pool.query<ApprovalMatrixVersionRow & { total: string }>(
      `SELECT *, count(*) OVER() total FROM approval_matrix_versions
       WHERE status='published'
       ORDER BY version DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
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

  async getVersion(version: number) {
    const result = await this.database.pool.query<ApprovalMatrixVersionRow>(
      `SELECT * FROM approval_matrix_versions WHERE status='published' AND version=$1`,
      [version],
    );
    if (!result.rowCount) throw new NotFoundException("Approval matrix version not found");
    return this.mapRow(result.rows[0]);
  }

  /** Rollback never mutates history: it publishes a new version copying a past payload, re-validated against current roles/approvers. */
  async rollback(targetVersion: number, reason: string, actor: Principal, request: Request) {
    return this.database.transaction(async (client) => {
      const targetResult = await client.query<ApprovalMatrixVersionRow>(
        `SELECT * FROM approval_matrix_versions WHERE status='published' AND version=$1`,
        [targetVersion],
      );
      if (!targetResult.rowCount) throw new NotFoundException("Approval matrix version not found");
      const target = targetResult.rows[0];
      const targetPayload = this.parsePayload(target.payload);
      const errors = await this.validate(targetPayload, client);
      if (errors.length)
        throw new ConflictException(`Cannot roll back: this version is no longer valid (${errors.join("; ")})`);

      const previousResult = await client.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM approval_matrix_versions WHERE status='published' ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      );
      const previousPayload = previousResult.rows[0]?.payload ?? DEFAULT_PAYLOAD;
      const nextVersionResult = await client.query<{ max: number | null }>(
        `SELECT max(version) max FROM approval_matrix_versions WHERE status='published'`,
      );
      const nextVersion = (nextVersionResult.rows[0]?.max ?? 0) + 1;
      const id = randomUUID();
      const actorRow = await client.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [actor.id]);
      const fullReason = `Rollback to version ${targetVersion}: ${reason}`;
      await client.query(
        `INSERT INTO approval_matrix_versions(id,version,status,payload,reason,changed_by,changed_by_display_name_snapshot,changed_by_role_snapshot,source_ip,created_at,updated_at,published_at)
         VALUES($1,$2,'published',$3,$4,$5,$6,$7,$8,now(),now(),now())`,
        [
          id,
          nextVersion,
          JSON.stringify(target.payload),
          fullReason,
          actor.id,
          actorRow.rows[0]?.display_name ?? null,
          actor.roles,
          request.ip ?? null,
        ],
      );
      await this.audit(
        client,
        actor,
        "ROLLED_BACK",
        request,
        {
          version: nextVersion,
          rolledBackToVersion: targetVersion,
          reason: fullReason,
          oldValue: previousPayload,
          newValue: targetPayload,
        },
        id,
      );
      return { version: nextVersion };
    });
  }

  /**
   * Read path used by ApprovalService.create(): resolves the winning rule
   * (if any) for a set of request facts against a specific matrix version
   * (the one pinned on the approval_cases row, or the currently-active one
   * for a brand-new case). Returns null when the matrix has no published
   * version, routing is disabled, or no rule (including fallback) matches
   * — in every such case ApprovalService keeps using Policy's own plan.
   */
  async resolveForFacts(
    client: Queryable,
    facts: ApprovalMatrixFacts,
    versionId?: string,
  ): Promise<{ versionId: string; rule: ApprovalMatrixRule; steps: ApprovalMatrixRule["steps"] } | null> {
    const row = versionId
      ? (await client.query<ApprovalMatrixVersionRow>(`SELECT * FROM approval_matrix_versions WHERE id=$1`, [versionId])).rows[0]
      : (
          await client.query<ApprovalMatrixVersionRow>(
            `SELECT * FROM approval_matrix_versions WHERE status='published' ORDER BY version DESC LIMIT 1`,
          )
        ).rows[0];
    if (!row) return null;
    const payload = ApprovalMatrixPayloadSchema.parse(row.payload);
    if (!payload.routingEnabled) return null;
    const resolution = resolveApprovalMatrix(payload.rules, facts);
    if (!resolution) return null;
    return { versionId: row.id, rule: resolution.rule, steps: resolution.steps };
  }

  async getPublishedVersionId(client: Queryable): Promise<string | null> {
    const row = (
      await client.query<{ id: string }>(
        `SELECT id FROM approval_matrix_versions WHERE status='published' ORDER BY version DESC LIMIT 1`,
      )
    ).rows[0];
    return row?.id ?? null;
  }

  private parsePayload(payload: unknown): ApprovalMatrixPayload {
    const result = ApprovalMatrixPayloadSchema.safeParse(payload);
    if (!result.success)
      throw new BadRequestException(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    return result.data;
  }

  private mapRow(row: ApprovalMatrixVersionRow) {
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      payload: row.payload,
      reason: row.reason,
      changedBy: row.changed_by_display_name_snapshot,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
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
       VALUES($1,$2,$3,'APPROVAL_MATRIX',$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        actor.id,
        `APPROVAL_MATRIX_${action}`,
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
