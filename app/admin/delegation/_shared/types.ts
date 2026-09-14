export type DelegationSummary = {
  id: string;
  delegateFrom: string;
  delegateFromName: string | null;
  delegateTo: string;
  delegateToName: string | null;
  startDate: string;
  endDate: string;
  reason: string;
  effectiveStatus: "SCHEDULED" | "ACTIVE" | "EXPIRED" | "CANCELLED";
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserOption = { id: string; displayName: string; email: string };
