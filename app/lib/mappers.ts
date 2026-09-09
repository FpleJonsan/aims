import type { PaymentRequestItem, RequestStatus } from "@/app/lib/types";

export function financeQueueItem(x: Record<string, unknown>): PaymentRequestItem {
  return {
    id: String(x.id),
    ticketNumber: String(x.ticket_number),
    status: String(x.status) as RequestStatus,
    payee: String(x.payee),
    purpose: `Final Finance Control · ${String(x.finance_control_status ?? "NOT STARTED")}`,
    category: null,
    amount: String(x.amount),
    currency: String(x.currency),
    departmentId: String(x.department_id),
    dueDate: String(x.due_date),
    paymentMethod: null,
    paymentDetails: null,
    remark: null,
    humanFinalRisk: String(x.final_risk),
  };
}

export function requesterListItem(x: Record<string, unknown>): PaymentRequestItem {
  return {
    id: String(x.id),
    ticketNumber: x.ticket_number ? String(x.ticket_number) : null,
    status: String(x.status) as RequestStatus,
    payee: x.payee ? String(x.payee) : null,
    purpose: x.purpose ? String(x.purpose) : null,
    category: null,
    amount: x.amount ? String(x.amount) : null,
    currency: x.currency ? String(x.currency) : null,
    departmentId: "",
    dueDate: x.due_date ? String(x.due_date).slice(0, 10) : null,
    paymentMethod: null,
    paymentDetails: null,
    remark: null,
    submittedAt: x.submitted_at ? String(x.submitted_at) : null,
    createdAt: x.created_at ? String(x.created_at) : null,
    updatedAt: x.updated_at ? String(x.updated_at) : null,
  };
}

export function requesterDetailItem(safe: {
  request: Record<string, unknown>;
  documents: Array<Record<string, unknown>>;
  activity: Array<Record<string, unknown>>;
  clarifications?: Array<Record<string, unknown>>;
  payment?: Record<string, unknown> | null;
}): PaymentRequestItem {
  const x = safe.request;
  return {
    ...requesterListItem(x),
    category: x.category ? String(x.category) : null,
    departmentId: String(x.department_id),
    paymentMethod: x.payment_method ? String(x.payment_method) : null,
    paymentDetails: x.payment_details ? String(x.payment_details) : null,
    remark: x.remark ? String(x.remark) : null,
    documents: safe.documents.map((d) => ({
      id: String(d.id),
      original_filename: String(d.original_filename),
      size_bytes: String(d.size_bytes),
      version: Number(d.version),
      mime_type: d.mime_type ? String(d.mime_type) : undefined,
      document_type: d.document_type ? String(d.document_type) : undefined,
      uploaded_at: d.uploaded_at ? String(d.uploaded_at) : undefined,
      security_status: d.security_status
        ? (String(d.security_status) as NonNullable<
            PaymentRequestItem["documents"]
          >[number]["security_status"])
        : undefined,
    })),
    audit: safe.activity.map((a) => ({
      id: `${String(a.occurred_at)}-${String(a.action)}`,
      action: String(a.action),
      occurred_at: String(a.occurred_at),
    })),
    clarifications: (safe.clarifications ?? []).map((c) => ({
      id: String(c.id),
      type: String(c.clarification_type),
      question: String(c.question),
      status: String(c.status),
      requestedAt: String(c.requested_at),
      response: c.response ? String(c.response) : null,
      respondedAt: c.responded_at ? String(c.responded_at) : null,
    })),
    paymentSummary: safe.payment
      ? {
          paymentDate: String(safe.payment.payment_date).slice(0, 10),
          status: String(safe.payment.status),
          amountMinor: String(safe.payment.amount_minor),
          currency: String(safe.payment.currency),
          paymentMethod: String(safe.payment.payment_method),
          recordedAt: String(safe.payment.recorded_at),
        }
      : null,
  };
}

export function paymentQueueItem(x: Record<string, unknown>): PaymentRequestItem {
  return {
    id: String(x.id),
    ticketNumber: String(x.ticket_number),
    status: "READY_FOR_PAYMENT",
    payee: String(x.payee),
    purpose: "Payment Processing · Ready to record external payment",
    category: String(x.category),
    amount: String(x.amount),
    currency: String(x.currency),
    departmentId: String(x.department_id),
    dueDate: String(x.due_date),
    paymentMethod: String(x.payment_method),
    paymentDetails: null,
    remark: null,
  };
}

export function financeNextAction(status: RequestStatus) {
  const actions: Record<
    RequestStatus,
    { label: string; detail: string; tone: string }
  > = {
    DRAFT: {
      label: "Request capture in progress",
      detail: "The requester has not submitted this request to Finance.",
      tone: "neutral",
    },
    SUBMITTED: {
      label: "Validation required",
      detail: "Review the request and supporting evidence before Finance analysis.",
      tone: "attention",
    },
    VALIDATING: {
      label: "Finance analysis in progress",
      detail:
        "Complete Finance Context, risk assessment, and deterministic policy evaluation.",
      tone: "attention",
    },
    NEEDS_CLARIFICATION: {
      label: "Clarification required",
      detail:
        "The request is waiting for information before the controlled workflow can continue.",
      tone: "attention",
    },
    PENDING_APPROVAL: {
      label: "Waiting for authorized approval",
      detail: "Approval records a decision; it does not execute or record payment.",
      tone: "awaiting",
    },
    APPROVED: {
      label: "Final Finance Control required",
      detail: "Approval is complete. Finance must verify the final control gate.",
      tone: "awaiting",
    },
    FINANCE_CHECK: {
      label: "Final Finance Control in progress",
      detail:
        "Verify approval, evidence, financial position, payment details, and duplicate protection.",
      tone: "attention",
    },
    FINANCE_HOLD: {
      label: "Finance Hold requires resolution",
      detail:
        "This is a controlled hold, not a rejection. Resolve the blocking check and recheck.",
      tone: "attention",
    },
    READY_FOR_PAYMENT: {
      label: "Ready for external payment recording",
      detail:
        "Control is complete. AIMS has not executed a bank transfer and the request is not yet Paid.",
      tone: "awaiting",
    },
    PAID: {
      label: "Payment completed and recorded",
      detail: "The external payment is recorded and the request is complete.",
      tone: "healthy",
    },
    REJECTED: {
      label: "Request rejected",
      detail: "Review the decision history for the authoritative reason.",
      tone: "blocking",
    },
    CANCELLED: {
      label: "Request cancelled",
      detail: "No further Finance action is required.",
      tone: "neutral",
    },
  };
  return actions[status];
}
