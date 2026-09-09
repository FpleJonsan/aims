"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog, StatusChip } from "@/app/components/shared";
import { financeNextAction, requesterListItem } from "@/app/lib/mappers";
import { discardDraftRequest } from "@/app/lib/request-actions";
import { requesterNeedsAction, requesterStatusPresentation } from "@/app/lib/requester-presentation";
import type { FinanceView, PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { formatDate, formatMoney, humanizeRequestError } from "@/app/lib/utils";

export function RequestList({
  items,
  open,
  empty,
  canCreate,
  requesterView,
  paymentOnly = false,
  api,
  financeView,
}: {
  items: PaymentRequestItem[];
  open: (id: string) => void;
  empty: () => void;
  canCreate: boolean;
  requesterView: boolean;
  paymentOnly?: boolean;
  api?: PortalApi;
  financeView?: FinanceView;
}) {
  const [requesterFilters, setRequesterFilters] = useState({
    search: "",
    status: "",
    dateFrom: "",
    dateTo: "",
  });
  const [requesterRows, setRequesterRows] = useState(items);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);

  useEffect(() => {
    if (!requesterView || !api) return;
    let active = true;
    const base = {
      pageSize: "100",
      ...Object.fromEntries(Object.entries(requesterFilters).filter(([, value]) => value)),
    };
    const paymentStatuses = requesterFilters.status
      ? [requesterFilters.status]
      : ["READY_FOR_PAYMENT", "PAID"];
    const work = paymentOnly
      ? Promise.all(
          paymentStatuses.map((status) =>
            api(`/requester/requests?${new URLSearchParams({ ...base, status }).toString()}`)
          )
        ).then((results) =>
          results.flatMap((result) => (result as { items: Array<Record<string, unknown>> }).items)
        )
      : api(`/requester/requests?${new URLSearchParams(base).toString()}`).then(
          (result) => (result as { items: Array<Record<string, unknown>> }).items
        );
    void work
      .then((rows) => {
        if (!active) return;
        setNotice("");
        setRequesterRows(rows.map(requesterListItem));
      })
      .catch((error) => {
        if (!active) return;
        setNotice(humanizeRequestError(error));
      });
    return () => {
      active = false;
    };
  }, [api, paymentOnly, requesterFilters, requesterView]);

  const visibleItems = requesterView
    ? paymentOnly
      ? requesterRows.filter(
          (item) => item.status === "READY_FOR_PAYMENT" || item.status === "PAID"
        )
      : requesterFilters.status
        ? requesterRows
        : requesterRows.filter((item) => item.status !== "CANCELLED")
    : items;

  const financeCopy = financeView
    ? {
        "work-queue": {
          eyebrow: "PRE-APPROVAL OPERATIONS",
          title: "Work Queue",
          description: "Finance work that still needs processing before Approval.",
          empty: "No Finance work pending",
        },
        approvals: {
          eyebrow: "AUTHORIZED DECISIONS",
          title: "Approval Inbox",
          description: "Requests currently requiring your authorized approval.",
          empty: "No approvals require your action",
        },
        "finance-control": {
          eyebrow: "FINAL GATE",
          title: "Finance Control",
          description: "Approved requests requiring final Finance verification.",
          empty: "No requests require Finance Control",
        },
        "payment-queue": {
          eyebrow: "EXTERNAL PAYMENT RECORDING",
          title: "Payment Queue",
          description:
            "Approved and Finance-controlled requests ready for external payment recording.",
          empty: "No payments ready to record",
        },
        "payment-history": {
          eyebrow: "PAYMENT RECORD",
          title: "Payment History",
          description: "Historical, read-only payment records.",
          empty: "No payments in the selected period",
        },
        dashboard: {
          eyebrow: "FINANCE COMMAND CENTER",
          title: "Finance Dashboard",
          description: "Authoritative finance reporting.",
          empty: "No Finance data",
        },
        ai: {
          eyebrow: "AI INTELLIGENCE",
          title: "Finance Watch & Ask AIMS",
          description: "Advisory interpretation of authorized evidence.",
          empty: "No AI insights generated",
        },
      }[financeView]
    : null;

  async function confirmDiscard() {
    if (!api || !confirmDiscardId) return;
    const id = confirmDiscardId;
    setConfirmDiscardId(null);
    setBusyId(id);
    setNotice("");
    try {
      await discardDraftRequest(api, id);
      setRequesterRows((rows) => rows.filter((row) => row.id !== id));
    } catch (error) {
      setNotice(humanizeRequestError(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card listPanel">
      <header className="listPanelHeader">
        <div>
          {!requesterView && financeCopy ? (
            <p className="queueDescription">{financeCopy.description}</p>
          ) : (
            <p className="queueDescription">
              {paymentOnly
                ? "Ready for payment and completed payments."
                : "Filter and open your payment requests."}
            </p>
          )}
        </div>
        <span className="listRecordCount">
          {visibleItems.length} {visibleItems.length === 1 ? "record" : "records"}
        </span>
      </header>
      {notice && (
        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}
      {requesterView && (
        <div className="requesterFilters" aria-label="Filter my requests">
          <label>
            Search
            <input
              value={requesterFilters.search}
              onChange={(event) =>
                setRequesterFilters((value) => ({ ...value, search: event.target.value }))
              }
              placeholder="Ticket, payee or purpose"
            />
          </label>
          <label>
            Status
            <select
              value={requesterFilters.status}
              onChange={(event) =>
                setRequesterFilters((value) => ({ ...value, status: event.target.value }))
              }
            >
              <option value="">All active statuses</option>
              {Object.entries(requesterStatusPresentation)
                .filter(
                  ([status]) =>
                    !paymentOnly || status === "READY_FOR_PAYMENT" || status === "PAID"
                )
                .map(([status, meta]) => (
                  <option key={status} value={status}>
                    {meta.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={requesterFilters.dateFrom}
              onChange={(event) =>
                setRequesterFilters((value) => ({ ...value, dateFrom: event.target.value }))
              }
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={requesterFilters.dateTo}
              onChange={(event) =>
                setRequesterFilters((value) => ({ ...value, dateTo: event.target.value }))
              }
            />
          </label>
          <button
            className="secondary"
            onClick={() =>
              setRequesterFilters({ search: "", status: "", dateFrom: "", dateTo: "" })
            }
          >
            Clear
          </button>
        </div>
      )}
      {visibleItems.length ? (
        <div className={`table ${requesterView ? "requesterRequestList" : "financeQueueList"}`}>
          {visibleItems.map((x, index) => {
            const showDiscard = requesterView && x.status === "DRAFT" && Boolean(api);

            if (!showDiscard) {
              return (
                <button
                  type="button"
                  key={`${x.id}-${index}`}
                  className={
                    requesterView && requesterNeedsAction(x.status) ? "requiresAction" : undefined
                  }
                  onClick={() => open(x.id)}
                >
                  <span className="ticket">{x.ticketNumber ?? "Draft · no ticket"}</span>
                  <span>
                    <b>{x.payee ?? "Untitled request"}</b>
                    <small>{x.purpose ?? "Capture not completed"}</small>
                    {!requesterView && (
                      <small>
                        Due {formatDate(x.dueDate)} · Action: {financeNextAction(x.status).label}
                      </small>
                    )}
                    {requesterView && (
                      <small>
                        {x.submittedAt
                          ? `Submitted ${formatDate(x.submittedAt)}`
                          : "Not submitted to Finance"}
                      </small>
                    )}
                  </span>
                  <span>{formatMoney(x.currency, x.amount)}</span>
                  {x.humanFinalRisk && <span>Human risk: {x.humanFinalRisk}</span>}
                  <span className="requestProgress">
                    <StatusChip status={x.status} />
                    {requesterView && (
                      <>
                        <small>Next owner: {requesterStatusPresentation[x.status].owner}</small>
                        <small>{requesterStatusPresentation[x.status].action}</small>
                      </>
                    )}
                  </span>
                  {requesterView && (
                    <span>
                      {formatDate(x.updatedAt)}
                      <small>Updated</small>
                    </span>
                  )}
                  <strong>{requesterView ? "Open" : "Open Request"} →</strong>
                </button>
              );
            }

            return (
              <div
                className={`requestRow ${requesterNeedsAction(x.status) ? "requiresAction" : ""}`}
                key={`${x.id}-${index}`}
              >
                <button type="button" className="requestRowOpen" onClick={() => open(x.id)}>
                  <span className="ticket">{x.ticketNumber ?? "Draft · no ticket"}</span>
                  <span>
                    <b>{x.payee ?? "Untitled request"}</b>
                    <small>{x.purpose ?? "Capture not completed"}</small>
                    <small>
                      {x.submittedAt
                        ? `Submitted ${formatDate(x.submittedAt)}`
                        : "Not submitted to Finance"}
                    </small>
                  </span>
                  <span>{formatMoney(x.currency, x.amount)}</span>
                  <span className="requestProgress">
                    <StatusChip status={x.status} />
                    <small>Next owner: {requesterStatusPresentation[x.status].owner}</small>
                    <small>{requesterStatusPresentation[x.status].action}</small>
                  </span>
                  <span>
                    {formatDate(x.updatedAt)}
                    <small>Updated</small>
                  </span>
                  <strong>Open →</strong>
                </button>
                <button
                  type="button"
                  className="danger discardDraftRow"
                  disabled={busyId === x.id}
                  onClick={() => setConfirmDiscardId(x.id)}
                >
                  Discard
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <h3>
            {items.length
              ? "No requests match these filters"
              : requesterView
                ? paymentOnly
                  ? "No completed payments yet."
                  : "You haven’t submitted any payment requests yet."
                : (financeCopy?.empty ?? "No Finance work pending")}
          </h3>
          <p>
            {items.length
              ? "Clear or change the filters to see more requests."
              : paymentOnly
                ? "Requests will appear here when they are ready for payment or paid."
                : "Create a request when you need Finance to process a payment."}
          </p>
          {canCreate && (
            <button className="primary" onClick={empty}>
              Start first request
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirmDiscardId)}
        title="Discard draft?"
        message="This draft will be cancelled and removed from your active request list."
        confirmLabel="Discard draft"
        cancelLabel="Keep draft"
        variant="destructive"
        busy={Boolean(busyId)}
        onCancel={() => setConfirmDiscardId(null)}
        onConfirm={() => void confirmDiscard()}
      />
    </section>
  );
}
