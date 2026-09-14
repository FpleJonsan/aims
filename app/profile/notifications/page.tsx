"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  UIProvider as UiProvider,
  Card as UiCard,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  Button as UiButton,
  Alert as UiAlert,
  LoadingSpinner as UiSpinner,
  Typography as UiTypography,
} from "../../components/ui";
import { AuthApiError, authApiGet, authApiPut } from "../../lib/auth-api";

type Preference = { channel: string; enabled: boolean; mutedUntil: string | null };

const CHANNEL_LABELS: Record<string, string> = { TELEGRAM: "Telegram" };

export default function NotificationPreferencesPage() {
  const [items, setItems] = useState<Preference[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyChannel, setBusyChannel] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    authApiGet<Preference[]>("/profile/notifications")
      .then((data) => {
        setItems(data);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load your notification preferences."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function save(channel: string, next: { enabled: boolean; mutedUntil: string | null }) {
    setBusyChannel(channel);
    setError(null);
    setNotice(null);
    try {
      await authApiPut(`/profile/notifications/${channel}`, next);
      setItems((current) => (current ? current.map((p) => (p.channel === channel ? { ...p, ...next } : p)) : current));
      setNotice("Preference saved.");
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not save this preference.");
    } finally {
      setBusyChannel(null);
    }
  }

  return (
    <UiProvider style={{ maxWidth: 640, margin: "48px auto", padding: 16 }}>
      <UiPageHeader
        title="Notification preferences"
        description="Control which channels notify you, or mute one temporarily."
        actions={<Link href="/profile/telegram">Telegram binding</Link>}
      />
      {error && (
        <UiAlert tone="danger" title="Action failed" style={{ marginBottom: 16 }}>
          {error}
        </UiAlert>
      )}
      {notice && (
        <UiAlert tone="success" title="Done" style={{ marginBottom: 16 }}>
          {notice}
        </UiAlert>
      )}
      {loading && <UiSpinner label="Loading preferences…" />}
      {!loading && items && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((item) => {
            const muted = Boolean(item.mutedUntil && new Date(item.mutedUntil) > new Date());
            return (
              <UiCard key={item.channel}>
                <UiCardBody>
                  <UiTypography as="h2" variant="section" style={{ marginBottom: 8 }}>
                    {CHANNEL_LABELS[item.channel] ?? item.channel}
                  </UiTypography>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      disabled={busyChannel === item.channel}
                      onChange={() => save(item.channel, { enabled: !item.enabled, mutedUntil: item.mutedUntil })}
                    />
                    Notify me on {CHANNEL_LABELS[item.channel] ?? item.channel}
                  </label>
                  {muted && (
                    <p>
                      Muted until {new Date(item.mutedUntil!).toLocaleString()}.{" "}
                      <UiButton disabled={busyChannel === item.channel} onClick={() => save(item.channel, { enabled: item.enabled, mutedUntil: null })}>
                        Unmute now
                      </UiButton>
                    </p>
                  )}
                  {!muted && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <UiButton
                        disabled={busyChannel === item.channel || !item.enabled}
                        onClick={() => save(item.channel, { enabled: item.enabled, mutedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })}
                      >
                        Mute for 24 hours
                      </UiButton>
                    </div>
                  )}
                </UiCardBody>
              </UiCard>
            );
          })}
        </div>
      )}
    </UiProvider>
  );
}
