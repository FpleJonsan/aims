"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  Input as UiInput,
  Select as UiSelect,
  Button as UiButton,
  Alert as UiAlert,
  Typography as UiTypography,
} from "../../../components/ui";
import { AuthApiError, authApiGet, authApiPost } from "../../../lib/auth-api";

type Department = { id: string; name: string };
const ROLE_OPTIONS = [
  { value: "REQUESTER", label: "Requester" },
  { value: "FINANCE", label: "Finance Analyst" },
  { value: "FINANCE_MASTER", label: "Finance Master" },
] as const;

export default function CreateUserPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [roles, setRoles] = useState<string[]>(["REQUESTER"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; temporaryPassword: string } | null>(null);

  useEffect(() => {
    authApiGet<Department[]>("/auth/password/departments").then((rows) => {
      setDepartments(rows);
      if (rows.length > 0) setDepartmentId(rows[0].id);
    });
  }, []);

  function toggleRole(role: string) {
    setRoles((current) => (current.includes(role) ? current.filter((value) => value !== role) : [...current, role]));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (roles.length === 0) {
      setError("Select at least one role.");
      return;
    }
    setBusy(true);
    try {
      const result = await authApiPost<{ id: string; temporaryPassword: string }>("/admin/users", { email, displayName, departmentId, roles });
      setCreated(result);
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div>
        <UiPageHeader title="Account created" />
        <UiCard style={{ maxWidth: 480 }}>
          <UiCardBody>
            <UiAlert tone="success" title="Share this temporary password now">
              It is shown only once and cannot be retrieved later. The account must change it at first sign-in.
            </UiAlert>
            <UiTypography as="p" variant="metric" style={{ margin: "16px 0", fontFamily: "monospace" }}>
              {created.temporaryPassword}
            </UiTypography>
            <Link href={`/admin/users/${created.id}`}>
              <UiButton variant="primary">View account</UiButton>
            </Link>
          </UiCardBody>
        </UiCard>
      </div>
    );
  }

  return (
    <div>
      <UiPageHeader title="Create user" description="Approver, Finance Analyst, and Finance Master accounts are created here." />
      <UiCard style={{ maxWidth: 480 }}>
        <UiCardBody>
          <form onSubmit={onSubmit} noValidate>
            {error && <UiAlert tone="danger" title="Could not create account" style={{ marginBottom: 16 }}>{error}</UiAlert>}
            <UiInput label="Display name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            <UiInput label="Email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <UiSelect label="Department" required value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </UiSelect>
            <fieldset style={{ border: "none", padding: 0, margin: "8px 0 16px" }}>
              <legend><UiTypography as="span" variant="label">Roles</UiTypography></legend>
              {ROLE_OPTIONS.map((option) => (
                <label key={option.value} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <input type="checkbox" checked={roles.includes(option.value)} onChange={() => toggleRole(option.value)} />
                  {option.label}
                </label>
              ))}
            </fieldset>
            <UiButton type="submit" variant="primary" busy={busy} busyLabel="Creating…" style={{ width: "100%" }}>
              Create account
            </UiButton>
          </form>
        </UiCardBody>
      </UiCard>
    </div>
  );
}
