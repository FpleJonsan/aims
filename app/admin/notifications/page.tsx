"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  Button as UiButton,
  Alert as UiAlert,
  Badge as UiBadge,
  Typography as UiTypography,
  LoadingSpinner as UiSpinner,
} from "../../components/ui";
import { AuthApiError, authApiGet, authApiPost } from "../../lib/auth-api";

type NotificationStatus = {
  channel: string;
  botConfigured: boolean;
  deliveryEnabled: boolean;
  reminderEnabled: boolean;
  escalationEnabled: boolean;
  reminderFrequencyHours: number;
  escalationTimingHours: number;
  configurationVersion: number;
  backlog: { pending: number; retrying: number; claimed: number; terminal: number };
};

type DispatchResult = { processed: number };

export default function NotificationsAdminPage() {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    authApiGet<NotificationStatus>("/admin/notifications")
      .then((data) => {
        setStatus(data);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load notification status."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function runDispatch() {
    setDispatching(true);
    setError(null);
    setNotice(null);
    try {
      const result = await authApiPost<DispatchResult>("/admin/notifications/dispatch");
      setNotice(`Dispatch run complete: ${result.processed} notification${result.processed === 1 ? "" : "s"} processed.`);
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Dispatch run failed.");
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div>
      <UiPageHeader
        title="Notifications"
        description="Enterprise Notification Platform status — Telegram is the first supported channel. Templates and delivery timing live in Business Configuration; approval reminders and escalation reuse the same settings."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/notifications/templates"><UiButton>Templates &amp; settings</UiButton></Link>
            <Link href="/admin/notifications/history"><UiButton>Delivery history</UiButton></Link>
          </div>
        }
      />
      {error && (
        <UiAlert tone="danger" title="Action failed" style={{ marginBottom: 16 }}>
          {error}
        </UiAlert>
      )}
      {notice && (
        <UiAlert tone="success" title="Done" style={{ marginBottom: 16 }}>
          {notice}
        </UiAlert>
      )}
      {loading && <UiSpinner label="Loading notification status…" />}
      {!loading && status && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
          <UiCard>
            <UiCardBody>
              <UiTypography as="h2" variant="section" style={{ marginBottom: 12 }}>
                Telegram channel
              </UiTypography>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <UiBadge tone={status.botConfigured ? "success" : "neutral"}>
                  Bot {status.botConfigured ? "configured" : "not configured"}
                </UiBadge>
                <UiBadge tone={status.deliveryEnabled ? "success" : "warning"}>
                  Delivery {status.deliveryEnabled ? "enabled" : "disabled"}
                </UiBadge>
                <UiBadge tone={status.reminderEnabled ? "success" : "neutral"}>
                  Reminders {status.reminderEnabled ? "on" : "off"}
                </UiBadge>
                <UiBadge tone={status.escalationEnabled ? "success" : "neutral"}>
                  Escalation {status.escalationEnabled ? "on" : "off"}
                </UiBadge>
              </div>
              <p>Reminder frequency: every {status.reminderFrequencyHours}h. Escalation after {status.escalationTimingHours}h.</p>
              <p>Configuration version: {status.configurationVersion}. <Link href="/admin/settings/version-history?category=notifications">View version history</Link>.</p>
              {!status.botConfigured && (
                <UiAlert tone="warning">
                  TELEGRAM_APPROVAL_ENABLED / TELEGRAM_BOT_TOKEN are not both set for this environment — no Telegram message can be delivered
                  until an operator configures them.
                </UiAlert>
              )}
              {status.botConfigured && !status.deliveryEnabled && (
                <UiAlert tone="info">
                  The bot is configured but delivery is turned off in <Link href="/admin/notifications/templates">Templates &amp; settings</Link>.
                </UiAlert>
              )}
            </UiCardBody>
          </UiCard>

          <UiCard>
            <UiCardBody>
              <UiTypography as="h2" variant="section" style={{ marginBottom: 12 }}>
                Delivery queue
              </UiTypography>
              <div style={{ display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
                <span>Pending: <strong>{status.backlog.pending}</strong></span>
                <span>Retrying: <strong>{status.backlog.retrying}</strong></span>
                <span>In flight: <strong>{status.backlog.claimed}</strong></span>
                <span>Failed (terminal): <strong>{status.backlog.terminal}</strong></span>
              </div>
              <UiButton variant="primary" busy={dispatching} busyLabel="Dispatching…" onClick={runDispatch}>
                Run dispatch now
              </UiButton>
              <p style={{ marginTop: 8, color: "#666" }}>
                Delivery normally runs on its own schedule; this triggers one manual pass over the queue (excluding the interactive
                Approval/Telegram messages, which are dispatched separately and are unaffected by this platform).
              </p>
            </UiCardBody>
          </UiCard>
        </div>
      )}
    </div>
  );
}
