"use client";

import { Input as UiInput, Select as UiSelect, Alert as UiAlert, Typography as UiTypography } from "../../../components/ui";
import { ConfigurationEditor } from "../_shared/ConfigurationEditor";

type AiConfig = {
  enabled: boolean;
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKeyReference: string | null;
  validationAiEnabled: boolean;
  financialAnalysisAiEnabled: boolean;
  manualModeAlwaysAvailable: true;
};

const DEFAULT_VALUE: AiConfig = {
  enabled: false,
  provider: "openai-compatible",
  model: "gpt-5-mini",
  temperature: 0.2,
  maxTokens: 2000,
  apiKeyReference: "OPENAI_API_KEY",
  validationAiEnabled: false,
  financialAnalysisAiEnabled: false,
  manualModeAlwaysAvailable: true,
};

export default function AiSettingsPage() {
  return (
    <ConfigurationEditor<AiConfig> category="ai" title="AI Configuration" description="Business-facing AI preferences. Manual mode always remains available regardless of these settings." defaultValue={DEFAULT_VALUE}>
      {({ value, setValue, disabled }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <UiAlert tone="info">
            This stores the business-facing AI preference only. The API key itself is never entered here — only a reference to the server environment variable that
            holds it — and switching provider credentials still requires a deployment, consistent with how secrets are handled everywhere else in AIMS.
          </UiAlert>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" disabled={disabled} checked={value.enabled} onChange={() => setValue((v) => ({ ...v, enabled: !v.enabled }))} />
            AI enabled
          </label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <UiInput label="Provider" disabled={disabled} value={value.provider} onChange={(e) => setValue((v) => ({ ...v, provider: e.target.value }))} />
            <UiInput label="Model" disabled={disabled} value={value.model} onChange={(e) => setValue((v) => ({ ...v, model: e.target.value }))} />
            <UiInput label="Temperature" type="number" step="0.1" min="0" max="2" disabled={disabled} value={value.temperature} onChange={(e) => setValue((v) => ({ ...v, temperature: Number(e.target.value) }))} />
            <UiInput label="Max tokens" type="number" disabled={disabled} value={value.maxTokens} onChange={(e) => setValue((v) => ({ ...v, maxTokens: Number(e.target.value) }))} />
            <UiInput
              label="API key reference"
              helper="Name of the server environment variable, never the key itself"
              disabled={disabled}
              value={value.apiKeyReference ?? ""}
              onChange={(e) => setValue((v) => ({ ...v, apiKeyReference: e.target.value || null }))}
            />
          </div>
          <UiTypography variant="label">Feature enablement</UiTypography>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" disabled={disabled || !value.enabled} checked={value.validationAiEnabled} onChange={() => setValue((v) => ({ ...v, validationAiEnabled: !v.validationAiEnabled }))} />
            Validation AI
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              disabled={disabled || !value.enabled}
              checked={value.financialAnalysisAiEnabled}
              onChange={() => setValue((v) => ({ ...v, financialAnalysisAiEnabled: !v.financialAnalysisAiEnabled }))}
            />
            Financial Analysis AI
          </label>
          <UiSelect label="Manual mode" disabled value="always">
            <option value="always">Always available (cannot be disabled)</option>
          </UiSelect>
        </div>
      )}
    </ConfigurationEditor>
  );
}
