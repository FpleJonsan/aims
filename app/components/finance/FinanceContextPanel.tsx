"use client";

import { useEffect, useState } from "react";
import type { PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function FinanceContextPanel({
  item,
  user,
  api,
}: {
  item: PaymentRequestItem;
  user: string;
  api: PortalApi;
}) {
  type Money = { minor: string; decimal: string };
  type View = {
    status: string;
    exceptionCode?: string;
    fiscalYear?: number;
    category: string;
    requestCurrency: string;
    budgetCurrency?: string;
    originalBudget?: Money;
    revisedBudget?: Money;
    actual?: Money;
    committed?: Money;
    available?: Money;
    requestAmount: Money;
    projectedAvailable?: Money;
    historicalSummary?: Record<string, string | boolean>;
    readyForFinancialRiskAnalysis: boolean;
  };
  const [data, setData] = useState<View | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/finance-context`)
      .then((value) => {
        if (active) setData(value as View);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function calculate() {
    setBusy(true);
    setNotice("");
    try {
      setData(
        (await api(`/payment-requests/${item.id}/finance-context`, {
          method: "POST",
          body: "{}",
        })) as View,
      );
    } catch (error) {
      setNotice(msg(error));
    } finally {
      setBusy(false);
    }
  }
  const amount = (money?: Money) =>
    money ? `${data?.requestCurrency ?? "MYR"} ${money.decimal}` : "—";
  return (
    <section className="financeContextPanel">
      <header>
        <div>
          <small>04 · FINANCE CONTEXT</small>
          <h3>Authoritative financial context</h3>
        </div>
        <span>SYSTEM CALCULATED</span>
      </header>
      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
      {!data && user === "demo.finance" && (
        <button className="primary" disabled={busy} onClick={calculate}>
          {busy ? "Calculating…" : "Calculate Finance Context"}
        </button>
      )}
      {!data && user !== "demo.finance" && (
        <p className="muted">Finance Context has not been calculated.</p>
      )}
      {data && (
        <>
          <div className="financeStatus">
            <b>{data.status}</b>
            <span>Fiscal year {data.fiscalYear ?? "—"}</span>
            <span>{data.category}</span>
          </div>
          {data.exceptionCode ? (
            <>
              <p className="financeException">
                <b>Finance Context exception</b>
                <br />
                {data.exceptionCode.replaceAll("_", " ")} · Finance attention is
                required before Stage 5.
              </p>
              {user === "demo.finance" && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      setData(
                        (await api(
                          `/payment-requests/${item.id}/finance-context/recalculate`,
                          { method: "POST", body: "{}" },
                        )) as View,
                      );
                    } catch (error) {
                      setNotice(msg(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Recalculate after correction
                </button>
              )}
            </>
          ) : (
            <>
              <div className="financeGrid">
              {[
                  ["Original budget", amount(data.originalBudget)],
                  ["Revised budget", amount(data.revisedBudget)],
                  ["Actual spending", amount(data.actual)],
                  ["Active commitments", amount(data.committed)],
                  ["Available budget", amount(data.available)],
                  ["Current request", amount(data.requestAmount)],
                  ["Projected available", amount(data.projectedAvailable)],
                ].map(([label, value]) => (
                  <article key={label}>
                    <small>{label}</small>
                    <b>{value}</b>
                  </article>
                ))}
              </div>
              <p className="financeFormula">
                AVAILABLE = REVISED − ACTUAL − ACTIVE COMMITMENTS
              </p>
            </>
          )}
          {data.readyForFinancialRiskAnalysis && (
            <p className="readyMarker">
              Finance Context complete · Ready for Day 4 Financial Risk
              Analysis. No automatic transition was performed.
            </p>
          )}
        </>
      )}
    </section>
  );
}
