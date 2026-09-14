"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  CardFooter as UiCardFooter,
  PageHeader as UiPageHeader,
  Textarea as UiTextarea,
  Button as UiButton,
  Alert as UiAlert,
  Badge as UiBadge,
  Dialog as UiDialog,
  Typography as UiTypography,
  LoadingSpinner as UiSpinner,
  TableContainer as UiTableContainer,
  TableHeaderRow as UiTableHeaderRow,
} from "../../components/ui";
import { AuthApiError, authApiDelete, authApiGet, authApiPost } from "../../lib/auth-api";
import { EMPTY_PAYLOAD, type ApprovalMatrixPayload, type ApprovalMatrixVersion } from "./_shared/types";

type Active = { version: number; payload: ApprovalMatrixPayload; publishedAt: string | null };
type Preview = {
  changedRuleCodes: string[];
  affectedDepartments: string[];
  affectedCategories: string[];
  nextVersion: number;
  validationErrors: string[];
  canPublish: boolean;
};

export default function ApprovalMatrixPage() {
  const [active, setActive] = useState<Active | null>(null);
  const [draft, setDraft] = useState<{ id: string; payload: ApprovalMatrixPayload } | null>(null);
  const [versions, setVersions] = useState<ApprovalMatrixVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reasonOpen, setReasonOpen] = useState<"publish" | { rollbackTo: number } | null>(null);
  const [reason, setReason] = useState("");
  const dialogTitleId = useId();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      authApiGet<Active>("/admin/approval-matrix/active"),
      authApiGet<{ id: string | null; payload?: ApprovalMatrixPayload }>("/admin/approval-matrix/draft"),
    ])
      .then(([activeMatrix, draftMatrix]) => {
        setActive(activeMatrix);
        setDraft(draftMatrix.id ? { id: draftMatrix.id, payload: draftMatrix.payload ?? EMPTY_PAYLOAD } : null);
        setError(null);
        setPreview(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load the Approval Matrix."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function loadVersions() {
    authApiGet<{ items: ApprovalMatrixVersion[] }>("/admin/approval-matrix/versions?pageSize=50")
      .then((result) => setVersions(result.items))
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load version history."));
  }

  async function ensureDraftFromActive() {
    const payload = active?.payload ?? EMPTY_PAYLOAD;
    await authApiPost("/admin/approval-matrix/draft", { payload });
    load();
  }

  async function toggleRouting() {
    setBusy("toggle");
    setError(null);
    try {
      const payload = draft?.payload ?? active?.payload ?? EMPTY_PAYLOAD;
      await authApiPost("/admin/approval-matrix/draft", { payload: { ...payload, routingEnabled: !payload.routingEnabled } });
      setNotice("Draft updated.");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not update the draft.");
    } finally {
      setBusy(null);
    }
  }

  async function removeRule(code: string) {
    setBusy(`delete-${code}`);
    setError(null);
    try {
      const base = draft?.payload ?? active?.payload ?? EMPTY_PAYLOAD;
      const payload = { ...base, rules: base.rules.filter((r) => r.code !== code) };
      await authApiPost("/admin/approval-matrix/draft", { payload });
      setNotice("Rule removed from draft.");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not remove this rule.");
    } finally {
      setBusy(null);
    }
  }

  async function discardDraft() {
    setBusy("discard");
    setError(null);
    try {
      await authApiDelete("/admin/approval-matrix/draft");
      setNotice("Draft discarded.");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not discard the draft.");
    } finally {
      setBusy(null);
    }
  }

  async function runPreview() {
    setBusy("preview");
    setError(null);
    try {
      const result = await authApiGet<Preview>("/admin/approval-matrix/preview");
      setPreview(result);
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not build a preview.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmReason() {
    if (!reasonOpen) return;
    setBusy("confirm");
    setError(null);
    try {
      if (reasonOpen === "publish") await authApiPost("/admin/approval-matrix/publish", { reason });
      else await authApiPost("/admin/approval-matrix/rollback", { targetVersion: reasonOpen.rollbackTo, reason });
      setReasonOpen(null);
      setReason("");
      setNotice(reasonOpen === "publish" ? "Approval Matrix published." : "Rolled back to a previous version.");
      load();
      if (showVersions) loadVersions();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not complete this action.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div>
        <UiPageHeader title="Approval Matrix" description="Configure who approves what, without a deployment." />
        <UiSpinner label="Loading Approval Matrix…" />
      </div>
    );
  }

  const rules = (draft?.payload ?? active?.payload ?? EMPTY_PAYLOAD).rules;

  return (
    <div>
      <UiPageHeader
        title="Approval Matrix"
        description="Department, category, project, currency, amount range, risk, priority, and payment-type rules that route Approval — sequential or parallel."
        actions={
          <Link href="/admin/approval-matrix/create">
            <UiButton variant="primary">Create rule</UiButton>
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

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <UiBadge tone="neutral">Active version: {active?.version ?? 0}</UiBadge>
        {draft && <UiBadge tone="warning">Unpublished draft</UiBadge>}
        <UiBadge tone={(draft?.payload ?? active?.payload)?.routingEnabled ? "success" : "danger"}>
          Matrix routing {(draft?.payload ?? active?.payload)?.routingEnabled ? "enabled" : "disabled"}
        </UiBadge>
      </div>

      <UiCard style={{ marginBottom: 16 }}>
        <UiCardBody>
          {!draft && (
            <UiAlert tone="info" title="No draft yet">
              Create a rule to start a new draft, or{" "}
              <UiButton onClick={ensureDraftFromActive}>start a draft from the active matrix</UiButton>.
            </UiAlert>
          )}
          {rules.length === 0 && draft && <UiTypography>No rules yet in this draft.</UiTypography>}
          {rules.length > 0 && (
            <UiTableContainer label="Approval matrix rules">
              <UiTableHeaderRow columns={["Code", "Name", "Priority", "Status", "Steps", "Effective", "Actions"]} />
              {rules
                .slice()
                .sort((a, b) => a.priority - b.priority)
                .map((rule) => (
                  <div
                    key={rule.id}
                    role="row"
                    style={{ display: "grid", gridTemplateColumns: "minmax(100px,0.9fr) minmax(140px,1.2fr) minmax(80px,0.6fr) minmax(100px,1fr) minmax(70px,0.6fr) minmax(160px,1.2fr) minmax(140px,1fr)", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eee" }}
                  >
                    <span role="cell" style={{ fontFamily: "monospace" }}>
                      {rule.code}
                    </span>
                    <span role="cell">
                      <Link href={`/admin/approval-matrix/${rule.id}`}>{rule.name}</Link>
                    </span>
                    <span role="cell">{rule.priority}</span>
                    <span role="cell">
                      {!rule.active && <UiBadge tone="neutral">Disabled</UiBadge>}
                      {rule.active && rule.isFallback && <UiBadge tone="warning">Fallback</UiBadge>}
                      {rule.active && !rule.isFallback && <UiBadge tone="success">Active</UiBadge>}
                    </span>
                    <span role="cell">{rule.steps.length}</span>
                    <span role="cell">
                      {rule.effectiveFrom} → {rule.effectiveTo ?? "no expiry"}
                    </span>
                    <span role="cell" style={{ display: "flex", gap: 4 }}>
                      <Link href={`/admin/approval-matrix/${rule.id}`}>
                        <UiButton>Edit</UiButton>
                      </Link>
                      <UiButton busy={busy === `delete-${rule.code}`} busyLabel="Removing…" onClick={() => removeRule(rule.code)}>
                        Delete
                      </UiButton>
                    </span>
                  </div>
                ))}
            </UiTableContainer>
          )}
        </UiCardBody>
        <UiCardFooter style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <UiButton busy={busy === "toggle"} busyLabel="Updating…" disabled={!draft && !active} onClick={toggleRouting}>
            {(draft?.payload ?? active?.payload)?.routingEnabled ? "Disable matrix routing" : "Enable matrix routing"}
          </UiButton>
          <UiButton busy={busy === "discard"} busyLabel="Discarding…" disabled={!draft} onClick={discardDraft}>
            Discard draft
          </UiButton>
          <UiButton busy={busy === "preview"} busyLabel="Building preview…" disabled={!draft} onClick={runPreview}>
            Preview
          </UiButton>
          <UiButton variant="primary" disabled={!draft} onClick={() => setReasonOpen("publish")}>
            Publish…
          </UiButton>
          <UiButton
            onClick={() => {
              setShowVersions((v) => !v);
              if (!showVersions) loadVersions();
            }}
          >
            {showVersions ? "Hide version history" : "Version history"}
          </UiButton>
        </UiCardFooter>
      </UiCard>

      {preview && (
        <UiCard style={{ marginBottom: 16 }}>
          <UiCardBody>
            <UiTypography as="h3" variant="card">
              Preview: version {preview.nextVersion}
            </UiTypography>
            {preview.validationErrors.length > 0 ? (
              <UiAlert tone="danger" title="Validation failed — publishing is blocked">
                <ul>
                  {preview.validationErrors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </UiAlert>
            ) : (
              <UiAlert tone="success" title="Valid">
                This draft can be published.
              </UiAlert>
            )}
            <UiTypography variant="label" style={{ marginTop: 12 }}>
              Changed rules: {preview.changedRuleCodes.length ? preview.changedRuleCodes.join(", ") : "none"}
            </UiTypography>
            <UiTypography variant="label">
              Affected departments: {preview.affectedDepartments.length ? preview.affectedDepartments.join(", ") : "all"}
            </UiTypography>
            <UiTypography variant="label">
              Affected categories: {preview.affectedCategories.length ? preview.affectedCategories.join(", ") : "all"}
            </UiTypography>
          </UiCardBody>
        </UiCard>
      )}

      {showVersions && (
        <UiCard style={{ marginBottom: 16 }}>
          <UiCardBody>
            <UiTypography as="h3" variant="card">
              Version history
            </UiTypography>
            {versions.length === 0 && <UiTypography>No published versions yet.</UiTypography>}
            {versions.map((version) => (
              <div key={version.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eee" }}>
                <div>
                  <strong>v{version.version}</strong> — {version.reason ?? "no reason recorded"}
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {version.changedBy ?? "unknown"} · {version.publishedAt ? new Date(version.publishedAt).toLocaleString() : ""}
                  </div>
                </div>
                <UiButton disabled={version.version === active?.version} onClick={() => setReasonOpen({ rollbackTo: version.version! })}>
                  Roll back to this version
                </UiButton>
              </div>
            ))}
          </UiCardBody>
        </UiCard>
      )}

      {reasonOpen && (
        <UiDialog labelledBy={dialogTitleId} onClose={() => setReasonOpen(null)} style={{ maxWidth: 480, margin: "10vh auto", padding: 24 }}>
          <UiTypography as="h2" variant="section" id={dialogTitleId}>
            {reasonOpen === "publish" ? "Publish Approval Matrix" : `Roll back to version ${reasonOpen.rollbackTo}`}
          </UiTypography>
          <UiTypography>A reason is required and is recorded permanently against this version.</UiTypography>
          <UiTextarea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginTop: 12 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <UiButton variant="primary" busy={busy === "confirm"} busyLabel="Working…" disabled={reason.trim().length < 3} onClick={confirmReason}>
              Confirm
            </UiButton>
            <UiButton onClick={() => setReasonOpen(null)}>Cancel</UiButton>
          </div>
        </UiDialog>
      )}
    </div>
  );
}
