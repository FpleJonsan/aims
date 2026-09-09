"use client";

import { FormEvent, useEffect, useState } from "react";
import { ConfirmDialog } from "@/app/components/shared";
import type { PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function PaymentPanel({
  item,
  api,
  changed,
}: {
  item: PaymentRequestItem;
  api: PortalApi;
  changed: () => Promise<void>;
}) {
  const [slipId, setSlipId] = useState(""),
    [bankReference, setBankReference] = useState(""),
    [paymentDate, setPaymentDate] = useState(
      new Date().toISOString().slice(0, 10),
    ),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [record, setRecord] = useState<Record<string, unknown> | null>(null),
    [confirmAction, setConfirmAction] = useState<null | { title: string; message: string; onConfirm: () => void }>(null);
  useEffect(() => {
    if (item.status === "PAID")
      void api(
        `/payments?search=${encodeURIComponent(item.ticketNumber ?? "")}`,
      )
        .then((x) =>
          setRecord(
            (x as { items: Record<string, unknown>[] }).items[0] ?? null,
          ),
        )
        .catch(() => undefined);
  }, [api, item.status, item.ticketNumber]);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = (await api(`/payment-requests/${item.id}/payment-slip`, {
        method: "POST",
        body: new FormData(e.currentTarget),
      })) as { id: string };
      setNotice("Payment slip uploaded securely. AIMS is checking it before it can be used.");
      const scan = await api(`/payment-requests/${item.id}/documents/${result.id}/scan`, {
        method: "POST",
        body: "{}",
      }) as {securityStatus:string};
      if(scan.securityStatus === "CLEAN"){
        setSlipId(result.id);
        setNotice("Payment slip ready. Its security check completed successfully.");
      }else{
        setSlipId("");
        setNotice(scan.securityStatus === "REJECTED" ? "Payment slip rejected. Choose a different file." : "Payment slip security check failed. Retry the check or upload the file again.");
      }
    } catch (error) {
      setNotice(msg(error));
    } finally {
      setBusy(false);
    }
  }
  async function recordPayment() {
    setBusy(true);
    try {
      await api(`/payment-requests/${item.id}/payment`, {
        method: "POST",
        body: JSON.stringify({
          commandKey: crypto.randomUUID(),
          paymentDate,
          amount: item.amount,
          currency: item.currency,
          bankReference,
          slipDocumentId: slipId,
          confirmPossibleDuplicate: false,
        }),
      });
      setNotice("External payment recorded atomically as PAID.");
      await changed();
    } catch (error) {
      setNotice(msg(error));
    } finally {
      setBusy(false);
    }
  }
  function requestPaymentConfirmation() {
    setConfirmAction({
      title: "Record external payment",
      message:
        "Confirm that Finance executed this payment externally and record it as PAID?",
      onConfirm: () => {
        setConfirmAction(null);
        void recordPayment();
      },
    });
  }
  return (
    <section className="paymentPanel">
      <header>
        <div>
          <small>09 · PAYMENT PROCESSING</small>
          <h3>
            {item.status === "PAID"
              ? "Authoritative payment record"
              : "Record external payment"}
          </h3>
        </div>
        <span>{item.status}</span>
      </header>
      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
      {item.status === "PAID" ? (
        <div className="paymentSummary">
          <b>
            {String(record?.currency ?? item.currency)}{" "}
            {String(record?.amount ?? item.amount)}
          </b>
          <span>
            Bank reference · {String(record?.bankReference ?? "Protected")}
          </span>
          <span>
            Recorded by · {String(record?.recordedByName ?? "Finance")}
          </span>
          <span>
            Payment date · {String(record?.paymentDate ?? "—").slice(0, 10)}
          </span>
        </div>
      ) : (
        <>
          <div className="paymentSummary">
            <b>
              {item.currency} {item.amount}
            </b>
            <span>{item.payee}</span>
            <span>Finance Control · PASSED</span>
            <span>
              AIMS records an external payment; it does not transfer funds.
            </span>
          </div>
          <form className="paymentForm" onSubmit={upload}>
            <label>
              Payment slip
              <input
                name="file"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                required
              />
            </label>
            <button disabled={busy}>{busy?"Checking slip…":"Upload and check slip"}</button>
          </form>
          <div className="paymentForm">
            <label>
              Payment date
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </label>
            <label>
              Bank reference
              <input
                value={bankReference}
                onChange={(e) => setBankReference(e.target.value)}
                maxLength={200}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !slipId || !bankReference.trim()}
              onClick={requestPaymentConfirmation}
            >
              Record payment
            </button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title ?? ""}
        message={confirmAction?.message ?? ""}
        confirmLabel="Record payment"
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => confirmAction?.onConfirm()}
      />
    </section>
  );
}
