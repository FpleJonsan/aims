"use client";

import { useCallback, useEffect, useState } from "react";
import type { PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function PolicyDecisionPanel({
  item,
  user,
  api,
}: {
  item: PaymentRequestItem;
  user: string;
  api: PortalApi;
}) {
  type Step = {
    sequence: number;
    requiredRole: string;
    authorityScope: string;
    reason: string;
  };
  type View = {
    id: string;
    result: string;
    policy_code?: string;
    policy_version?: number;
    matched_rule_ids: string[];
    approval_required: boolean;
    approval_plan: Step[];
    required_evidence: string[];
    escalation?: string;
    auto_approval_eligible: boolean;
    ready_for_approval: boolean;
    stale: boolean;
    exception_id?: string;
    exception_code?: string;
    exception_reason?: string;
    required_justification?: string;
    requested_role?: string;
    exception_status?: string;
  };
  const [data, setData] = useState<View | null>(null),
    [notice, setNotice] = useState(""),
    [justification, setJustification] = useState("");
  const load = useCallback(
    async () => {
      try {
        setData(
          (await api(`/payment-requests/${item.id}/policy-evaluation`)) as View,
        );
      } catch {
        const history = (await api(
          `/payment-requests/${item.id}/policy-evaluation/history`,
        )) as View[];
        setData(history[0] ?? null);
      }
    },
    [api, item.id],
  );
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        return (await api(
          `/payment-requests/${item.id}/policy-evaluation`,
        )) as View;
      } catch {
        const history = (await api(
          `/payment-requests/${item.id}/policy-evaluation/history`,
        )) as View[];
        return history[0] ?? null;
      }
    })()
      .then((v) => {
        if (active) setData(v);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function evaluate() {
    setNotice("");
    try {
      await api(`/payment-requests/${item.id}/policy-evaluation`, {
        method: "POST",
        body: "{}",
      });
      await load();
    } catch (error) {
      setNotice(msg(error));
    }
  }
  async function respond() {
    if (!data?.exception_id) return;
    setNotice("");
    try {
      await api(
        `/payment-requests/${item.id}/policy-clarifications/${data.exception_id}/respond`,
        { method: "POST", body: JSON.stringify({ justification }) },
      );
      setNotice("Justification recorded. Policy re-evaluation is required.");
      await load();
    } catch (error) {
      setNotice(msg(error));
    }
  }
  return (
    <section className="policyPanel">
      <header>
        <div>
          <small>06 · SYSTEM POLICY</small>
          <h3>Policy &amp; Decision</h3>
        </div>
        <span>{data?.result ?? "NOT EVALUATED"}</span>
      </header>
      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
      {!data && user === "demo.finance" && (
        <button className="primary" onClick={evaluate}>
          Evaluate active policy
        </button>
      )}
      {data && (
        <>
          <div className="financeStatus">
            <b>
              {data.policy_code ?? "No applicable policy"}
              {data.policy_version ? ` · v${data.policy_version}` : ""}
            </b>
            <span>{data.stale ? "STALE" : "CURRENT"}</span>
            <span>Matched rules: {data.matched_rule_ids?.length ?? 0}</span>
          </div>
          <div className="financeGrid">
            <article>
              <small>Approval required</small>
              <b>{data.approval_required ? "YES" : "NO"}</b>
            </article>
            <article>
              <small>Auto-approval eligible</small>
              <b>{data.auto_approval_eligible ? "YES" : "NO"}</b>
            </article>
            <article>
              <small>Ready for Approval</small>
              <b>{data.ready_for_approval ? "YES" : "NO"}</b>
            </article>
          </div>
          {data.approval_plan?.length > 0 && (
            <div className="consolidated">
              <small>APPROVAL PLAN · ROLE REQUIREMENTS ONLY</small>
              {data.approval_plan.map((s) => (
                <p key={`${s.sequence}-${s.requiredRole}`}>
                  <b>
                    {s.sequence}. {s.requiredRole}
                  </b>{" "}
                  · {s.authorityScope}
                  <br />
                  {s.reason}
                </p>
              ))}
            </div>
          )}
          {data.required_evidence?.length > 0 && (
            <p>
              <b>Required evidence:</b> {data.required_evidence.join(", ")}
            </p>
          )}
          {data.escalation && (
            <p>
              <b>Escalation:</b> {data.escalation}
            </p>
          )}
          {data.result === "JUSTIFICATION_REQUIRED" && (
            <div className="financeException">
              <b>{data.exception_code?.replaceAll("_", " ")}</b>
              <p>{data.exception_reason}</p>
              <small>
                Required from {data.requested_role}:{" "}
                {data.required_justification}
              </small>
              {data.exception_status === "OPEN" && (
                <>
                  <textarea
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Controlled policy justification"
                  />
                  <button onClick={respond}>Submit justification</button>
                </>
              )}
            </div>
          )}
          {data.exception_status === "JUSTIFIED" && user === "demo.finance" && (
            <button onClick={evaluate}>Re-evaluate policy</button>
          )}
          {data.ready_for_approval && (
            <p className="readyMarker">
              System Policy complete · ready to create the controlled Approval
              case.
            </p>
          )}
        </>
      )}
    </section>
  );
}
