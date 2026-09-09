"use client";

import { useCallback, useEffect, useState } from "react";
import type { PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function FinanceControlPanel({
  item,
  api,
  changed,
}: {
  item: PaymentRequestItem;
  api: PortalApi;
  changed: () => Promise<void>;
}) {
  type Check = {
    code: string;
    source: string;
    result: string;
    safe_detail?: object;
  };
  type Confirmation = { code: string; confirmed: boolean };
  type Run = {
    id: string;
    run_version: number;
    status: string;
    duplicate_status: string;
    evidence_fingerprint: string;
  };
  type View = {
    run: Run | null;
    checks: Check[];
    confirmations: Confirmation[];
    exception: null | {
      failed_check_codes: string[];
      reason: string;
      status: string;
    };
    readyForPayment: boolean;
  };
  type History = {
    id: string;
    run_version: number;
    status: string;
    is_current: boolean;
  };
  const [data, setData] = useState<View | null>(null),
    [history, setHistory] = useState<History[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const load = useCallback(async () => {
    setData(
      (await api(`/payment-requests/${item.id}/finance-control`)) as View,
    );
    setHistory(
      (
        (await api(`/payment-requests/${item.id}/finance-control/history`)) as {
          items: History[];
        }
      ).items,
    );
  }, [api, item.id]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api(`/payment-requests/${item.id}/finance-control`),
      api(`/payment-requests/${item.id}/finance-control/history`),
    ])
      .then(([view, runs]) => {
        if (active) {
          setData(view as View);
          setHistory((runs as { items: History[] }).items);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
      await load();
      await changed();
    } catch (error) {
      setNotice(msg(error));
    } finally {
      setBusy(false);
    }
  }
  const confirmations = [
    ["PAYEE_VERIFIED", "Payee identity verified"],
    ["PAYMENT_METHOD_VERIFIED", "Payment method verified"],
    ["PAYMENT_DETAILS_VERIFIED", "Payment details verified"],
    ["SUPPORTING_DOCUMENTS_VERIFIED", "Supporting documents verified"],
    ...(data?.run?.duplicate_status === "POSSIBLE_DUPLICATE"
      ? [["POSSIBLE_DUPLICATE_REVIEWED", "Possible duplicate reviewed"]]
      : []),
  ];
  const confirmed = new Set(
    data?.confirmations.filter((x) => x.confirmed).map((x) => x.code),
  );
  return (
    <section className="financeControlPanel">
      <header>
        <div>
          <small>08 · FINAL FINANCE CONTROL</small>
          <h3>Independent pre-payment verification</h3>
        </div>
        <span>{data?.run?.status ?? "NOT STARTED"}</span>
      </header>
      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
      {!data?.run && item.status === "APPROVED" && (
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api(`/payment-requests/${item.id}/finance-control`, {
                method: "POST",
                body: "{}",
              });
            })
          }
        >
          Start Final Finance Control
        </button>
      )}
      {data?.run && (
        <>
          <div className="financeStatus">
            <b>Run v{data.run.run_version}</b>
            <span>
              Duplicate: {data.run.duplicate_status.replaceAll("_", " ")}
            </span>
            <span>Evidence: {data.run.evidence_fingerprint.slice(0, 12)}…</span>
          </div>
          {data.run.status === "CHECKING" && (
            <div className="controlConfirmations">
              {confirmations.map(([code, label]) => (
                <button
                  key={code}
                  disabled={busy || confirmed.has(code)}
                  onClick={() =>
                    run(async () => {
                      await api(`/finance-control/${data.run!.id}/checks`, {
                        method: "POST",
                        body: JSON.stringify({ code, confirmed: true }),
                      });
                    })
                  }
                >
                  <b>{confirmed.has(code) ? "✓" : "○"}</b> {label}
                </button>
              ))}
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`/finance-control/${data.run!.id}/finalize`, {
                      method: "POST",
                      body: JSON.stringify({ commandKey: crypto.randomUUID() }),
                    });
                  })
                }
              >
                Run deterministic controls
              </button>
            </div>
          )}
          {data.checks.length > 0 && (
            <div className="controlChecks">
              {data.checks.map((check) => (
                <p key={check.code}>
                  <b>{check.result}</b>
                  <span>{check.code.replaceAll("_", " ")}</span>
                  <small>{check.source}</small>
                </p>
              ))}
            </div>
          )}
          {data.run.status === "HOLD" && (
            <div className="financeException">
              <b>Finance Hold</b>
              <p>{data.exception?.reason}</p>
              <small>{data.exception?.failed_check_codes?.join(", ")}</small>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Resolution note required"
              />
              <button
                disabled={busy || !note.trim()}
                onClick={() =>
                  run(async () => {
                    await api(`/finance-control/${data.run!.id}/hold/resolve`, {
                      method: "POST",
                      body: JSON.stringify({ resolution: "RECHECK", note }),
                    });
                    setNote("");
                  })
                }
              >
                Resolve and recheck
              </button>
            </div>
          )}
          {data.readyForPayment && (
            <p className="readyMarker">
              Final Finance Control passed · READY FOR PAYMENT. Payment
              Processing is not implemented in Day 7.
            </p>
          )}
        </>
      )}
      <div className="controlHistory">
        <small>CONTROL HISTORY</small>
        {history.length ? (
          history.map((run) => (
            <p key={run.id}>
              v{run.run_version} · {run.status}
              {run.is_current ? " · CURRENT" : ""}
            </p>
          ))
        ) : (
          <p>No completed control runs.</p>
        )}
      </div>
    </section>
  );
}
