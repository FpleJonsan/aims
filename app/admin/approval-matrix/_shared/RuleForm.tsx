"use client";

import { useState } from "react";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  Input as UiInput,
  Select as UiSelect,
  Button as UiButton,
  Alert as UiAlert,
  Typography as UiTypography,
} from "../../../components/ui";
import { emptyStep, type ApprovalMatrixRule, type ApprovalMatrixStep, type StringMatch } from "./types";

function csv(values: string[] | undefined): string {
  return (values ?? []).join(", ");
}
function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function StepEditor({
  step,
  onChange,
  onRemove,
}: {
  step: ApprovalMatrixStep;
  onChange: (step: ApprovalMatrixStep) => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 8, display: "grid", gap: 8, gridTemplateColumns: "repeat(4, 1fr)" }}>
      <UiInput
        label="Sequence"
        type="number"
        value={step.sequence}
        onChange={(e) => onChange({ ...step, sequence: Number(e.target.value) || 1 })}
      />
      <UiInput
        label="Parallel group"
        helper="Steps sharing a sequence + group activate together."
        type="number"
        value={step.parallelGroup ?? ""}
        onChange={(e) => onChange({ ...step, parallelGroup: e.target.value === "" ? null : Number(e.target.value) })}
      />
      <UiInput
        label="Required approvals"
        helper="Blank = all steps in the group."
        type="number"
        value={step.requiredApprovals ?? ""}
        onChange={(e) => onChange({ ...step, requiredApprovals: e.target.value === "" ? null : Number(e.target.value) })}
      />
      <UiSelect
        label="Authority scope"
        value={step.authorityScope}
        onChange={(e) => onChange({ ...step, authorityScope: e.target.value as ApprovalMatrixStep["authorityScope"] })}
      >
        <option value="DEPARTMENT">Department</option>
        <option value="ORGANIZATION">Organization</option>
      </UiSelect>
      <UiInput label="Required role" required value={step.requiredRole} onChange={(e) => onChange({ ...step, requiredRole: e.target.value })} />
      <UiInput
        label="Min amount (minor units)"
        value={step.minimumAmountMinor ?? ""}
        onChange={(e) => onChange({ ...step, minimumAmountMinor: e.target.value || undefined })}
      />
      <UiInput
        label="Max amount (minor units)"
        value={step.maximumAmountMinor ?? ""}
        onChange={(e) => onChange({ ...step, maximumAmountMinor: e.target.value || undefined })}
      />
      <UiSelect label="Mandatory" value={step.mandatory ? "yes" : "no"} onChange={(e) => onChange({ ...step, mandatory: e.target.value === "yes" })}>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </UiSelect>
      <div style={{ gridColumn: "1 / -1" }}>
        <UiInput label="Reason" required value={step.reason} onChange={(e) => onChange({ ...step, reason: e.target.value })} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <UiButton onClick={onRemove}>Remove step</UiButton>
      </div>
    </div>
  );
}

function stringMatchEditor(
  label: string,
  value: StringMatch | undefined,
  onChange: (value: StringMatch | undefined) => void,
) {
  return (
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 2fr", alignItems: "end" }}>
      <UiSelect
        label={`${label} operator`}
        value={value?.op ?? ""}
        onChange={(e) => {
          const op = e.target.value as StringMatch["op"] | "";
          if (!op) return onChange(undefined);
          onChange({ op, values: value?.values ?? [] });
        }}
      >
        <option value="">Not filtered</option>
        <option value="EQUALS">Equals</option>
        <option value="CONTAINS">Contains</option>
        <option value="STARTS_WITH">Starts with</option>
        <option value="ENDS_WITH">Ends with</option>
      </UiSelect>
      <UiInput
        label={`${label} values (comma separated)`}
        disabled={!value}
        value={csv(value?.values)}
        onChange={(e) => value && onChange({ ...value, values: parseCsv(e.target.value) })}
      />
    </div>
  );
}

export function RuleForm({
  initial,
  busy,
  error,
  onSubmit,
  onDelete,
}: {
  initial: ApprovalMatrixRule;
  busy: boolean;
  error: string | null;
  onSubmit: (rule: ApprovalMatrixRule) => void;
  onDelete?: () => void;
}) {
  const [rule, setRule] = useState<ApprovalMatrixRule>(initial);

  function update<K extends keyof ApprovalMatrixRule>(key: K, value: ApprovalMatrixRule[K]) {
    setRule((prev) => ({ ...prev, [key]: value }));
  }
  function updateConditions<K extends keyof ApprovalMatrixRule["conditions"]>(key: K, value: ApprovalMatrixRule["conditions"][K]) {
    setRule((prev) => ({ ...prev, conditions: { ...prev.conditions, [key]: value } }));
  }

  return (
    <UiCard style={{ maxWidth: 900 }}>
      <UiCardBody>
        {error && (
          <UiAlert tone="danger" title="Could not save this rule" style={{ marginBottom: 16 }}>
            {error}
          </UiAlert>
        )}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, 1fr)" }}>
          <UiInput label="Code" required value={rule.code} onChange={(e) => update("code", e.target.value)} />
          <UiInput label="Name" required value={rule.name} onChange={(e) => update("name", e.target.value)} />
          <UiInput label="Priority" helper="Lower number wins first." type="number" value={rule.priority} onChange={(e) => update("priority", Number(e.target.value) || 0)} />
          <UiSelect label="Condition logic" value={rule.conditionLogic} onChange={(e) => update("conditionLogic", e.target.value as "ALL" | "ANY")}>
            <option value="ALL">Match ALL set conditions (AND)</option>
            <option value="ANY">Match ANY set condition (OR)</option>
          </UiSelect>
          <UiSelect label="Active" value={rule.active ? "yes" : "no"} onChange={(e) => update("active", e.target.value === "yes")}>
            <option value="yes">Active</option>
            <option value="no">Disabled</option>
          </UiSelect>
          <UiSelect label="Fallback rule" helper="Used only when no other active rule matches." value={rule.isFallback ? "yes" : "no"} onChange={(e) => update("isFallback", e.target.value === "yes")}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </UiSelect>
          <UiInput label="Effective from" type="date" required value={rule.effectiveFrom} onChange={(e) => update("effectiveFrom", e.target.value)} />
          <UiInput label="Effective to" type="date" helper="Blank = no expiry." value={rule.effectiveTo ?? ""} onChange={(e) => update("effectiveTo", e.target.value || null)} />
          <UiSelect label="Finance review required" value={rule.financeReviewRequired ? "yes" : "no"} onChange={(e) => update("financeReviewRequired", e.target.value === "yes")}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </UiSelect>
          <UiSelect label="AI analysis required" value={rule.aiAnalysisRequired ? "yes" : "no"} onChange={(e) => update("aiAnalysisRequired", e.target.value === "yes")}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </UiSelect>
        </div>

        <UiTypography as="h3" variant="card" style={{ marginTop: 20 }}>
          Conditions
        </UiTypography>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, 1fr)", marginTop: 8 }}>
          <UiInput label="Department IDs (comma separated)" value={csv(rule.conditions.departmentIds)} onChange={(e) => updateConditions("departmentIds", parseCsv(e.target.value))} />
          <UiInput label="Project IDs (comma separated)" value={csv(rule.conditions.projectIds)} onChange={(e) => updateConditions("projectIds", parseCsv(e.target.value))} />
          <UiInput label="Currencies (comma separated, e.g. MYR, USD)" value={csv(rule.conditions.currencies)} onChange={(e) => updateConditions("currencies", parseCsv(e.target.value))} />
          <UiInput
            label="Risk levels (comma separated: LOW, MEDIUM, HIGH, CRITICAL)"
            value={csv(rule.conditions.riskLevels)}
            onChange={(e) => updateConditions("riskLevels", parseCsv(e.target.value) as never)}
          />
          <UiInput
            label="Priorities (comma separated: LOW, NORMAL, HIGH, URGENT)"
            value={csv(rule.conditions.priorities)}
            onChange={(e) => updateConditions("priorities", parseCsv(e.target.value) as never)}
          />
          <UiInput label="Amount min (minor units)" value={rule.conditions.amountMinorMin ?? ""} onChange={(e) => updateConditions("amountMinorMin", e.target.value || undefined)} />
          <UiInput label="Amount max (minor units)" value={rule.conditions.amountMinorMax ?? ""} onChange={(e) => updateConditions("amountMinorMax", e.target.value || undefined)} />
          <UiInput label="Claim count min" type="number" value={rule.conditions.claimCountMin ?? ""} onChange={(e) => updateConditions("claimCountMin", e.target.value === "" ? undefined : Number(e.target.value))} />
          <UiInput label="Claim count max" type="number" value={rule.conditions.claimCountMax ?? ""} onChange={(e) => updateConditions("claimCountMax", e.target.value === "" ? undefined : Number(e.target.value))} />
        </div>
        <div style={{ marginTop: 12 }}>{stringMatchEditor("Category", rule.conditions.categories, (v) => updateConditions("categories", v))}</div>
        <div style={{ marginTop: 12 }}>{stringMatchEditor("Payment type", rule.conditions.paymentTypes, (v) => updateConditions("paymentTypes", v))}</div>

        <UiTypography as="h3" variant="card" style={{ marginTop: 20 }}>
          Approval steps
        </UiTypography>
        {rule.steps.map((step, index) => (
          <StepEditor
            key={index}
            step={step}
            onChange={(next) => update("steps", rule.steps.map((s, i) => (i === index ? next : s)))}
            onRemove={() => update("steps", rule.steps.filter((_, i) => i !== index))}
          />
        ))}
        <UiButton
          onClick={() => update("steps", [...rule.steps, emptyStep((rule.steps.at(-1)?.sequence ?? 0) + 1)])}
          style={{ marginBottom: 16 }}
        >
          Add step
        </UiButton>

        <div style={{ display: "flex", gap: 8 }}>
          <UiButton variant="primary" busy={busy} busyLabel="Saving…" onClick={() => onSubmit(rule)}>
            Save rule to draft
          </UiButton>
          {onDelete && <UiButton onClick={onDelete}>Delete rule</UiButton>}
        </div>
      </UiCardBody>
    </UiCard>
  );
}
