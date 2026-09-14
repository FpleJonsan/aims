"use client";

import { Input as UiInput, Select as UiSelect, Button as UiButton, Typography as UiTypography } from "../../../components/ui";
import { ConfigurationEditor } from "../_shared/ConfigurationEditor";
import { useMasterDataOptions } from "../_shared/useMasterDataOptions";

type RemarkTemplate = { code: string; text: string };
type FinanceConfig = {
  defaultDepartmentId: string | null;
  defaultCategoryId: string | null;
  defaultProjectId: string | null;
  defaultCurrencyId: string | null;
  defaultPaymentMethodId: string | null;
  budgetYear: number;
  budgetLockDate: string | null;
  financeCalendar: "CALENDAR_YEAR" | "CUSTOM";
  reminderDays: number;
  overdueGracePeriodDays: number;
  maximumClaimAmount: number;
  maximumPaymentAmount: number;
  maximumClaimItems: number;
  maximumAttachments: number;
  maximumAttachmentSizeMb: number;
  allowedAttachmentTypes: string[];
  financeRemarkTemplates: RemarkTemplate[];
};

const DEFAULT_VALUE: FinanceConfig = {
  defaultDepartmentId: null,
  defaultCategoryId: null,
  defaultProjectId: null,
  defaultCurrencyId: null,
  defaultPaymentMethodId: null,
  budgetYear: new Date().getUTCFullYear(),
  budgetLockDate: null,
  financeCalendar: "CALENDAR_YEAR",
  reminderDays: 3,
  overdueGracePeriodDays: 2,
  maximumClaimAmount: 10000,
  maximumPaymentAmount: 50000,
  maximumClaimItems: 20,
  maximumAttachments: 10,
  maximumAttachmentSizeMb: 10,
  allowedAttachmentTypes: ["pdf", "jpg", "jpeg", "png"],
  financeRemarkTemplates: [],
};

function MasterDataSelect({
  label,
  disabled,
  value,
  onChange,
  options,
}: {
  label: string;
  disabled: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
  options: { id: string; code: string; name: string }[];
}) {
  return (
    <UiSelect label={label} disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Select…</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name} ({option.code})
        </option>
      ))}
    </UiSelect>
  );
}

export default function FinanceSettingsPage() {
  const departments = useMasterDataOptions("departments");
  const categories = useMasterDataOptions("categories");
  const projects = useMasterDataOptions("projects");
  const currencies = useMasterDataOptions("currencies");
  const paymentMethods = useMasterDataOptions("payment-methods");

  return (
    <ConfigurationEditor<FinanceConfig> category="finance" title="Finance Settings" description="Defaults, limits, and remark templates used by finance workflows." defaultValue={DEFAULT_VALUE}>
      {({ value, setValue, disabled }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <UiTypography variant="label">Defaults (reused from Master Data)</UiTypography>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <MasterDataSelect label="Default department" disabled={disabled} value={value.defaultDepartmentId} onChange={(id) => setValue((v) => ({ ...v, defaultDepartmentId: id }))} options={departments} />
            <MasterDataSelect label="Default category" disabled={disabled} value={value.defaultCategoryId} onChange={(id) => setValue((v) => ({ ...v, defaultCategoryId: id }))} options={categories} />
            <MasterDataSelect label="Default project" disabled={disabled} value={value.defaultProjectId} onChange={(id) => setValue((v) => ({ ...v, defaultProjectId: id }))} options={projects} />
            <MasterDataSelect label="Default currency" disabled={disabled} value={value.defaultCurrencyId} onChange={(id) => setValue((v) => ({ ...v, defaultCurrencyId: id }))} options={currencies} />
            <MasterDataSelect label="Default payment method" disabled={disabled} value={value.defaultPaymentMethodId} onChange={(id) => setValue((v) => ({ ...v, defaultPaymentMethodId: id }))} options={paymentMethods} />
          </div>

          <UiTypography variant="label">Budget calendar</UiTypography>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <UiInput label="Budget year" type="number" disabled={disabled} value={value.budgetYear} onChange={(e) => setValue((v) => ({ ...v, budgetYear: Number(e.target.value) }))} />
            <UiInput label="Budget lock date" type="date" disabled={disabled} value={value.budgetLockDate ?? ""} onChange={(e) => setValue((v) => ({ ...v, budgetLockDate: e.target.value || null }))} />
            <UiSelect label="Finance calendar" disabled={disabled} value={value.financeCalendar} onChange={(e) => setValue((v) => ({ ...v, financeCalendar: e.target.value as "CALENDAR_YEAR" | "CUSTOM" }))}>
              <option value="CALENDAR_YEAR">Calendar year</option>
              <option value="CUSTOM">Custom</option>
            </UiSelect>
          </div>

          <UiTypography variant="label">Reminders and limits</UiTypography>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <UiInput label="Reminder days" type="number" disabled={disabled} value={value.reminderDays} onChange={(e) => setValue((v) => ({ ...v, reminderDays: Number(e.target.value) }))} />
            <UiInput label="Overdue grace period (days)" type="number" disabled={disabled} value={value.overdueGracePeriodDays} onChange={(e) => setValue((v) => ({ ...v, overdueGracePeriodDays: Number(e.target.value) }))} />
            <UiInput label="Maximum claim amount" type="number" disabled={disabled} value={value.maximumClaimAmount} onChange={(e) => setValue((v) => ({ ...v, maximumClaimAmount: Number(e.target.value) }))} />
            <UiInput label="Maximum payment amount" type="number" disabled={disabled} value={value.maximumPaymentAmount} onChange={(e) => setValue((v) => ({ ...v, maximumPaymentAmount: Number(e.target.value) }))} />
            <UiInput label="Maximum claim items" type="number" disabled={disabled} value={value.maximumClaimItems} onChange={(e) => setValue((v) => ({ ...v, maximumClaimItems: Number(e.target.value) }))} />
            <UiInput label="Maximum attachments" type="number" disabled={disabled} value={value.maximumAttachments} onChange={(e) => setValue((v) => ({ ...v, maximumAttachments: Number(e.target.value) }))} />
            <UiInput label="Maximum attachment size (MB)" type="number" disabled={disabled} value={value.maximumAttachmentSizeMb} onChange={(e) => setValue((v) => ({ ...v, maximumAttachmentSizeMb: Number(e.target.value) }))} />
            <UiInput
              label="Allowed attachment types"
              helper="Comma-separated, e.g. pdf,jpg,png"
              disabled={disabled}
              value={value.allowedAttachmentTypes.join(",")}
              onChange={(e) => setValue((v) => ({ ...v, allowedAttachmentTypes: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) }))}
            />
          </div>

          <UiTypography variant="label">Finance remark templates</UiTypography>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {value.financeRemarkTemplates.map((template, index) => (
              <div key={index} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <UiInput
                  label="Code"
                  disabled={disabled}
                  value={template.code}
                  onChange={(e) => setValue((v) => ({ ...v, financeRemarkTemplates: v.financeRemarkTemplates.map((t, i) => (i === index ? { ...t, code: e.target.value } : t)) }))}
                />
                <UiInput
                  label="Text"
                  disabled={disabled}
                  value={template.text}
                  onChange={(e) => setValue((v) => ({ ...v, financeRemarkTemplates: v.financeRemarkTemplates.map((t, i) => (i === index ? { ...t, text: e.target.value } : t)) }))}
                />
                <UiButton variant="danger" disabled={disabled} onClick={() => setValue((v) => ({ ...v, financeRemarkTemplates: v.financeRemarkTemplates.filter((_, i) => i !== index) }))}>
                  Remove
                </UiButton>
              </div>
            ))}
            <UiButton disabled={disabled} onClick={() => setValue((v) => ({ ...v, financeRemarkTemplates: [...v.financeRemarkTemplates, { code: "", text: "" }] }))}>
              Add template
            </UiButton>
          </div>
        </div>
      )}
    </ConfigurationEditor>
  );
}
