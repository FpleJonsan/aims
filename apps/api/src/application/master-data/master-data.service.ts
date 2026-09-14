import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { redactSensitiveData } from "../../infrastructure/configuration/secret-boundary.js";
import type { CreateMasterDataDto, ListMasterDataDto, UpdateMasterDataDto } from "./master-data.dto.js";
import type { MasterDataDomainConfig, MasterDataRow, Queryable } from "./master-data.types.js";

/**
 * One reusable CRUD engine for every P20.5C master-data domain (Categories,
 * Departments, Projects, Currencies, Payment Methods). Each domain gets its
 * own DI-provided instance configured with its own table name — the logic
 * below never changes per domain, only the config does. This keeps every
 * domain's Create/Edit/Enable/Disable/Soft-Delete/Search/Sort/Default/
 * Reference-Count/Duplicate-Prevention/Audit behavior identical by
 * construction instead of by convention.
 */
export class MasterDataService {
  constructor(
    private readonly database: Postgres,
    private readonly config: MasterDataDomainConfig,
  ) {}

  async list(query: ListMasterDataDto) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const search = query.search?.trim() ? `%${query.search.trim()}%` : null;
    const status = query.status ?? "active";
    const result = await this.database.pool.query<MasterDataRow & { total: string }>(
      `SELECT id, code, name, description, sort_order, is_default, active, deleted_at, created_by, updated_by, created_at, updated_at,
              count(*) OVER() total
       FROM ${this.config.table}
       WHERE deleted_at IS NULL
         AND ($1::text IS NULL OR name ILIKE $1 OR code ILIKE $1)
         AND ($2::text != 'active' OR active = true)
         AND ($2::text != 'disabled' OR active = false)
       ORDER BY sort_order, name
       LIMIT $3 OFFSET $4`,
      [search, status, pageSize, (page - 1) * pageSize],
    );
    const total = result.rows[0] ? Number(result.rows[0].total) : 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const items = await Promise.all(result.rows.map((row) => this.mapRow(row)));
    return { items, page, pageSize, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
  }

  async get(id: string) {
    const result = await this.database.pool.query<MasterDataRow>(
      `SELECT id, code, name, description, sort_order, is_default, active, deleted_at, created_by, updated_by, created_at, updated_at
       FROM ${this.config.table} WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    if (!result.rowCount) throw new NotFoundException(`${this.config.entityPrefix} not found`);
    return this.mapRow(result.rows[0]);
  }

  async create(dto: CreateMasterDataDto, actor: Principal, request: Request) {
    const id = randomUUID();
    const code = dto.code.trim();
    const sortOrder = dto.sortOrder !== undefined ? Number(dto.sortOrder) : 0;
    return this.database.transaction(async (client) => {
      await this.assertNoDuplicate(client, code, dto.name.trim());
      if (dto.isDefault) await client.query(`UPDATE ${this.config.table} SET is_default=false WHERE is_default=true`);
      await client.query(
        `INSERT INTO ${this.config.table}(id,code,name,description,sort_order,is_default,active,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,true,$7,$7)`,
        [id, code, dto.name.trim(), dto.description?.trim() || null, sortOrder, Boolean(dto.isDefault), actor.id],
      );
      await this.audit(client, actor, "CREATED", id, request, { code, name: dto.name.trim() });
      return { id, code };
    });
  }

  async update(id: string, dto: UpdateMasterDataDto, actor: Principal, request: Request) {
    await this.database.transaction(async (client) => {
      const current = await client.query<MasterDataRow>(`SELECT * FROM ${this.config.table} WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      if (!current.rowCount) throw new NotFoundException(`${this.config.entityPrefix} not found`);
      const row = current.rows[0];
      const nextName = dto.name !== undefined ? dto.name.trim() : row.name;
      if (dto.name !== undefined) await this.assertNoDuplicate(client, undefined, nextName, id);
      const nextDescription = dto.description !== undefined ? dto.description.trim() || null : row.description;
      const nextSortOrder = dto.sortOrder !== undefined ? Number(dto.sortOrder) : row.sort_order;
      const nextIsDefault = dto.isDefault ?? row.is_default;
      if (nextIsDefault && !row.is_default) await client.query(`UPDATE ${this.config.table} SET is_default=false WHERE is_default=true`);
      await client.query(
        `UPDATE ${this.config.table} SET name=$2, description=$3, sort_order=$4, is_default=$5, updated_by=$6, updated_at=now() WHERE id=$1`,
        [id, nextName, nextDescription, nextSortOrder, nextIsDefault, actor.id],
      );
      await this.audit(client, actor, "UPDATED", id, request, { code: row.code, oldName: row.name, newName: nextName });
    });
  }

  async setActive(id: string, active: boolean, actor: Principal, request: Request) {
    await this.database.transaction(async (client) => {
      const result = await client.query<{ code: string }>(
        `UPDATE ${this.config.table} SET active=$2, updated_by=$3, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING code`,
        [id, active, actor.id],
      );
      if (!result.rowCount) throw new NotFoundException(`${this.config.entityPrefix} not found`);
      await this.audit(client, actor, active ? "ENABLED" : "DISABLED", id, request, { code: result.rows[0].code });
    });
  }

  async softDelete(id: string, actor: Principal, request: Request) {
    await this.database.transaction(async (client) => {
      const current = await client.query<MasterDataRow>(`SELECT * FROM ${this.config.table} WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      if (!current.rowCount) throw new NotFoundException(`${this.config.entityPrefix} not found`);
      const row = current.rows[0];
      const referenceCount = await this.referenceCount(client, row);
      if (referenceCount > 0) throw new ConflictException(`${this.config.entityPrefix} is referenced by ${referenceCount} record(s) and cannot be deleted. Disable it instead.`);
      await client.query(`UPDATE ${this.config.table} SET deleted_at=now(), active=false, updated_by=$2, updated_at=now() WHERE id=$1`, [id, actor.id]);
      await this.audit(client, actor, "SOFT_DELETED", id, request, { code: row.code });
    });
  }

  private async assertNoDuplicate(client: Queryable, code: string | undefined, name: string, excludeId?: string) {
    if (code !== undefined) {
      const codeExists = await client.query(`SELECT 1 FROM ${this.config.table} WHERE deleted_at IS NULL AND code=$1`, [code]);
      if (codeExists.rowCount) throw new BadRequestException(`A ${this.config.entityPrefix.toLowerCase()} with this code already exists`);
    }
    const nameExists = await client.query(
      `SELECT 1 FROM ${this.config.table} WHERE deleted_at IS NULL AND lower(name)=lower($1) AND ($2::uuid IS NULL OR id != $2)`,
      [name, excludeId ?? null],
    );
    if (nameExists.rowCount) throw new BadRequestException(`A ${this.config.entityPrefix.toLowerCase()} with this name already exists`);
  }

  private async referenceCount(client: Queryable, row: MasterDataRow): Promise<number> {
    if (!this.config.referenceCount) return 0;
    return this.config.referenceCount(client, row);
  }

  private async mapRow(row: MasterDataRow) {
    const [referenceCount, createdBy, updatedBy] = await Promise.all([
      this.referenceCount(this.database.pool, row),
      this.userDisplayName(row.created_by),
      this.userDisplayName(row.updated_by),
    ]);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      sortOrder: row.sort_order,
      isDefault: row.is_default,
      active: row.active,
      referenceCount,
      createdBy,
      updatedBy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async userDisplayName(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const result = await this.database.pool.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [userId]);
    return result.rows[0]?.display_name ?? null;
  }

  private async audit(client: Queryable, actor: Principal, action: string, entityId: string, request: Request, metadata: Record<string, unknown> = {}) {
    const actorRow = await client.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [actor.id]);
    const correlationId = (request as Request & { correlationId?: string }).correlationId ?? "unavailable";
    await client.query(
      `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata,source_ip,actor_role_snapshot,actor_display_name_snapshot)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        actor.id,
        `${this.config.entityPrefix}_${action}`,
        `MASTER_DATA_${this.config.entityPrefix}`,
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
