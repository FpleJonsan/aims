"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog, KpiCard, StatusChip } from "@/app/components/shared";
import { requesterListItem } from "@/app/lib/mappers";
import { discardDraftRequest } from "@/app/lib/request-actions";
import { requesterStatusPresentation } from "@/app/lib/requester-presentation";
import type { PaymentRequestItem, PortalApi, RequesterDashboardSummary } from "@/app/lib/types";
import { formatDate, formatMoney, humanizeRequestError, msg } from "@/app/lib/utils";

export function RequesterDashboard({
  api,
  open,
  newRequest,
  viewAll,
}: {
  api: PortalApi;
  open: (id: string) => Promise<void>;
  newRequest: () => void;
  viewAll: () => void;
}) {
  const [summary, setSummary] = useState<RequesterDashboardSummary | null>(null);
  const [recent, setRecent] = useState<PaymentRequestItem[]>([]);
  const [attention, setAttention] = useState<PaymentRequestItem[]>([]);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api("/requester/dashboard"),
      api("/requester/requests?pageSize=5"),
      api("/requester/requests?pageSize=5&status=NEEDS_CLARIFICATION"),
      api("/requester/requests?pageSize=5&status=DRAFT"),
    ])
      .then(([s, r, clarifications, drafts]) => {
        if (!active) return;
        setSummary(s as RequesterDashboardSummary);
        setRecent(
          (r as { items: Array<Record<string, unknown>> }).items
            .map(requesterListItem)
            .filter((item) => item.status !== "CANCELLED")
        );
        setAttention(
          [
            ...(clarifications as { items: Array<Record<string, unknown>> }).items,
            ...(drafts as { items: Array<Record<string, unknown>> }).items,
          ].map(requesterListItem)
        );
      })
      .catch((e) => {
        if (active) setNotice(msg(e));
      });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  async function confirmDiscard() {
    if (!confirmDiscardId) return;
    const id = confirmDiscardId;
    setConfirmDiscardId(null);
    setBusyId(id);
    setNotice("");
    try {
      await discardDraftRequest(api, id);
      setReloadKey((value) => value + 1);
    } catch (error) {
      setNotice(humanizeRequestError(error));
    } finally {
      setBusyId(null);
    }
  }

  if (!summary)
    return (
      <section className="card">
        <p>{notice || "Loading your requests…"}</p>
      </section>
    );

  return (
    <section className="requesterDashboard">
      {notice && (
        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}
      <section className="attentionSection" aria-labelledby="attention-title">
        <div className="sectionHeading">
          <div>
            <small>ACTION REQUIRED</small>
            <h3 id="attention-title">Needs My Attention</h3>
          </div>
          <span>{summary.needsClarification + summary.drafts} open</span>
        </div>
        {attention.length ? (
          <div className="attentionList">
            {attention.map((item) => {
              const clarification = item.status === "NEEDS_CLARIFICATION";
              return (
                <article key={item.id}>
                  <span className="attentionIcon">!</span>
                  <div>
                    <StatusChip status={item.status} />
                    <h4>
                      {item.ticketNumber || "Draft request"} · {item.payee || "Payee not added"}
                    </h4>
                    <p>
                      {clarification
                        ? "Finance needs additional information before this request can continue."
                        : "This draft has not been submitted to Finance."}
                    </p>
                    <small>
                      {clarification
                        ? "Open the request to review what Finance needs."
                        : `Last updated ${formatDate(item.updatedAt)}`}
                    </small>
                  </div>
                  <div className="attentionActions">
                    <button className="primary" onClick={() => void open(item.id)}>
                      {clarification ? "Respond" : "Continue Request"}
                    </button>
                    {item.status === "DRAFT" && (
                      <button
                        type="button"
                        className="danger"
                        disabled={busyId === item.id}
                        onClick={() => setConfirmDiscardId(item.id)}
                      >
                        Discard
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="quietEmpty">
            <b>You’re all caught up.</b>
            <span>No requests currently need your action.</span>
          </div>
        )}
      </section>
      <section aria-label="Request summary">
        <div className="sectionHeading">
          <div>
            <small>REQUEST SUMMARY</small>
            <h3>Your requests at a glance</h3>
          </div>
        </div>
        <div className="requesterMetrics">
          <KpiCard
            icon="☷"
            label="Total Requests"
            value={String(summary.myRequests)}
            detail="Requests you created"
          />
          <KpiCard
            icon="!"
            label="Needs My Attention"
            value={String(summary.needsClarification + summary.drafts)}
            detail="Drafts and clarifications"
            tone="warning"
          />
          <KpiCard
            icon="◷"
            label="In Progress"
            value={String(summary.inProgress)}
            detail="With Finance"
            tone="info"
          />
          <KpiCard
            icon="✓"
            label="Waiting for Approval"
            value={String(summary.pendingApproval)}
            detail="With an approver"
            tone="warning"
          />
          <KpiCard
            icon="→"
            label="Ready for Payment"
            value={String(summary.readyForPayment)}
            detail="Payment not yet recorded"
            tone="success"
          />
          <KpiCard
            icon="●"
            label="Paid"
            value={String(summary.paid)}
            detail="Payment recorded"
            tone="success"
          />
        </div>
      </section>
      <section className="card">
        <header>
          <div>
            <small>RECENT REQUESTS</small>
            <h3>Recently updated</h3>
          </div>
          <button className="textButton" onClick={viewAll}>
            View all requests →
          </button>
        </header>
        {recent.length ? (
          <div className="requesterRecent requesterRecentDetailed">
            {recent.map((item) => (
              <div className="recentRequestRow" key={item.id}>
                <button type="button" className="recentRequestOpen" onClick={() => void open(item.id)}>
                  <span>
                    <b>{item.ticketNumber || "Draft request"}</b>
                    <small>
                      {item.payee || "Payee not added"} · {item.purpose || "Purpose not added"}
                    </small>
                  </span>
                  <span>{formatMoney(item.currency, item.amount)}</span>
                  <span>
                    <StatusChip status={item.status} />
                    <small>Next: {requesterStatusPresentation[item.status].action}</small>
                  </span>
                  <span>{formatDate(item.updatedAt)}</span>
                  <strong>View →</strong>
                </button>
                {item.status === "DRAFT" && (
                  <button
                    type="button"
                    className="danger discardDraftRow"
                    disabled={busyId === item.id}
                    onClick={() => setConfirmDiscardId(item.id)}
                  >
                    Discard
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="emptyState">
            <b>You haven’t submitted any payment requests yet.</b>
            <span>Create a request when you need Finance to process a payment.</span>
            <button className="primary" onClick={newRequest}>
              Create Request
            </button>
          </div>
        )}
      </section>
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
