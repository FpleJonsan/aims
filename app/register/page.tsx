"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  UIProvider as UiProvider,
  Card as UiCard,
  CardBody as UiCardBody,
  CardFooter as UiCardFooter,
  Input as UiInput,
  Select as UiSelect,
  Button as UiButton,
  Alert as UiAlert,
  PageHeader as UiPageHeader,
  Typography as UiTypography,
} from "../components/ui";
import { AuthApiError, authApiGet, authApiPost } from "../lib/auth-api";

type Department = { id: string; name: string };

export default function RegisterPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authApiGet<Department[]>("/auth/password/departments")
      .then((rows) => {
        setDepartments(rows);
        if (rows.length > 0) setDepartmentId(rows[0].id);
      })
      .catch(() => setDepartmentsError("Could not load departments. Refresh to try again."));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await authApiPost("/auth/password/register", { email, password, displayName, departmentId });
      router.push("/");
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Registration failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiProvider className="aims-auth-page">
      <main style={{ maxWidth: 420, margin: "0 auto", padding: "48px 16px" }}>
        <UiPageHeader title="Create your account" description="Register as a Requester. Approver, Finance Analyst, and Finance Master accounts are created internally." />
        <UiCard>
          <UiCardBody>
            <form onSubmit={onSubmit} noValidate>
              {error && (
                <UiAlert tone="danger" title="Registration failed" style={{ marginBottom: 16 }}>
                  {error}
                </UiAlert>
              )}
              {departmentsError && (
                <UiAlert tone="warning" style={{ marginBottom: 16 }}>
                  {departmentsError}
                </UiAlert>
              )}
              <UiInput
                label="Display name"
                name="displayName"
                autoComplete="name"
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <UiInput
                label="Email"
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <UiSelect
                label="Department"
                name="department"
                required
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                {departments.length === 0 && <option value="">Loading departments…</option>}
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </UiSelect>
              <UiInput
                label="Password"
                type="password"
                name="password"
                autoComplete="new-password"
                helper="At least 12 characters."
                required
                minLength={12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <UiInput
                label="Confirm password"
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                required
                minLength={12}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              <UiButton type="submit" variant="primary" busy={busy} busyLabel="Creating account…" style={{ width: "100%" }}>
                Create account
              </UiButton>
            </form>
          </UiCardBody>
          <UiCardFooter>
            <UiTypography variant="metadata">
              Already have an account? <Link href="/login">Sign in</Link>
            </UiTypography>
          </UiCardFooter>
        </UiCard>
      </main>
    </UiProvider>
  );
}
