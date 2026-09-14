import { createHash, createHmac, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { classifyAimsEnvironment } from "../../infrastructure/configuration/aims-environment.js";

/**
 * Moved out of ApprovalService (approval.service.ts) as part of P20.5G: the
 * SQL and every invariant below are unchanged from the original Day 6/P12
 * implementation (same tables: telegram_identity_bindings,
 * telegram_pending_interactions, approval_action_tokens, notification_outbox,
 * same recovery-generation handling). The one deliberate behavior change is
 * authorization: binding now belongs to User Profile (self-service) per the
 * P20.5G brief, rather than being admin-only. A user may always act on their
 * own binding; ADMIN retains the ability to act on behalf of another user
 * (kept for support/ops), but the HTTP surface (notification.controller.ts)
 * only ever exposes the self-service path — Finance Master can view binding
 * status but the API does not offer bind/unbind-on-behalf-of-another-user.
 */
@Injectable()
export class NotificationBindingService {
  constructor(private readonly db: Postgres) {}

  private assertSelfOrAdmin(actor: Principal, userId: string) {
    if (actor.id !== userId && !actor.roles.includes("ADMIN"))
      throw new ForbiddenException("You may only manage your own Telegram binding");
  }

  async status(actor: Principal, userId: string) {
    this.assertSelfOrAdmin(actor, userId);
    return this.readStatus(userId);
  }

  /** View-only, for Finance Master: no bind/unbind-on-behalf-of-another-user capability is exposed alongside this. */
  async adminViewStatus(userId: string) {
    return this.readStatus(userId);
  }

  private async readStatus(userId: string) {
    const result = await this.db.pool.query<{ status: string; created_at: string }>(
      `SELECT status,created_at FROM telegram_identity_bindings WHERE user_id=$1 AND status='ACTIVE'`,
      [userId],
    );
    return result.rowCount ? { status: "ACTIVE", boundAt: result.rows[0].created_at } : { status: "NOT_BOUND", boundAt: null };
  }

  async createChallenge(userId: string, actor: Principal, correlationId: string) {
    this.assertSelfOrAdmin(actor, userId);
    if (process.env.TELEGRAM_APPROVAL_ENABLED !== "true") throw new ConflictException("Telegram notification channel is disabled");
    const secret = process.env.TELEGRAM_CALLBACK_SECRET;
    if (!secret) throw new ConflictException("Telegram callback configuration is unavailable");
    const id = randomUUID(),
      token = `${id}.${createHmac("sha256", secret).update(id).digest("base64url").slice(0, 24)}`,
      tokenHash = createHash("sha256").update(token).digest("hex"),
      expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await this.db.retryableTransaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
      const generation = await c.query<{ generation: string }>("SELECT generation FROM aims_recovery_generation WHERE singleton");
      const user = await c.query("SELECT 1 FROM users WHERE id=$1 AND active", [userId]);
      if (!user.rowCount) throw new BadRequestException("Active user not found");
      await c.query(
        `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
         VALUES($1,$2,'TELEGRAM_BINDING_CHALLENGE_CREATED','TELEGRAM_IDENTITY_BINDING',$3,$4,$5)`,
        [randomUUID(), actor.id, id, correlationId, JSON.stringify({ userId, tokenHash, expiresAt, recoveryGeneration: generation.rows[0].generation })],
      );
    });
    return { challenge: `/bind ${token}`, expiresAt };
  }

  async revoke(userId: string, actor: Principal, correlationId: string) {
    this.assertSelfOrAdmin(actor, userId);
    return this.db.retryableTransaction(async (c) => {
      const revoked = await c.query<{ id: string }>(
        "UPDATE telegram_identity_bindings SET status='REVOKED',revoked_at=now() WHERE user_id=$1 AND status='ACTIVE' RETURNING id",
        [userId],
      );
      if (!revoked.rowCount) throw new NotFoundException("Active Telegram binding not found");
      for (const binding of revoked.rows)
        await c.query("UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE telegram_binding_id=$1 AND status='PENDING'", [binding.id]);
      await c.query("UPDATE approval_action_tokens SET status='REVOKED' WHERE recipient_user_id=$1 AND status='ACTIVE'", [userId]);
      await c.query(
        `UPDATE notification_outbox o SET status='FAILED_TERMINAL',last_error_code='IDENTITY_REVOKED',
         claimed_at=NULL,claim_token=NULL,claimed_by=NULL
         FROM approval_steps s JOIN approval_cases ac ON ac.id=s.approval_case_id
         WHERE o.aggregate_id=s.id AND o.recipient_user_id=$1 AND s.status='ACTIVE'
           AND ac.is_current AND o.status IN('PENDING','FAILED_RETRYABLE','PROCESSING')`,
        [userId],
      );
      await c.query(
        `UPDATE notification_outbox SET status='FAILED_TERMINAL',last_error_code='IDENTITY_REVOKED',
         claimed_at=NULL,claim_token=NULL,claimed_by=NULL
         WHERE recipient_user_id=$1 AND status IN('PENDING','FAILED_RETRYABLE','PROCESSING')`,
        [userId],
      );
      for (const binding of revoked.rows)
        await c.query(
          `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
           VALUES($1,$2,'TELEGRAM_IDENTITY_REVOKED','TELEGRAM_IDENTITY_BINDING',$3,$4,$5)`,
          [randomUUID(), actor.id, binding.id, correlationId, JSON.stringify({ userId, explicit: true })],
        );
      return { userId, status: "REVOKED" };
    });
  }

  async bindTelegram(
    input: { userId: string; telegramUserId: string; telegramChatId: string },
    actor: Principal,
    correlationId: string,
  ) {
    this.assertSelfOrAdmin(actor, input.userId);
    assertTelegramId(input.telegramUserId);
    assertTelegramId(input.telegramChatId);
    if (isProductionRuntime() && input.telegramUserId !== input.telegramChatId)
      throw new BadRequestException("Telegram approval bindings require the user's private chat");
    return this.db.retryableTransaction(async (c) => {
      const user = await c.query("SELECT 1 FROM users WHERE id=$1 AND active", [input.userId]);
      if (!user.rowCount) throw new BadRequestException("Active user not found");
      const revoked = await c.query(
        "UPDATE telegram_identity_bindings SET status='REVOKED',revoked_at=now() WHERE user_id=$1 AND status='ACTIVE' RETURNING id",
        [input.userId],
      );
      for (const prior of revoked.rows) {
        await c.query("UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE telegram_binding_id=$1 AND status='PENDING'", [prior.id]);
        await c.query(
          `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata) VALUES($1,$2,'TELEGRAM_IDENTITY_REVOKED','TELEGRAM_IDENTITY_BINDING',$3,$4,$5)`,
          [randomUUID(), actor.id, prior.id, correlationId, JSON.stringify({ userId: input.userId, replaced: true })],
        );
      }
      if (revoked.rowCount) {
        await c.query("UPDATE approval_action_tokens SET status='REVOKED' WHERE recipient_user_id=$1 AND status='ACTIVE'", [input.userId]);
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
        [id, input.userId, input.telegramUserId, input.telegramChatId, actor.id],
      );
      await c.query(
        `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
        VALUES($1,$2,'TELEGRAM_IDENTITY_BOUND','TELEGRAM_IDENTITY_BINDING',$3,$4,$5)`,
        [randomUUID(), actor.id, id, correlationId, JSON.stringify({ userId: input.userId })],
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
}

export function assertTelegramId(value: string): void {
  if (!/^[1-9][0-9]{0,15}$/.test(value)) throw new BadRequestException("Telegram identifier is invalid");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new BadRequestException("Telegram identifier is outside the safe range");
}

export function isProductionRuntime(): boolean {
  return classifyAimsEnvironment().protected;
}
