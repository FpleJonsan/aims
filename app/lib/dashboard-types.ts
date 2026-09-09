/** Dashboard DTO shapes aligned to reporting endpoints. */

export interface EvidenceRef {
  metric: string;
  value: string;
}

export interface IntelligenceWatch {
  headline?: string;
  summary?: string;
  interpretation?: string;
  insights?: Array<{
    title?: string;
    severity?: string;
    summary?: string;
    detail?: string;
    evidenceReferences?: EvidenceRef[];
  }>;
}

export interface IntelligenceAnswer {
  answer?: string;
  response?: string;
  evidenceReferences?: EvidenceRef[];
}

export interface BudgetRow {
  currency?: string;
  department?: string;
  department_id?: string;
  category?: string;
  budget?: string | number;
  actual?: string | number;
  available?: string | number;
  utilisationBasisPoints?: number | null;
}

export interface TrendRow {
  currency: string;
  amount: string;
  month?: string;
  period_month?: string;
}

export interface WorkflowSummary {
  processed?: number | string;
  avg_request_to_paid_seconds?: number | string | null;
  ai_validation?: number | string;
  manual_validation?: number | string;
  timeSaved?: string;
}

export interface AiUsageSummary {
  calls?: number | string;
  total_tokens?: number | string;
  average_latency_ms?: number | string;
  failures?: number | string;
  estimatedCost?: string;
}

export interface FinancialPosition {
  currency: string;
  available: string;
  budget?: string;
  actual?: string;
  committed?: string;
  utilisationBasisPoints: number | null;
}

export interface FinanceDashboardSummary {
  dataSnapshotAsOf: string;
  financialPositions: FinancialPosition[];
  payments: {
    amounts: Array<{ currency: string; paidAmount: string }>;
    count?: number;
  };
  vendors: Array<{
    payee: string;
    currency: string;
    amount: string;
    payment_count: number;
  }>;
  risk: { HIGH?: number; CRITICAL?: number; [key: string]: number | undefined };
  requests: {
    PENDING_APPROVAL?: { count?: number };
    [key: string]: { count?: number } | undefined;
  };
  financeControl: { holds: number; ready: number };
}
