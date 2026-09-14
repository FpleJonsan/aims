/**
 * P20.5G Enterprise Notification Platform. Channel-independent event names a
 * Workflow-side service can publish through NotificationService.publish().
 * Telegram is the only channel wired to deliver these today; adding Email/
 * In-App/SMS/Teams/Slack later means adding a NotificationChannelSender for
 * that channel, never changing this list or the publishing call sites.
 */
export const NOTIFICATION_EVENT_TYPES = [
  "REQUEST_SUBMITTED",
  "VALIDATION_STARTED",
  "VALIDATION_COMPLETE",
  "NEED_CLARIFICATION",
  "APPROVAL_REQUESTED",
  "APPROVAL_REMINDER",
  "APPROVAL_DELEGATED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  "FINANCE_REVIEW",
  "FINANCE_HOLD",
  "PAYMENT_READY",
  "PAYMENT_COMPLETED",
  "CANCELLATION_REQUESTED",
  "CANCELLATION_APPROVED",
  "CANCELLATION_REJECTED",
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export function isNotificationEventType(value: string): value is NotificationEventType {
  return (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * APPROVAL_STEP_ACTIVATED is deliberately excluded above: it is the existing
 * Day-6 interactive Telegram approve/reject/clarify message, still owned end
 * to end by ApprovalService/ApprovalOutboxService. It shares the
 * notification_outbox table with the generic events here (see
 * NotificationDispatcherService), distinguished purely by event_type so the
 * two delivery workers never claim each other's rows.
 */
export const INTERACTIVE_APPROVAL_EVENT_TYPE = "APPROVAL_STEP_ACTIVATED";

export type NotificationOutboxRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  channel: string;
  recipient_user_id: string | null;
  payload: Record<string, unknown>;
  status: "PENDING" | "PROCESSING" | "SENT" | "FAILED_RETRYABLE" | "FAILED_TERMINAL";
  attempts: number;
  next_attempt_at: string;
  last_error_code: string | null;
  created_at: string;
  sent_at: string | null;
  claimed_at: string | null;
  claim_token: string | null;
  claimed_by: string | null;
};
