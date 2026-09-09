"use client";

import { useEffect, useState } from "react";
import type { PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function FinancialHumanReview({ item, api }: { item: PaymentRequestItem; api: PortalApi }) {
  type View = {
    id: string;
    status: string;
    ai_assessment?: { riskLevel?: string; priority?: string };
  };
  const [data, setData] = useState<View | null>(null),
    [risk, setRisk] = useState("MEDIUM"),
    [priority, setPriority] = useState("NORMAL"),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/financial-analysis`)
      .then((value) => {
        if (active) setData(value as View);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  if (data?.status !== "AWAITING_HUMAN_REVIEW") return null;
  async function finalize() {
    if (!data) return;
    try {
      await api(
        `/payment-requests/${item.id}/financial-analysis/${data.id}/finalize`,
        {
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
            remarks: "Human final assessment",
            overrideReason:
              data.ai_assessment &&
              (data.ai_assessment.riskLevel !== risk ||
                data.ai_assessment.priority !== priority)
                ? "Finance reviewer adjusted the AI recommendation."
                : undefined,
          }),
        },
      );
      setData(
        (await api(`/payment-requests/${item.id}/financial-analysis`)) as View,
      );
    } catch (error) {
      setNotice(msg(error));
    }
  }
  return (
    <section className="humanFinal">
      <small>HUMAN REVIEW · ACCOUNTABLE FINAL ASSESSMENT</small>
      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
      <select aria-label="Human final risk" value={risk} onChange={(event) => setRisk(event.target.value)}>
        <option>LOW</option>
        <option>MEDIUM</option>
        <option>HIGH</option>
        <option>CRITICAL</option>
      </select>
      <select
        aria-label="Human final priority"
        value={priority}
        onChange={(event) => setPriority(event.target.value)}
      >
        <option>LOW</option>
        <option>NORMAL</option>
        <option>HIGH</option>
        <option>URGENT</option>
      </select>
      <button onClick={finalize}>Finalize assessment</button>
    </section>
  );
}
