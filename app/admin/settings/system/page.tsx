"use client";

import { Input as UiInput } from "../../../components/ui";
import { ConfigurationEditor } from "../_shared/ConfigurationEditor";

type SystemConfig = {
  dashboardRefreshIntervalSeconds: number;
  reminderIntervalMinutes: number;
  overdueThresholdDays: number;
  aiEnabled: boolean;
  telegramEnabled: boolean;
  maximumUploadSizeMb: number;
  maximumUploadCount: number;
  allowedFileTypes: string[];
  sessionTimeoutMinutes: number;
};

const DEFAULT_VALUE: SystemConfig = {
  dashboardRefreshIntervalSeconds: 60,
  reminderIntervalMinutes: 60,
  overdueThresholdDays: 5,
  aiEnabled: false,
  telegramEnabled: false,
  maximumUploadSizeMb: 10,
  maximumUploadCount: 10,
  allowedFileTypes: ["pdf", "jpg", "jpeg", "png"],
  sessionTimeoutMinutes: 30,
};

export default function SystemParametersPage() {
  return (
    <ConfigurationEditor<SystemConfig> category="system" title="System Parameters" description="Operational limits and feature kill switches shared across AIMS." defaultValue={DEFAULT_VALUE}>
      {({ value, setValue, disabled }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <UiInput
              label="Dashboard refresh interval (s)"
              type="number"
              disabled={disabled}
              value={value.dashboardRefreshIntervalSeconds}
              onChange={(e) => setValue((v) => ({ ...v, dashboardRefreshIntervalSeconds: Number(e.target.value) }))}
            />
            <UiInput label="Reminder interval (min)" type="number" disabled={disabled} value={value.reminderIntervalMinutes} onChange={(e) => setValue((v) => ({ ...v, reminderIntervalMinutes: Number(e.target.value) }))} />
            <UiInput label="Overdue threshold (days)" type="number" disabled={disabled} value={value.overdueThresholdDays} onChange={(e) => setValue((v) => ({ ...v, overdueThresholdDays: Number(e.target.value) }))} />
            <UiInput label="Session timeout (min)" type="number" disabled={disabled} value={value.sessionTimeoutMinutes} onChange={(e) => setValue((v) => ({ ...v, sessionTimeoutMinutes: Number(e.target.value) }))} />
            <UiInput label="Maximum upload size (MB)" type="number" disabled={disabled} value={value.maximumUploadSizeMb} onChange={(e) => setValue((v) => ({ ...v, maximumUploadSizeMb: Number(e.target.value) }))} />
            <UiInput label="Maximum upload count" type="number" disabled={disabled} value={value.maximumUploadCount} onChange={(e) => setValue((v) => ({ ...v, maximumUploadCount: Number(e.target.value) }))} />
            <UiInput
              label="Allowed file types"
              helper="Comma-separated, e.g. pdf,jpg,png"
              disabled={disabled}
              value={value.allowedFileTypes.join(",")}
              onChange={(e) => setValue((v) => ({ ...v, allowedFileTypes: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) }))}
            />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" disabled={disabled} checked={value.aiEnabled} onChange={() => setValue((v) => ({ ...v, aiEnabled: !v.aiEnabled }))} />
            AI enabled (system-level kill switch)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" disabled={disabled} checked={value.telegramEnabled} onChange={() => setValue((v) => ({ ...v, telegramEnabled: !v.telegramEnabled }))} />
            Telegram enabled (system-level kill switch)
          </label>
        </div>
      )}
    </ConfigurationEditor>
  );
}
