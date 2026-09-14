"use client";

import { Input as UiInput, Select as UiSelect, Button as UiButton, Typography as UiTypography } from "../../../components/ui";
import { ConfigurationEditor } from "../_shared/ConfigurationEditor";
import { useMasterDataOptions } from "../_shared/useMasterDataOptions";

type PublicHoliday = { date: string; name: string };
type CompanyConfig = {
  companyName: string;
  companyLogoUrl: string | null;
  companyAddress: string;
  registrationNumber: string;
  taxNumber: string;
  timezone: string;
  language: string;
  workingDays: number[];
  publicHolidays: PublicHoliday[];
  financialYearStartMonth: number;
  defaultCurrencyId: string | null;
};

const DEFAULT_VALUE: CompanyConfig = {
  companyName: "",
  companyLogoUrl: null,
  companyAddress: "",
  registrationNumber: "",
  taxNumber: "",
  timezone: "Asia/Kuala_Lumpur",
  language: "en",
  workingDays: [1, 2, 3, 4, 5],
  publicHolidays: [],
  financialYearStartMonth: 1,
  defaultCurrencyId: null,
};

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export default function CompanySettingsPage() {
  const currencies = useMasterDataOptions("currencies");
  return (
    <ConfigurationEditor<CompanyConfig> category="company" title="Company Settings" description="Enterprise identity, locale, and calendar used across AIMS." defaultValue={DEFAULT_VALUE}>
      {({ value, setValue, disabled }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <UiInput label="Company name" required disabled={disabled} value={value.companyName} onChange={(e) => setValue((v) => ({ ...v, companyName: e.target.value }))} />
            <UiInput label="Company logo URL" disabled={disabled} value={value.companyLogoUrl ?? ""} onChange={(e) => setValue((v) => ({ ...v, companyLogoUrl: e.target.value || null }))} />
          </div>
          <UiInput label="Company address" required disabled={disabled} value={value.companyAddress} onChange={(e) => setValue((v) => ({ ...v, companyAddress: e.target.value }))} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <UiInput label="Registration number" required disabled={disabled} value={value.registrationNumber} onChange={(e) => setValue((v) => ({ ...v, registrationNumber: e.target.value }))} />
            <UiInput label="Tax number" required disabled={disabled} value={value.taxNumber} onChange={(e) => setValue((v) => ({ ...v, taxNumber: e.target.value }))} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <UiInput label="Timezone" helper="IANA timezone, e.g. Asia/Kuala_Lumpur" required disabled={disabled} value={value.timezone} onChange={(e) => setValue((v) => ({ ...v, timezone: e.target.value }))} />
            <UiInput label="Language" required disabled={disabled} value={value.language} onChange={(e) => setValue((v) => ({ ...v, language: e.target.value }))} />
            <UiSelect label="Financial year starts" disabled={disabled} value={value.financialYearStartMonth} onChange={(e) => setValue((v) => ({ ...v, financialYearStartMonth: Number(e.target.value) }))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                <option key={month} value={month}>
                  Month {month}
                </option>
              ))}
            </UiSelect>
            <UiSelect label="Default currency" required disabled={disabled} value={value.defaultCurrencyId ?? ""} onChange={(e) => setValue((v) => ({ ...v, defaultCurrencyId: e.target.value || null }))}>
              <option value="">Select…</option>
              {currencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </UiSelect>
          </div>

          <UiTypography variant="label">Working days</UiTypography>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {WEEKDAYS.map((day) => (
              <label key={day.value} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={value.workingDays.includes(day.value)}
                  onChange={() =>
                    setValue((v) => ({
                      ...v,
                      workingDays: v.workingDays.includes(day.value) ? v.workingDays.filter((d) => d !== day.value) : [...v.workingDays, day.value].sort(),
                    }))
                  }
                />
                {day.label}
              </label>
            ))}
          </div>

          <UiTypography variant="label">Public holidays</UiTypography>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {value.publicHolidays.map((holiday, index) => (
              <div key={index} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <UiInput
                  label="Date"
                  type="date"
                  disabled={disabled}
                  value={holiday.date}
                  onChange={(e) =>
                    setValue((v) => ({ ...v, publicHolidays: v.publicHolidays.map((h, i) => (i === index ? { ...h, date: e.target.value } : h)) }))
                  }
                />
                <UiInput
                  label="Name"
                  disabled={disabled}
                  value={holiday.name}
                  onChange={(e) => setValue((v) => ({ ...v, publicHolidays: v.publicHolidays.map((h, i) => (i === index ? { ...h, name: e.target.value } : h)) }))}
                />
                <UiButton variant="danger" disabled={disabled} onClick={() => setValue((v) => ({ ...v, publicHolidays: v.publicHolidays.filter((_, i) => i !== index) }))}>
                  Remove
                </UiButton>
              </div>
            ))}
            <UiButton disabled={disabled} onClick={() => setValue((v) => ({ ...v, publicHolidays: [...v.publicHolidays, { date: "", name: "" }] }))}>
              Add holiday
            </UiButton>
          </div>
        </div>
      )}
    </ConfigurationEditor>
  );
}
