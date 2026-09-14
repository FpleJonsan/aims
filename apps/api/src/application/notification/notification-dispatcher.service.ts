/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { metrics, operationalLog } from "../../infrastructure/observability/telemetry.js";
import { NOTIFICATION_CHANNELS, NotificationDeliveryError, type NotificationChannelRegistry } from "./notification-channel.js";
import { INTERACTIVE_APPROVAL_EVENT_TYPE } from "./notification.types.js";

/**
 * Generalized sibling of ApprovalOutboxService (approval-outbox.service.ts),
 * which is left untouched and keeps owning APPROVAL_STEP_ACTIVATED rows (the
 * interactive approve/reject/clarify Telegram messages). This dispatcher
 * claims every other event_type from the same notification_outbox table —
 * the two workers are mutually exclusive by an explicit event_type filter on
 * both sides, so they never race the same row. Delivery is plain rendered
 * text (no inline keyboard, no action tokens): the message was already
 * rendered by NotificationService.publish() and travels in payload.renderedText.
 */
@Injectable()
export class NotificationDispatcherService {
  private readonly workerId = randomUUID();
  constructor(
    private readonly db: Postgres,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannelRegistry,
  ) {}

  async dispatch(limit = 20) {
    const results = [];
    for (let i = 0; i < Math.min(limit, 100); i++) {
      const claimed = await this.claim();
      if (!claimed) break;
      results.push(await this.deliver(claimed));
    }
    return { processed: results.length, results };
  }

  private async claim() {
    const claimToken = randomUUID();
    const claimed = await this.db.transaction(async (c) => {
      const q = await c.query<any>(
        `SELECT * FROM notification_outbox
         WHERE event_type<>$1 AND
           ((status IN('PENDING','FAILED_RETRYABLE') AND attempts<5 AND next_attempt_at<=now()) OR
            (status='PROCESSING' AND claimed_at<now()-interval '120 seconds'))
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
        [INTERACTIVE_APPROVAL_EVENT_TYPE],
      );
      if (!q.rowCount) return null;
      const result = await c.query<any>(
        `UPDATE notification_outbox SET status='PROCESSING',attempts=attempts+1,
         claimed_at=now(),claim_token=$2,claimed_by=$3,last_error_code=NULL
         WHERE id=$1 RETURNING *`,
        [q.rows[0].id, claimToken, this.workerId],
      );
      return result.rows[0];
    });
    return claimed ?? null;
  }

  private async deliver(row: any) {
    const started = performance.now();
    const correlationId = typeof row.payload?.correlationId === "string" ? row.payload.correlationId : randomUUID();
    metrics.counter("aims_worker_work_total", { workload: "NOTIFICATION_DELIVERY", outcome: "CLAIMED", failure_category: "NONE" });
    try {
      const chat = await this.db.pool.query<{ telegram_chat_id: string }>(
        `SELECT telegram_chat_id FROM telegram_identity_bindings WHERE user_id=$1 AND status='ACTIVE'`,
        [row.recipient_user_id],
      );
      if (!chat.rowCount) throw new Error("RECIPIENT_NOT_BOUND");
      const sender = this.channels.get(row.channel);
      if (!sender) throw new Error("CHANNEL_NOT_CONFIGURED");
      const text = typeof row.payload?.renderedText === "string" ? row.payload.renderedText : "";
      if (!text) throw new Error("EMPTY_RENDERED_TEXT");
      await sender.send({ recipientChatId: String(chat.rows[0].telegram_chat_id), text });
      const completed = await this.db.transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
        return c.query(
          `UPDATE notification_outbox SET status='SENT',sent_at=now(),last_error_code=NULL,
           claimed_at=NULL,claim_token=NULL,claimed_by=NULL
           WHERE id=$1 AND status='PROCESSING' AND claim_token=$2
             AND claim_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton)`,
          [row.id, row.claim_token],
        );
      });
      if (!completed.rowCount) return { id: row.id, status: "STALE_CLAIM" };
      await this.audit(row, "NOTIFICATION_SENT", null);
      metrics.counter("aims_worker_work_total", { workload: "NOTIFICATION_DELIVERY", outcome: "SUCCESS", failure_category: "NONE" });
      metrics.counter("aims_provider_operations_total", { provider: row.channel, surface: "NOTIFICATION", outcome: "SUCCESS", failure_category: "NONE" });
      return { id: row.id, status: "SENT" };
    } catch (error) {
      const code = safeDeliveryCode(error);
      const deliveryError = error instanceof NotificationDeliveryError ? error : undefined;
      const terminal =
        row.attempts >= 5 ||
        deliveryError?.retryable === false ||
        code === "RECIPIENT_NOT_BOUND" ||
        code === "CHANNEL_NOT_CONFIGURED" ||
        code === "EMPTY_RENDERED_TEXT";
      const retryDelay = Math.max(1, Math.min(deliveryError?.retryAfterSeconds ?? 300, 3_600));
      const failed = await this.db.transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
        return c.query(
          `UPDATE notification_outbox SET status=$3::varchar,
           next_attempt_at=CASE WHEN $3::varchar='FAILED_RETRYABLE' THEN now()+make_interval(secs=>$5) ELSE next_attempt_at END,
           last_error_code=$4,claimed_at=NULL,claim_token=NULL,claimed_by=NULL
           WHERE id=$1 AND status='PROCESSING' AND claim_token=$2
             AND claim_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton)`,
          [row.id, row.claim_token, terminal ? "FAILED_TERMINAL" : "FAILED_RETRYABLE", code, retryDelay],
        );
      });
      if (!failed.rowCount) return { id: row.id, status: "STALE_CLAIM" };
      await this.audit(row, terminal ? "NOTIFICATION_FAILED_TERMINAL" : "NOTIFICATION_FAILED", code);
      metrics.counter("aims_worker_work_total", {
        workload: "NOTIFICATION_DELIVERY",
        outcome: terminal ? "TERMINAL_FAILURE" : "RETRYABLE_FAILURE",
        failure_category: terminal ? "TERMINAL" : "PROVIDER",
      });
      operationalLog("warn", "provider_operation_failed", {
        provider: row.channel,
        surface: "NOTIFICATION",
        channel: row.channel,
        correlation_id: correlationId,
        failure_category: terminal ? "TERMINAL" : "PROVIDER",
        safe_error_code: code,
      });
      return { id: row.id, status: terminal ? "FAILED_TERMINAL" : "FAILED_RETRYABLE", code };
    } finally {
      metrics.histogram("aims_worker_work_duration_seconds", { workload: "NOTIFICATION_DELIVERY" }, (performance.now() - started) / 1000);
    }
  }

  private async audit(row: any, action: string, errorCode: string | null) {
    await this.db.pool.query(
      `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)VALUES($1,NULL,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        action,
        row.aggregate_type,
        row.aggregate_id,
        typeof row.payload?.correlationId === "string" ? row.payload.correlationId : randomUUID(),
        JSON.stringify({ outboxId: row.id, channel: row.channel, eventType: row.event_type, errorCode }),
      ],
    );
  }
}

function safeDeliveryCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : "DELIVERY_FAILED";
  return /^[A-Z0-9_]{1,64}$/.test(raw) ? raw : "DELIVERY_FAILED";
}
