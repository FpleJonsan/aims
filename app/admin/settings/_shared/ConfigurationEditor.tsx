"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
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
} from "../../../components/ui";
import { AuthApiError, authApiGet, authApiPost, authApiPut } from "../../../lib/auth-api";

type ActiveConfiguration<T> = { category: string; version: number; payload: T; reason: string | null; publishedAt: string | null };
type DraftConfiguration<T> = { id: string; payload: T; updatedAt: string } | null;
type PreviewResult<T> = { currentValue: T; newValue: T; changedFields: string[]; nextVersion: number; validationErrors: string[]; canPublish: boolean };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Module 7/8/9/10/11 — the one shared Draft -> Validate -> Preview -> Publish
 * -> Version engine for every Business Configuration settings page. Field
 * layout differs per category (Company, Finance, Numbering, AI,
 * Notifications, System), so this component takes the form body as a render
 * prop instead of a declarative schema — exactly the boundary MasterData's
 * single generic manager draws too: the CRUD/versioning mechanics are never
 * duplicated, only the presentation of six genuinely different field sets.
 */
export function ConfigurationEditor<T extends Record<string, unknown>>({
  category,
  title,
  description,
  defaultValue,
  children,
}: {
  category: string;
  title: string;
  description: string;
  defaultValue: T;
  children: (props: { value: T; setValue: (updater: (value: T) => T) => void; disabled: boolean }) => ReactNode;
}) {
  const apiPath = `/admin/configuration/${category}`;
  const [active, setActive] = useState<ActiveConfiguration<T> | null>(null);
  const [draftValue, setDraftValue] = useState<T>(defaultValue);
  const [hasDraft, setHasDraft] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "discard" | "preview" | "publish" | null>(null);
  const [preview, setPreview] = useState<PreviewResult<T> | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const dialogTitleId = useId();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([authApiGet<ActiveConfiguration<T>>(apiPath), authApiGet<{ draft: DraftConfiguration<T> }>(`${apiPath}/draft`)])
      .then(([activeConfig, { draft }]) => {
        setActive(activeConfig);
        setHasDraft(Boolean(draft));
        setDraftValue(draft ? draft.payload : clone(activeConfig.payload));
        setError(null);
        setPreview(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : `Could not load ${title.toLowerCase()}.`))
      .finally(() => setLoading(false));
  }, [apiPath, title]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function setValue(updater: (value: T) => T) {
    setDraftValue((previous) => updater(previous));
    setPreview(null);
  }

  async function saveDraft() {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      await authApiPut(`${apiPath}/draft`, { payload: draftValue });
      setNotice("Draft saved.");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not save this draft.");
    } finally {
      setBusy(null);
    }
  }

  async function discardDraft() {
    setBusy("discard");
    setError(null);
    setNotice(null);
    try {
      await authApiPost(`${apiPath}/draft/discard`);
      setNotice("Draft discarded.");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not discard this draft.");
    } finally {
      setBusy(null);
    }
  }

  async function runPreview() {
    setBusy("preview");
    setError(null);
    try {
      const result = await authApiGet<PreviewResult<T>>(`${apiPath}/preview`);
      setPreview(result);
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not build a preview. Save the draft first.");
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy("publish");
    setError(null);
    setNotice(null);
    try {
      await authApiPost(`${apiPath}/publish`, { reason });
      setReasonOpen(false);
      setReason("");
      setNotice("Configuration published.");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not publish this configuration.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div>
        <UiPageHeader title={title} description={description} />
        <UiSpinner label={`Loading ${title.toLowerCase()}…`} />
      </div>
    );
  }

  return (
    <div>
      <UiPageHeader
        title={title}
        description={description}
        actions={
          <Link href={`/admin/settings/version-history?category=${category}`}>
            <UiButton>Version history</UiButton>
          </Link>
        }
      />

      {error && <UiAlert tone="danger" title="Action failed" style={{ marginBottom: 16 }}>{error}</UiAlert>}
      {notice && <UiAlert tone="success" title="Done" style={{ marginBottom: 16 }}>{notice}</UiAlert>}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <UiBadge tone="neutral">Active version: {active?.version ?? 0}</UiBadge>
        {hasDraft && <UiBadge tone="warning">Unpublished draft</UiBadge>}
      </div>

      <UiCard style={{ marginBottom: 16 }}>
        <UiCardBody>{children({ value: draftValue, setValue, disabled: busy !== null })}</UiCardBody>
        <UiCardFooter style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <UiButton variant="primary" busy={busy === "save"} busyLabel="Saving…" onClick={saveDraft}>
            Save draft
          </UiButton>
          <UiButton busy={busy === "discard"} busyLabel="Discarding…" disabled={!hasDraft} onClick={discardDraft}>
            Discard draft
          </UiButton>
          <UiButton busy={busy === "preview"} busyLabel="Building preview…" disabled={!hasDraft} onClick={runPreview}>
            Preview
          </UiButton>
          <UiButton variant="primary" disabled={!hasDraft} onClick={() => setReasonOpen(true)}>
            Publish…
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
              <UiAlert tone="success" title="Valid">This draft can be published.</UiAlert>
            )}
            <UiTypography variant="label" style={{ marginTop: 12 }}>
              Changed fields: {preview.changedFields.length ? preview.changedFields.join(", ") : "none"}
            </UiTypography>
          </UiCardBody>
        </UiCard>
      )}

      {reasonOpen && (
        <UiDialog labelledBy={dialogTitleId} onClose={() => setReasonOpen(false)} className="aims-dialog-surface" style={{ maxWidth: 480, margin: "10vh auto", padding: 24 }}>
          <UiTypography as="h2" variant="section" id={dialogTitleId}>
            Publish {title}
          </UiTypography>
          <UiTypography>A reason is required and is recorded permanently against this version.</UiTypography>
          <UiTextarea label="Reason for this change" required value={reason} onChange={(event) => setReason(event.target.value)} style={{ marginTop: 12 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <UiButton variant="primary" busy={busy === "publish"} busyLabel="Publishing…" disabled={reason.trim().length < 3} onClick={publish}>
              Confirm publish
            </UiButton>
            <UiButton onClick={() => setReasonOpen(false)}>Cancel</UiButton>
          </div>
        </UiDialog>
      )}
    </div>
  );
}
