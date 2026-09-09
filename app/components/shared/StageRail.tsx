import type { RequestStatus } from "@/app/lib/types";

const stages = [
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
];

const statusStage: Record<RequestStatus, number> = {
  DRAFT: 1,
  SUBMITTED: 2,
  VALIDATING: 3,
  NEEDS_CLARIFICATION: 3,
  PENDING_APPROVAL: 6,
  APPROVED: 7,
  FINANCE_CHECK: 7,
  FINANCE_HOLD: 7,
  READY_FOR_PAYMENT: 8,
  PAID: 11,
  REJECTED: 6,
};

interface StageRailProps {
  currentStatus: RequestStatus;
  className?: string;
}

export function StageRail({ currentStatus, className = "" }: StageRailProps) {
  const currentStage = statusStage[currentStatus];

  return (
    <nav
      className={`stageRail ${className}`}
      aria-label="Payment request workflow stages"
    >
      {stages.map((stage, index) => {
        const stageNumber = index + 1;
        const isPast = stageNumber < currentStage;
        const isCurrent = stageNumber === currentStage;
        const isFuture = stageNumber > currentStage;

        let stageClass = "";
        if (isPast) stageClass = "completed";
        if (isCurrent) stageClass = "current available";
        if (isFuture) stageClass = "future";

        return (
          <div key={stage} className={stageClass}>
            <span aria-hidden="true">{stageNumber}</span>
            <b>{stage}</b>
            <small>
              {isPast ? "Complete" : isCurrent ? "In Progress" : "Pending"}
            </small>
          </div>
        );
      })}
    </nav>
  );
}

export { statusStage };
