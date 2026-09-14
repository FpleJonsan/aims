"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  Select as UiSelect,
  Button as UiButton,
  Alert as UiAlert,
  Badge as UiBadge,
  Dialog as UiDialog,
  Textarea as UiTextarea,
  TableContainer as UiTableContainer,
  TableHeaderRow as UiTableHeaderRow,
  LoadingSpinner as UiSpinner,
  Typography as UiTypography,
} from "../../../components/ui";
import { AuthApiError, authApiGet, authApiPost } from "../../../lib/auth-api";

const CATEGORY_LABELS: Record<string, string> = {
  company: "Company",
  finance: "Finance",
  numbering: "Numbering",
  ai: "AI",
  notifications: "Notifications",
  system: "System",
};

type VersionEntry = { category: string; version: number; reason: string | null; changedBy: string | null; publishedAt: string | null };
type ListResponse = { items: VersionEntry[]; total: number };

export default function ConfigurationVersionHistoryPage() {
  const searchParams = useSearchParams();
  const [category, setCategory] = useState(searchParams.get("category") ?? "");
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<VersionEntry | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogTitleId = useId();

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ pageSize: "50" });
    if (category) params.set("category", category);
    authApiGet<ListResponse>(`/admin/configuration/versions?${params.toString()}`)
      .then((response) => {
        setData(response);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load version history."))
      .finally(() => setLoading(false));
  }, [category]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function confirmRollback() {
    if (!rollbackTarget) return;
    setBusy(true);
    setError(null);
    try {
      await authApiPost(`/admin/configuration/${rollbackTarget.category}/versions/${rollbackTarget.version}/rollback`, { reason });
      setNotice(`Rolled back ${CATEGORY_LABELS[rollbackTarget.category] ?? rollbackTarget.category} to version ${rollbackTarget.version}.`);
      setRollbackTarget(null);
      setReason("");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not roll back this configuration.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <UiPageHeader title="Configuration version history" description="Every published change across every settings category, with mandatory reasons and rollback." />
      {error && <UiAlert tone="danger" title="Action failed" style={{ marginBottom: 16 }}>{error}</UiAlert>}
      {notice && <UiAlert tone="success" title="Done" style={{ marginBottom: 16 }}>{notice}</UiAlert>}

      <UiCard style={{ marginBottom: 16 }}>
        <UiCardBody>
          <UiSelect label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </UiSelect>
        </UiCardBody>
      </UiCard>

      {loading && <UiSpinner label="Loading version history…" />}
      {!loading && data && (
        <UiCard>
          <UiCardBody>
            <UiTableContainer label="Configuration versions">
              <UiTableHeaderRow columns={["Category", "Version", "Reason", "Published by", "Published at", "Actions"]} />
              {data.items.map((item) => (
                <div key={`${item.category}-${item.version}`} role="row" style={{ display: "grid", gridTemplateColumns: "1fr 0.6fr 2fr 1fr 1.2fr 1fr", gap: 8, padding: "8px 0", borderBottom: "1px solid #eee" }}>
                  <span role="cell"><UiBadge tone="neutral">{CATEGORY_LABELS[item.category] ?? item.category}</UiBadge></span>
                  <span role="cell">v{item.version}</span>
                  <span role="cell">{item.reason ?? "—"}</span>
                  <span role="cell">{item.changedBy ?? "—"}</span>
                  <span role="cell">{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : "—"}</span>
                  <span role="cell">
                    <UiButton onClick={() => setRollbackTarget(item)}>Rollback to this version</UiButton>
                  </span>
                </div>
              ))}
            </UiTableContainer>
            {data.items.length === 0 && <UiTypography style={{ marginTop: 12 }}>No published versions yet.</UiTypography>}
          </UiCardBody>
        </UiCard>
      )}

      {rollbackTarget && (
        <UiDialog labelledBy={dialogTitleId} onClose={() => setRollbackTarget(null)} style={{ maxWidth: 480, margin: "10vh auto", padding: 24 }}>
          <UiTypography as="h2" variant="section" id={dialogTitleId}>
            Roll back {CATEGORY_LABELS[rollbackTarget.category] ?? rollbackTarget.category} to version {rollbackTarget.version}
          </UiTypography>
          <UiTypography>This publishes a new version copying version {rollbackTarget.version}&apos;s values. History is never rewritten.</UiTypography>
          <UiTextarea label="Reason for this rollback" required value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: 12 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <UiButton variant="primary" busy={busy} busyLabel="Rolling back…" disabled={reason.trim().length < 3} onClick={confirmRollback}>
              Confirm rollback
            </UiButton>
            <UiButton onClick={() => setRollbackTarget(null)}>Cancel</UiButton>
          </div>
        </UiDialog>
      )}
    </div>
  );
}
