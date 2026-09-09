import {
  requesterStatusPresentation,
  type RequesterStatus,
} from "@/app/lib/requester-presentation";

interface StatusChipProps {
  status: string;
  className?: string;
}

export function StatusChip({ status, className = "" }: StatusChipProps) {
  const meta = requesterStatusPresentation[status as RequesterStatus];
  const label = meta?.label ?? status.replaceAll("_", " ");
  const tone = meta?.tone ?? "neutral";

  return (
    <span
      className={`statusChip status-${tone} ${className}`.trim()}
      role="status"
      aria-label={`Status: ${label}`}
    >
      {label}
    </span>
  );
}
