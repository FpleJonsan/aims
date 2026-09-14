/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { ApprovalService } from "../approval/approval.service.js";
import { NotificationBindingService, isProductionRuntime } from "./notification-binding.service.js";

/**
 * Moved out of ApprovalService (approval.service.ts) as part of P20.5G. Every
 * SQL statement, advisory lock, and recovery-generation check below is
 * unchanged from the original Day 6/P12 implementation — this is a
 * relocation, not a rewrite. The only mechanical change is that the two call
 * sites which used to invoke `this.act(...)` directly on ApprovalService now
 * call the same public `ApprovalService.act()` through an injected
 * dependency, which is exactly the "Telegram never bypasses Approval, it
 * only reuses the existing Approval API" shape the platform is meant to
 * have. Route path (integrations/telegram/webhook) is unchanged — it is
 * registered with Telegram's servers and must not move.
 */
@Injectable()
export class TelegramInboundService {
  constructor(
    private readonly db: Postgres,
    private readonly approvals: ApprovalService,
    private readonly bindings: NotificationBindingService,
  ) {}

  async telegramWebhook(secret: string | undefined, body: unknown) {
    if (process.env.TELEGRAM_APPROVAL_ENABLED !== "true") return { ok: false, disabled: true };
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || !secret || !safeEqual(secret, expected)) throw new ForbiddenException("Invalid Telegram webhook secret");
    const update = validateTelegramUpdate(body),
      updateId = update.update_id;
    const claim = await this.db.retryableTransaction(async (c) => {
      const existing = await c.query<any>("SELECT * FROM telegram_webhook_updates WHERE update_id=$1 FOR UPDATE", [updateId]);
      if (!existing.rowCount) {
        await c.query("INSERT INTO telegram_webhook_updates(update_id,status,attempts,locked_at)VALUES($1,'PROCESSING',1,now())", [updateId]);
        return "CLAIMED";
      }
      const row = existing.rows[0];
      if (row.status === "COMPLETED") return "COMPLETED";
      if (row.status === "FAILED_TERMINAL") return "TERMINAL";
      if (row.status === "PROCESSING" && row.locked_at && Date.now() - new Date(row.locked_at).getTime() < 120000) return "PROCESSING";
      await c.query(
        "UPDATE telegram_webhook_updates SET status='PROCESSING',attempts=attempts+1,locked_at=now(),last_error_code=NULL WHERE update_id=$1",
        [updateId],
      );
      return "CLAIMED";
    });
    if (claim === "COMPLETED") return { ok: true, idempotent: true };
    if (claim === "TERMINAL") return { ok: false, terminal: true };
    if (claim === "PROCESSING") return { ok: true, processing: true };
    try {
      const result = await this.processTelegramUpdate(update);
      await this.db.pool.query("UPDATE telegram_webhook_updates SET status='COMPLETED',completed_at=now(),locked_at=NULL WHERE update_id=$1", [updateId]);
      return result;
    } catch (error) {
      const terminal = typeof (error as any)?.getStatus === "function" && (error as any).getStatus() < 500;
      await this.db.pool.query("UPDATE telegram_webhook_updates SET status=$2,locked_at=NULL,last_error_code=$3 WHERE update_id=$1", [
        updateId,
        terminal ? "FAILED_TERMINAL" : "FAILED_RETRYABLE",
        (error instanceof Error ? error.name : "WEBHOOK_FAILURE").slice(0, 64),
      ]);
      throw error;
    }
  }

  private async processTelegramUpdate(update: any) {
    const message = update?.message;
    if (typeof message?.text === "string" && message.text.startsWith("/bind ")) return this.consumeTelegramBindingChallenge(message);
    if (typeof message?.text === "string" && typeof message?.from?.id === "number") {
      const pending = await this.db.retryableTransaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
        const generation = await c.query<{ generation: string }>("SELECT generation FROM aims_recovery_generation WHERE singleton");
        const q = await c.query<any>(
          `SELECT i.*,b.telegram_chat_id,u.department_id,ARRAY(SELECT ur.role FROM user_roles ur WHERE ur.user_id=u.id)roles,ac.payment_request_id FROM telegram_pending_interactions i JOIN telegram_identity_bindings b ON b.id=i.telegram_binding_id AND b.status='ACTIVE' JOIN users u ON u.id=i.recipient_user_id AND u.active JOIN approval_cases ac ON ac.id=i.approval_case_id WHERE b.telegram_user_id=$1 AND b.telegram_chat_id=$2 AND i.status='PENDING' AND i.expires_at>now() FOR UPDATE OF i`,
          [message.from.id, message.chat?.id],
        );
        if (!q.rowCount) throw new ConflictException("No active Telegram interaction");
        const row = q.rows[0];
        return { ...row, recovery_generation: generation.rows[0].generation };
      });
      const result = await this.approvals.act(
        pending.payment_request_id,
        pending.approval_step_id,
        {
          commandKey: pending.id,
          action: pending.action,
          reason: message.text.trim(),
          requiredResponse:
            pending.action === "REQUEST_CLARIFICATION" ? `Provide the requested information: ${message.text.trim()}` : undefined,
        },
        { id: pending.recipient_user_id, departmentId: pending.department_id, roles: pending.roles },
        randomUUID(),
        "TELEGRAM",
        pending.recovery_generation,
      );
      await this.db.pool.query("UPDATE telegram_pending_interactions SET status='CONSUMED',consumed_at=now() WHERE id=$1 AND status='PENDING'", [pending.id]);
      return result;
    }
    const callback = update?.callback_query;
    if (typeof callback?.data !== "string" || typeof callback?.from?.id !== "number") return { ok: true, ignored: true };
    const callbackChat = callback.message?.chat;
    if (isProductionRuntime() && (!callbackChat || callbackChat.type !== "private" || callbackChat.id !== callback.from.id))
      throw new ForbiddenException("Telegram approval actions require the bound private chat");
    const prepared = await this.db.retryableTransaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
      const generation = await c.query<{ generation: string }>("SELECT generation FROM aims_recovery_generation WHERE singleton");
      const token = await c.query<any>(
        `SELECT t.*,ac.payment_request_id,b.id binding_id,b.user_id,u.department_id,ARRAY(SELECT ur.role FROM user_roles ur WHERE ur.user_id=u.id) roles
         FROM approval_action_tokens t JOIN approval_cases ac ON ac.id=t.approval_case_id
         JOIN telegram_identity_bindings b ON b.telegram_user_id=$2 AND ($3::bigint IS NULL OR b.telegram_chat_id=$3) AND b.status='ACTIVE' AND b.user_id=t.recipient_user_id
         JOIN users u ON u.id=b.user_id AND u.active
         WHERE t.token_hash=$1 AND t.issued_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton) FOR UPDATE OF t`,
        [createHash("sha256").update(callback.data).digest("hex"), callback.from.id, callbackChat?.id ?? null],
      );
      if (!token.rowCount) throw new ConflictException("Telegram action token is invalid, expired, or used");
      const row = token.rows[0];
      if (row.status === "CONSUMED" && row.action === "APPROVE") {
        const completed = await c.query("SELECT 1 FROM approval_actions WHERE command_key=$1 AND actor_id=$2 AND action='APPROVE'", [row.id, row.user_id]);
        if (!completed.rowCount) throw new ConflictException("Telegram action token is invalid, expired, or used");
        return {
          duplicate: true,
          requestId: row.payment_request_id,
          stepId: row.approval_step_id,
          tokenId: row.id,
          action: row.action,
          principal: { id: row.user_id, departmentId: row.department_id, roles: row.roles } as Principal,
          recoveryGeneration: generation.rows[0].generation,
        };
      }
      if (row.status !== "ACTIVE" || new Date(row.expires_at) <= new Date()) throw new ConflictException("Telegram action token is invalid, expired, or used");
      if (row.status !== "ACTIVE") throw new ConflictException("Telegram action token is already used");
      if (row.action !== "APPROVE") {
        await c.query("UPDATE telegram_pending_interactions SET status='CANCELLED' WHERE telegram_binding_id=$1 AND status='PENDING'", [row.binding_id]);
        await c.query("UPDATE approval_action_tokens SET used_at=now(),used_by=$2,status='CONSUMED' WHERE id=$1", [row.id, row.user_id]);
        const interactionId = randomUUID();
        await c.query(
          "INSERT INTO telegram_pending_interactions(id,telegram_binding_id,recipient_user_id,approval_case_id,approval_step_id,action,status,expires_at)VALUES($1,$2,$3,$4,$5,$6,'PENDING',now()+interval '10 minutes')",
          [interactionId, row.binding_id, row.user_id, row.approval_case_id, row.approval_step_id, row.action],
        );
        return { pending: true, action: row.action, interactionId, chatId: callback.message?.chat?.id };
      }
      return {
        requestId: row.payment_request_id,
        stepId: row.approval_step_id,
        tokenId: row.id,
        action: row.action,
        principal: { id: row.user_id, departmentId: row.department_id, roles: row.roles } as Principal,
        recoveryGeneration: generation.rows[0].generation,
      };
    });
    if ((prepared as any).pending)
      return {
        method: "sendMessage",
        chat_id: (prepared as any).chatId,
        text:
          (prepared as any).action === "REJECT"
            ? "Reply with the rejection reason within 10 minutes."
            : "Reply with the clarification reason and requested information within 10 minutes.",
        reply_markup: { force_reply: true },
      };
    const command = prepared as { requestId: string; stepId: string; tokenId: string; principal: Principal; recoveryGeneration: string };
    const result = await this.approvals.act(
      command.requestId,
      command.stepId,
      { commandKey: command.tokenId, action: "APPROVE" },
      command.principal,
      randomUUID(),
      "TELEGRAM",
      command.recoveryGeneration,
    );
    await this.db.pool.query(
      "UPDATE approval_action_tokens SET used_at=COALESCE(used_at,now()),used_by=COALESCE(used_by,$2),status='CONSUMED' WHERE id=$1 AND status='ACTIVE'",
      [command.tokenId, command.principal.id],
    );
    return result;
  }

  private async consumeTelegramBindingChallenge(message: any) {
    if (message.chat?.type !== "private" || message.chat?.id !== message.from?.id)
      throw new ForbiddenException("Telegram binding requires a private chat");
    const token = message.text.slice(6).trim();
    if (!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{24}$/.test(token)) throw new BadRequestException("Invalid Telegram binding challenge");
    const [id, signature] = token.split("."),
      secret = process.env.TELEGRAM_CALLBACK_SECRET,
      expected = secret ? createHmac("sha256", secret).update(id).digest("base64url").slice(0, 24) : "";
    if (!secret || !safeEqual(signature, expected)) throw new ForbiddenException("Invalid Telegram binding challenge");
    const created = await this.db.retryableTransaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [id]);
      await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
      const generation = await c.query<{ generation: string }>("SELECT generation FROM aims_recovery_generation WHERE singleton");
      const q = await c.query<any>(
        `SELECT ae.actor_id,ae.correlation_id,ae.safe_metadata,u.department_id
         FROM audit_events ae JOIN users u ON u.id=ae.actor_id AND u.active
         WHERE ae.action='TELEGRAM_BINDING_CHALLENGE_CREATED' AND ae.entity_id=$1
           AND EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role='ADMIN')
         ORDER BY occurred_at DESC LIMIT 1`,
        [id],
      );
      if (!q.rowCount) throw new ConflictException("Telegram binding challenge is invalid");
      const metadata = q.rows[0].safe_metadata;
      if (
        metadata?.tokenHash !== createHash("sha256").update(token).digest("hex") ||
        metadata?.recoveryGeneration !== generation.rows[0].generation ||
        new Date(metadata?.expiresAt).getTime() <= Date.now()
      )
        throw new ConflictException("Telegram binding challenge is expired");
      const consumed = await c.query("SELECT 1 FROM audit_events WHERE action='TELEGRAM_BINDING_CHALLENGE_CONSUMED' AND entity_id=$1", [id]);
      if (consumed.rowCount) throw new ConflictException("Telegram binding challenge is already used");
      await c.query(
        `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)
         VALUES($1,$2,'TELEGRAM_BINDING_CHALLENGE_CONSUMED','TELEGRAM_IDENTITY_BINDING',$3,$4,$5)`,
        [randomUUID(), q.rows[0].actor_id, id, q.rows[0].correlation_id, JSON.stringify({ userId: metadata.userId })],
      );
      return {
        userId: metadata.userId as string,
        actorId: q.rows[0].actor_id as string,
        actorDepartmentId: q.rows[0].department_id as string,
        correlationId: q.rows[0].correlation_id as string,
      };
    });
    return this.bindings.bindTelegram(
      { userId: created.userId, telegramUserId: String(message.from.id), telegramChatId: String(message.chat.id) },
      { id: created.actorId, departmentId: created.actorDepartmentId, roles: ["ADMIN"] },
      created.correlationId,
    );
  }
}

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function validateTelegramUpdate(body: unknown): any {
  assertBoundedStructure(body, 0, { nodes: 0 });
  if (!isRecord(body)) throw new BadRequestException("Telegram update must be an object");
  assertSafeTelegramNumber(body.update_id, "update ID", true);
  const message = body.message;
  const callback = body.callback_query;
  if (message !== undefined) validateTelegramMessage(message);
  if (callback !== undefined) {
    if (!isRecord(callback)) throw new BadRequestException("Telegram callback is malformed");
    if (typeof callback.data !== "string" || Buffer.byteLength(callback.data) > 64) throw new BadRequestException("Telegram callback data is invalid");
    validateTelegramIdentity(callback.from, "callback user");
    if (isProductionRuntime() && !isRecord(callback.message)) throw new BadRequestException("Telegram callback message is required");
    if (isRecord(callback.message)) validateTelegramChat(callback.message.chat);
  }
  return body;
}

function validateTelegramMessage(value: unknown): void {
  if (!isRecord(value)) throw new BadRequestException("Telegram message is malformed");
  if (typeof value.text !== "string" || value.text.length < 1 || value.text.length > 2_000) throw new BadRequestException("Telegram message text is invalid");
  validateTelegramIdentity(value.from, "message user");
  validateTelegramChat(value.chat);
}

function validateTelegramIdentity(value: unknown, label: string): void {
  if (!isRecord(value)) throw new BadRequestException(`Telegram ${label} is malformed`);
  assertSafeTelegramNumber(value.id, label, false);
}

function validateTelegramChat(value: unknown): void {
  if (!isRecord(value)) throw new BadRequestException("Telegram chat is malformed");
  assertSafeTelegramNumber(value.id, "chat ID", false);
  if (isProductionRuntime() && value.type !== "private") throw new ForbiddenException("Telegram approval supports private chats only");
}

function assertSafeTelegramNumber(value: unknown, label: string, allowZero: boolean): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0))
    throw new BadRequestException(`Telegram ${label} is invalid`);
}

function assertBoundedStructure(value: unknown, depth: number, counter: { nodes: number }): void {
  counter.nodes += 1;
  if (depth > 8 || counter.nodes > 128) throw new BadRequestException("Telegram update structure is too complex");
  if (Array.isArray(value)) {
    if (value.length > 32) throw new BadRequestException("Telegram update array is too large");
    for (const child of value) assertBoundedStructure(child, depth + 1, counter);
  } else if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 32) throw new BadRequestException("Telegram update object is too large");
    for (const [, child] of entries) assertBoundedStructure(child, depth + 1, counter);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
