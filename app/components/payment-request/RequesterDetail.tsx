"use client";

import { FormEvent, useState } from "react";
import { DocumentViewButton } from "@/app/components/payment-request/DocumentViewButton";
import { ConfirmDialog, Field, stages, statusStage, StatusChip } from "@/app/components/shared";
import {
  clarificationActionable,
  friendlyActivity,
  requesterActivityVisible,
  requesterStatusPresentation,
} from "@/app/lib/requester-presentation";
import type { DocumentSecurityStatus as DocSec, PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { formatDate, formatMoney, humanizeRequestError } from "@/app/lib/utils";

export function RequesterRequestExperience({item,form,field,fieldErrors,busy,notice,submittedTicket,confirming,setConfirming,save,reviewSubmission,confirmSubmission,discardDraft,upload,remove,api,changed,back,backLabel="← My Requests",identityHeader=null}:{item:PaymentRequestItem;form:PaymentRequestItem;field:(name:keyof PaymentRequestItem,value:string)=>void;fieldErrors:Record<string,string>;busy:boolean;notice:string;submittedTicket:string|null;confirming:boolean;setConfirming:(value:boolean)=>void;save:(event:FormEvent)=>Promise<void>;reviewSubmission:()=>void;confirmSubmission:()=>Promise<void>;discardDraft:()=>void;upload:(event:FormEvent<HTMLFormElement>)=>Promise<void>;remove:(id:string)=>Promise<void>;api:PortalApi;changed:()=>Promise<void>;back:()=>void;backLabel?:string;identityHeader?:string|null}){
  const draft=item.status==="DRAFT";
  if(submittedTicket)return <section className="requesterSuccess" role="status"><span aria-hidden="true">✓</span><small>REQUEST SUBMITTED</small><h2>{submittedTicket}</h2><p>Finance can now begin reviewing your request. If Finance needs more information, AIMS will highlight it in Needs My Attention.</p><div><button className="primary" onClick={()=>void changed()}>View Request</button><button onClick={back}>{backLabel.replace(/^←\s*/,"") || "Back"}</button></div></section>;
  return <section className="requesterRequestExperience">
    <div className="requesterDetailToolbar">
      <button type="button" className="back" onClick={back}>{backLabel}</button>
      {draft&&<button type="button" className="danger textButton discardDraft" disabled={busy} onClick={discardDraft}>Discard draft</button>}
    </div>
    <header className="requesterRequestHeader"><div><small>{item.ticketNumber??"DRAFT · NOT SUBMITTED"}</small><h2>{draft?"New Payment Request":item.payee||"Payment request"}</h2><p>{draft?"Complete the sections below, attach supporting documents, then review before submitting.":item.purpose}</p></div><StatusChip status={item.status}/></header>
    {notice&&<p className="notice" role="status" aria-live="polite">{notice}</p>}
    {draft?<>
      <form className="requesterDraftForm" onSubmit={save} noValidate>
        <section><header><span>1</span><div><small>PAYMENT DETAILS</small><h3>What is this payment for?</h3></div></header><div className="fields">
          <Field id="request-payee" label="Payee / Payer" value={form.payee} set={value=>field("payee",value)} disabled={false} required error={fieldErrors.payee}/>
          <Field id="request-category" label="Category" value={form.category} set={value=>field("category",value)} disabled={false} required error={fieldErrors.category}/>
          <Field id="request-purpose" label="Purpose" help="Explain what this payment is for." value={form.purpose} set={value=>field("purpose",value)} disabled={false} required error={fieldErrors.purpose} wide/>
          <Field id="request-amount" label="Amount" value={form.amount} set={value=>field("amount",value)} disabled={false} required error={fieldErrors.amount}/>
          <label className={fieldErrors.currency?"fieldInvalid":""} htmlFor="request-currency"><span>Currency <b>Required</b></span><select id="request-currency" value={form.currency??""} onChange={event=>field("currency",event.target.value)} aria-invalid={Boolean(fieldErrors.currency)} aria-describedby={fieldErrors.currency?"request-currency-error":undefined}><option value="">Select currency</option>{["MYR","USD","SGD","EUR","GBP"].map(value=><option key={value}>{value}</option>)}</select>{fieldErrors.currency&&<small id="request-currency-error" role="alert">{fieldErrors.currency}</small>}</label>
          <label className={fieldErrors.dueDate?"fieldInvalid":""} htmlFor="request-dueDate"><span>Due Date <b>Required</b></span><small>When should Finance complete this payment?</small><input id="request-dueDate" type="date" value={form.dueDate??""} onChange={event=>field("dueDate",event.target.value)} aria-invalid={Boolean(fieldErrors.dueDate)} aria-describedby={fieldErrors.dueDate?"request-dueDate-error":undefined}/>{fieldErrors.dueDate&&<small id="request-dueDate-error" role="alert">{fieldErrors.dueDate}</small>}</label>
          <label><span>Department</span><small>Your assigned department will be used.</small><input value="Your assigned department" disabled/></label>
        </div></section>
        <section><header><span>2</span><div><small>PAYMENT METHOD</small><h3>How should Finance complete it?</h3></div></header><div className="fields">
          <label className={fieldErrors.paymentMethod?"fieldInvalid":""} htmlFor="request-paymentMethod"><span>Payment Method <b>Required</b></span><select id="request-paymentMethod" value={form.paymentMethod??""} onChange={event=>field("paymentMethod",event.target.value)} aria-invalid={Boolean(fieldErrors.paymentMethod)}><option value="">Select payment method</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD">Corporate card</option><option value="CASH">Cash</option></select>{fieldErrors.paymentMethod&&<small role="alert">{fieldErrors.paymentMethod}</small>}</label>
          <Field id="request-paymentDetails" label="Payment Details" help="Provide the information Finance needs to complete the external payment." value={form.paymentDetails} set={value=>field("paymentDetails",value)} disabled={false} required error={fieldErrors.paymentDetails} wide/>
          <Field id="request-remark" label="Remark" help="Add any additional context for Finance." value={form.remark} set={value=>field("remark",value)} disabled={false} optional wide/>
        </div></section>
        <footer>
          <button disabled={busy}>Save Draft</button>
          <button type="button" className="danger" disabled={busy} onClick={discardDraft}>Discard draft</button>
          <span>Saving a draft does not submit it to Finance.</span>
        </footer>
      </form>
      <RequesterDocuments item={item} editable upload={upload} remove={remove} busy={busy} identityHeader={identityHeader}/>
      <section className="requestReview"><header><span>4</span><div><small>REVIEW & SUBMIT</small><h3>Check your request</h3></div></header><div className="reviewSummary"><p><span>Payee</span><b>{form.payee||"Not added"}</b></p><p><span>Purpose</span><b>{form.purpose||"Not added"}</b></p><p><span>Amount</span><b>{formatMoney(form.currency,form.amount)}</b></p><p><span>Due date</span><b>{formatDate(form.dueDate)}</b></p><p><span>Documents</span><b>{item.documents?.length??0} attached</b></p></div><div className="requestReviewActions"><button className="primary" disabled={busy} onClick={reviewSubmission}>Review and Submit →</button></div></section>
      <ConfirmDialog
        open={confirming}
        title="Submit this request?"
        message="After submission, Finance will begin reviewing the request. Editing becomes restricted. If corrections are needed later, Finance may request clarification or revised information."
        confirmLabel="Submit Request"
        cancelLabel="Continue Editing"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void confirmSubmission()}
      />
    </>:<RequesterSubmittedDetail item={item} api={api} changed={changed} upload={upload} busy={busy} identityHeader={identityHeader}/>}
  </section>;
}

export function RequesterDocuments({item,editable,upload,remove,busy,identityHeader}:{item:PaymentRequestItem;editable:boolean;upload:(event:FormEvent<HTMLFormElement>)=>Promise<void>;remove?:(id:string)=>Promise<void>;busy:boolean;identityHeader?:string|null}){
  return <section className="requesterDocuments" id="supporting-documents"><header><span>3</span><div><small>SUPPORTING DOCUMENTS</small><h3>Invoices and supporting files</h3><p>Uploaded files are checked before AIMS accepts them as supporting evidence.</p></div></header>{editable&&<form className="upload" onSubmit={upload}><label>Choose document<input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required/></label><label>Document type <small>Optional</small><input name="documentType" placeholder="Invoice, quotation, contract…"/></label><button disabled={busy}>{busy?"Checking document…":"Upload Document"}</button><small>PDF, JPG or PNG · maximum 10 MB · private security check required</small></form>}<div className="requesterDocumentList">{item.documents?.map(document=><article key={document.id}><span>DOC</span><div><b>{document.original_filename}</b><small>{document.document_type||"Supporting document"} · {Math.ceil(Number(document.size_bytes)/1024)} KB{document.uploaded_at?` · ${formatDate(document.uploaded_at)}`:""}</small><DocumentSecurityStatus status={document.security_status}/></div><div className="documentRowActions"><DocumentViewButton requestId={item.id} document={document} identityHeader={identityHeader}/>{editable&&remove&&<button type="button" aria-label={`Remove ${document.original_filename}`} onClick={()=>void remove(document.id)}>Remove</button>}</div></article>)}</div>{!item.documents?.length&&<div className="emptyState"><b>No documents attached</b><span>Add the files Finance needs to review this payment.</span></div>}{!editable&&<p className="documentLock">Only documents marked Ready are trusted supporting evidence. Documents are locked after submission unless Finance requests a replacement.</p>}</section>;
}

export function DocumentSecurityStatus({status}:{status?:DocSec}){
  const value=status??"QUARANTINED",label=value==="CLEAN"?"Document ready":value==="REJECTED"?"Document rejected":value==="SCAN_FAILED"?"Security check failed":value==="SCANNING"?"Checking document":"Awaiting security check";
  return <small className={`documentSecurity status-${value.toLowerCase()}`} role="status">{label}</small>;
}

export function RequesterSubmittedDetail({item,api,changed,upload,busy,identityHeader=null}:{item:PaymentRequestItem;api:PortalApi;changed:()=>Promise<void>;upload:(event:FormEvent<HTMLFormElement>)=>Promise<void>;busy:boolean;identityHeader?:string|null}){
  const [response,setResponse]=useState(""),[responseNotice,setResponseNotice]=useState(""),[responding,setResponding]=useState(false);
  const active=item.clarifications?.find(value=>clarificationActionable(value.status)),history=item.clarifications??[],visibleActivity=item.audit?.filter(event=>requesterActivityVisible(event.action))??[];
  async function respond(){if(!active||!response.trim())return;setResponding(true);setResponseNotice("");try{const path=active.type==="APPROVAL"?`/payment-requests/${item.id}/approval-clarifications/${active.id}/respond`:active.type==="POLICY"?`/payment-requests/${item.id}/policy-clarifications/${active.id}/respond`:`/payment-requests/${item.id}/clarifications/${active.id}/respond`;await api(path,{method:"POST",body:JSON.stringify(active.type==="POLICY"?{justification:response.trim()}:{response:response.trim()})});setResponseNotice("Your response was submitted. Finance can continue reviewing the request.");setResponse("");await changed()}catch(error){setResponseNotice(humanizeRequestError(error))}finally{setResponding(false)}}
  return <div className="requesterSubmittedDetail"><RequesterDetailOverview item={item}/>{active&&<section className="clarificationPanel" aria-labelledby="clarification-title"><small>ACTION REQUIRED</small><h2 id="clarification-title">Finance needs information from you</h2><p>Your request cannot continue until you respond.</p><dl><div><dt>Requested by</dt><dd>{active.type==="APPROVAL"?"Approval team":active.type==="POLICY"?"Finance policy review":"Finance"}</dd></div><div><dt>Requested</dt><dd>{formatDate(active.requestedAt)}</dd></div><div><dt>Information needed</dt><dd>{active.question}</dd></div></dl><label htmlFor="clarification-response">Your response <b>Required</b></label><textarea id="clarification-response" value={response} onChange={event=>setResponse(event.target.value)} placeholder="Provide the requested information" maxLength={4000}/>{item.status==="NEEDS_CLARIFICATION"&&<RequesterDocuments item={item} editable upload={upload} busy={busy} identityHeader={identityHeader}/>}<button className="primary" disabled={responding||!response.trim()} onClick={()=>void respond()}>Submit Response</button>{responseNotice&&<p className="notice" role="status">{responseNotice}</p>}</section>}
    <section className="requestDetailsCard"><div className="sectionHeading"><div><small>REQUEST DETAILS</small><h3>Payment request</h3></div></div><dl><div><dt>Ticket</dt><dd>{item.ticketNumber}</dd></div><div><dt>Payee</dt><dd>{item.payee}</dd></div><div><dt>Purpose</dt><dd>{item.purpose}</dd></div><div><dt>Category</dt><dd>{item.category}</dd></div><div><dt>Amount</dt><dd>{formatMoney(item.currency,item.amount)}</dd></div><div><dt>Due date</dt><dd>{formatDate(item.dueDate)}</dd></div><div><dt>Payment method</dt><dd>{item.paymentMethod?.replaceAll("_"," ")}</dd></div><div><dt>Submitted</dt><dd>{formatDate(item.submittedAt)}</dd></div></dl></section>
    {!active&&<RequesterDocuments item={item} editable={false} upload={upload} busy={busy} identityHeader={identityHeader}/>}
    <section className="requesterStatusCard"><small>APPROVAL & FINANCE STATUS</small><h3>{requesterStatusPresentation[item.status].label}</h3><p>{item.status==="READY_FOR_PAYMENT"?"All required approval and Finance checks are complete. Payment has not yet been recorded.":item.status==="PAID"?"Finance has recorded the completed external payment in AIMS.":item.status==="REJECTED"?"This request was not approved. Review the requester-visible activity below for available information.":requesterStatusPresentation[item.status].action}</p></section>
    {history.length>0&&<section className="clarificationHistory"><small>CLARIFICATION HISTORY</small><h3>Conversation</h3>{history.map(entry=><article key={entry.id}><div><b>{entry.type==="APPROVAL"?"Approval team":entry.type==="POLICY"?"Finance policy review":"Finance"}</b><small>{formatDate(entry.requestedAt)}</small><p>{entry.question}</p></div>{entry.response&&<div className="requesterReply"><b>You</b><small>{formatDate(entry.respondedAt)}</small><p>{entry.response}</p></div>}{entry.status!=="OPEN"&&!entry.response&&<p className="staleClarification">This clarification is no longer active.</p>}</article>)}</section>}
    {visibleActivity.length>0&&<section className="requesterActivity"><small>ACTIVITY</small><h3>Request history</h3>{visibleActivity.map(event=><div className="activity" key={event.id}><i/><p><b>{friendlyActivity(event.action)}</b><small>{formatDate(event.occurred_at)}</small></p></div>)}</section>}
  </div>;
}

export function RequesterDetailOverview({item}:{item:PaymentRequestItem}){
  const meta=requesterStatusPresentation[item.status],current=statusStage[item.status];
  const groups=[{label:"Request Submitted",at:1},{label:"Validation",at:2},{label:"Financial Review",at:3},{label:"Approval",at:6},{label:"Final Finance Review",at:7},{label:"Payment",at:8}];
  return <section className="requesterDetailOverview" aria-label="Request progress and required actions">
    <div className="requesterSnapshot"><div><small>CURRENT STATUS</small><StatusChip status={item.status}/><p>{meta.action}</p></div><div><small>NEXT OWNER</small><b>{meta.owner}</b><p>{item.status==="PAID"?"No further action required.":meta.action}</p></div><div><small>REQUEST VALUE</small><b>{formatMoney(item.currency,item.amount)}</b><p>{item.payee||"Payee not added"}</p></div><div><small>SUBMITTED</small><b>{formatDate(item.submittedAt)}</b><p>{item.dueDate?`Due ${formatDate(item.dueDate)}`:"No due date"}</p></div></div>
    <div className="requesterJourney"><div className="sectionHeading"><div><small>PROGRESS</small><h3>Your request journey</h3></div><span>{meta.action}</span></div><div className="journeySummary" role="list" aria-label="Simplified request progress">{groups.map(group=><div role="listitem" key={group.label} className={current>group.at?"completed":current===group.at?"current":"upcoming"}><span>{current>group.at?"✓":""}</span><b>{group.label}</b></div>)}</div><details><summary>View all 12 AIMS stages</summary><div className="compactJourney" role="list">{stages.map((stage,index)=><div role="listitem" key={stage} className={index<current?"completed":index===current?item.status==="NEEDS_CLARIFICATION"||item.status==="FINANCE_HOLD"?"blocked":"current":"upcoming"}><span>{index<current?"✓":String(index+1).padStart(2,"0")}</span><b>{stage}</b></div>)}</div></details></div>
    {item.paymentSummary&&<section className="requesterPayment"><div><small>PAYMENT SUMMARY</small><h3>Paid</h3><p>Finance has recorded the completed external payment in AIMS.</p></div><dl><div><dt>Payment date</dt><dd>{formatDate(item.paymentSummary.paymentDate)}</dd></div><div><dt>Amount</dt><dd>{item.paymentSummary.currency} {(Number(item.paymentSummary.amountMinor)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div><div><dt>Method</dt><dd>{item.paymentSummary.paymentMethod.replaceAll("_"," ")}</dd></div><div><dt>Status</dt><dd><StatusChip status="PAID"/></dd></div></dl></section>}
  </section>;
}
