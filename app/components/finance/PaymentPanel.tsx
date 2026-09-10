"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/app/components/shared";
import type { PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

type SlipSecurityStatus = "CLEAN" | "REJECTED" | "SCAN_FAILED" | "PENDING";

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
    [confirmAction, setConfirmAction] = useState<null | {
      title: string;
      message: string;
      onConfirm: () => void;
    }>(null);
  const activePoll = useRef(0);

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

  useEffect(() => {
    if (item.status !== "READY_FOR_PAYMENT" || slipId) return;
    let active = true;
    void api(`/payment-requests/${item.id}`)
      .then((detail) => {
        if (!active) return;
        const documents = (
          detail as {
            documents?: Array<{
              id: string;
              document_type?: string;
              security_status?: string;
            }>;
          }
        ).documents;
        const ready = [...(documents ?? [])]
          .reverse()
          .find(
            (document) =>
              document.document_type === "PAYMENT_SLIP" &&
              document.security_status === "CLEAN",
          );
        if (!ready) return;
        setSlipId(ready.id);
        setNotice("Payment slip ready. Its security check completed successfully.");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id, item.status, slipId]);

  useEffect(() => () => {
    activePoll.current += 1;
  }, []);

  async function waitForSlipReady(documentId: string): Promise<SlipSecurityStatus> {
    const pollId = ++activePoll.current;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (pollId !== activePoll.current) return "PENDING";
      const detail = (await api(`/payment-requests/${item.id}`)) as {
        documents?: Array<{ id: string; security_status?: string }>;
      };
      const status = detail.documents?.find((document) => document.id === documentId)
        ?.security_status;
      if (status === "CLEAN" || status === "REJECTED" || status === "SCAN_FAILED") {
        return status;
      }
      setNotice("Payment slip uploaded. Waiting for the security check to finish…");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return "PENDING";
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setSlipId("");
    try {
      const result = (await api(`/payment-requests/${item.id}/payment-slip`, {
        method: "POST",
        body: new FormData(e.currentTarget),
      })) as { id: string };
      setNotice("Payment slip uploaded securely. AIMS is checking it before it can be used.");
      const status = await waitForSlipReady(result.id);
      if (status === "CLEAN") {
        setSlipId(result.id);
        setNotice("Payment slip ready. Its security check completed successfully.");
      } else if (status === "REJECTED") {
        setNotice("Payment slip rejected. Choose a different file.");
      } else if (status === "SCAN_FAILED") {
        setNotice("Payment slip security check failed. Upload the file again.");
      } else {
        setNotice(
          "Payment slip is still awaiting its security check. Keep this page open, or upload again after the document worker has processed it.",
        );
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

  const canRecord = Boolean(slipId && bankReference.trim() && !busy);

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
      {notice && (
        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}
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
            <button disabled={busy}>
              {busy ? "Checking slip…" : "Upload and check slip"}
            </button>
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
              disabled={!canRecord}
              onClick={requestPaymentConfirmation}
            >
              Record payment
            </button>
            {!canRecord && !busy && (
              <small>
                {!slipId
                  ? "Upload and check a payment slip before recording."
                  : "Enter a bank reference before recording."}
              </small>
            )}
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
