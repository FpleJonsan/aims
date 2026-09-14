import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { redactSensitiveData } from "../../infrastructure/configuration/secret-boundary.js";
import { defaultPayloadFor } from "./configuration.defaults.js";
import { validateConfigurationPayload } from "./configuration.schemas.js";
import type { ConfigurationCategory, ConfigurationVersionRow, Queryable } from "./configuration.types.js";
import { isConfigurationCategory } from "./configuration.types.js";

function assertCategory(category: string): ConfigurationCategory {
  if (!isConfigurationCategory(category)) throw new BadRequestException(`Unknown configuration category: ${category}`);
  return category;
}

function diffChangedFields(current: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) changed.push(key);
  }
  return changed.sort();
}

/**
 * P20.5D — one reusable engine for every Business Configuration category,
 * mirroring how MasterDataService serves every P20.5C Master Data domain.
 * Draft -> Validate -> Preview -> Publish -> Version, plus rollback, all
 * live here; the six settings pages differ only in field schema and
 * validation (configuration.schemas.ts), never in this control flow.
 */
@Injectable()
export class ConfigurationService {
  constructor(private readonly database: Postgres) {}

  async getActive(categoryInput: string) {
    const category = assertCategory(categoryInput);
    const result = await this.database.pool.query<ConfigurationVersionRow>(
      `SELECT * FROM configuration_versions WHERE category=$1 AND status='published' ORDER BY version DESC LIMIT 1`,
      [category],
    );
    if (!result.rowCount) return { category, version: 0, payload: defaultPayloadFor(category), publishedAt: null, reason: null };
    return this.mapRow(result.rows[0]);
  }

  async getDraft(categoryInput: string) {
    const category = assertCategory(categoryInput);
    const result = await this.database.pool.query<ConfigurationVersionRow>(
      `SELECT * FROM configuration_versions WHERE category=$1 AND status='draft'`,
      [category],
    );
    if (!result.rowCount) return null;
    return this.mapRow(result.rows[0]);
  }

  async saveDraft(categoryInput: string, payload: Record<string, unknown>, actor: Principal, request: Request) {
    const category = assertCategory(categoryInput);
    return this.database.transaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM configuration_versions WHERE category=$1 AND status='draft' FOR UPDATE`,
        [category],
      );
      let id: string;
      if (existing.rowCount) {
        id = existing.rows[0].id;
        await client.query(`UPDATE configuration_versions SET payload=$2, updated_at=now() WHERE id=$1`, [id, JSON.stringify(payload)]);
        await this.audit(client, actor, category, "DRAFT_UPDATED", request, {}, id);
      } else {
        id = randomUUID();
        await client.query(
          `INSERT INTO configuration_versions(id,category,version,status,payload,changed_by,created_at,updated_at)
           VALUES($1,$2,NULL,'draft',$3,$4,now(),now())`,
          [id, category, JSON.stringify(payload), actor.id],
        );
        await this.audit(client, actor, category, "DRAFT_CREATED", request, {}, id);
      }
      return { id };
    });
  }

  async discardDraft(categoryInput: string, actor: Principal, request: Request) {
    const category = assertCategory(categoryInput);
    await this.database.transaction(async (client) => {
      const result = await client.query<{ id: string }>(`DELETE FROM configuration_versions WHERE category=$1 AND status='draft' RETURNING id`, [category]);
      if (!result.rowCount) throw new NotFoundException("No draft to discard");
      await this.audit(client, actor, category, "DRAFT_DISCARDED", request, {}, result.rows[0].id);
    });
  }

  /** Module 10 — Configuration Preview. Read-only: never writes anything. */
  async preview(categoryInput: string) {
    const category = assertCategory(categoryInput);
    const draft = await this.getDraft(category);
    if (!draft) throw new NotFoundException("No draft to preview");
    const current = await this.getActive(category);
    const validationErrors = await validateConfigurationPayload(category, draft.payload, this.database.pool);
    const nextVersionResult = await this.database.pool.query<{ max: number | null }>(
      `SELECT max(version) max FROM configuration_versions WHERE category=$1 AND status='published'`,
      [category],
    );
    const nextVersion = (nextVersionResult.rows[0]?.max ?? 0) + 1;
    return {
      category,
      currentValue: current.payload,
      newValue: draft.payload,
      changedFields: diffChangedFields(current.payload, draft.payload),
      nextVersion,
      validationErrors,
      canPublish: validationErrors.length === 0,
    };
  }

  /** Module 8/9/11 — Publish requires a mandatory reason and fails closed on any validation error. */
  async publish(categoryInput: string, reason: string, actor: Principal, request: Request) {
    const category = assertCategory(categoryInput);
    return this.database.transaction(async (client) => {
      const draftResult = await client.query<ConfigurationVersionRow>(
        `SELECT * FROM configuration_versions WHERE category=$1 AND status='draft' FOR UPDATE`,
        [category],
      );
      if (!draftResult.rowCount) throw new NotFoundException("No draft to publish");
      const draft = draftResult.rows[0];
      const errors = await validateConfigurationPayload(category, draft.payload, client);
      if (errors.length) throw new BadRequestException(errors.join("; "));

      const previousResult = await client.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM configuration_versions WHERE category=$1 AND status='published' ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        [category],
      );
      const previousPayload = previousResult.rows[0]?.payload ?? defaultPayloadFor(category);
      const nextVersionResult = await client.query<{ max: number | null }>(
        `SELECT max(version) max FROM configuration_versions WHERE category=$1 AND status='published'`,
        [category],
      );
      const nextVersion = (nextVersionResult.rows[0]?.max ?? 0) + 1;

      const actorRow = await client.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [actor.id]);
      await client.query(
        `UPDATE configuration_versions
         SET status='published', version=$2, reason=$3, changed_by=$4,
             changed_by_display_name_snapshot=$5, changed_by_role_snapshot=$6,
             source_ip=$7, published_at=now(), updated_at=now()
         WHERE id=$1`,
        [draft.id, nextVersion, reason, actor.id, actorRow.rows[0]?.display_name ?? null, actor.roles, request.ip ?? null],
      );
      await this.audit(
        client,
        actor,
        category,
        "PUBLISHED",
        request,
        {
          version: nextVersion,
          reason,
          changedFields: diffChangedFields(previousPayload, draft.payload),
          oldValue: previousPayload,
          newValue: draft.payload,
        },
        draft.id,
      );
      return { version: nextVersion };
    });
  }

  async listVersions(categoryInput: string | undefined, page: number, pageSize: number) {
    const category = categoryInput ? assertCategory(categoryInput) : undefined;
    const result = await this.database.pool.query<ConfigurationVersionRow & { total: string }>(
      `SELECT *, count(*) OVER() total FROM configuration_versions
       WHERE status='published' AND ($1::text IS NULL OR category=$1)
       ORDER BY category, version DESC
       LIMIT $2 OFFSET $3`,
      [category ?? null, pageSize, (page - 1) * pageSize],
    );
    const total = result.rows[0] ? Number(result.rows[0].total) : 0;
    return { items: result.rows.map((row) => this.mapRow(row)), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async getVersion(categoryInput: string, version: number) {
    const category = assertCategory(categoryInput);
    const result = await this.database.pool.query<ConfigurationVersionRow>(
      `SELECT * FROM configuration_versions WHERE category=$1 AND status='published' AND version=$2`,
      [category, version],
    );
    if (!result.rowCount) throw new NotFoundException("Configuration version not found");
    return this.mapRow(result.rows[0]);
  }

  /**
   * Module 7 — Rollback never mutates or removes history: it publishes a
   * brand-new version whose payload copies a past one, re-validated against
   * the *current* state of Master Data (a referenced record may since have
   * been disabled or deleted).
   */
  async rollback(categoryInput: string, targetVersion: number, reason: string, actor: Principal, request: Request) {
    const category = assertCategory(categoryInput);
    return this.database.transaction(async (client) => {
      const targetResult = await client.query<ConfigurationVersionRow>(
        `SELECT * FROM configuration_versions WHERE category=$1 AND status='published' AND version=$2`,
        [category, targetVersion],
      );
      if (!targetResult.rowCount) throw new NotFoundException("Configuration version not found");
      const target = targetResult.rows[0];
      const errors = await validateConfigurationPayload(category, target.payload, client);
      if (errors.length) throw new ConflictException(`Cannot roll back: this version is no longer valid (${errors.join("; ")})`);

      const previousResult = await client.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM configuration_versions WHERE category=$1 AND status='published' ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        [category],
      );
      const previousPayload = previousResult.rows[0]?.payload ?? defaultPayloadFor(category);
      const nextVersionResult = await client.query<{ max: number | null }>(
        `SELECT max(version) max FROM configuration_versions WHERE category=$1 AND status='published'`,
        [category],
      );
      const nextVersion = (nextVersionResult.rows[0]?.max ?? 0) + 1;
      const id = randomUUID();
      const actorRow = await client.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [actor.id]);
      const fullReason = `Rollback to version ${targetVersion}: ${reason}`;
      await client.query(
        `INSERT INTO configuration_versions(id,category,version,status,payload,reason,changed_by,changed_by_display_name_snapshot,changed_by_role_snapshot,source_ip,created_at,updated_at,published_at)
         VALUES($1,$2,$3,'published',$4,$5,$6,$7,$8,$9,now(),now(),now())`,
        [id, category, nextVersion, JSON.stringify(target.payload), fullReason, actor.id, actorRow.rows[0]?.display_name ?? null, actor.roles, request.ip ?? null],
      );
      await this.audit(
        client,
        actor,
        category,
        "ROLLED_BACK",
        request,
        {
          version: nextVersion,
          rolledBackToVersion: targetVersion,
          reason: fullReason,
          oldValue: previousPayload,
          newValue: target.payload,
        },
        id,
      );
      return { version: nextVersion };
    });
  }

  private mapRow(row: ConfigurationVersionRow) {
    return {
      id: row.id,
      category: row.category,
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
    category: ConfigurationCategory,
    action: string,
    request: Request,
    metadata: Record<string, unknown>,
    entityId: string,
  ) {
    const actorRow = await client.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [actor.id]);
    const correlationId = (request as Request & { correlationId?: string }).correlationId ?? "unavailable";
    await client.query(
      `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata,source_ip,actor_role_snapshot,actor_display_name_snapshot)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        actor.id,
        `CONFIGURATION_${action}`,
        `CONFIGURATION_${category.toUpperCase()}`,
        entityId,
        correlationId,
        JSON.stringify(redactSensitiveData({ category, ...metadata })),
        request.ip ?? null,
        actor.roles,
        actorRow.rows[0]?.display_name ?? null,
      ],
    );
  }
}
