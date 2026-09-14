"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  Input as UiInput,
  Button as UiButton,
  Alert as UiAlert,
  Badge as UiBadge,
  TableContainer as UiTableContainer,
  TableHeaderRow as UiTableHeaderRow,
  LoadingSpinner as UiSpinner,
} from "../../components/ui";
import { AuthApiError, authApiGet, authApiPost } from "../../lib/auth-api";

type RoleSummary = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  disabled: boolean;
  permissionCount: number;
  referenceCount: number;
};

export default function AdminRolesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    authApiGet<RoleSummary[]>(`/admin/roles?${params.toString()}`)
      .then((rows) => {
        setRoles(rows);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load roles."))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function submitClone(role: RoleSummary) {
    if (!cloneName.trim()) return;
    setBusy(role.id);
    try {
      const result = await authApiPost<{ id: string }>(`/admin/roles/${role.id}/clone`, { name: cloneName.trim() });
      setCloningId(null);
      setCloneName("");
      router.push(`/admin/roles/${result.id}`);
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not clone this role.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <UiPageHeader
        title="Roles"
        description="Define role and permission sets. Effective permission is the union of every role a user holds."
        actions={
          <>
            <Link href="/admin/permissions" style={{ marginRight: 8 }}>
              <UiButton>Permission matrix</UiButton>
            </Link>
            <Link href="/admin/roles/create">
              <UiButton variant="primary">Create role</UiButton>
            </Link>
          </>
        }
      />
      <UiCard>
        <UiCardBody>
          <UiInput label="Search" helper="Search by role name or code." value={search} onChange={(event) => setSearch(event.target.value)} />
          {error && <UiAlert tone="danger" title="Could not load roles">{error}</UiAlert>}
          {loading && <UiSpinner label="Loading roles…" />}
          {!loading && roles && (
            <UiTableContainer label="Roles">
              <UiTableHeaderRow columns={["Name", "Code", "Permissions", "Assigned users", "Status", "Actions"]} />
              {roles.map((role) => (
                <div
                  key={role.id}
                  role="row"
                  style={{ display: "grid", gridTemplateColumns: "minmax(160px,1.4fr) minmax(100px,1fr) minmax(90px,0.8fr) minmax(100px,0.9fr) minmax(90px,0.8fr) minmax(140px,1.2fr)", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eee" }}
                >
                  <span role="cell">
                    <Link href={`/admin/roles/${role.id}`}>{role.name}</Link>
                    {role.isSystem && <UiBadge tone="neutral" style={{ marginLeft: 8 }}>Developer-only</UiBadge>}
                  </span>
                  <span role="cell" style={{ fontFamily: "monospace" }}>{role.code}</span>
                  <span role="cell">{role.permissionCount}</span>
                  <span role="cell">{role.referenceCount}</span>
                  <span role="cell">{role.disabled ? <UiBadge tone="danger">Disabled</UiBadge> : <UiBadge tone="success">Active</UiBadge>}</span>
                  <span role="cell">
                    {cloningId === role.id ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <UiInput label="New role name" value={cloneName} onChange={(event) => setCloneName(event.target.value)} />
                        <UiButton busy={busy === role.id} busyLabel="Cloning…" onClick={() => submitClone(role)}>Save</UiButton>
                        <UiButton onClick={() => setCloningId(null)}>Cancel</UiButton>
                      </div>
                    ) : (
                      <UiButton
                        onClick={() => {
                          setCloningId(role.id);
                          setCloneName(`${role.name} copy`);
                        }}
                      >
                        Clone
                      </UiButton>
                    )}
                  </span>
                </div>
              ))}
            </UiTableContainer>
          )}
        </UiCardBody>
      </UiCard>
    </div>
  );
}
