import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { ConfigurationService } from "../configuration/configuration.service.js";
import { operationalLog } from "../../infrastructure/observability/telemetry.js";
import { DEFAULT_NOTIFICATION_TEMPLATES, findPublishedTemplate, renderTemplate } from "./notification-templates.js";
import type { NotificationEventType } from "./notification.types.js";
import { isNotificationEventType } from "./notification.types.js";

export type PublishNotificationInput = {
  eventType: NotificationEventType;
  aggregateType: string;
  aggregateId: string;
  recipientUserId: string;
  correlationId: string;
  variables?: Readonly<Record<string, string | number>>;
};

const SUPPORTED_CHANNELS = ["TELEGRAM"] as const;

/**
 * P20.5G core publish surface. A Workflow-side service calls publish() with
 * a channel-independent event; this never throws and never blocks the
 * caller's transaction on delivery — it only decides *whether* a
 * notification should exist and enqueues it onto the same notification_outbox
 * table the existing Approval/Telegram delivery already uses.
 * NotificationDispatcherService (a separate, later, best-effort process)
 * does the actual sending. "Notification failures never stop Approval" is
 * enforced structurally: publish() is fire-and-forget from the caller's
 * point of view and swallows every error itself.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly db: Postgres,
    private readonly configuration: ConfigurationService,
  ) {}

  async publish(input: PublishNotificationInput): Promise<{ enqueued: boolean; reason?: string }> {
    try {
      if (!isNotificationEventType(input.eventType)) return { enqueued: false, reason: "UNKNOWN_EVENT_TYPE" };
      const settings = await this.configuration.getActive("notifications");
      if (settings.payload.telegramEnabled !== true) return { enqueued: false, reason: "TELEGRAM_DISABLED" };

      const binding = await this.db.pool.query<{ telegram_chat_id: string }>(
        `SELECT telegram_chat_id FROM telegram_identity_bindings WHERE user_id=$1 AND status='ACTIVE'`,
        [input.recipientUserId],
      );
      if (!binding.rowCount) return { enqueued: false, reason: "NO_BINDING" };

      const preference = await this.db.pool.query<{ enabled: boolean; muted_until: string | null }>(
        `SELECT enabled,muted_until FROM notification_preferences WHERE user_id=$1 AND channel='TELEGRAM'`,
        [input.recipientUserId],
      );
      const pref = preference.rows[0];
      if (pref && (!pref.enabled || (pref.muted_until && new Date(pref.muted_until) > new Date())))
        return { enqueued: false, reason: "MUTED" };

      const published = findPublishedTemplate(settings.payload.notificationTemplates, input.eventType, "TELEGRAM");
      const templateText = published?.text ?? DEFAULT_NOTIFICATION_TEMPLATES[input.eventType];
      const renderedText = renderTemplate(templateText, input.variables ?? {});

      const result = await this.db.pool.query(
        `INSERT INTO notification_outbox(id,aggregate_type,aggregate_id,event_type,channel,recipient_user_id,payload)
         VALUES($1,$2,$3,$4,'TELEGRAM',$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
        [
          randomUUID(),
          input.aggregateType,
          input.aggregateId,
          input.eventType,
          input.recipientUserId,
          JSON.stringify({ renderedText, correlationId: input.correlationId, variables: input.variables ?? {} }),
        ],
      );
      return { enqueued: Boolean(result.rowCount) };
    } catch (error) {
      operationalLog("warn", "notification_publish_failed", {
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        safe_error_code: error instanceof Error ? error.name : "PUBLISH_FAILURE",
      });
      return { enqueued: false, reason: "PUBLISH_ERROR" };
    }
  }

  async getPreferences(actor: Principal) {
    const rows = await this.db.pool.query<{ channel: string; enabled: boolean; muted_until: string | null }>(
      `SELECT channel,enabled,muted_until FROM notification_preferences WHERE user_id=$1`,
      [actor.id],
    );
    const byChannel = new Map(rows.rows.map((row) => [row.channel, row]));
    return SUPPORTED_CHANNELS.map((channel) => {
      const row = byChannel.get(channel);
      return { channel, enabled: row?.enabled ?? true, mutedUntil: row?.muted_until ?? null };
    });
  }

  async getStatus() {
    const settings = await this.configuration.getActive("notifications");
    const backlog = await this.db.pool.query<{ pending: number; retrying: number; claimed: number; terminal: number }>(
      `SELECT count(*)FILTER(WHERE status='PENDING')::int pending,
              count(*)FILTER(WHERE status='FAILED_RETRYABLE')::int retrying,
              count(*)FILTER(WHERE status='PROCESSING')::int claimed,
              count(*)FILTER(WHERE status='FAILED_TERMINAL')::int terminal
       FROM notification_outbox WHERE event_type<>'APPROVAL_STEP_ACTIVATED'`,
    );
    return {
      channel: "TELEGRAM",
      botConfigured: process.env.TELEGRAM_APPROVAL_ENABLED === "true" && Boolean(process.env.TELEGRAM_BOT_TOKEN),
      deliveryEnabled: settings.payload.telegramEnabled === true,
      reminderEnabled: settings.payload.telegramReminderEnabled === true,
      escalationEnabled: settings.payload.telegramEscalationEnabled === true,
      reminderFrequencyHours: settings.payload.reminderFrequencyHours,
      escalationTimingHours: settings.payload.escalationTimingHours,
      configurationVersion: settings.version,
      backlog: backlog.rows[0] ?? { pending: 0, retrying: 0, claimed: 0, terminal: 0 },
    };
  }

  async listHistory(input: { page: number; pageSize: number; eventType?: string; status?: string }) {
    const result = await this.db.pool.query<Record<string, unknown> & { total: string }>(
      `SELECT o.id,o.aggregate_type,o.aggregate_id,o.event_type,o.channel,o.status,o.attempts,
              o.last_error_code,o.created_at,o.sent_at,u.display_name recipient_display_name,
              count(*) OVER() total
       FROM notification_outbox o LEFT JOIN users u ON u.id=o.recipient_user_id
       WHERE o.event_type<>'APPROVAL_STEP_ACTIVATED'
         AND ($3::text IS NULL OR o.event_type=$3) AND ($4::text IS NULL OR o.status=$4)
       ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`,
      [input.pageSize, (input.page - 1) * input.pageSize, input.eventType ?? null, input.status ?? null],
    );
    const total = result.rows[0] ? Number(result.rows[0].total) : 0;
    return {
      items: result.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "total"))),
      page: input.page,
      pageSize: input.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    };
  }

  async listOwnHistory(actor:Principal,input:{page:number;pageSize:number;eventType?:string;status?:string}){
    const result=await this.db.pool.query<Record<string,unknown>&{total:string}>(
      `SELECT id,event_type,channel,status,created_at,sent_at,last_error_code,count(*) OVER() total
       FROM notification_outbox WHERE recipient_user_id=$1
         AND($4::text IS NULL OR event_type=$4)AND($5::text IS NULL OR status=$5)
       ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
      [actor.id,input.pageSize,(input.page-1)*input.pageSize,input.eventType??null,input.status??null]);
    const total=result.rows[0]?Number(result.rows[0].total):0;
    return{items:result.rows.map(({total:rowTotal,...row})=>{void rowTotal;return row}),page:input.page,pageSize:input.pageSize,total,totalPages:Math.max(1,Math.ceil(total/input.pageSize))};
  }

  async setPreference(
    actor: Principal,
    channel: string,
    input: { enabled: boolean; mutedUntil: string | null },
    request: Request,
  ) {
    if (!SUPPORTED_CHANNELS.includes(channel as (typeof SUPPORTED_CHANNELS)[number]))
      return { channel, enabled: input.enabled, mutedUntil: input.mutedUntil };
    await this.db.retryableTransaction(async (c) => {
      await c.query(
        `INSERT INTO notification_preferences(id,user_id,channel,enabled,muted_until,updated_at)
         VALUES($1,$2,$3,$4,$5,now())
         ON CONFLICT(user_id,channel) DO UPDATE SET enabled=$4,muted_until=$5,updated_at=now()`,
        [randomUUID(), actor.id, channel, input.enabled, input.mutedUntil],
      );
      const correlationId = (request as Request & { correlationId?: string }).correlationId ?? "unavailable";
      await c.query(
        `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata,source_ip,actor_role_snapshot)
         VALUES($1,$2,'NOTIFICATION_PREFERENCE_UPDATED','NOTIFICATION_PREFERENCE',$3,$4,$5,$6,$7)`,
        [
          randomUUID(),
          actor.id,
          actor.id,
          correlationId,
          JSON.stringify({ channel, enabled: input.enabled, mutedUntil: input.mutedUntil }),
          request.ip ?? null,
          actor.roles,
        ],
      );
    });
    return { channel, enabled: input.enabled, mutedUntil: input.mutedUntil };
  }
}
