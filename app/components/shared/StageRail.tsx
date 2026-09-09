import type { RequestStatus } from "@/app/lib/types";

export const stages = [
  "Request Initiation",
  "Request Capture",
  "Validation",
  "Finance Context",
  "Financial Risk Analysis",
  "Policy & Decision",
  "Approval",
  "Final Finance Control",
  "Payment Processing",
  "Payment Record / History",
  "Finance Dashboard",
  "AI Finance Intelligence",
] as const;

export const statusStage: Record<RequestStatus, number> = {
  DRAFT: 1,
  SUBMITTED: 2,
  VALIDATING: 3,
  NEEDS_CLARIFICATION: 3,
  PENDING_APPROVAL: 6,
  APPROVED: 7,
  FINANCE_CHECK: 7,
  FINANCE_HOLD: 7,
  READY_FOR_PAYMENT: 8,
  PAID: 9,
  REJECTED: 6,
  CANCELLED: 1,
};

interface StageRailProps {
  currentStatus: RequestStatus;
  className?: string;
}

export function StageRail({ currentStatus, className = "" }: StageRailProps) {
  const currentStage = statusStage[currentStatus];

  return (
    <nav
      className={`stageRail ${className}`.trim()}
      aria-label="12-stage AIMS workflow"
    >
      {stages.map((stage, index) => {
        const stageNumber = index;
        const isPast = currentStage >= 0 && stageNumber < currentStage;
        const isCurrent = stageNumber === currentStage;
        const stageClass =
          currentStage < 0
            ? "available"
            : isPast
              ? "completed"
              : isCurrent
                ? "current"
                : "future";

        return (
          <div key={stage} className={stageClass}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <b>{stage}</b>
            <small>
              {currentStage < 0
                ? "Available"
                : isPast
                  ? "Completed"
                  : isCurrent
                    ? "Current"
                    : "Locked"}
            </small>
          </div>
        );
      })}
    </nav>
  );
}
