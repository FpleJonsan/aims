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
  Badge as UiBadge,
  LoadingSpinner as UiSpinner,
} from "../../components/ui";
import { AuthApiError, authApiDelete, authApiGet, authApiPost } from "../../lib/auth-api";

type BindingStatus = { status: "ACTIVE" | "NOT_BOUND"; boundAt: string | null };
type Challenge = { challenge: string; expiresAt: string };

export default function TelegramBindingPage() {
  const [status, setStatus] = useState<BindingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    authApiGet<BindingStatus>("/profile/telegram")
      .then((data) => {
        setStatus(data);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load your Telegram binding status."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function generateChallenge() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await authApiPost<Challenge>("/profile/telegram/challenge");
      setChallenge(result);
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not generate a binding code.");
    } finally {
      setBusy(false);
    }
  }

  async function unbind() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await authApiDelete("/profile/telegram");
      setNotice("Telegram unbound.");
      setChallenge(null);
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not unbind Telegram.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiProvider style={{ maxWidth: 640, margin: "48px auto", padding: 16 }}>
      <UiPageHeader
        title="Telegram"
        description="Bind your Telegram account to receive approval requests, status updates, and other AIMS notifications there."
        actions={<Link href="/profile/notifications">Notification preferences</Link>}
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
      {loading && <UiSpinner label="Checking your Telegram binding…" />}
      {!loading && status && (
        <UiCard>
          <UiCardBody>
            <div style={{ marginBottom: 12 }}>
              <UiBadge tone={status.status === "ACTIVE" ? "success" : "neutral"}>
                {status.status === "ACTIVE" ? "Bound" : "Not bound"}
              </UiBadge>
              {status.status === "ACTIVE" && status.boundAt && (
                <span style={{ marginLeft: 8, color: "#666" }}>since {new Date(status.boundAt).toLocaleString()}</span>
              )}
            </div>

            {status.status === "ACTIVE" && (
              <>
                <p>Your account is bound to Telegram. Unbind to stop receiving messages there, or to rebind a different Telegram account.</p>
                <UiButton variant="danger" busy={busy} busyLabel="Unbinding…" onClick={unbind}>
                  Unbind Telegram
                </UiButton>
              </>
            )}

            {status.status === "NOT_BOUND" && !challenge && (
              <>
                <p>Generate a one-time binding code, then send it to the AIMS Telegram bot from a private chat.</p>
                <UiButton variant="primary" busy={busy} busyLabel="Generating…" onClick={generateChallenge}>
                  Generate binding code
                </UiButton>
              </>
            )}

            {challenge && (
              <div style={{ marginTop: 8 }}>
                <p>Open a private chat with the AIMS Telegram bot and send exactly:</p>
                <pre style={{ background: "#f5f5f5", padding: 12, borderRadius: 4, overflowX: "auto" }}>{challenge.challenge}</pre>
                <p style={{ color: "#666" }}>Expires at {new Date(challenge.expiresAt).toLocaleString()}.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <UiButton onClick={load}>I&apos;ve sent it — check status</UiButton>
                  <UiButton busy={busy} busyLabel="Generating…" onClick={generateChallenge}>
                    Generate a new code
                  </UiButton>
                </div>
              </div>
            )}
          </UiCardBody>
        </UiCard>
      )}
    </UiProvider>
  );
}
