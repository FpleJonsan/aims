"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  Input as UiInput,
  Textarea as UiTextarea,
  Select as UiSelect,
  Button as UiButton,
  Alert as UiAlert,
  Badge as UiBadge,
  TableContainer as UiTableContainer,
  TableHeaderRow as UiTableHeaderRow,
  LoadingSpinner as UiSpinner,
} from "../../components/ui";
import { AuthApiError, authApiGet, authApiPost } from "../../lib/auth-api";
import type { DelegationSummary, UserOption } from "./_shared/types";

const STATUS_TONE: Record<DelegationSummary["effectiveStatus"], "success" | "warning" | "neutral" | "danger"> = {
  ACTIVE: "success",
  SCHEDULED: "warning",
  EXPIRED: "neutral",
  CANCELLED: "danger",
};

export default function DelegationPage() {
  const [items, setItems] = useState<DelegationSummary[] | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [delegateFrom, setDelegateFrom] = useState("");
  const [delegateTo, setDelegateTo] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: "100" });
    if (statusFilter) params.set("effectiveStatus", statusFilter);
    Promise.all([
      authApiGet<{ items: DelegationSummary[] }>(`/admin/delegation?${params.toString()}`),
      authApiGet<{ items: UserOption[] }>("/admin/users?pageSize=200"),
    ])
      .then(([delegations, userList]) => {
        setItems(delegations.items);
        setUsers(userList.items);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load delegations."))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      await authApiPost("/admin/delegation", { delegateFrom, delegateTo, startDate, endDate, reason });
      setNotice("Delegation created.");
      setDelegateFrom("");
      setDelegateTo("");
      setReason("");
      setEndDate("");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not create this delegation.");
    } finally {
      setBusy(null);
    }
  }

  async function submitCancel() {
    if (!cancelTarget) return;
    setBusy("cancel");
    setError(null);
    try {
      await authApiPost(`/admin/delegation/${cancelTarget}/cancel`, { reason: cancelReason });
      setNotice("Delegation cancelled.");
      setCancelTarget(null);
      setCancelReason("");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not cancel this delegation.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <UiPageHeader
        title="Approval Delegation"
        description="Temporarily route one approver's authority to another user — scheduled, active, or expired, without touching history."
        actions={
          <Link href="/admin/delegation/history">
            <UiButton>Delegation history</UiButton>
          </Link>
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

      <UiCard style={{ marginBottom: 16, maxWidth: 640 }}>
        <UiCardBody>
          <form onSubmit={submitCreate} noValidate>
            <UiSelect label="Delegate from" required value={delegateFrom} onChange={(e) => setDelegateFrom(e.target.value)}>
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.email})
                </option>
              ))}
            </UiSelect>
            <UiSelect label="Delegate to" required value={delegateTo} onChange={(e) => setDelegateTo(e.target.value)}>
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.email})
                </option>
              ))}
            </UiSelect>
            <UiInput label="Start date" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <UiInput label="End date" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <UiTextarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
            <UiButton type="submit" variant="primary" busy={busy === "create"} busyLabel="Creating…" style={{ marginTop: 8 }}>
              Create delegation
            </UiButton>
          </form>
        </UiCardBody>
      </UiCard>

      <UiCard>
        <UiCardBody>
          <UiSelect label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 240, marginBottom: 12 }}>
            <option value="">All</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
          </UiSelect>
          {loading && <UiSpinner label="Loading delegations…" />}
          {!loading && items && items.length === 0 && <UiAlert tone="info">No delegations match this filter.</UiAlert>}
          {!loading && items && items.length > 0 && (
            <UiTableContainer label="Delegations">
              <UiTableHeaderRow columns={["From", "To", "Start", "End", "Status", "Reason", "Actions"]} />
              {items.map((item) => (
                <div
                  key={item.id}
                  role="row"
                  style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.8fr 0.8fr 0.8fr 1.4fr 0.8fr", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eee" }}
                >
                  <span role="cell">{item.delegateFromName ?? item.delegateFrom}</span>
                  <span role="cell">{item.delegateToName ?? item.delegateTo}</span>
                  <span role="cell">{item.startDate}</span>
                  <span role="cell">{item.endDate}</span>
                  <span role="cell">
                    <UiBadge tone={STATUS_TONE[item.effectiveStatus]}>{item.effectiveStatus}</UiBadge>
                  </span>
                  <span role="cell">{item.reason}</span>
                  <span role="cell">
                    {item.effectiveStatus !== "CANCELLED" && item.effectiveStatus !== "EXPIRED" && (
                      <UiButton onClick={() => setCancelTarget(item.id)}>Cancel</UiButton>
                    )}
                  </span>
                </div>
              ))}
            </UiTableContainer>
          )}
        </UiCardBody>
      </UiCard>

      {cancelTarget && (
        <UiCard style={{ maxWidth: 480, margin: "24px auto" }}>
          <UiCardBody>
            <UiTextarea label="Reason for cancelling" required value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <UiButton variant="primary" busy={busy === "cancel"} busyLabel="Cancelling…" disabled={cancelReason.trim().length < 1} onClick={submitCancel}>
                Confirm cancel
              </UiButton>
              <UiButton onClick={() => setCancelTarget(null)}>Back</UiButton>
            </div>
          </UiCardBody>
        </UiCard>
      )}
    </div>
  );
}
