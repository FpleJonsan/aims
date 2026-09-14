"use client";

import { Input as UiInput, Typography as UiTypography, Card as UiCard, CardBody as UiCardBody } from "../../../components/ui";
import { ConfigurationEditor } from "../_shared/ConfigurationEditor";

type NumberingRule = {
  prefix: string;
  includeCompanyPrefix: boolean;
  companyPrefix: string | null;
  includeDepartmentPrefix: boolean;
  includeYear: boolean;
  includeMonth: boolean;
  sequenceLength: number;
  leadingZero: boolean;
  restartYearly: boolean;
  restartMonthly: boolean;
};
type NumberingConfig = { documentTypes: Record<string, NumberingRule> };

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  PAYMENT_REQUEST: "Payment Request",
  CLAIM: "Claim",
  APPROVAL: "Approval",
  PAYMENT: "Payment",
  SUPPORT: "Support",
};

function defaultRule(prefix: string): NumberingRule {
  return {
    prefix,
    includeCompanyPrefix: false,
    companyPrefix: null,
    includeDepartmentPrefix: false,
    includeYear: true,
    includeMonth: false,
    sequenceLength: 5,
    leadingZero: true,
    restartYearly: true,
    restartMonthly: false,
  };
}

const DEFAULT_VALUE: NumberingConfig = {
  documentTypes: { PAYMENT_REQUEST: defaultRule("PR"), CLAIM: defaultRule("CLM"), APPROVAL: defaultRule("APR"), PAYMENT: defaultRule("PAY"), SUPPORT: defaultRule("SUP") },
};

function previewNumber(rule: NumberingRule): string {
  const parts = [rule.includeCompanyPrefix ? rule.companyPrefix?.trim() || "CO" : null, rule.prefix, rule.includeYear ? "2026" : null, rule.includeMonth ? "09" : null];
  const sequence = (rule.leadingZero ? "1".padStart(rule.sequenceLength, "0") : "1").slice(-Math.max(rule.sequenceLength, 1));
  return [...parts.filter(Boolean), sequence].join("-");
}

export default function NumberingSettingsPage() {
  return (
    <ConfigurationEditor<NumberingConfig>
      category="numbering"
      title="Business Numbering"
      description="Configurable numbering rules per document type. Rules apply only to future records — historical numbers are never rewritten."
      defaultValue={DEFAULT_VALUE}
    >
      {({ value, setValue, disabled }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {Object.keys(DOCUMENT_TYPE_LABELS).map((type) => {
            const rule = value.documentTypes[type] ?? defaultRule("");
            function update(patch: Partial<NumberingRule>) {
              setValue((v) => ({ ...v, documentTypes: { ...v.documentTypes, [type]: { ...rule, ...patch } } }));
            }
            return (
              <UiCard key={type}>
                <UiCardBody>
                  <UiTypography as="h3" variant="card">
                    {DOCUMENT_TYPE_LABELS[type]}
                  </UiTypography>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
                    <UiInput label="Prefix" required disabled={disabled} value={rule.prefix} onChange={(e) => update({ prefix: e.target.value })} />
                    <UiInput label="Sequence length" type="number" disabled={disabled} value={rule.sequenceLength} onChange={(e) => update({ sequenceLength: Number(e.target.value) })} />
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="checkbox" disabled={disabled} checked={rule.includeCompanyPrefix} onChange={() => update({ includeCompanyPrefix: !rule.includeCompanyPrefix })} />
                      Company prefix
                    </label>
                    {rule.includeCompanyPrefix && (
                      <UiInput label="Company prefix" disabled={disabled} value={rule.companyPrefix ?? ""} onChange={(e) => update({ companyPrefix: e.target.value || null })} />
                    )}
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="checkbox" disabled={disabled} checked={rule.includeDepartmentPrefix} onChange={() => update({ includeDepartmentPrefix: !rule.includeDepartmentPrefix })} />
                      Department prefix
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="checkbox" disabled={disabled} checked={rule.includeYear} onChange={() => update({ includeYear: !rule.includeYear })} />
                      Year
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="checkbox" disabled={disabled} checked={rule.includeMonth} onChange={() => update({ includeMonth: !rule.includeMonth })} />
                      Month
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="checkbox" disabled={disabled} checked={rule.leadingZero} onChange={() => update({ leadingZero: !rule.leadingZero })} />
                      Leading zero
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="checkbox" disabled={disabled} checked={rule.restartYearly} onChange={() => update({ restartYearly: !rule.restartYearly })} />
                      Restart yearly
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="checkbox" disabled={disabled} checked={rule.restartMonthly} onChange={() => update({ restartMonthly: !rule.restartMonthly })} />
                      Restart monthly
                    </label>
                  </div>
                  <UiTypography variant="metadata" style={{ marginTop: 8 }}>
                    Example: {previewNumber(rule)}
                  </UiTypography>
                </UiCardBody>
              </UiCard>
            );
          })}
        </div>
      )}
    </ConfigurationEditor>
  );
}
