"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Card as UiCard,
  CardBody as UiCardBody,
  PageHeader as UiPageHeader,
  Input as UiInput,
  Select as UiSelect,
  Button as UiButton,
  Alert as UiAlert,
  Badge as UiBadge,
  TableContainer as UiTableContainer,
  TableHeaderRow as UiTableHeaderRow,
  Pagination as UiPagination,
  LoadingSpinner as UiSpinner,
} from "../../../components/ui";
import { AuthApiError, authApiGet, authApiPatch, authApiPost } from "../../../lib/auth-api";

type MasterDataItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isDefault: boolean;
  active: boolean;
  referenceCount: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = { items: MasterDataItem[]; page: number; pageSize: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean };

const emptyForm = { code: "", name: "", description: "", sortOrder: "0", isDefault: false };
type EditState = { name: string; description: string; sortOrder: string; isDefault: boolean };

export function MasterDataManager({ apiPath, label, pluralLabel }: { apiPath: string; label: string; pluralLabel: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "disabled" | "all">("active");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20", status });
    if (search.trim()) params.set("search", search.trim());
    authApiGet<ListResponse>(`${apiPath}?${params.toString()}`)
      .then((response) => {
        setData(response);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : `Could not load ${pluralLabel.toLowerCase()}.`))
      .finally(() => setLoading(false));
  }, [apiPath, page, pluralLabel, search, status]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await authApiPost(apiPath, {
        code: createForm.code.trim(),
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
        sortOrder: createForm.sortOrder,
        isDefault: createForm.isDefault,
      });
      setCreateForm(emptyForm);
      setNotice(`${label} created.`);
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : `Could not create this ${label.toLowerCase()}.`);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(item: MasterDataItem) {
    setEditingId(item.id);
    setEditState({ name: item.name, description: item.description ?? "", sortOrder: String(item.sortOrder), isDefault: item.isDefault });
  }

  async function saveEdit(id: string) {
    if (!editState) return;
    setBusyId(id);
    setError(null);
    try {
      await authApiPatch(`${apiPath}/${id}`, {
        name: editState.name.trim(),
        description: editState.description.trim() || null,
        sortOrder: editState.sortOrder,
        isDefault: editState.isDefault,
      });
      setEditingId(null);
      setNotice(`${label} updated.`);
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not save changes.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(item: MasterDataItem) {
    setBusyId(item.id);
    setError(null);
    try {
      await authApiPost(`${apiPath}/${item.id}/${item.active ? "disable" : "enable"}`, {});
      setNotice(item.active ? `${label} disabled.` : `${label} enabled.`);
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not change status.");
    } finally {
      setBusyId(null);
    }
  }

  async function softDelete(item: MasterDataItem) {
    setBusyId(item.id);
    setError(null);
    try {
      await authApiPost(`${apiPath}/${item.id}/soft-delete`, {});
      setNotice(`${label} deleted.`);
      load();
    } catch (cause) {
      setError(cause instanceof AuthApiError ? cause.message : "Could not delete this record.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <UiPageHeader title={pluralLabel} description={`Create, edit, enable, disable, and delete ${pluralLabel.toLowerCase()}. Records referenced by existing data can only be disabled.`} />

      {error && <UiAlert tone="danger" title="Action failed" style={{ marginBottom: 16 }}>{error}</UiAlert>}
      {notice && <UiAlert tone="success" title="Done" style={{ marginBottom: 16 }}>{notice}</UiAlert>}

      <UiCard style={{ marginBottom: 16 }}>
        <UiCardBody>
          <form onSubmit={submitCreate} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <UiInput label="Code" required value={createForm.code} onChange={(event) => setCreateForm((f) => ({ ...f, code: event.target.value }))} />
            <UiInput label="Name" required value={createForm.name} onChange={(event) => setCreateForm((f) => ({ ...f, name: event.target.value }))} />
            <UiInput label="Description" value={createForm.description} onChange={(event) => setCreateForm((f) => ({ ...f, description: event.target.value }))} />
            <UiInput label="Sort order" value={createForm.sortOrder} onChange={(event) => setCreateForm((f) => ({ ...f, sortOrder: event.target.value }))} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
              <input type="checkbox" checked={createForm.isDefault} onChange={() => setCreateForm((f) => ({ ...f, isDefault: !f.isDefault }))} />
              Default
            </label>
            <UiButton type="submit" variant="primary" busy={creating} busyLabel="Creating…">
              Create {label.toLowerCase()}
            </UiButton>
          </form>
        </UiCardBody>
      </UiCard>

      <UiCard>
        <UiCardBody>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
            <UiInput
              label="Search"
              helper="Search by name or code."
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
            <UiSelect
              label="Status"
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value as "active" | "disabled" | "all");
              }}
            >
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
              <option value="all">All</option>
            </UiSelect>
          </div>
          {loading && <UiSpinner label={`Loading ${pluralLabel.toLowerCase()}…`} />}
          {!loading && data && (
            <>
              <UiTableContainer label={pluralLabel}>
                <UiTableHeaderRow columns={["Name", "Code", "Sort", "Default", "Status", "References", "Updated by", "Actions"]} />
                {data.items.map((item) => {
                  const editing = editingId === item.id;
                  return (
                    <div
                      key={item.id}
                      role="row"
                      style={{ display: "grid", gridTemplateColumns: "minmax(140px,1.4fr) minmax(90px,0.8fr) minmax(70px,0.6fr) minmax(80px,0.6fr) minmax(90px,0.8fr) minmax(80px,0.8fr) minmax(100px,1fr) minmax(170px,1.6fr)", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eee" }}
                    >
                      {editing && editState ? (
                        <>
                          <span role="cell"><UiInput label="Name" value={editState.name} onChange={(event) => setEditState({ ...editState, name: event.target.value })} /></span>
                          <span role="cell" style={{ fontFamily: "monospace" }}>{item.code}</span>
                          <span role="cell"><UiInput label="Sort" value={editState.sortOrder} onChange={(event) => setEditState({ ...editState, sortOrder: event.target.value })} /></span>
                          <span role="cell">
                            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <input type="checkbox" checked={editState.isDefault} onChange={() => setEditState({ ...editState, isDefault: !editState.isDefault })} />
                              Default
                            </label>
                          </span>
                          <span role="cell">{item.active ? <UiBadge tone="success">Active</UiBadge> : <UiBadge tone="danger">Disabled</UiBadge>}</span>
                          <span role="cell">{item.referenceCount}</span>
                          <span role="cell">{item.updatedBy ?? "—"}</span>
                          <span role="cell" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <UiButton variant="primary" busy={busyId === item.id} busyLabel="Saving…" onClick={() => saveEdit(item.id)}>
                              Save
                            </UiButton>
                            <UiButton onClick={() => setEditingId(null)}>Cancel</UiButton>
                          </span>
                        </>
                      ) : (
                        <>
                          <span role="cell">{item.name}{item.isDefault && <UiBadge tone="neutral" style={{ marginLeft: 6 }}>Default</UiBadge>}</span>
                          <span role="cell" style={{ fontFamily: "monospace" }}>{item.code}</span>
                          <span role="cell">{item.sortOrder}</span>
                          <span role="cell">{item.isDefault ? "Yes" : "—"}</span>
                          <span role="cell">{item.active ? <UiBadge tone="success">Active</UiBadge> : <UiBadge tone="danger">Disabled</UiBadge>}</span>
                          <span role="cell">{item.referenceCount}</span>
                          <span role="cell">{item.updatedBy ?? "—"}</span>
                          <span role="cell" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <UiButton onClick={() => startEdit(item)}>Edit</UiButton>
                            <UiButton busy={busyId === item.id} busyLabel="Working…" onClick={() => toggleActive(item)}>
                              {item.active ? "Disable" : "Enable"}
                            </UiButton>
                            <UiButton variant="danger" busy={busyId === item.id} busyLabel="Deleting…" onClick={() => softDelete(item)}>
                              Delete
                            </UiButton>
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </UiTableContainer>
              <UiPagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                hasPreviousPage={data.hasPreviousPage}
                hasNextPage={data.hasNextPage}
                onPrevious={() => setPage((value) => Math.max(1, value - 1))}
                onNext={() => setPage((value) => value + 1)}
              />
            </>
          )}
        </UiCardBody>
      </UiCard>
    </div>
  );
}
