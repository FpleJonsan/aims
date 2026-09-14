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
} from "../../../components/ui";
import { AuthApiError, authApiGet } from "../../../lib/auth-api";
import type { DelegationSummary } from "../_shared/types";

type AuditRow = { entity_id: string; action: string; actor_display_name_snapshot: string | null; occurred_at: string; safe_metadata: Record<string, unknown> };
type HistoryItem = DelegationSummary & { auditTrail: AuditRow[] };

const STATUS_TONE: Record<DelegationSummary["effectiveStatus"], "success" | "warning" | "neutral" | "danger"> = {
  ACTIVE: "success",
  SCHEDULED: "warning",
  EXPIRED: "neutral",
  CANCELLED: "danger",
};

export default function DelegationHistoryPage() {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    authApiGet<{ items: HistoryItem[] }>("/admin/delegation/history?pageSize=100")
      .then((result) => setItems(result.items))
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load delegation history."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return (
    <div>
      <UiPageHeader
        title="Delegation history"
        description="Every delegation ever created, including expired and cancelled ones, with its full audit trail. Delegation never changes historical Approval audit — this only shows the delegation records themselves."
        actions={
          <Link href="/admin/delegation">
            <UiButton>Back to delegations</UiButton>
          </Link>
        }
      />
      {error && (
        <UiAlert tone="danger" title="Could not load history">
          {error}
        </UiAlert>
      )}
      {loading && <UiSpinner label="Loading history…" />}
      {!loading &&
        items?.map((item) => (
          <UiCard key={item.id} style={{ marginBottom: 12 }}>
            <UiCardBody>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <UiTypography as="h3" variant="card">
                  {item.delegateFromName ?? item.delegateFrom} → {item.delegateToName ?? item.delegateTo}
                </UiTypography>
                <UiBadge tone={STATUS_TONE[item.effectiveStatus]}>{item.effectiveStatus}</UiBadge>
              </div>
              <UiTypography variant="label">
                {item.startDate} → {item.endDate} · {item.reason}
              </UiTypography>
              {item.cancelReason && <UiTypography variant="label">Cancelled: {item.cancelReason}</UiTypography>}
              {item.auditTrail.length > 0 && (
                <ul style={{ marginTop: 8 }}>
                  {item.auditTrail.map((row, index) => (
                    <li key={index} style={{ fontSize: 13 }}>
                      {new Date(row.occurred_at).toLocaleString()} — {row.action} by {row.actor_display_name_snapshot ?? "unknown"}
                    </li>
                  ))}
                </ul>
              )}
            </UiCardBody>
          </UiCard>
        ))}
      {!loading && items?.length === 0 && <UiAlert tone="info">No delegations have been created yet.</UiAlert>}
    </div>
  );
}
