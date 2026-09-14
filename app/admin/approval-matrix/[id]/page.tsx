"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader as UiPageHeader, Alert as UiAlert, LoadingSpinner as UiSpinner } from "../../../components/ui";
import { AuthApiError, authApiGet, authApiPost } from "../../../lib/auth-api";
import { RuleForm } from "../_shared/RuleForm";
import { EMPTY_PAYLOAD, type ApprovalMatrixPayload, type ApprovalMatrixRule } from "../_shared/types";

export default function EditApprovalMatrixRulePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [rule, setRule] = useState<ApprovalMatrixRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      authApiGet<{ payload: ApprovalMatrixPayload }>("/admin/approval-matrix/active"),
      authApiGet<{ id: string | null; payload?: ApprovalMatrixPayload }>("/admin/approval-matrix/draft"),
    ])
      .then(([active, draft]) => {
        const payload = draft.id ? draft.payload! : active.payload ?? EMPTY_PAYLOAD;
        const found = payload.rules.find((r) => r.id === params.id);
        if (!found) throw new Error("Rule not found in the current draft or active matrix.");
        setRule(found);
      })
      .catch((cause) => setLoadError(cause instanceof AuthApiError ? cause.message : cause instanceof Error ? cause.message : "Could not load this rule."))
      .finally(() => setLoading(false));
  }, [params.id]);

  async function currentPayload(): Promise<ApprovalMatrixPayload> {
    const [active, draft] = await Promise.all([
      authApiGet<{ payload: ApprovalMatrixPayload }>("/admin/approval-matrix/active"),
      authApiGet<{ id: string | null; payload?: ApprovalMatrixPayload }>("/admin/approval-matrix/draft"),
    ]);
    return draft.id ? draft.payload! : active.payload ?? EMPTY_PAYLOAD;
  }

  async function onSubmit(updated: ApprovalMatrixRule) {
    setBusy(true);
    setError(null);
    try {
      const payload = await currentPayload();
      const rules = payload.rules.some((r) => r.id === updated.id)
        ? payload.rules.map((r) => (r.id === updated.id ? updated : r))
        : [...payload.rules, updated];
      await authApiPost("/admin/approval-matrix/draft", { payload: { ...payload, rules } });
      router.push("/admin/approval-matrix");
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not save this rule.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!rule) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await currentPayload();
      await authApiPost("/admin/approval-matrix/draft", { payload: { ...payload, rules: payload.rules.filter((r) => r.id !== rule.id) } });
      router.push("/admin/approval-matrix");
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not delete this rule.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div>
        <UiPageHeader title="Edit approval matrix rule" />
        <UiSpinner label="Loading rule…" />
      </div>
    );
  }

  if (loadError || !rule) {
    return (
      <div>
        <UiPageHeader title="Edit approval matrix rule" />
        <UiAlert tone="danger" title="Could not load this rule">
          {loadError ?? "Unknown error."}
        </UiAlert>
      </div>
    );
  }

  return (
    <div>
      <UiPageHeader title={`Edit rule: ${rule.name}`} description="Changes are written to the current draft. Publish the draft to make them effective." />
      <RuleForm initial={rule} busy={busy} error={error} onSubmit={onSubmit} onDelete={onDelete} />
    </div>
  );
}
