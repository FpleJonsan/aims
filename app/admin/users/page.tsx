"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
  Pagination as UiPagination,
  LoadingSpinner as UiSpinner,
} from "../../components/ui";
import { AuthApiError, authApiGet } from "../../lib/auth-api";

type UserSummary = {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  department: string;
  lastLoginAt: string | null;
  roles: string[];
  locked: boolean;
};

type ListResponse = { items: UserSummary[]; page: number; pageSize: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean };

const ROLE_LABELS: Record<string, string> = { REQUESTER: "Requester", FINANCE: "Finance Analyst", FINANCE_MASTER: "Finance Master" };

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search.trim()) params.set("search", search.trim());
    authApiGet<ListResponse>(`/admin/users?${params.toString()}`)
      .then((response) => {
        setData(response);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof AuthApiError ? cause.message : "Could not load users."))
      .finally(() => setLoading(false));
  }, [search, page]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return (
    <div>
      <UiPageHeader
        title="User Management"
        description="Create accounts and manage status and roles."
        actions={<Link href="/admin/users/create"><UiButton variant="primary">Create user</UiButton></Link>}
      />
      <UiCard>
        <UiCardBody>
          <UiInput
            label="Search"
            helper="Search by name or email."
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
          {error && <UiAlert tone="danger" title="Could not load users">{error}</UiAlert>}
          {loading && <UiSpinner label="Loading users…" />}
          {!loading && data && (
            <>
              <UiTableContainer label="Users">
                <UiTableHeaderRow columns={["Name", "Email", "Department", "Roles", "Status", "Last login"]} />
                {data.items.map((user) => (
                  <Link
                    key={user.id}
                    href={`/admin/users/${user.id}`}
                    role="row"
                    style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 8, padding: "8px 0", borderBottom: "1px solid #eee", textDecoration: "none", color: "inherit" }}
                  >
                    <span role="cell">{user.displayName}</span>
                    <span role="cell">{user.email}</span>
                    <span role="cell">{user.department}</span>
                    <span role="cell">{user.roles.map((role) => ROLE_LABELS[role] ?? role).join(", ") || "—"}</span>
                    <span role="cell">
                      {!user.active ? <UiBadge tone="danger">Disabled</UiBadge> : user.locked ? <UiBadge tone="warning">Locked</UiBadge> : <UiBadge tone="success">Active</UiBadge>}
                    </span>
                    <span role="cell">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</span>
                  </Link>
                ))}
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
