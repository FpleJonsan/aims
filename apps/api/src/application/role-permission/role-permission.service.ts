import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { PoolClient } from "pg";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { redactSensitiveData } from "../../infrastructure/configuration/secret-boundary.js";
import type { CloneRoleDto, CreateRoleDto, ListRolesDto, SetRolePermissionsDto, UpdateRoleDto } from "./role-permission.dto.js";

/** Coarse identities that already exist outside this module: REQUESTER/FINANCE/ADMIN/FINANCE_MASTER live in user_roles, APPROVER is inferred from an active approval_authorities grant. The P21 roles table mirrors these five by code so effective permissions can be computed without touching either table. */
const GROUP_ORDER = [
  "Dashboard",
  "Payment Request",
  "Validation",
  "Finance Context",
  "Financial Analysis",
  "Policy",
  "Approval",
  "Finance Control",
  "Payment",
  "Reporting",
  "Master Data",
  "User Management",
  "Settings",
] as const;

type RoleRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  disabled: boolean;
  created_at: string;
  updated_at: string;
  permission_count?: string;
};

@Injectable()
export class RolePermissionService {
  constructor(private readonly database: Postgres) {}

  async list(query: ListRolesDto) {
    const search = query.search?.trim() ? `%${query.search.trim()}%` : null;
    const roles = await this.database.pool.query<RoleRow>(
      `SELECT r.id, r.code, r.name, r.description, r.is_system, r.disabled, r.created_at, r.updated_at,
              (SELECT count(*) FROM role_permissions rp WHERE rp.role_id = r.id) permission_count
       FROM roles r
       WHERE ($1::text IS NULL OR r.name ILIKE $1 OR r.code ILIKE $1)
       ORDER BY r.name`,
      [search],
    );
    const counts = await this.roleReferenceCounts();
    return roles.rows.map((row) => this.mapRole(row, counts.get(row.code) ?? 0));
  }

  async get(id: string) {
    const role = await this.database.pool.query<RoleRow>(
      `SELECT id, code, name, description, is_system, disabled, created_at, updated_at FROM roles WHERE id=$1`,
      [id],
    );
    if (!role.rowCount) throw new NotFoundException("Role not found");
    const permissions = await this.database.pool.query<{ permission_id: string }>(
      `SELECT permission_id FROM role_permissions WHERE role_id=$1`,
      [id],
    );
    const counts = await this.roleReferenceCounts();
    return {
      ...this.mapRole(role.rows[0], counts.get(role.rows[0].code) ?? 0),
      permissionIds: permissions.rows.map((row) => row.permission_id),
    };
  }

  async listPermissions() {
    const result = await this.database.pool.query<{ id: string; code: string; group_name: string; name: string }>(
      `SELECT id, code, group_name, name FROM permissions`,
    );
    return result.rows
      .slice()
      .sort((a, b) => {
        const groupDelta = GROUP_ORDER.indexOf(a.group_name as (typeof GROUP_ORDER)[number]) - GROUP_ORDER.indexOf(b.group_name as (typeof GROUP_ORDER)[number]);
        return groupDelta !== 0 ? groupDelta : a.name.localeCompare(b.name);
      })
      .map((row) => ({ id: row.id, code: row.code, group: row.group_name, name: row.name }));
  }

  async create(dto: CreateRoleDto, actor: Principal, request: Request) {
    const code = await this.generateUniqueCode(dto.name);
    const id = randomUUID();
    return this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO roles(id,code,name,description,is_system,disabled) VALUES($1,$2,$3,$4,false,false)`,
        [id, code, dto.name.trim(), dto.description?.trim() || null],
      );
      const permissionIds = dto.permissionIds ?? [];
      if (permissionIds.length) await this.replacePermissions(client, id, [], permissionIds);
      await this.audit(client, actor, "ROLE_CREATED", id, request, { code, name: dto.name.trim(), permissionCount: permissionIds.length });
      return { id, code };
    });
  }

  async update(id: string, dto: UpdateRoleDto, actor: Principal, request: Request) {
    await this.database.transaction(async (client) => {
      const current = await client.query<Pick<RoleRow, "code" | "name" | "description" | "is_system" | "disabled">>(
        `SELECT code, name, description, is_system, disabled FROM roles WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!current.rowCount) throw new NotFoundException("Role not found");
      const role = current.rows[0];
      if (role.is_system) throw new ForbiddenException("Technical Admin cannot be edited");

      const nextName = dto.name !== undefined ? dto.name.trim() : role.name;
      const nextDescription = dto.description !== undefined ? dto.description.trim() || null : role.description;
      const nextDisabled = dto.disabled ?? role.disabled;
      await client.query(`UPDATE roles SET name=$2, description=$3, disabled=$4, updated_at=now() WHERE id=$1`, [id, nextName, nextDescription, nextDisabled]);

      if (dto.disabled !== undefined && dto.disabled !== role.disabled) {
        await this.audit(client, actor, dto.disabled ? "ROLE_DISABLED" : "ROLE_ENABLED", id, request, { code: role.code });
      }
      if (nextName !== role.name || nextDescription !== role.description) {
        await this.audit(client, actor, "ROLE_UPDATED", id, request, { code: role.code, oldName: role.name, newName: nextName });
      }
    });
  }

  async clone(id: string, dto: CloneRoleDto, actor: Principal, request: Request) {
    const code = await this.generateUniqueCode(dto.name);
    const newId = randomUUID();
    return this.database.transaction(async (client) => {
      const source = await client.query<{ description: string | null }>(`SELECT description FROM roles WHERE id=$1`, [id]);
      if (!source.rowCount) throw new NotFoundException("Role not found");
      await client.query(
        `INSERT INTO roles(id,code,name,description,is_system,disabled) VALUES($1,$2,$3,$4,false,false)`,
        [newId, code, dto.name.trim(), source.rows[0].description],
      );
      await client.query(
        `INSERT INTO role_permissions(role_id,permission_id) SELECT $1, permission_id FROM role_permissions WHERE role_id=$2`,
        [newId, id],
      );
      await this.audit(client, actor, "ROLE_CLONED", newId, request, { sourceRoleId: id, code, name: dto.name.trim() });
      return { id: newId, code };
    });
  }

  async setPermissions(id: string, dto: SetRolePermissionsDto, actor: Principal, request: Request) {
    await this.database.transaction(async (client) => {
      const role = await client.query<Pick<RoleRow, "code" | "is_system">>(`SELECT code, is_system FROM roles WHERE id=$1 FOR UPDATE`, [id]);
      if (!role.rowCount) throw new NotFoundException("Role not found");
      if (role.rows[0].is_system) throw new ForbiddenException("Technical Admin cannot be edited");

      const existing = await client.query<{ permission_id: string }>(`SELECT permission_id FROM role_permissions WHERE role_id=$1`, [id]);
      const { added, removed } = await this.replacePermissions(client, id, existing.rows.map((row) => row.permission_id), dto.permissionIds);
      await this.audit(client, actor, "ROLE_PERMISSIONS_UPDATED", id, request, { code: role.rows[0].code, added, removed, reason: dto.reason });
    });
  }

  /** Union of permission codes across every role the principal currently holds: their coarse user_roles roles, plus APPROVER when they hold an active approval authority. Never a deny — only ever a grant. */
  async getEffectivePermissionCodes(principal: Principal): Promise<Set<string>> {
    const approver = await this.database.pool.query(`SELECT 1 FROM approval_authorities WHERE user_id=$1 AND active=true LIMIT 1`, [principal.id]);
    const roleCodes: string[] = [...principal.roles, ...(approver.rowCount ? ["APPROVER"] : [])];
    if (roleCodes.length === 0) return new Set();
    const result = await this.database.pool.query<{ code: string }>(
      `SELECT DISTINCT p.code
       FROM roles r
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE r.code = ANY($1) AND r.disabled = false`,
      [roleCodes],
    );
    return new Set(result.rows.map((row) => row.code));
  }

  private async replacePermissions(
    client: Pick<PoolClient, "query">,
    roleId: string,
    currentIds: string[],
    desiredIds: string[],
  ): Promise<{ added: number; removed: number }> {
    if (desiredIds.length) {
      const found = await client.query<{ id: string }>(`SELECT id FROM permissions WHERE id = ANY($1)`, [desiredIds]);
      if (found.rowCount !== new Set(desiredIds).size) throw new BadRequestException("One or more permissions are unknown");
    }
    const current = new Set(currentIds);
    const desired = new Set(desiredIds);
    const toAdd = [...desired].filter((permissionId) => !current.has(permissionId));
    const toRemove = [...current].filter((permissionId) => !desired.has(permissionId));
    for (const permissionId of toAdd) await client.query(`INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)`, [roleId, permissionId]);
    for (const permissionId of toRemove) await client.query(`DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2`, [roleId, permissionId]);
    return { added: toAdd.length, removed: toRemove.length };
  }

  private async generateUniqueCode(name: string): Promise<string> {
    const base = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "ROLE";
    let candidate = base;
    for (let suffix = 2; ; suffix += 1) {
      const exists = await this.database.pool.query(`SELECT 1 FROM roles WHERE code=$1`, [candidate]);
      if (!exists.rowCount) return candidate;
      candidate = `${base}_${suffix}`;
    }
  }

  private async roleReferenceCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const userRoles = await this.database.pool.query<{ role: string; total: string }>(`SELECT role, count(*) total FROM user_roles GROUP BY role`);
    for (const row of userRoles.rows) counts.set(row.role, Number(row.total));
    const approvers = await this.database.pool.query<{ total: string }>(`SELECT count(DISTINCT user_id) total FROM approval_authorities WHERE active=true`);
    counts.set("APPROVER", Number(approvers.rows[0]?.total ?? 0));
    return counts;
  }

  private mapRole(row: RoleRow, referenceCount: number) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      isSystem: row.is_system,
      disabled: row.disabled,
      permissionCount: row.permission_count !== undefined ? Number(row.permission_count) : undefined,
      referenceCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async audit(client: Pick<PoolClient, "query">, actor: Principal, action: string, roleId: string, request: Request, metadata: Record<string, unknown> = {}) {
    const actorRow = await client.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [actor.id]);
    const correlationId = (request as Request & { correlationId?: string }).correlationId ?? "unavailable";
    await client.query(
      `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata,source_ip,actor_role_snapshot,actor_display_name_snapshot)
       VALUES($1,$2,$3,'ROLE',$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        actor.id,
        action,
        roleId,
        correlationId,
        JSON.stringify(redactSensitiveData(metadata)),
        request.ip ?? null,
        actor.roles,
        actorRow.rows[0]?.display_name ?? null,
      ],
    );
  }
}
