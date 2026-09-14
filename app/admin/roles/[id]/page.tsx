"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  Textarea as UiTextarea,
  Typography as UiTypography,
  LoadingSpinner as UiSpinner,
} from "../../../components/ui";
import { AuthApiError, authApiGet, authApiPatch } from "../../../lib/auth-api";

type RoleDetail = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  disabled: boolean;
  referenceCount: number;
  permissionIds: string[];
};

export default function AdminRoleDetailPage() {
  const params = useParams<{ id: string }>();
  const [role, setRole] = useState<RoleDetail | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const load = useCallback(() => {
    authApiGet<RoleDetail>(`/admin/roles/${params.id}`)
      .then((detail) => {
        setRole(detail);
        setName(detail.name);
        setDescription(detail.description ?? "");
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load this role."));
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    setBusyAction("save");
    setError(null);
    setNotice(null);
    try {
      await authApiPatch(`/admin/roles/${params.id}`, { name, description: description.trim() || null });
      setNotice("Role updated.");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not save changes.");
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleDisabled() {
    if (!role) return;
    setBusyAction("disabled");
    setError(null);
    setNotice(null);
    try {
      await authApiPatch(`/admin/roles/${params.id}`, { disabled: !role.disabled });
      setNotice(role.disabled ? "Role enabled." : "Role disabled.");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not change status.");
    } finally {
      setBusyAction(null);
    }
  }

  if (error && !role) return <UiAlert tone="danger" title="Could not load role">{error}</UiAlert>;
  if (!role) return <UiSpinner label="Loading role…" />;

  return (
    <div>
      <UiPageHeader
        title={role.name}
        description={`Code: ${role.code}`}
        actions={role.disabled ? <UiBadge tone="danger">Disabled</UiBadge> : <UiBadge tone="success">Active</UiBadge>}
      />
      {error && <UiAlert tone="danger" title="Action failed" style={{ marginBottom: 16 }}>{error}</UiAlert>}
      {notice && <UiAlert tone="success" title="Done" style={{ marginBottom: 16 }}>{notice}</UiAlert>}

      {role.isSystem && (
        <UiAlert tone="info" title="Developer-only role" style={{ marginBottom: 16 }}>
          Technical Admin is reserved for developers. Finance Master cannot edit its name, status, or permissions.
        </UiAlert>
      )}

      <UiCard style={{ marginBottom: 16 }}>
        <UiCardHeader><UiSectionHeader title="Details" description={`Assigned to ${role.referenceCount} user${role.referenceCount === 1 ? "" : "s"}.`} /></UiCardHeader>
        <UiCardBody>
          <form onSubmit={saveDetails}>
            <UiInput label="Name" required disabled={role.isSystem} value={name} onChange={(event) => setName(event.target.value)} />
            <UiTextarea label="Description" disabled={role.isSystem} value={description} onChange={(event) => setDescription(event.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <UiButton type="submit" variant="primary" disabled={role.isSystem} busy={busyAction === "save"} busyLabel="Saving…">
                Save changes
              </UiButton>
              <UiButton type="button" variant={role.disabled ? "primary" : "danger"} disabled={role.isSystem} busy={busyAction === "disabled"} busyLabel="Updating…" onClick={toggleDisabled}>
                {role.disabled ? "Enable role" : "Disable role"}
              </UiButton>
            </div>
          </form>
        </UiCardBody>
      </UiCard>

      <UiCard>
        <UiCardHeader><UiSectionHeader title="Permissions" description={`${role.permissionIds.length} permission(s) granted.`} /></UiCardHeader>
        <UiCardBody>
          <UiTypography variant="metadata">Edit this role&apos;s permissions from the <Link href={`/admin/permissions?role=${role.id}`}>permission matrix</Link>.</UiTypography>
        </UiCardBody>
      </UiCard>
    </div>
  );
}
