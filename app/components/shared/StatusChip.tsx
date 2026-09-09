import type { RequestStatus } from "@/app/lib/types";

interface StatusChipProps {
  status: RequestStatus | string;
  className?: string;
}

export function StatusChip({ status, className = "" }: StatusChipProps) {
  const displayText = status.replaceAll("_", " ");
  const normalizedStatus = status.toLowerCase().replaceAll("_", "_");

  return (
    <span
      className={`statusChip status-${normalizedStatus} ${className}`}
      role="status"
      aria-label={`Status: ${displayText}`}
    >
      {displayText}
    </span>
  );
}
