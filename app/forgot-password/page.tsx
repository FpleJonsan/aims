"use client";

import { FormEvent, useState } from "react";
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
import { authApiPost } from "../lib/auth-api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await authApiPost("/auth/password/forgot-password", { email });
    } catch {
      // Intentionally ignored: the confirmation message never reveals whether the account exists.
    } finally {
      setBusy(false);
      setSubmitted(true);
    }
  }

  return (
    <UiProvider className="aims-auth-page">
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 16px" }}>
        <UiPageHeader title="Forgot password" description="We'll email you a link to reset your password." />
        <UiCard>
          <UiCardBody>
            {submitted ? (
              <UiAlert tone="success" title="Check your email">
                If an account exists for that email address, a password reset link has been sent. The link expires in 30 minutes.
              </UiAlert>
            ) : (
              <form onSubmit={onSubmit} noValidate>
                <UiInput
                  label="Email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <UiButton type="submit" variant="primary" busy={busy} busyLabel="Sending…" style={{ width: "100%" }}>
                  Send reset link
                </UiButton>
              </form>
            )}
          </UiCardBody>
          <UiCardFooter>
            <UiTypography variant="metadata">
              <Link href="/login">Back to sign in</Link>
            </UiTypography>
          </UiCardFooter>
        </UiCard>
      </main>
    </UiProvider>
  );
}
