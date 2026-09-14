import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { metrics } from "../../infrastructure/observability/telemetry.js";
import { hashPassword, verifyPassword } from "../../infrastructure/security/password-hash.js";
import { EMAIL_SENDER, type EmailSender } from "../../infrastructure/email/email-sender.js";
import type { Principal, Role } from "../../domain/payment-request.js";
import { SessionService } from "./session.service.js";
import type { ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from "./password-auth.dto.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900;
const RESET_TOKEN_TTL_SECONDS = 1800;

type CredentialRow = {
  user_id: string; department_id: string; role: Role | null; identity_id: string;
  hash: Buffer; salt: Buffer; scrypt_params: { N: number; r: number; p: number };
  failed_attempts: number; locked_until: string | null; force_reset: boolean;
};

@Injectable()
export class PasswordAuthService {
  constructor(
    private readonly database: Postgres,
    private readonly sessions: SessionService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  async listActiveDepartments(): Promise<Array<{ id: string; name: string }>> {
    const result = await this.database.pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM departments WHERE active ORDER BY name`,
    );
    return result.rows;
  }

  async register(dto: RegisterDto, request: Request, response: Response) {
    this.sessions.requireAllowedOrigin(request);
    const normalizedEmail = dto.email.trim().toLowerCase();
    const { hash, salt, params } = await hashPassword(dto.password);
    const userId = randomUUID(), identityId = randomUUID();
    let identity;
    try {
      identity = await this.database.pool.query<{ identity_id: string; user_id: string; department_id: string; role: Role }>(
        `SELECT * FROM self_register_requester($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, dto.departmentId, normalizedEmail, dto.displayName, identityId, hash, salt, JSON.stringify(params)],
      );
    } catch (error) {
      await this.audit("PASSWORD_REGISTRATION_FAILURE", request, null, null, null);
      metrics.counter("aims_domain_operations_total", { operation: "REGISTER", outcome: "FAILURE", failure_category: "VALIDATION", channel: "WEB" });
      const code = (error as { code?: string }).code;
      if (code === "23505") throw new ConflictException("Email already registered");
      if (code === "23503") throw new BadRequestException("Unknown or inactive department");
      throw error;
    }
    const issued = await this.sessions.createPasswordSessionRecord(identity.rows, this.database.pool, false);
    this.sessions.setPasswordSessionCookies(response, issued);
    await this.audit("PASSWORD_REGISTRATION_SUCCESS", request, userId, identityId, ["REQUESTER"]);
    metrics.counter("aims_domain_operations_total", { operation: "REGISTER", outcome: "SUCCESS", failure_category: "NONE", channel: "WEB" });
    return { authenticated: true, userId };
  }

  async login(dto: LoginDto, request: Request, response: Response) {
    this.sessions.requireAllowedOrigin(request);
    const normalizedEmail = dto.email.trim().toLowerCase();
    const result = await this.database.pool.query<CredentialRow>(
      `SELECT u.id user_id, u.department_id, ur.role, x.id identity_id,
              pc.hash, pc.salt, pc.scrypt_params, pc.failed_attempts, pc.locked_until, pc.force_reset
       FROM user_external_identities x
       JOIN users u ON u.id=x.user_id AND u.active=true
       JOIN password_credentials pc ON pc.user_id=u.id
       LEFT JOIN user_roles ur ON ur.user_id=u.id
       WHERE x.provider='password' AND x.issuer='aims-password' AND x.subject=$1`,
      [normalizedEmail],
    );
    if (!result.rowCount) return this.denyLogin(request, null, null);
    const rows = result.rows, row = rows[0];
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      await this.audit("PASSWORD_AUTHENTICATION_LOCKED", request, row.user_id, row.identity_id, null);
      metrics.counter("aims_domain_operations_total", { operation: "LOGIN", outcome: "FAILURE", failure_category: "AUTHENTICATION", channel: "WEB" });
      throw new UnauthorizedException("Account temporarily locked. Try again later.");
    }
    const valid = await verifyPassword(dto.password, row.hash, row.salt, row.scrypt_params);
    if (!valid) {
      const attempts = row.failed_attempts + 1;
      const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_SECONDS * 1000) : null;
      await this.database.pool.query(
        `UPDATE password_credentials SET failed_attempts=$2, locked_until=$3, updated_at=now() WHERE user_id=$1`,
        [row.user_id, attempts, lockedUntil],
      );
      return this.denyLogin(request, row.user_id, row.identity_id);
    }
    await this.database.pool.query(
      `UPDATE password_credentials SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`,
      [row.user_id],
    );
    const roles = rows.flatMap((r) => (r.role ? [r.role] : []));
    const identityRows = rows.map((r) => ({ identity_id: r.identity_id, user_id: r.user_id, department_id: r.department_id, role: r.role }));
    const issued = await this.sessions.createPasswordSessionRecord(identityRows, this.database.pool, Boolean(dto.rememberMe));
    this.sessions.setPasswordSessionCookies(response, issued);
    await this.database.pool.query(`UPDATE users SET last_login_at=now() WHERE id=$1`, [row.user_id]);
    await this.audit("PASSWORD_AUTHENTICATION_SUCCESS", request, row.user_id, row.identity_id, roles);
    metrics.counter("aims_domain_operations_total", { operation: "LOGIN", outcome: "SUCCESS", failure_category: "NONE", channel: "WEB" });
    return { authenticated: true, userId: row.user_id, mustChangePassword: row.force_reset };
  }

  async forgotPassword(dto: ForgotPasswordDto, request: Request) {
    this.sessions.requireAllowedOrigin(request);
    const normalizedEmail = dto.email.trim().toLowerCase();
    const result = await this.database.pool.query<{ user_id: string; email: string }>(
      `SELECT u.id user_id, u.email FROM user_external_identities x
       JOIN users u ON u.id=x.user_id AND u.active=true
       WHERE x.provider='password' AND x.issuer='aims-password' AND x.subject=$1`,
      [normalizedEmail],
    );
    if (result.rowCount) {
      const row = result.rows[0];
      const rawToken = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      await this.database.pool.query(
        `INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+($4::text||' seconds')::interval)`,
        [randomUUID(), row.user_id, tokenHash, String(RESET_TOKEN_TTL_SECONDS)],
      );
      const resetUrl = `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/reset-password?token=${rawToken}`;
      try {
        await this.email.send({
          to: row.email,
          subject: "Reset your AIMS password",
          text: `Use this link to reset your password: ${resetUrl}\nThis link expires in 30 minutes. If you did not request this, you can ignore this email.`,
        });
      } catch {
        // Delivery failure must not leak whether the account exists; the request is still audited below.
      }
      await this.audit("PASSWORD_RESET_REQUESTED", request, row.user_id, null, null);
    }
    metrics.counter("aims_domain_operations_total", { operation: "PASSWORD_RESET_REQUEST", outcome: "INITIATED", failure_category: "NONE", channel: "WEB" });
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto, request: Request) {
    this.sessions.requireAllowedOrigin(request);
    const tokenHash = createHash("sha256").update(dto.token).digest("hex");
    const result = await this.database.pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()`,
      [tokenHash],
    );
    if (!result.rowCount) {
      await this.audit("PASSWORD_RESET_FAILURE", request, null, null, null);
      metrics.counter("aims_domain_operations_total", { operation: "PASSWORD_RESET", outcome: "FAILURE", failure_category: "AUTHENTICATION", channel: "WEB" });
      throw new UnauthorizedException("Invalid or expired reset token");
    }
    const { id, user_id: userId } = result.rows[0];
    const { hash, salt, params } = await hashPassword(dto.newPassword);
    await this.database.pool.query(
      `UPDATE password_credentials SET hash=$2, salt=$3, scrypt_params=$4, force_reset=false, failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`,
      [userId, hash, salt, JSON.stringify(params)],
    );
    await this.database.pool.query(`UPDATE password_reset_tokens SET used_at=now() WHERE id=$1`, [id]);
    await this.sessions.revokeAllForUser(userId, request);
    await this.audit("PASSWORD_RESET_COMPLETED", request, userId, null, null);
    metrics.counter("aims_domain_operations_total", { operation: "PASSWORD_RESET", outcome: "SUCCESS", failure_category: "NONE", channel: "WEB" });
    return { ok: true };
  }

  async changePassword(actor:Principal,dto:ChangePasswordDto,request:Request,response:Response){
    if(dto.newPassword!==dto.confirmPassword)throw new BadRequestException("Passwords do not match");
    if(dto.currentPassword===dto.newPassword)throw new BadRequestException("New password must be different");
    const current=await this.database.pool.query<CredentialRow>(`SELECT user_id,NULL::uuid department_id,NULL::varchar role,NULL::uuid identity_id,hash,salt,scrypt_params,failed_attempts,locked_until,force_reset FROM password_credentials WHERE user_id=$1`,[actor.id]);
    if(!current.rowCount||!(await verifyPassword(dto.currentPassword,current.rows[0].hash,current.rows[0].salt,current.rows[0].scrypt_params)))throw new UnauthorizedException("Current password is incorrect");
    const encoded=await hashPassword(dto.newPassword);
    await this.database.retryableTransaction(async client=>{
      await client.query(`UPDATE password_credentials SET hash=$2,salt=$3,scrypt_params=$4,force_reset=false,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=$1`,[actor.id,encoded.hash,encoded.salt,encoded.params]);
      await client.query(`UPDATE aims_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1`,[actor.id]);
      await client.query(`INSERT INTO authentication_audit_events(id,user_id,authentication_method,source_channel,event_type,correlation_id,source_ip,actor_role_snapshot) VALUES($1,$2,'LOCAL_PASSWORD','WEB','PASSWORD_CHANGED',$3,$4,$5)`,[randomUUID(),actor.id,request.correlationId??"unavailable",request.ip??null,actor.roles]);
    });
    await this.sessions.logout(request,response);
    return{changed:true,reauthenticationRequired:true};
  }

  private async denyLogin(request: Request, userId: string | null, identityId: string | null): Promise<never> {
    await this.audit("PASSWORD_AUTHENTICATION_FAILURE", request, userId, identityId, null);
    metrics.counter("aims_domain_operations_total", { operation: "LOGIN", outcome: "FAILURE", failure_category: "AUTHENTICATION", channel: "WEB" });
    throw new UnauthorizedException("Invalid email or password");
  }

  private async audit(eventType: string, request: Request, userId: string | null, identityId: string | null, roles: Role[] | null): Promise<void> {
    await this.database.pool.query(
      `INSERT INTO authentication_audit_events
       (id,user_id,external_identity_id,authentication_method,source_channel,event_type,correlation_id,source_ip,actor_role_snapshot)
       VALUES($1,$2,$3,'LOCAL_PASSWORD','WEB',$4,$5,$6,$7)`,
      [randomUUID(), userId, identityId, eventType, (request as Request & { correlationId?: string }).correlationId ?? "unavailable", request.ip ?? null, roles],
    );
  }
}
