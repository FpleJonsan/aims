"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await authApiPost<{ authenticated: boolean; mustChangePassword?: boolean }>("/auth/password/login", {
        email,
        password,
        rememberMe,
      });
      if (result.mustChangePassword) {
        setNotice("Your password must be changed before you continue. Use “Forgot password” to set a new one.");
        return;
      }
      router.push("/");
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Sign in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiProvider className="aims-auth-page">
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 16px" }}>
        <UiPageHeader title="Sign in" description="Sign in to AIMS with your email and password." />
        <UiCard>
          <UiCardBody>
            <form onSubmit={onSubmit} noValidate>
              {error && (
                <UiAlert tone="danger" title="Sign in failed" style={{ marginBottom: 16 }}>
                  {error}
                </UiAlert>
              )}
              {notice && (
                <UiAlert tone="info" title="Password change required" style={{ marginBottom: 16 }}>
                  {notice}
                </UiAlert>
              )}
              <UiInput
                label="Email"
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <UiInput
                label="Password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 16px" }}>
                <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                <UiTypography as="span" variant="label">Remember me</UiTypography>
              </label>
              <UiButton type="submit" variant="primary" busy={busy} busyLabel="Signing in…" style={{ width: "100%" }}>
                Sign in
              </UiButton>
            </form>
          </UiCardBody>
          <UiCardFooter>
            <UiTypography variant="metadata">
              <Link href="/forgot-password">Forgot password?</Link> &middot; Need an account? <Link href="/register">Register</Link>
            </UiTypography>
          </UiCardFooter>
        </UiCard>
      </main>
    </UiProvider>
  );
}
