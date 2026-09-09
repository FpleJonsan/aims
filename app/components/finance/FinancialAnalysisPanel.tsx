"use client";

import { useEffect, useState } from "react";
import type { PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function FinancialAnalysisPanel({
  item,
  user,
  api,
}: {
  item: PaymentRequestItem;
  user: string;
  api: PortalApi;
}) {
  type Agent = {
    agent: string;
    status: string;
    result?: {
      summary?: string;
      confidence?: number;
      findings?: Array<{
        code: string;
        explanation: string;
        evidenceReferences: unknown[];
      }>;
    };
    failure_code?: string;
  };
  type View = {
    id: string;
    source: string;
    status: string;
    ai_assessment?: {
      riskLevel?: string;
      priority?: string;
      urgency?: string;
      summary?: string;
      disagreements?: string[];
    };
    final_risk?: string;
    final_priority?: string;
    agents: Agent[];
    readyForPolicyEvaluation: boolean;
  };
  const [data, setData] = useState<View | null>(null),
    [notice, setNotice] = useState(""),
    [risk, setRisk] = useState("MEDIUM"),
    [priority, setPriority] = useState("NORMAL");
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/financial-analysis`)
      .then((v) => {
        if (active) setData(v as View);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function start() {
    try {
      const value = (await api(
        `/payment-requests/${item.id}/financial-analysis`,
        { method: "POST", body: "{}" },
      )) as View | { mode: string };
      if ("id" in value) setData(value);
      else
        setNotice(
          value.mode === "MANUAL"
            ? "AI Assistance: Disabled · Complete the manual assessment."
            : "AI assistance unavailable · Continue manually.",
        );
    } catch (e) {
      setNotice(msg(e));
    }
  }
  async function manual() {
    try {
      setData(
        (await api(`/payment-requests/${item.id}/financial-analysis/manual`, {
          method: "POST",
          body: JSON.stringify({
            riskLevel: risk,
            priority,
            urgency: priority,
            riskFlags: [],
            financialAssessment: "Finance Context reviewed by Finance.",
            spendingAssessment: "Authoritative historical metrics reviewed.",
            complianceRemarks: "Current Validation and evidence reviewed.",
            evidenceReferences: [
              {
                source: "FINANCE_CONTEXT",
                reference: "current Finance Context snapshot",
                field: "projected_available_amount_minor",
              },
            ],
            remarks: "Manual financial assessment",
          }),
        })) as View,
      );
    } catch (e) {
      setNotice(msg(e));
    }
  }
  return (
    <section className="financialAnalysisPanel">
      <header>
        <div>
          <small>05 · FINANCIAL RISK ANALYSIS</small>
          <h3>Evidence-backed financial intelligence</h3>
        </div>
        <span>{data?.status ?? "NOT STARTED"}</span>
      </header>
      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
      {!data && user === "demo.finance" && (
        <div className="analysisActions">
          <button onClick={start}>Start AI-assisted analysis</button>
          <select aria-label="Manual final risk" value={risk} onChange={(e) => setRisk(e.target.value)}>
            <option>LOW</option>
            <option>MEDIUM</option>
            <option>HIGH</option>
            <option>CRITICAL</option>
          </select>
          <select
            aria-label="Manual final priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option>LOW</option>
            <option>NORMAL</option>
            <option>HIGH</option>
            <option>URGENT</option>
          </select>
          <button onClick={manual}>Complete manually</button>
        </div>
      )}
      {data && (
        <>
          <div className="agentGrid">
            {data.agents.map((a) => (
              <article key={a.agent}>
                <small>{a.agent.replaceAll("_", " ")}</small>
                <b>{a.status}</b>
                <p>
                  {a.result?.summary ??
                    (a.failure_code
                      ? "AI assistance unavailable."
                      : "No result")}
                </p>
                <em>
                  {a.result?.findings?.length ?? 0} evidence-backed finding(s)
                </em>
              </article>
            ))}
          </div>
          {data.ai_assessment && (
            <div className="consolidated">
              <small>AI RECOMMENDATION</small>
              <h4>
                {data.ai_assessment.riskLevel} RISK ·{" "}
                {data.ai_assessment.priority} PRIORITY
              </h4>
              <p>{data.ai_assessment.summary}</p>
              {data.ai_assessment.disagreements?.map((x) => (
                <p key={x}>Disagreement: {x}</p>
              ))}
            </div>
          )}
          {data.status === "FINALIZED" && (
            <div className="humanFinal">
              <small>HUMAN FINAL ASSESSMENT</small>
              <h4>
                {data.final_risk} RISK · {data.final_priority} PRIORITY
              </h4>
            </div>
          )}
          {data.readyForPolicyEvaluation && (
            <p className="readyMarker">
              Financial Risk Analysis finalized · Ready for Day 5 Policy
              Evaluation. No automatic transition was performed.
            </p>
          )}
        </>
      )}
    </section>
  );
}
