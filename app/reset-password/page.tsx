"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  UIProvider as UiProvider,
  Card as UiCard,
  CardBody as UiCardBody,
  CardFooter as UiCardFooter,
  Input as UiInput,
  Button as UiButton,
  Alert as UiAlert,
  PageHeader as UiPageHeader,
  Typography as UiTypography,
} from "../components/ui";
import { AuthApiError, authApiPost } from "../lib/auth-api";

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await authApiPost("/auth/password/reset-password", { token, newPassword });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Reset failed. The link may have expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiProvider className="aims-auth-page">
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 16px" }}>
        <UiPageHeader title="Reset password" description="Choose a new password for your account." />
        <UiCard>
          <UiCardBody>
            {!token && (
              <UiAlert tone="danger" title="Invalid link">
                This reset link is missing its token. Request a new one from the Forgot Password page.
              </UiAlert>
            )}
            {token && done && (
              <UiAlert tone="success" title="Password updated">
                Your password has been changed. All previous sessions were signed out.
              </UiAlert>
            )}
            {token && !done && (
              <form onSubmit={onSubmit} noValidate>
                {error && (
                  <UiAlert tone="danger" title="Reset failed" style={{ marginBottom: 16 }}>
                    {error}
                  </UiAlert>
                )}
                <UiInput
                  label="New password"
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  helper="At least 12 characters."
                  required
                  minLength={12}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <UiInput
                  label="Confirm new password"
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
                <UiButton type="submit" variant="primary" busy={busy} busyLabel="Updating…" style={{ width: "100%" }}>
                  Update password
                </UiButton>
              </form>
            )}
          </UiCardBody>
          <UiCardFooter>
            <UiTypography variant="metadata">
              {done ? <Link href="/login">Sign in</Link> : <Link href="/forgot-password">Request a new link</Link>}
            </UiTypography>
          </UiCardFooter>
        </UiCard>
      </main>
    </UiProvider>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
