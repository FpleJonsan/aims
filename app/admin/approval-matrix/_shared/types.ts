export type StringMatch = { op: "EQUALS" | "CONTAINS" | "STARTS_WITH" | "ENDS_WITH"; values: string[] };

export type ApprovalMatrixConditions = {
  departmentIds?: string[];
  projectIds?: string[];
  categories?: StringMatch;
  paymentTypes?: StringMatch;
  currencies?: string[];
  amountMinorMin?: string;
  amountMinorMax?: string;
  riskLevels?: ("LOW" | "MEDIUM" | "HIGH" | "CRITICAL")[];
  priorities?: ("LOW" | "NORMAL" | "HIGH" | "URGENT")[];
  claimCountMin?: number;
  claimCountMax?: number;
};

export type ApprovalMatrixStep = {
  sequence: number;
  parallelGroup: number | null;
  requiredApprovals: number | null;
  requiredRole: string;
  authorityScope: "DEPARTMENT" | "ORGANIZATION";
  departmentScope?: string;
  minimumAmountMinor?: string;
  maximumAmountMinor?: string;
  mandatory: boolean;
  reason: string;
};

export type ApprovalMatrixRule = {
  id: string;
  code: string;
  name: string;
  priority: number;
  active: boolean;
  isFallback: boolean;
  conditionLogic: "ALL" | "ANY";
  conditions: ApprovalMatrixConditions;
  financeReviewRequired: boolean;
  aiAnalysisRequired: boolean;
  steps: ApprovalMatrixStep[];
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type ApprovalMatrixPayload = { routingEnabled: boolean; rules: ApprovalMatrixRule[] };

export type ApprovalMatrixVersion = {
  id: string;
  version: number | null;
  status: "draft" | "published";
  payload: ApprovalMatrixPayload;
  reason: string | null;
  changedBy: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export const EMPTY_PAYLOAD: ApprovalMatrixPayload = { routingEnabled: true, rules: [] };

export function newRuleId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptyStep(sequence: number): ApprovalMatrixStep {
  return {
    sequence,
    parallelGroup: null,
    requiredApprovals: null,
    requiredRole: "",
    authorityScope: "DEPARTMENT",
    mandatory: true,
    reason: "",
  };
}

export function emptyRule(): ApprovalMatrixRule {
  return {
    id: newRuleId(),
    code: "",
    name: "",
    priority: 100,
    active: true,
    isFallback: false,
    conditionLogic: "ALL",
    conditions: {},
    financeReviewRequired: false,
    aiAnalysisRequired: false,
    steps: [emptyStep(1)],
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: null,
  };
}
