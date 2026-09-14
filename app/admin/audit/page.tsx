"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  EmptyState,
  Input,
  LoadingSpinner,
  PageHeader,
  Pagination,
  TableContainer,
  TableHeaderRow,
  Typography,
} from "../../components/ui";
import { authApiGet } from "../../lib/auth-api";

type Row = {
  id: string;
  actor_id: string | null;
  actor_display_name_snapshot: string | null;
  actor_role_snapshot: string[] | null;
  occurred_at: string;
  action: string;
  entity_type: string;
  entity_id: string;
  source_ip: string | null;
  previous_state: string | null;
  new_state: string | null;
  metadata: unknown;
};
type Page = { items: Row[]; page: number; totalPages: number; total: number };

export default function AuditPage() {
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    actorId: "",
    role: "",
    action: "",
    entityType: "",
    entityId: "",
  });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    const normalized = {
      ...applied,
      dateFrom: applied.dateFrom
        ? new Date(applied.dateFrom).toISOString()
        : "",
      dateTo: applied.dateTo ? new Date(applied.dateTo).toISOString() : "",
    };
    const q = new URLSearchParams({
      page: String(page),
      pageSize: "25",
      ...Object.fromEntries(
        Object.entries(normalized).filter(([, value]) => value),
      ),
    });
    authApiGet<Page>(`/admin/audit?${q}`)
      .then((value) => {
        setData(value);
        setError("");
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load the audit trail.",
        ),
      );
  }, [applied, page]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  function apply(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setApplied(filters);
  }
  return (
    <div>
      <PageHeader
        title="Enterprise Audit"
        description="Read-only, append-only history of authorized business and administration actions."
      />
      <Card>
        <CardBody>
          <form className="auditFilters" onSubmit={apply}>
            <Input
              label="From"
              type="datetime-local"
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters({ ...filters, dateFrom: event.target.value })
              }
            />
            <Input
              label="To"
              type="datetime-local"
              value={filters.dateTo}
              onChange={(event) =>
                setFilters({ ...filters, dateTo: event.target.value })
              }
            />
            <Input
              label="Actor ID"
              value={filters.actorId}
              onChange={(event) =>
                setFilters({ ...filters, actorId: event.target.value })
              }
            />
            <Input
              label="Role"
              value={filters.role}
              onChange={(event) =>
                setFilters({ ...filters, role: event.target.value })
              }
            />
            <Input
              label="Action"
              value={filters.action}
              onChange={(event) =>
                setFilters({ ...filters, action: event.target.value })
              }
            />
            <Input
              label="Entity type"
              value={filters.entityType}
              onChange={(event) =>
                setFilters({ ...filters, entityType: event.target.value })
              }
            />
            <Input
              label="Entity ID"
              value={filters.entityId}
              onChange={(event) =>
                setFilters({ ...filters, entityId: event.target.value })
              }
            />
            <Button type="submit" variant="primary">
              Apply filters
            </Button>
          </form>
        </CardBody>
      </Card>
      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <LoadingSpinner label="Loading audit events…" />}
      {data &&
        (data.items.length ? (
          <>
            <TableContainer label="Enterprise audit events">
              <div role="table">
                <TableHeaderRow
                  className="enterpriseTableRow auditRow enterpriseTableHeader"
                  columns={["Time", "Actor", "Action", "Entity", "Change"]}
                />
                {data.items.map((item) => (
                  <div
                    role="row"
                    className="enterpriseTableRow auditRow"
                    key={item.id}
                  >
                    <span role="cell" data-label="Time">
                      {new Date(item.occurred_at).toLocaleString()}
                    </span>
                    <span role="cell" data-label="Actor">
                      <Typography variant="label">
                        {item.actor_display_name_snapshot ?? "System"}
                      </Typography>
                      <Typography variant="metadata">
                        {item.actor_role_snapshot?.join(", ") || "System"}
                      </Typography>
                    </span>
                    <span role="cell" data-label="Action">
                      {item.action.replaceAll("_", " ")}
                    </span>
                    <span role="cell" data-label="Entity">
                      <Typography variant="label">
                        {item.entity_type.replaceAll("_", " ")}
                      </Typography>
                      <Typography variant="metadata">
                        {item.entity_id}
                      </Typography>
                    </span>
                    <span role="cell" data-label="Change">
                      {item.previous_state || item.new_state
                        ? `${item.previous_state ?? "—"} → ${item.new_state ?? "—"}`
                        : "Recorded"}
                    </span>
                  </div>
                ))}
              </div>
            </TableContainer>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              hasPreviousPage={data.page > 1}
              hasNextPage={data.page < data.totalPages}
              onPrevious={() => setPage((value) => value - 1)}
              onNext={() => setPage((value) => value + 1)}
            />
          </>
        ) : (
          <EmptyState title="No audit events">
            <span>No append-only events match these filters.</span>
          </EmptyState>
        ))}
    </div>
  );
}
