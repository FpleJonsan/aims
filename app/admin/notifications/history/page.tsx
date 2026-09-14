"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  Select as UiSelect,
  Alert as UiAlert,
  Badge as UiBadge,
  TableContainer as UiTableContainer,
  TableHeaderRow as UiTableHeaderRow,
  LoadingSpinner as UiSpinner,
  Pagination as UiPagination,
} from "../../../components/ui";
import { AuthApiError, authApiGet } from "../../../lib/auth-api";

type HistoryRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  channel: string;
  status: string;
  attempts: number;
  last_error_code: string | null;
  created_at: string;
  sent_at: string | null;
  recipient_display_name: string | null;
};
type HistoryResponse = { items: HistoryRow[]; page: number; pageSize: number; total: number; totalPages: number };

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  SENT: "success",
  PENDING: "neutral",
  PROCESSING: "warning",
  FAILED_RETRYABLE: "warning",
  FAILED_TERMINAL: "danger",
};

export default function NotificationHistoryPage() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (eventType) params.set("eventType", eventType);
    if (status) params.set("status", status);
    authApiGet<HistoryResponse>(`/admin/notifications/history?${params.toString()}`)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load notification history."))
      .finally(() => setLoading(false));
  }, [page, eventType, status]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return (
    <div>
      <UiPageHeader
        title="Notification history"
        description="Delivery attempts for generic notification events (Approval's own interactive Telegram messages are audited separately under Approval)."
        actions={<Link href="/admin/notifications">&larr; Back to notifications</Link>}
      />
      {error && (
        <UiAlert tone="danger" title="Could not load" style={{ marginBottom: 16 }}>
          {error}
        </UiAlert>
      )}
      <UiCard>
        <UiCardBody>
          <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <UiSelect
              label="Status"
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
              style={{ maxWidth: 220 }}
            >
              <option value="">All</option>
              <option value="PENDING">Pending</option>
              <option value="PROCESSING">Processing</option>
              <option value="SENT">Sent</option>
              <option value="FAILED_RETRYABLE">Failed (retrying)</option>
              <option value="FAILED_TERMINAL">Failed (terminal)</option>
            </UiSelect>
            <UiSelect
              label="Event type"
              value={eventType}
              onChange={(e) => {
                setPage(1);
                setEventType(e.target.value);
              }}
              style={{ maxWidth: 260 }}
            >
              <option value="">All</option>
              <option value="APPROVAL_APPROVED">Approval approved</option>
              <option value="APPROVAL_REJECTED">Approval rejected</option>
              <option value="APPROVAL_DELEGATED">Approval delegated</option>
              <option value="APPROVAL_REMINDER">Approval reminder</option>
              <option value="REQUEST_SUBMITTED">Request submitted</option>
              <option value="NEED_CLARIFICATION">Need clarification</option>
              <option value="FINANCE_REVIEW">Finance review</option>
              <option value="PAYMENT_READY">Payment ready</option>
              <option value="PAYMENT_COMPLETED">Payment completed</option>
              <option value="CANCELLATION_REQUESTED">Cancellation requested</option>
              <option value="CANCELLATION_APPROVED">Cancellation approved</option>
              <option value="CANCELLATION_REJECTED">Cancellation rejected</option>
            </UiSelect>
          </div>
          {loading && <UiSpinner label="Loading history…" />}
          {!loading && data && data.items.length === 0 && <UiAlert tone="info">No notifications match this filter.</UiAlert>}
          {!loading && data && data.items.length > 0 && (
            <>
              <UiTableContainer label="Notification history">
                <UiTableHeaderRow columns={["Event", "Channel", "Recipient", "Status", "Attempts", "Error", "Created", "Sent"]} />
                {data.items.map((row) => (
                  <div
                    key={row.id}
                    role="row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.4fr 0.7fr 1fr 0.9fr 0.6fr 1fr 1.1fr 1.1fr",
                      gap: 8,
                      alignItems: "center",
                      padding: "8px 0",
                      borderBottom: "1px solid #eee",
                      fontSize: 13,
                    }}
                  >
                    <span role="cell">{row.event_type}</span>
                    <span role="cell">{row.channel}</span>
                    <span role="cell">{row.recipient_display_name ?? "—"}</span>
                    <span role="cell">
                      <UiBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</UiBadge>
                    </span>
                    <span role="cell">{row.attempts}</span>
                    <span role="cell">{row.last_error_code ?? "—"}</span>
                    <span role="cell">{new Date(row.created_at).toLocaleString()}</span>
                    <span role="cell">{row.sent_at ? new Date(row.sent_at).toLocaleString() : "—"}</span>
                  </div>
                ))}
              </UiTableContainer>
              <UiPagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                hasPreviousPage={data.page > 1}
                hasNextPage={data.page < data.totalPages}
                onPrevious={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => p + 1)}
              />
            </>
          )}
        </UiCardBody>
      </UiCard>
    </div>
  );
}
