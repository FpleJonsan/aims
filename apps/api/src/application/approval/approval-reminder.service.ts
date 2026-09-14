import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { ConfigurationService } from "../configuration/configuration.service.js";
import { ApprovalDelegationService } from "../approval-delegation/approval-delegation.service.js";
import { NotificationService } from "../notification/notification.service.js";

type OverdueStepRow = {
  id: string;
  required_role: string;
  authority_scope: string;
  created_by: string;
  department_id: string;
  ticket_number: string | null;
  request_amount_minor: string;
};

/**
 * P20.5G-2 — fires APPROVAL_REMINDER for approval steps that have sat ACTIVE
 * past the admin-configured reminderFrequencyHours (Business Configuration
 * "notifications" category, same source getStatus() already reads). Reuses
 * the same holder + delegation resolution as ApprovalService.queueStep().
 * A step is reminded at most once: notification_outbox's existing
 * UNIQUE(aggregate_id, event_type, recipient_user_id) constraint is the
 * idempotency guard, so no schema change and no extra "already reminded"
 * bookkeeping table are needed.
 */
@Injectable()
export class ApprovalReminderService {
  constructor(
    private readonly db: Postgres,
    private readonly delegations: ApprovalDelegationService,
    private readonly configuration: ConfigurationService,
    private readonly notifications?: NotificationService,
  ) {}

  async sweep(): Promise<{ processed: number }> {
    const settings = await this.configuration.getActive("notifications");
    if (settings.payload.telegramReminderEnabled !== true) return { processed: 0 };
    const hours = Number(settings.payload.reminderFrequencyHours ?? 24);

    const overdue = await this.db.pool.query<OverdueStepRow>(
      `SELECT s.id, s.required_role, s.authority_scope, pr.created_by, pr.department_id,
              pr.ticket_number, fc.request_amount_minor
       FROM approval_steps s
       JOIN approval_cases ac ON ac.id=s.approval_case_id AND ac.is_current AND ac.status='PENDING'
       JOIN payment_requests pr ON pr.id=ac.payment_request_id AND pr.status='PENDING_APPROVAL'
       JOIN finance_context_snapshots fc ON fc.id=ac.finance_context_snapshot_id
       WHERE s.status='ACTIVE' AND s.activated_at < now() - ($1 || ' hours')::interval`,
      [hours],
    );
    if (!overdue.rowCount) return { processed: 0 };

    const today = (await this.db.pool.query<{ d: string }>("SELECT current_date::text d")).rows[0].d;
    let processed = 0;
    for (const step of overdue.rows) {
      const holders = await this.db.pool.query<{ user_id: string }>(
        `SELECT DISTINCT aa.user_id FROM approval_authorities aa JOIN users u ON u.id=aa.user_id AND u.active
         WHERE aa.active AND aa.authority_role=$1 AND aa.authority_scope=$2
           AND (aa.authority_scope='ORGANIZATION' OR aa.department_id=$3) AND aa.user_id<>$4
           AND (aa.minimum_amount_minor IS NULL OR aa.minimum_amount_minor<=$5)
           AND (aa.maximum_amount_minor IS NULL OR aa.maximum_amount_minor>=$5)`,
        [step.required_role, step.authority_scope, step.department_id, step.created_by, step.request_amount_minor],
      );
      const recipients = new Set<string>();
      for (const holder of holders.rows) {
        const resolved = await this.delegations.resolveDelegate(this.db.pool, holder.user_id, today);
        if (resolved.userId !== step.created_by) recipients.add(resolved.userId);
      }
      for (const recipientUserId of recipients) {
        const result = await this.notifications?.publish({
          eventType: "APPROVAL_REMINDER",
          aggregateType: "APPROVAL_STEP",
          aggregateId: step.id,
          recipientUserId,
          correlationId: randomUUID(),
          variables: { ticketNumber: step.ticket_number ?? "" },
        });
        if (result?.enqueued) processed++;
      }
    }
    return { processed };
  }
}
