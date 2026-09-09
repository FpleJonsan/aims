// Core domain types
export const REQUEST_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "VALIDATING",
  "NEEDS_CLARIFICATION",
  "PENDING_APPROVAL",
  "APPROVED",
  "FINANCE_CHECK",
  "FINANCE_HOLD",
  "READY_FOR_PAYMENT",
  "PAID",
  "REJECTED",
  "CANCELLED",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type DocumentSecurityStatus =
  | "QUARANTINED"
  | "SCANNING"
  | "CLEAN"
  | "REJECTED"
  | "SCAN_FAILED";

export interface PaymentRequestDocument {
  id: string;
  original_filename: string;
  size_bytes: string;
  version: number;
  mime_type?: string;
  document_type?: string;
  uploaded_at?: string;
  security_status?: DocumentSecurityStatus;
}

export interface PaymentRequestClarification {
  id: string;
  type: string;
  question: string;
  status: string;
  requestedAt: string;
  response?: string | null;
  respondedAt?: string | null;
}

export interface PaymentSummary {
  paymentDate: string;
  status: string;
  amountMinor: string;
  currency: string;
  paymentMethod: string;
  recordedAt: string;
}

/** Portal list/detail payment request shape (UI). */
export interface PaymentRequestItem {
  id: string;
  ticketNumber: string | null;
  status: RequestStatus;
  payee: string | null;
  purpose: string | null;
  category: string | null;
  amount: string | null;
  currency: string | null;
  departmentId: string;
  dueDate: string | null;
  paymentMethod: string | null;
  paymentDetails: string | null;
  remark: string | null;
  humanFinalRisk?: string;
  submittedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  clarifications?: PaymentRequestClarification[];
  paymentSummary?: PaymentSummary | null;
  documents?: PaymentRequestDocument[];
  audit?: Array<{ id: string; action: string; occurred_at: string }>;
}

/** @deprecated Prefer PaymentRequestItem */
export type Item = PaymentRequestItem;

export type PortalApi = (path: string, init?: RequestInit) => Promise<unknown>;

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface DashboardFilterState {
  dateFrom: string;
  dateTo: string;
  departmentId: string;
  category: string;
}

export type DashboardDrill =
  | {
      view: "REPORTING_REQUESTS";
      reportView: "PENDING_APPROVAL" | "RISK_ATTENTION";
      filters: DashboardFilterState;
    }
  | {
      view: "FINANCE_CONTROL";
      status: "FINANCE_HOLD";
      filters: DashboardFilterState;
    }
  | {
      view: "PAYMENT_QUEUE";
      status: "READY_FOR_PAYMENT";
      filters: DashboardFilterState;
    }
  | { view: "PAYMENT_HISTORY"; filters: Record<string, string> };

export interface PortalSession {
  user: {
    id: string;
    subject: string;
    email: string;
    displayName: string;
    department: string;
  };
  workspaces: {
    requester: boolean;
    finance: boolean;
  };
  capabilities: {
    financeAnalysis: boolean;
    approval: boolean;
    financeControl: boolean;
    payment: boolean;
    reporting: boolean;
    policyAdmin: boolean;
  };
}

export type Workspace = "requester" | "finance";

export type FinanceView =
  | "work-queue"
  | "approvals"
  | "finance-control"
  | "payment-queue"
  | "payment-history"
  | "dashboard"
  | "ai";

export type AuthPhase = "login" | "checking" | "ready" | "no-access" | "error";
export type IdentityMode = "LOCAL" | "COMPETITION";

export interface LocalIdentity {
  subject: string;
  displayName: string;
  department: string;
  persona: string;
  workspaces: string[];
}

export interface UserProfile {
  initials: string;
  name: string;
  department: string;
}

export interface RequesterDashboardSummary {
  myRequests: number;
  drafts: number;
  awaitingReview: number;
  needsClarification: number;
  pendingApproval: number;
  approvedReady: number;
  readyForPayment: number;
  inProgress: number;
  paid: number;
}
