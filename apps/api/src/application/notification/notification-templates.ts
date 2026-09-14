import type { NotificationEventType } from "./notification.types.js";

/**
 * Built-in fallback copy so every event type is usable the moment the
 * platform ships, before a Finance Master has authored anything through
 * admin/configuration/notifications (the existing Business Configuration
 * 'notifications' category, reused unchanged for draft/publish/version —
 * see notification.service.ts). A published notificationTemplates entry with
 * a matching {code, channel} always takes priority over this map.
 */
export const DEFAULT_NOTIFICATION_TEMPLATES: Record<NotificationEventType, string> = {
  REQUEST_SUBMITTED: "Your payment request {{ticketNumber}} has been submitted.",
  VALIDATION_COMPLETE: "Payment request {{ticketNumber}} passed validation.",
  NEED_CLARIFICATION: "Payment request {{ticketNumber}} needs clarification: {{reason}}",
  APPROVAL_REQUESTED: "A new approval is waiting on {{ticketNumber}} ({{currency}} {{amount}}).",
  APPROVAL_REMINDER: "Reminder: {{ticketNumber}} is still awaiting your approval.",
  APPROVAL_DELEGATED: "Approvals from {{delegateFromName}} are now routed to you until {{endDate}}.",
  APPROVAL_APPROVED: "Payment request {{ticketNumber}} was approved.",
  APPROVAL_REJECTED: "Payment request {{ticketNumber}} was rejected: {{reason}}",
  FINANCE_REVIEW: "Payment request {{ticketNumber}} is ready for Finance review.",
  PAYMENT_READY: "Payment request {{ticketNumber}} is ready for payment.",
  PAYMENT_COMPLETED: "Payment for {{ticketNumber}} has been completed.",
  CANCELLATION_REQUESTED: "A cancellation was requested for {{ticketNumber}}: {{reason}}",
  CANCELLATION_APPROVED: "The cancellation of {{ticketNumber}} was approved.",
  CANCELLATION_REJECTED: "The cancellation of {{ticketNumber}} was rejected.",
};

export type NotificationTemplateDefinition = { code: string; channel: string; text: string };

/** Matches configuration.schemas.ts's validateNotifications shape: {code, channel, text}[]. */
export function findPublishedTemplate(
  templates: unknown,
  eventType: string,
  channel: string,
): NotificationTemplateDefinition | undefined {
  if (!Array.isArray(templates)) return undefined;
  return templates.find(
    (t): t is NotificationTemplateDefinition =>
      isRecord(t) &&
      typeof t.code === "string" &&
      typeof t.channel === "string" &&
      typeof t.text === "string" &&
      t.code === eventType &&
      t.channel === channel,
  );
}

export function renderTemplate(text: string, variables: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
