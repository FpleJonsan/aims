"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader as UiPageHeader } from "../../../components/ui";
import { AuthApiError, authApiGet, authApiPost } from "../../../lib/auth-api";
import { RuleForm } from "../_shared/RuleForm";
import { EMPTY_PAYLOAD, emptyRule, type ApprovalMatrixPayload, type ApprovalMatrixRule } from "../_shared/types";

export default function CreateApprovalMatrixRulePage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(rule: ApprovalMatrixRule) {
    setBusy(true);
    setError(null);
    try {
      const [active, draft] = await Promise.all([
        authApiGet<{ payload: ApprovalMatrixPayload }>("/admin/approval-matrix/active"),
        authApiGet<{ id: string | null; payload?: ApprovalMatrixPayload }>("/admin/approval-matrix/draft"),
      ]);
      const basePayload = draft.id ? draft.payload! : active.payload ?? EMPTY_PAYLOAD;
      if (basePayload.rules.some((r) => r.code === rule.code)) throw new Error(`A rule with code "${rule.code}" already exists.`);
      const payload = { ...basePayload, rules: [...basePayload.rules, rule] };
      await authApiPost("/admin/approval-matrix/draft", { payload });
      router.push("/admin/approval-matrix");
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : cause instanceof Error ? cause.message : "Could not create this rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <UiPageHeader title="Create approval matrix rule" description="Added to the current draft. Publish the draft to make it effective." />
      <RuleForm initial={emptyRule()} busy={busy} error={error} onSubmit={onSubmit} />
    </div>
  );
}
