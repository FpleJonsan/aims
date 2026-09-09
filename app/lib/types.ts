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
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

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
  documents?: Array<{
    id: string;
    original_filename: string;
    size_bytes: string;
    version: number;
  }>;
  audit?: Array<{
    id: string;
    action: string;
    occurred_at: string;
  }>;
}

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

export interface UserProfile {
  initials: string;
  name: string;
  department: string;
}
