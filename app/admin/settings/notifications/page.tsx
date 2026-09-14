"use client";

import { Input as UiInput, Select as UiSelect, Button as UiButton, Alert as UiAlert, Typography as UiTypography } from "../../../components/ui";
import { ConfigurationEditor } from "../_shared/ConfigurationEditor";

type NotificationTemplate = { code: string; channel: string; text: string };
type NotificationConfig = {
  telegramEnabled: boolean;
  telegramReminderEnabled: boolean;
  telegramEscalationEnabled: boolean;
  notificationTemplates: NotificationTemplate[];
  reminderFrequencyHours: number;
  escalationTimingHours: number;
};

const DEFAULT_VALUE: NotificationConfig = {
  telegramEnabled: false,
  telegramReminderEnabled: false,
  telegramEscalationEnabled: false,
  notificationTemplates: [],
  reminderFrequencyHours: 24,
  escalationTimingHours: 72,
};

export default function NotificationSettingsPage() {
  return (
    <ConfigurationEditor<NotificationConfig>
      category="notifications"
      title="Notification Settings"
      description="Telegram reminders and escalation timing. Email and in-app notification channels are not yet implemented."
      defaultValue={DEFAULT_VALUE}
    >
      {({ value, setValue, disabled }) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <UiAlert tone="info">Email and in-app notifications are out of scope for this phase; only Telegram is configurable today.</UiAlert>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" disabled={disabled} checked={value.telegramEnabled} onChange={() => setValue((v) => ({ ...v, telegramEnabled: !v.telegramEnabled }))} />
            Telegram enabled
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              disabled={disabled || !value.telegramEnabled}
              checked={value.telegramReminderEnabled}
              onChange={() => setValue((v) => ({ ...v, telegramReminderEnabled: !v.telegramReminderEnabled }))}
            />
            Telegram reminders
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              disabled={disabled || !value.telegramEnabled}
              checked={value.telegramEscalationEnabled}
              onChange={() => setValue((v) => ({ ...v, telegramEscalationEnabled: !v.telegramEscalationEnabled }))}
            />
            Telegram escalation
          </label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <UiInput label="Reminder frequency (hours)" type="number" disabled={disabled} value={value.reminderFrequencyHours} onChange={(e) => setValue((v) => ({ ...v, reminderFrequencyHours: Number(e.target.value) }))} />
            <UiInput label="Escalation timing (hours)" type="number" disabled={disabled} value={value.escalationTimingHours} onChange={(e) => setValue((v) => ({ ...v, escalationTimingHours: Number(e.target.value) }))} />
          </div>

          <UiTypography variant="label">Notification templates</UiTypography>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {value.notificationTemplates.map((template, index) => (
              <div key={index} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <UiInput
                  label="Code"
                  disabled={disabled}
                  value={template.code}
                  onChange={(e) => setValue((v) => ({ ...v, notificationTemplates: v.notificationTemplates.map((t, i) => (i === index ? { ...t, code: e.target.value } : t)) }))}
                />
                <UiSelect
                  label="Channel"
                  disabled={disabled}
                  value={template.channel}
                  onChange={(e) => setValue((v) => ({ ...v, notificationTemplates: v.notificationTemplates.map((t, i) => (i === index ? { ...t, channel: e.target.value } : t)) }))}
                >
                  <option value="TELEGRAM">Telegram</option>
                </UiSelect>
                <UiInput
                  label="Text"
                  disabled={disabled}
                  value={template.text}
                  onChange={(e) => setValue((v) => ({ ...v, notificationTemplates: v.notificationTemplates.map((t, i) => (i === index ? { ...t, text: e.target.value } : t)) }))}
                />
                <UiButton variant="danger" disabled={disabled} onClick={() => setValue((v) => ({ ...v, notificationTemplates: v.notificationTemplates.filter((_, i) => i !== index) }))}>
                  Remove
                </UiButton>
              </div>
            ))}
            <UiButton disabled={disabled} onClick={() => setValue((v) => ({ ...v, notificationTemplates: [...v.notificationTemplates, { code: "", channel: "TELEGRAM", text: "" }] }))}>
              Add template
            </UiButton>
          </div>
        </div>
      )}
    </ConfigurationEditor>
  );
}
