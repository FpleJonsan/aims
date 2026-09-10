"use client";

import { useCallback, useEffect, useState } from "react";
import type { PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function ApprovalPanel({
  item,
  user,
  api,
  changed,
}: {
  item: PaymentRequestItem;
  user: string;
  api: PortalApi;
  changed: () => Promise<void>;
}) {
  type Step = {
    id: string;
    sequence: number;
    required_role: string;
    authority_scope: string;
    reason: string;
    status: string;
    completed_at?: string;
  };
  type View = {
    case: null | {
      id: string;
      status: string;
      policy_decision_run_id: string;
      source: string;
    };
    steps: Step[];
    readyForFinanceControl: boolean;
    commitmentStatus?: string;
    detail?: Record<string, unknown>;
    evidence?: Array<Record<string, unknown>>;
    history?: Array<Record<string, unknown>>;
  };
  const [data, setData] = useState<View | null>(null),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState("");
  const load = useCallback(
    async () =>
      setData((await api(`/payment-requests/${item.id}/approval`)) as View),
    [api, item.id],
  );
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/approval`)
      .then((v) => {
        if (active) setData(v as View);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function create() {
    setNotice("");
    try {
      await api(`/payment-requests/${item.id}/approval`, {
        method: "POST",
        body: "{}",
      });
      await load();
      await changed();
    } catch (e) {
      const message = msg(e);
      setNotice(
        message === "Approval route is unresolved"
          ? "Approval route is unresolved. Re-evaluate System Policy after the human-final risk and amount match an active rule (for demo: LOW ≤ MYR 1,000 auto-approves; MEDIUM ≤ MYR 1,000 needs AM review)."
          : message,
      );
    }
  }
  async function action(
    step: Step,
    kind: "APPROVE" | "REJECT" | "REQUEST_CLARIFICATION",
  ) {
    try {
      await api(
        `/payment-requests/${item.id}/approval/steps/${step.id}/actions`,
        {
          method: "POST",
          body: JSON.stringify({
            commandKey: crypto.randomUUID(),
            action: kind,
            reason: kind === "APPROVE" ? undefined : reason,
            requiredResponse:
              kind === "REQUEST_CLARIFICATION"
                ? "Provide the requested information; the request will return to Validation."
                : undefined,
          }),
        },
      );
      setReason("");
      await load();
      await changed();
    } catch (e) {
      setNotice(msg(e));
    }
  }
  const active = data?.steps.find((s) => s.status === "ACTIVE");
  return (
    <section className="policyPanel">
      <header>
        <div>
          <small>07 · HUMAN ACCOUNTABILITY</small>
          <h3>Approval</h3>
        </div>
        <span>{data?.case?.status ?? "NOT STARTED"}</span>
      </header>
      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
      {!data?.case && user === "demo.finance" && (
        <button className="primary" onClick={create}>
          Create Approval case
        </button>
      )}
      {data?.case && (
        <>
          <p>
            <b>System Policy reference:</b> {data.case.policy_decision_run_id}
          </p>
          <p>
            <b>Source:</b> {data.case.source}
          </p>
          <p>
            <b>Commitment:</b> {data.commitmentStatus ?? "NOT AVAILABLE"}
          </p>
          {data.detail && (
            <div className="financeGrid">
              <article>
                <small>FINANCE CONTEXT · DETERMINISTIC</small>
                <b>Available: {String(data.detail.available_amount_minor)}</b>
                <span>
                  Projected:{" "}
                  {String(data.detail.projected_available_amount_minor)}
                </span>
              </article>
              <article>
                <small>AI ANALYSIS · ADVISORY</small>
                <b>{data.detail.ai_assessment ? "Available" : "Not used"}</b>
              </article>
              <article>
                <small>HUMAN FINAL ASSESSMENT · ACCOUNTABLE</small>
                <b>{String(data.detail.final_risk)}</b>
                <span>{String(data.detail.final_priority)}</span>
              </article>
              <article>
                <small>SYSTEM POLICY · DETERMINISTIC</small>
                <b>{String(data.detail.policy_result)}</b>
              </article>
            </div>
          )}
          <div className="consolidated">
            <small>EVIDENCE</small>
            {data.evidence?.map((e) => (
              <p key={String(e.id)}>
                {String(e.original_filename)} ·{" "}
                {String(e.document_type ?? "UNCLASSIFIED")} · v
                {String(e.version)}
              </p>
            ))}
          </div>
          <div className="consolidated">
            <small>SEQUENTIAL APPROVAL ROUTE</small>
            {data.steps.map((s) => (
              <p key={s.id}>
                <b>
                  {s.sequence}. {s.required_role}
                </b>{" "}
                · {s.authority_scope} · {s.status}
                <br />
                {s.reason}
              </p>
            ))}
          </div>
          <div className="consolidated">
            <small>APPROVAL HISTORY</small>
            {data.history?.length ? (
              data.history.map((h, i) => (
                <p key={i}>
                  {String(h.action)} · {String(h.channel)} ·{" "}
                  {String(h.required_role ?? "Policy")}
                </p>
              ))
            ) : (
              <p>No completed actions.</p>
            )}
          </div>
          {active && user === "demo.approver" && (
            <div className="financeException">
              <b>Current approval step</b>
              <p>{active.required_role} · Human decision</p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason required for reject or clarification"
              />
              <button onClick={() => action(active, "APPROVE")}>Approve</button>
              <button onClick={() => action(active, "REQUEST_CLARIFICATION")}>
                Request clarification
              </button>
              <button onClick={() => action(active, "REJECT")}>Reject</button>
            </div>
          )}
          {data.readyForFinanceControl && (
            <p className="readyMarker">
              Approval complete · ready for Final Finance Control.
            </p>
          )}
        </>
      )}
    </section>
  );
}
