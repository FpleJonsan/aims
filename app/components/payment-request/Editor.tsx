"use client";

import { FormEvent, useState } from "react";
import { AuthorityBadge, ConfirmDialog, Field, StatusChip } from "@/app/components/shared";
import { ApprovalPanel } from "@/app/components/finance/ApprovalPanel";
import { FinanceContextPanel } from "@/app/components/finance/FinanceContextPanel";
import { FinanceControlPanel } from "@/app/components/finance/FinanceControlPanel";
import { FinancialAnalysisPanel } from "@/app/components/finance/FinancialAnalysisPanel";
import { FinancialHumanReview } from "@/app/components/finance/FinancialHumanReview";
import { PaymentPanel } from "@/app/components/finance/PaymentPanel";
import { PolicyDecisionPanel } from "@/app/components/finance/PolicyDecisionPanel";
import { ValidationPanel } from "@/app/components/finance/ValidationPanel";
import { financeNextAction } from "@/app/lib/mappers";
import { discardDraftRequest } from "@/app/lib/request-actions";
import { DocumentSecurityStatus, RequesterRequestExperience } from "@/app/components/payment-request/RequesterDetail";
import { DocumentViewButton } from "@/app/components/payment-request/DocumentViewButton";
import type { PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { formatDate, formatMoney, humanizeRequestError, msg } from "@/app/lib/utils";

export function Editor({
  item,
  user,
  identityHeader = null,
  requesterView,
  api,
  changed,
  back,
  backLabel = "← My Requests",
}: {
  item: PaymentRequestItem;
  user: string;
  identityHeader?: string | null;
  requesterView:boolean;
  api: PortalApi;
  changed: () => Promise<void>;
  back: () => void;
  backLabel?: string;
}) {
  const [form, setForm] = useState(item),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [fieldErrors,setFieldErrors]=useState<Record<string,string>>({}),
    [confirming,setConfirming]=useState(false),
    [submittedTicket,setSubmittedTicket]=useState<string|null>(null),
    [confirmAction, setConfirmAction] = useState<null | {
      title: string;
      message: string;
      confirmLabel?: string;
      variant?: "default" | "destructive";
      onConfirm: () => void;
    }>(null);
  const draft = item.status === "DRAFT";
  const field = (name: keyof PaymentRequestItem, value: string) =>
    setForm((x) => ({ ...x, [name]: value }));
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (e) {
      setNotice(requesterView?humanizeRequestError(e):msg(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await persistDraft();
  }
  async function persistDraft(successMessage="Draft saved. This request has not been submitted to Finance.") {
    await act(async () => {
      const {
        payee,
        purpose,
        category,
        amount,
        currency,
        dueDate,
        paymentMethod,
        paymentDetails,
        remark,
      } = form;
      await api(`/payment-requests/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          payee,
          purpose,
          category,
          amount,
          currency,
          dueDate,
          paymentMethod,
          paymentDetails,
          remark,
        }),
      });
      await changed();
      setNotice(successMessage);
    });
  }
  function submit() {
    setConfirmAction({
      title: "Submit request",
      message: "Submit this request as a controlled snapshot?",
      onConfirm: () => {
        setConfirmAction(null);
        void act(async () => {
          const x = (await api(`/payment-requests/${item.id}/submit`, {
            method: "POST",
            body: "{}",
          })) as PaymentRequestItem;
          await changed();
          setNotice(`Submitted as ${x.ticketNumber}.`);
        });
      },
    });
  }
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    await act(async () => {
      const document=await api(`/payment-requests/${item.id}/documents`, {
        method: "POST",
        body: new FormData(target),
      }) as {id:string};
      setNotice("Document uploaded. You can View it while AIMS completes the security check.");
      try {
        const scan=await api(`/payment-requests/${item.id}/documents/${document.id}/scan`,{method:"POST",body:"{}"}) as {securityStatus:string};
        setNotice(scan.securityStatus==="CLEAN"?"Document ready. Its security check completed successfully.":scan.securityStatus==="REJECTED"?"Document rejected. It cannot be used as supporting evidence.":"Document uploaded. Security check is still pending — you can View it meanwhile.");
      } catch {
        setNotice("Document uploaded. Security scanning runs in the background — you can View it now.");
      }
      await changed();
      target.reset();
    });
  }
  async function remove(id: string) {
    await act(async () => {
      await api(`/payment-requests/${item.id}/documents/${id}`, {
        method: "DELETE",
      });
      await changed();
    });
  }
  function reviewRequesterSubmission(){
    const required:Record<string,string>={payee:"Enter the person or organization to be paid.",purpose:"Explain what this payment is for.",category:"Enter a payment category.",amount:"Enter a valid payment amount.",currency:"Select a currency.",dueDate:"Select when Finance should complete the payment.",paymentMethod:"Select a payment method.",paymentDetails:"Provide the information Finance needs to complete the payment."};
    const next=Object.fromEntries(Object.entries(required).filter(([name])=>!String(form[name as keyof PaymentRequestItem]??"").trim()));
    if(form.amount&&!/^\d+(\.\d{1,4})?$/.test(form.amount)||Number(form.amount)<=0)next.amount="Enter a valid payment amount greater than zero.";
    setFieldErrors(next);
    if(Object.keys(next).length){setNotice("Complete the highlighted fields before reviewing your request.");requestAnimationFrame(()=>document.getElementById(`request-${Object.keys(next)[0]}`)?.focus());return;}
    setNotice("");setConfirming(true);
  }
  async function confirmRequesterSubmission(){
    setConfirming(false);
    await act(async()=>{
      const {payee,purpose,category,amount,currency,dueDate,paymentMethod,paymentDetails,remark}=form;
      await api(`/payment-requests/${item.id}`,{method:"PATCH",body:JSON.stringify({payee,purpose,category,amount,currency,dueDate,paymentMethod,paymentDetails,remark})});
      const submitted=await api(`/payment-requests/${item.id}/submit`,{method:"POST",body:"{}"}) as PaymentRequestItem;
      setSubmittedTicket(submitted.ticketNumber??"Submitted request");await changed();
    });
  }
  function discardDraft() {
    setConfirmAction({
      title: "Discard draft?",
      message:
        "This removes the draft from your active requests. The request will be marked Cancelled and cannot be edited again.",
      confirmLabel: "Discard draft",
      variant: "destructive",
      onConfirm: () => {
        setConfirmAction(null);
        void act(async () => {
          await discardDraftRequest(api, item.id);
          back();
        });
      },
    });
  }
  if (requesterView)
    return (
      <>
        <RequesterRequestExperience
          item={item}
          form={form}
          field={field}
          fieldErrors={fieldErrors}
          busy={busy}
          notice={notice}
          submittedTicket={submittedTicket}
          confirming={confirming}
          setConfirming={setConfirming}
          save={save}
          reviewSubmission={reviewRequesterSubmission}
          confirmSubmission={confirmRequesterSubmission}
          discardDraft={discardDraft}
          upload={upload}
          remove={remove}
          api={api}
          changed={changed}
          back={back}
          backLabel={backLabel}
          identityHeader={identityHeader}
        />
        <ConfirmDialog
          open={!!confirmAction}
          title={confirmAction?.title ?? ""}
          message={confirmAction?.message ?? ""}
          confirmLabel={confirmAction?.confirmLabel ?? "Confirm"}
          cancelLabel="Keep editing"
          variant={confirmAction?.variant ?? "default"}
          busy={busy}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => confirmAction?.onConfirm()}
        />
      </>
    );
  const nextAction=financeNextAction(item.status);
  return (
    <section className="editor">
      <button className="back" onClick={back}>
        {backLabel}
      </button>
      <header>
        <div>
          <small>{item.ticketNumber ?? "REQUEST INITIATION"}</small>
          <h2>{item.payee || "New payment request"}</h2>
        </div>
        <StatusChip status={item.status}/>
      </header>
      {notice && (
        <p className="notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}
      <section className="financeRequestSummary" aria-label="Finance request summary">
        <div><small>TICKET</small><b>{item.ticketNumber??"—"}</b></div><div><small>PAYEE</small><b>{item.payee??"—"}</b></div><div><small>AMOUNT</small><b>{formatMoney(item.currency,item.amount)}</b></div><div><small>DUE DATE</small><b>{formatDate(item.dueDate)}</b></div><div><small>CURRENT STATUS</small><StatusChip status={item.status}/></div>
      </section>
      <section className={`financeCurrentAction ${nextAction.tone}`} aria-labelledby="next-action-title">
        <div><small>WHAT HAPPENS NEXT</small><h3 id="next-action-title">{nextAction.label}</h3><p>{nextAction.detail}</p></div><AuthorityBadge>{item.status==="PAID"?"PAYMENT RECORD":item.status==="FINANCE_HOLD"||item.status==="FINANCE_CHECK"?"FINANCE CONTROL":item.status==="PENDING_APPROVAL"?"APPROVER DECISION":"SYSTEM WORKFLOW"}</AuthorityBadge>
      </section>
      <section className="decisionContext" aria-label="Decision authority context">
        <div><AuthorityBadge>SYSTEM CALCULATED</AuthorityBadge><b>Finance Context</b><span>Budget, actual, commitments, and projected position</span></div>
        <div><AuthorityBadge ai>AI ADVISORY</AuthorityBadge><b>Specialist Analysis</b><span>Evidence-backed interpretation; never authoritative</span></div>
        <div><AuthorityBadge>HUMAN DECISION</AuthorityBadge><b>Final Risk Assessment</b><span>{item.humanFinalRisk?`${item.humanFinalRisk} authoritative risk`:"Accountable human assessment"}</span></div>
        <div><AuthorityBadge>POLICY DECISION</AuthorityBadge><b>Deterministic Policy</b><span>Rules and approval route remain system-controlled</span></div>
      </section>
      {!requesterView&&item.status !== "DRAFT" && (
        <ValidationPanel item={item} user={user} api={api} changed={changed} />
      )}
      {!requesterView&&[
        "VALIDATING",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) && (
        <FinanceContextPanel item={item} user={user} api={api} />
      )}
      {!requesterView&&[
        "VALIDATING",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) && (
        <FinancialAnalysisPanel item={item} user={user} api={api} />
      )}
      {!requesterView&&item.status === "VALIDATING" && user === "demo.finance" && (
        <FinancialHumanReview item={item} api={api} />
      )}
      {!requesterView&&[
        "VALIDATING",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) && (
        <PolicyDecisionPanel item={item} user={user} api={api} />
      )}
      {!requesterView&&[
        "VALIDATING",
        "PENDING_APPROVAL",
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
        "REJECTED",
        "NEEDS_CLARIFICATION",
      ].includes(item.status) && (
        <ApprovalPanel item={item} user={user} api={api} changed={changed} />
      )}
      {!requesterView&&[
        "APPROVED",
        "FINANCE_CHECK",
        "FINANCE_HOLD",
        "READY_FOR_PAYMENT",
        "PAID",
      ].includes(item.status) &&
        user === "demo.finance" && (
          <FinanceControlPanel item={item} api={api} changed={changed} />
        )}
      {!requesterView&&["READY_FOR_PAYMENT", "PAID"].includes(item.status) &&
        user === "demo.finance" && (
          <PaymentPanel item={item} api={api} changed={changed} />
        )}
      <div className="editorGrid">
        <form className="capture" onSubmit={save}>
          <div className="formTitle">
            <span>02</span>
            <p>
              <b>Request Capture</b>
              <small>
                Capture facts only. Validation begins only after submission.
              </small>
            </p>
          </div>
          <div className="fields">
            <Field
              label="Payee"
              value={form.payee}
              set={(v) => field("payee", v)}
              disabled={!draft}
            />
            <Field
              label="Category"
              value={form.category}
              set={(v) => field("category", v)}
              disabled={!draft}
            />
            <Field
              label="Purpose"
              value={form.purpose}
              set={(v) => field("purpose", v)}
              disabled={!draft}
              wide
            />
            <Field
              label="Amount"
              value={form.amount}
              set={(v) => field("amount", v)}
              disabled={!draft}
            />
            <label>
              Currency
              <select
                value={form.currency ?? ""}
                onChange={(e) => field("currency", e.target.value)}
                disabled={!draft}
              >
                <option value="">Select</option>
                {["MYR", "USD", "SGD", "EUR", "GBP"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input
                type="date"
                value={form.dueDate ?? ""}
                onChange={(e) => field("dueDate", e.target.value)}
                disabled={!draft}
              />
            </label>
            <label>
              Payment method
              <select
                value={form.paymentMethod ?? ""}
                onChange={(e) => field("paymentMethod", e.target.value)}
                disabled={!draft}
              >
                <option value="">Select</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CARD">Corporate card</option>
                <option value="CASH">Cash</option>
              </select>
            </label>
            <Field
              label="Payment details"
              value={form.paymentDetails}
              set={(v) => field("paymentDetails", v)}
              disabled={!draft}
              wide
            />
            <Field
              label="Remark"
              value={form.remark}
              set={(v) => field("remark", v)}
              disabled={!draft}
              wide
            />
          </div>
          {draft && (
            <footer>
              <button disabled={busy}>Save draft</button>
              <button
                type="button"
                className="primary"
                onClick={submit}
                disabled={busy}
              >
                Submit request →
              </button>
            </footer>
          )}
        </form>
        <aside className="right">
          <section id="supporting-documents">
            <small>SUPPORTING DOCUMENTS</small>
            {(draft || item.status === "NEEDS_CLARIFICATION") && (
              <form className="upload" onSubmit={upload}>
                <label>Supporting document<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required /></label>
                <label>Document type<input name="documentType" placeholder="Optional" /></label>
                <button disabled={busy}>Upload document</button>
                <small>PDF, JPG or PNG · maximum 10 MB</small>
              </form>
            )}
            {item.documents?.map((d) => (
              <div className="document" key={d.id}>
                <span>DOC</span>
                <p>
                  <b>{d.original_filename}</b>
                  <small>
                    v{d.version} · {Math.ceil(Number(d.size_bytes) / 1024)} KB
                  </small>
                  <DocumentSecurityStatus status={d.security_status}/>
                </p>
                <div className="documentRowActions">
                  <DocumentViewButton
                    requestId={item.id}
                    document={d}
                    identityHeader={identityHeader}
                  />
                  {draft && (
                    <button
                      type="button"
                      aria-label={`Remove ${d.original_filename}`}
                      onClick={() => remove(d.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!item.documents?.length && (
              <p className="muted">No documents attached.</p>
            )}
          </section>
          <section>
            <small>ACTIVITY</small>
            {item.audit?.map((a) => (
              <div className="activity" key={a.id}>
                <i />
                <p>
                  <b>{a.action.replaceAll("_", " ")}</b>
                  <small>{new Date(a.occurred_at).toLocaleString()}</small>
                </p>
              </div>
            ))}
          </section>
        </aside>
      </div>
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title ?? ""}
        message={confirmAction?.message ?? ""}
        confirmLabel={confirmAction?.confirmLabel ?? "Submit"}
        variant={confirmAction?.variant ?? "default"}
        busy={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => confirmAction?.onConfirm()}
      />
    </section>
  );
}
