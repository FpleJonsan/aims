"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  Input as UiInput,
  Select as UiSelect,
  Button as UiButton,
  Alert as UiAlert,
  Typography as UiTypography,
  TableContainer as UiTableContainer,
  LoadingSpinner as UiSpinner,
} from "../../components/ui";
import { AuthApiError, authApiGet, authApiPatch, authApiPost } from "../../lib/auth-api";

type RoleSummary = { id: string; code: string; name: string; isSystem: boolean; disabled: boolean };
type RoleDetail = { id: string; permissionIds: string[] };
type PermissionRow = { id: string; code: string; group: string; name: string };

export default function AdminPermissionsPage() {
  const searchParams = useSearchParams();
  const highlightRoleId = searchParams.get("role");

  const [roles, setRoles] = useState<RoleSummary[] | null>(null);
  const [catalog, setCatalog] = useState<PermissionRow[] | null>(null);
  const [assignments, setAssignments] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [cloneSourceId, setCloneSourceId] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloneBusy, setCloneBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([authApiGet<RoleSummary[]>("/admin/roles"), authApiGet<PermissionRow[]>("/admin/permissions")])
      .then(async ([roleRows, permissionRows]) => {
        const details = await Promise.all(roleRows.map((role) => authApiGet<RoleDetail>(`/admin/roles/${role.id}`)));
        const next: Record<string, Set<string>> = {};
        for (const detail of details) next[detail.id] = new Set(detail.permissionIds);
        setRoles(roleRows);
        setCatalog(permissionRows);
        setAssignments(next);
        setError(null);
        if (roleRows.length && !cloneSourceId) setCloneSourceId(roleRows[0].id);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load the permission matrix."))
      .finally(() => setLoading(false));
    // cloneSourceId intentionally excluded: only used to seed a default once, not to retrigger loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const visiblePermissions = useMemo(() => {
    if (!catalog) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter((permission) => permission.name.toLowerCase().includes(needle) || permission.code.toLowerCase().includes(needle) || permission.group.toLowerCase().includes(needle));
  }, [catalog, search]);

  const permissionRows = useMemo(
    () => visiblePermissions.map((permission, index) => ({ permission, showGroupHeader: index === 0 || permission.group !== visiblePermissions[index - 1].group })),
    [visiblePermissions],
  );

  async function applyPermissionIds(role: RoleSummary, permissionIds: string[]) {
    const previous = assignments[role.id] ?? new Set<string>();
    setAssignments((current) => ({ ...current, [role.id]: new Set(permissionIds) }));
    setSavingRoleId(role.id);
    setError(null);
    try {
      await authApiPatch(`/admin/roles/${role.id}/permissions`, { permissionIds });
    } catch (cause) {
      setAssignments((current) => ({ ...current, [role.id]: previous }));
      setError(cause instanceof AuthApiError ? cause.message : "Could not update this role's permissions.");
    } finally {
      setSavingRoleId(null);
    }
  }

  function toggle(role: RoleSummary, permissionId: string) {
    if (role.isSystem) return;
    const current = assignments[role.id] ?? new Set<string>();
    const next = new Set(current);
    if (next.has(permissionId)) next.delete(permissionId);
    else next.add(permissionId);
    void applyPermissionIds(role, [...next]);
  }

  function selectAll(role: RoleSummary) {
    if (role.isSystem || !catalog) return;
    void applyPermissionIds(role, catalog.map((permission) => permission.id));
  }

  function clearAll(role: RoleSummary) {
    if (role.isSystem) return;
    void applyPermissionIds(role, []);
  }

  async function submitClone(event: FormEvent) {
    event.preventDefault();
    if (!cloneSourceId || !cloneName.trim()) return;
    setCloneBusy(true);
    setError(null);
    try {
      await authApiPost(`/admin/roles/${cloneSourceId}/clone`, { name: cloneName.trim() });
      setCloneName("");
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not clone this role.");
    } finally {
      setCloneBusy(false);
    }
  }

  if (error && !roles) return <UiAlert tone="danger" title="Could not load the permission matrix">{error}</UiAlert>;
  if (loading || !roles || !catalog) return <UiSpinner label="Loading permission matrix…" />;

  return (
    <div>
      <UiPageHeader
        title="Permission matrix"
        description="Rows are permissions, columns are roles. A checked cell grants that permission to that role; effective permission for a user is the union of every role they hold."
      />
      {error && <UiAlert tone="danger" title="Update failed" style={{ marginBottom: 16 }}>{error}</UiAlert>}

      <UiCard style={{ marginBottom: 16 }}>
        <UiCardBody style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <UiInput label="Search permissions" helper="Filters by name, code, or group." value={search} onChange={(event) => setSearch(event.target.value)} />
          <form onSubmit={submitClone} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <UiSelect label="Clone existing role" value={cloneSourceId} onChange={(event) => setCloneSourceId(event.target.value)}>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </UiSelect>
            <UiInput label="New role name" value={cloneName} onChange={(event) => setCloneName(event.target.value)} />
            <UiButton type="submit" busy={cloneBusy} busyLabel="Cloning…">Clone</UiButton>
          </form>
        </UiCardBody>
      </UiCard>

      <UiTableContainer label="Permission matrix">
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: `minmax(240px,1.6fr) repeat(${roles.length}, minmax(120px,1fr))`, minWidth: 240 + roles.length * 120 }}>
            <div role="row" style={{ display: "contents" }}>
              <span role="columnheader" />
              {roles.map((role) => (
                <span
                  key={role.id}
                  role="columnheader"
                  style={{ padding: "8px 4px", borderBottom: "2px solid #ccc", fontWeight: 600, textAlign: "center", background: role.id === highlightRoleId ? "#fff8dd" : undefined }}
                >
                  <div>{role.name}</div>
                  {role.isSystem && <UiTypography variant="metadata">developer-only</UiTypography>}
                  {!role.isSystem && (
                    <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 4 }}>
                      <button type="button" onClick={() => selectAll(role)} style={{ fontSize: 11 }}>All</button>
                      <button type="button" onClick={() => clearAll(role)} style={{ fontSize: 11 }}>None</button>
                    </div>
                  )}
                  {savingRoleId === role.id && <UiTypography variant="metadata">saving…</UiTypography>}
                </span>
              ))}
            </div>

            {permissionRows.map(({ permission, showGroupHeader }) => {
              return (
                <div key={permission.id} role="row" style={{ display: "contents" }}>
                  {showGroupHeader && (
                    <div style={{ gridColumn: `1 / span ${roles.length + 1}`, background: "#f3f3f3", padding: "6px 8px", fontWeight: 600 }}>
                      {permission.group}
                    </div>
                  )}
                  <span role="rowheader" style={{ padding: "6px 8px", borderBottom: "1px solid #eee" }}>{permission.name}</span>
                  {roles.map((role) => {
                    const granted = assignments[role.id]?.has(permission.id) ?? false;
                    return (
                      <span key={role.id} role="cell" style={{ textAlign: "center", borderBottom: "1px solid #eee" }}>
                        <input
                          type="checkbox"
                          checked={granted}
                          disabled={role.isSystem}
                          onChange={() => toggle(role, permission.id)}
                          aria-label={`${permission.name} for ${role.name}`}
                        />
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </UiTableContainer>
    </div>
  );
}
