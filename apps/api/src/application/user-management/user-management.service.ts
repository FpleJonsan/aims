import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import type { Request } from "express";
import type { PoolClient } from "pg";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { redactSensitiveData } from "../../infrastructure/configuration/secret-boundary.js";
import { hashPassword } from "../../infrastructure/security/password-hash.js";
import { SessionService } from "../auth/session.service.js";
import type { Principal } from "../../domain/payment-request.js";
import type { ApprovalAuthorityDto, CoarseRole, CreateUserDto, ListUsersDto } from "./user-management.dto.js";

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  active: boolean;
  department_id: string;
  department: string;
  last_login_at: string | null;
  roles: CoarseRole[];
  has_password_credentials: boolean;
  locked_until: string | null;
};

function generateTemporaryPassword(): string {
  // 24 base64url chars from 18 random bytes comfortably clears the 12-character minimum policy.
  return randomBytes(18).toString("base64url");
}

@Injectable()
export class UserManagementService {
  constructor(
    private readonly database: Postgres,
    private readonly sessions: SessionService,
  ) {}

  async list(query: ListUsersDto): Promise<{ items: unknown[]; page: number; pageSize: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean }> {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const search = query.search?.trim() ? `%${query.search.trim()}%` : null;
    const result = await this.database.pool.query<UserRow & { total: string }>(
      `SELECT u.id, u.email, u.display_name, u.active, u.department_id, d.name department, u.last_login_at,
              COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') roles,
              EXISTS(SELECT 1 FROM password_credentials pc WHERE pc.user_id=u.id) has_password_credentials,
              (SELECT pc.locked_until FROM password_credentials pc WHERE pc.user_id=u.id) locked_until,
              count(*) OVER() total
       FROM users u
       JOIN departments d ON d.id=u.department_id
       LEFT JOIN user_roles ur ON ur.user_id=u.id AND ur.role IN ('REQUESTER','FINANCE','FINANCE_MASTER')
       WHERE ($1::text IS NULL OR u.display_name ILIKE $1 OR u.email ILIKE $1)
       GROUP BY u.id, d.name
       ORDER BY u.display_name
       LIMIT $2 OFFSET $3`,
      [search, pageSize, (page - 1) * pageSize],
    );
    const total = result.rows[0] ? Number(result.rows[0].total) : 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      items: result.rows.map((row) => this.mapUser(row)),
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };
  }

  async get(id: string) {
    const result = await this.database.pool.query<UserRow>(
      `SELECT u.id, u.email, u.display_name, u.active, u.department_id, d.name department, u.last_login_at,
              COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), '{}') roles,
              EXISTS(SELECT 1 FROM password_credentials pc WHERE pc.user_id=u.id) has_password_credentials,
              (SELECT pc.locked_until FROM password_credentials pc WHERE pc.user_id=u.id) locked_until
       FROM users u
       JOIN departments d ON d.id=u.department_id
       LEFT JOIN user_roles ur ON ur.user_id=u.id AND ur.role IN ('REQUESTER','FINANCE','FINANCE_MASTER')
       WHERE u.id=$1
       GROUP BY u.id, d.name`,
      [id],
    );
    if (!result.rowCount) throw new NotFoundException("User not found");
    const telegram = await this.database.pool.query<{ status: string; created_at: string }>(
      `SELECT status, created_at FROM telegram_identity_bindings WHERE user_id=$1 AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1`,
      [id],
    );
    const authorities = await this.database.pool.query<{ authority_role: string; authority_scope: string; department_id: string | null; active: boolean }>(
      `SELECT authority_role, authority_scope, department_id, active FROM approval_authorities WHERE user_id=$1 ORDER BY authority_role`,
      [id],
    );
    return {
      ...this.mapUser(result.rows[0]),
      telegramBinding: telegram.rowCount ? { bound: true, boundAt: telegram.rows[0].created_at } : { bound: false },
      approvalAuthorities: authorities.rows.map((row) => ({
        authorityRole: row.authority_role,
        authorityScope: row.authority_scope,
        active: row.active,
      })),
    };
  }

  async create(dto: CreateUserDto, actor: Principal, request: Request) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const userId = randomUUID();
    const identityId = randomUUID();
    const temporaryPassword = generateTemporaryPassword();
    const { hash, salt, params } = await hashPassword(temporaryPassword);
    const created = await this.database.transaction(async (client) => {
      const department = await client.query<{ active: boolean }>(`SELECT active FROM departments WHERE id=$1`, [dto.departmentId]);
      if (!department.rowCount || !department.rows[0].active) throw new BadRequestException("Unknown or inactive department");
      const emailTaken = await client.query(`SELECT 1 FROM users WHERE email=$1`, [normalizedEmail]);
      if (emailTaken.rowCount) throw new ConflictException("Email already registered");

      await client.query(
        `INSERT INTO users(id,external_subject,email,display_name,department_id) VALUES($1,$2,$3,$4,$5)`,
        [userId, normalizedEmail, normalizedEmail, dto.displayName, dto.departmentId],
      );
      await client.query(
        `INSERT INTO user_external_identities(id,user_id,provider,issuer,subject) VALUES($1,$2,'password','aims-password',$3)`,
        [identityId, userId, normalizedEmail],
      );
      await client.query(
        `INSERT INTO password_credentials(user_id,hash,salt,scrypt_params,force_reset) VALUES($1,$2,$3,$4,true)`,
        [userId, hash, salt, JSON.stringify(params)],
      );
      for (const role of dto.roles) {
        await client.query(`INSERT INTO user_roles(user_id,role) VALUES($1,$2)`, [userId, role]);
      }
      await this.audit(client, actor, "USER_CREATED", userId, request, { email: normalizedEmail, roles: dto.roles });
      return { id: userId, temporaryPassword };
    });
    return created;
  }

  async setActive(id: string, active: boolean, actor: Principal, request: Request) {
    if (id === actor.id) throw new ForbiddenException("You cannot disable your own account");
    await this.database.transaction(async (client) => {
      const result = await client.query(`UPDATE users SET active=$2 WHERE id=$1 RETURNING id`, [id, active]);
      if (!result.rowCount) throw new NotFoundException("User not found");
      await this.audit(client, actor, active ? "USER_ENABLED" : "USER_DISABLED", id, request);
    });
    if (!active) await this.sessions.revokeAllForUser(id, request);
  }

  async lock(id: string, actor: Principal, request: Request) {
    if (id === actor.id) throw new ForbiddenException("You cannot lock your own account");
    await this.withPasswordCredentials(id, async (client) => {
      await client.query(
        `UPDATE password_credentials SET locked_until=now() + interval '100 years', updated_at=now() WHERE user_id=$1`,
        [id],
      );
      await this.audit(client, actor, "USER_LOCKED", id, request);
    });
    await this.sessions.revokeAllForUser(id, request);
  }

  async unlock(id: string, actor: Principal, request: Request) {
    await this.withPasswordCredentials(id, async (client) => {
      await client.query(
        `UPDATE password_credentials SET locked_until=NULL, failed_attempts=0, updated_at=now() WHERE user_id=$1`,
        [id],
      );
      await this.audit(client, actor, "USER_UNLOCKED", id, request);
    });
  }

  async resetPassword(id: string, actor: Principal, request: Request): Promise<{ temporaryPassword: string }> {
    const temporaryPassword = generateTemporaryPassword();
    const { hash, salt, params } = await hashPassword(temporaryPassword);
    await this.withPasswordCredentials(id, async (client) => {
      await client.query(
        `UPDATE password_credentials SET hash=$2, salt=$3, scrypt_params=$4, force_reset=true, failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`,
        [id, hash, salt, JSON.stringify(params)],
      );
      await this.audit(client, actor, "USER_PASSWORD_RESET", id, request);
    });
    await this.sessions.revokeAllForUser(id, request);
    return { temporaryPassword };
  }

  async forcePasswordReset(id: string, actor: Principal, request: Request) {
    await this.withPasswordCredentials(id, async (client) => {
      await client.query(`UPDATE password_credentials SET force_reset=true, updated_at=now() WHERE user_id=$1`, [id]);
      await this.audit(client, actor, "USER_FORCE_PASSWORD_RESET", id, request);
    });
  }

  async assignRoles(id: string, roles: CoarseRole[], actor: Principal, request: Request) {
    await this.database.transaction(async (client) => {
      const existing = await client.query<{ role: CoarseRole }>(
        `SELECT role FROM user_roles WHERE user_id=$1 AND role IN ('REQUESTER','FINANCE','FINANCE_MASTER')`,
        [id],
      );
      const current = new Set(existing.rows.map((row) => row.role));
      const desired = new Set(roles);
      const toAdd = [...desired].filter((role) => !current.has(role));
      const toRemove = [...current].filter((role) => !desired.has(role));
      if (toRemove.includes("FINANCE_MASTER") && id === actor.id) throw new ForbiddenException("You cannot remove your own Finance Master role");
      for (const role of toAdd) await client.query(`INSERT INTO user_roles(user_id,role) VALUES($1,$2)`, [id, role]);
      for (const role of toRemove) await client.query(`DELETE FROM user_roles WHERE user_id=$1 AND role=$2`, [id, role]);
      await this.audit(client, actor, "USER_ROLES_ASSIGNED", id, request, { roles });
    });
  }

  async upsertApprovalAuthority(id: string, dto: ApprovalAuthorityDto, actor: Principal, request: Request) {
    await this.database.transaction(async (client) => {
      const user = await client.query<{ department_id: string }>(`SELECT department_id FROM users WHERE id=$1`, [id]);
      if (!user.rowCount) throw new NotFoundException("User not found");
      const departmentId = dto.authorityScope === "DEPARTMENT" ? user.rows[0].department_id : null;
      await client.query(
        `INSERT INTO approval_authorities(id,user_id,authority_role,authority_scope,department_id,active)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id,authority_role,authority_scope,department_id) DO UPDATE SET active=EXCLUDED.active`,
        [randomUUID(), id, dto.authorityRole, dto.authorityScope, departmentId, dto.active],
      );
      await this.audit(client, actor, "USER_APPROVAL_AUTHORITY_UPDATED", id, request, { authorityRole: dto.authorityRole, authorityScope: dto.authorityScope, active: dto.active });
    });
  }

  private async withPasswordCredentials(id: string, operation: (client: PoolClient) => Promise<void>): Promise<void> {
    await this.database.transaction(async (client) => {
      const exists = await client.query(`SELECT 1 FROM password_credentials WHERE user_id=$1`, [id]);
      if (!exists.rowCount) throw new BadRequestException("This user does not use password authentication");
      await operation(client);
    });
  }

  private mapUser(row: UserRow) {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      active: row.active,
      departmentId: row.department_id,
      department: row.department,
      lastLoginAt: row.last_login_at,
      roles: row.roles,
      hasPasswordCredentials: row.has_password_credentials,
      locked: Boolean(row.locked_until && new Date(row.locked_until).getTime() > Date.now()),
    };
  }

  private async audit(client: Pick<PoolClient, "query">, actor: Principal, action: string, targetUserId: string, request: Request, metadata: Record<string, unknown> = {}) {
    const actorRow = await client.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [actor.id]);
    const correlationId = (request as Request & { correlationId?: string }).correlationId ?? "unavailable";
    await client.query(
      `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata,source_ip,actor_role_snapshot,actor_display_name_snapshot)
       VALUES($1,$2,$3,'USER',$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        actor.id,
        action,
        targetUserId,
        correlationId,
        JSON.stringify(redactSensitiveData(metadata)),
        request.ip ?? null,
        actor.roles,
        actorRow.rows[0]?.display_name ?? null,
      ],
    );
  }
}
