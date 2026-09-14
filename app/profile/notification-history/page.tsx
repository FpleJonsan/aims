"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Card,
  CardBody,
  EmptyState,
  LoadingSpinner,
  PageHeader,
  Pagination,
  Select,
  StatusChip,
  TableContainer,
  TableHeaderRow,
  Typography,
  UIProvider,
} from "../../components/ui";
import { authApiGet } from "../../lib/auth-api";
type Row = {
  id: string;
  event_type: string;
  channel: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  last_error_code: string | null;
};
type Page = { items: Row[]; page: number; totalPages: number; total: number };
export default function NotificationHistoryPage() {
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [data, setData] = useState<Page | null>(null),
    [error, setError] = useState("");
  const load = useCallback(() => {
    const q = new URLSearchParams({
      page: String(page),
      pageSize: "25",
      ...(status ? { status } : {}),
    });
    authApiGet<Page>(`/profile/notifications/history?${q}`)
      .then((x) => {
        setData(x);
        setError("");
      })
      .catch((c) =>
        setError(
          c instanceof Error
            ? c.message
            : "Could not load notification history.",
        ),
      );
  }, [page, status]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  return (
    <UIProvider className="enterpriseStatePage">
      <main className="enterpriseStateMain">
        <PageHeader
          title="Notification history"
          description="Delivery records for notifications sent to your account."
          actions={<Link href="/profile">Back to profile</Link>}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PROCESSING">Processing</option>
          <option value="SENT">Sent</option>
          <option value="FAILED_RETRYABLE">Retrying</option>
          <option value="FAILED_TERMINAL">Failed</option>
        </Select>
        {error && <Alert tone="danger">{error}</Alert>}
        {!data && !error && (
          <LoadingSpinner label="Loading notification history…" />
        )}
        {data && (
          <Card>
            <CardBody>
              {data.items.length ? (
                <TableContainer label="Notification delivery history">
                  <div role="table">
                    <TableHeaderRow
                      className="enterpriseTableRow enterpriseTableHeader"
                      columns={[
                        "Event",
                        "Channel",
                        "Status",
                        "Created",
                        "Delivered",
                      ]}
                    />
                    {data.items.map((x) => (
                      <div role="row" className="enterpriseTableRow" key={x.id}>
                        <span role="cell" data-label="Event">
                          <Typography variant="label">
                            {x.event_type.replaceAll("_", " ")}
                          </Typography>
                        </span>
                        <span role="cell" data-label="Channel">{x.channel}</span>
                        <span role="cell" data-label="Status">
                          <StatusChip status={x.status} />
                          {x.last_error_code && (
                            <Typography variant="metadata">
                              {x.last_error_code.replaceAll("_", " ")}
                            </Typography>
                          )}
                        </span>
                        <span role="cell" data-label="Created">
                          {new Date(x.created_at).toLocaleString()}
                        </span>
                        <span role="cell" data-label="Delivered">
                          {x.sent_at
                            ? new Date(x.sent_at).toLocaleString()
                            : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </TableContainer>
              ) : (
                <EmptyState title="No notification history">
                  <span>No delivery records match this filter.</span>
                </EmptyState>
              )}
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                total={data.total}
                hasPreviousPage={data.page > 1}
                hasNextPage={data.page < data.totalPages}
                onPrevious={() => setPage((p) => p - 1)}
                onNext={() => setPage((p) => p + 1)}
              />
            </CardBody>
          </Card>
        )}
      </main>
    </UIProvider>
  );
}
