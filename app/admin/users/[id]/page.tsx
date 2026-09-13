"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Card as UiCard,
  CardHeader as UiCardHeader,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  SectionHeader as UiSectionHeader,
  Button as UiButton,
  Alert as UiAlert,
  Badge as UiBadge,
  Input as UiInput,
  Select as UiSelect,
  Typography as UiTypography,
  LoadingSpinner as UiSpinner,
} from "../../../components/ui";
import { AuthApiError, authApiGet, authApiPost, authApiPut, authApiPatch } from "../../../lib/auth-api";

type ApprovalAuthority = { authorityRole: string; authorityScope: "DEPARTMENT" | "ORGANIZATION"; active: boolean };
type UserDetail = {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  department: string;
  lastLoginAt: string | null;
  roles: string[];
  hasPasswordCredentials: boolean;
  locked: boolean;
  telegramBinding: { bound: boolean; boundAt?: string };
  approvalAuthorities: ApprovalAuthority[];
};

const ROLE_OPTIONS = [
  { value: "REQUESTER", label: "Requester" },
  { value: "FINANCE", label: "Finance Analyst" },
  { value: "FINANCE_MASTER", label: "Finance Master" },
] as const;

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [authorityRole, setAuthorityRole] = useState("");
  const [authorityScope, setAuthorityScope] = useState<"DEPARTMENT" | "ORGANIZATION">("DEPARTMENT");

  const load = useCallback(() => {
    authApiGet<UserDetail>(`/admin/users/${params.id}`)
      .then((detail) => {
        setUser(detail);
        setRoles(detail.roles);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load this account."));
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(action: string, run: () => Promise<unknown>, successMessage: string) {
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      const result = await run();
      const temporaryPassword = (result as { temporaryPassword?: string } | undefined)?.temporaryPassword;
      setNotice(temporaryPassword ? `${successMessage} Temporary password (shown once): ${temporaryPassword}` : successMessage);
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Action failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function saveRoles(event: FormEvent) {
    event.preventDefault();
    await runAction("roles", () => authApiPatch(`/admin/users/${params.id}/roles`, { roles }), "Roles updated.");
  }

  async function saveAuthority(event: FormEvent) {
    event.preventDefault();
    if (!authorityRole.trim()) return;
    await runAction(
      "authority",
      () => authApiPut(`/admin/users/${params.id}/approval-authority`, { authorityRole: authorityRole.trim(), authorityScope, active: true }),
      "Approval authority granted.",
    );
    setAuthorityRole("");
  }

  async function revokeAuthority(authority: ApprovalAuthority) {
    await runAction(
      `authority-${authority.authorityRole}`,
      () => authApiPut(`/admin/users/${params.id}/approval-authority`, { ...authority, active: false }),
      "Approval authority revoked.",
    );
  }

  if (error && !user) return <UiAlert tone="danger" title="Could not load account">{error}</UiAlert>;
  if (!user) return <UiSpinner label="Loading account…" />;

  return (
    <div>
      <UiPageHeader
        title={user.displayName}
        description={`${user.email} · ${user.department}`}
        actions={
          <>
            {!user.active ? <UiBadge tone="danger">Disabled</UiBadge> : user.locked ? <UiBadge tone="warning">Locked</UiBadge> : <UiBadge tone="success">Active</UiBadge>}
          </>
        }
      />
      {error && <UiAlert tone="danger" title="Action failed" style={{ marginBottom: 16 }}>{error}</UiAlert>}
      {notice && <UiAlert tone="success" title="Done" style={{ marginBottom: 16 }}>{notice}</UiAlert>}

      <UiCard style={{ marginBottom: 16 }}>
        <UiCardHeader><UiSectionHeader title="Account status" /></UiCardHeader>
        <UiCardBody>
          <UiTypography variant="metadata">Last login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</UiTypography>
          <UiTypography variant="metadata">Telegram: {user.telegramBinding.bound ? "Bound" : "Not bound"}</UiTypography>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            {user.active ? (
              <UiButton variant="danger" busy={busyAction === "disable"} busyLabel="Disabling…" onClick={() => runAction("disable", () => authApiPost(`/admin/users/${params.id}/disable`, {}), "Account disabled.")}>
                Disable user
              </UiButton>
            ) : (
              <UiButton variant="primary" busy={busyAction === "enable"} busyLabel="Enabling…" onClick={() => runAction("enable", () => authApiPost(`/admin/users/${params.id}/enable`, {}), "Account enabled.")}>
                Enable user
              </UiButton>
            )}
            {user.hasPasswordCredentials && (
              <>
                {user.locked ? (
                  <UiButton busy={busyAction === "unlock"} busyLabel="Unlocking…" onClick={() => runAction("unlock", () => authApiPost(`/admin/users/${params.id}/unlock`, {}), "Account unlocked.")}>
                    Unlock user
                  </UiButton>
                ) : (
                  <UiButton busy={busyAction === "lock"} busyLabel="Locking…" onClick={() => runAction("lock", () => authApiPost(`/admin/users/${params.id}/lock`, {}), "Account locked.")}>
                    Lock user
                  </UiButton>
                )}
                <UiButton busy={busyAction === "reset-password"} busyLabel="Resetting…" onClick={() => runAction("reset-password", () => authApiPost(`/admin/users/${params.id}/reset-password`, {}), "Password reset.")}>
                  Reset password
                </UiButton>
                <UiButton busy={busyAction === "force-password-reset"} busyLabel="Requesting…" onClick={() => runAction("force-password-reset", () => authApiPost(`/admin/users/${params.id}/force-password-reset`, {}), "User must change password at next sign-in.")}>
                  Force password reset
                </UiButton>
              </>
            )}
          </div>
          {!user.hasPasswordCredentials && (
            <UiTypography variant="metadata" style={{ marginTop: 8 }}>
              This account does not use password authentication, so Lock/Reset/Force-reset are not applicable.
            </UiTypography>
          )}
        </UiCardBody>
      </UiCard>

      <UiCard style={{ marginBottom: 16 }}>
        <UiCardHeader><UiSectionHeader title="Roles" /></UiCardHeader>
        <UiCardBody>
          <form onSubmit={saveRoles}>
            {ROLE_OPTIONS.map((option) => (
              <label key={option.value} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={roles.includes(option.value)}
                  onChange={() =>
                    setRoles((current) => (current.includes(option.value) ? current.filter((value) => value !== option.value) : [...current, option.value]))
                  }
                />
                {option.label}
              </label>
            ))}
            <UiButton type="submit" variant="primary" busy={busyAction === "roles"} busyLabel="Saving…" style={{ marginTop: 8 }}>
              Save roles
            </UiButton>
          </form>
        </UiCardBody>
      </UiCard>

      <UiCard>
        <UiCardHeader><UiSectionHeader title="Approval authority" description="Grants recognized by the Approval workflow for a given step's required role code." /></UiCardHeader>
        <UiCardBody>
          {user.approvalAuthorities.filter((authority) => authority.active).length === 0 && (
            <UiTypography variant="metadata">No active approval authority.</UiTypography>
          )}
          {user.approvalAuthorities.filter((authority) => authority.active).map((authority) => (
            <div key={`${authority.authorityRole}-${authority.authorityScope}`} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <UiBadge>{authority.authorityRole}</UiBadge>
              <UiTypography variant="metadata">{authority.authorityScope}</UiTypography>
              <UiButton busy={busyAction === `authority-${authority.authorityRole}`} busyLabel="Revoking…" onClick={() => revokeAuthority(authority)}>
                Revoke
              </UiButton>
            </div>
          ))}
          <form onSubmit={saveAuthority} style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <UiInput label="Role code" helper="Matches an Approval Matrix step's required role, e.g. AM." value={authorityRole} onChange={(event) => setAuthorityRole(event.target.value)} />
            <UiSelect label="Scope" value={authorityScope} onChange={(event) => setAuthorityScope(event.target.value as "DEPARTMENT" | "ORGANIZATION")}>
              <option value="DEPARTMENT">Department</option>
              <option value="ORGANIZATION">Organization</option>
            </UiSelect>
            <UiButton type="submit" variant="primary" busy={busyAction === "authority"} busyLabel="Granting…">
              Grant
            </UiButton>
          </form>
        </UiCardBody>
      </UiCard>
    </div>
  );
}
