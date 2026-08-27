import type { ReactNode } from "react";

interface KpiCardProps {
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  icon: string;
  onClick?: () => void;
  className?: string;
}

export function KpiCard({
  label,
  value,
  detail,
  tone = "neutral",
  icon,
  onClick,
  className = "",
}: KpiCardProps) {
  const content = (
    <>
      <span className="metricIcon" aria-hidden="true">
        {icon}
      </span>
      <small>{label}</small>
      <b>{value}</b>
      <span className="metricDetail">{detail}</span>
    </>
  );

  const baseClass = `kpiCard tone-${tone} ${className}`;
  const ariaLabel = `${label}: ${value}. ${detail}`;

  if (onClick) {
    return (
      <button
        className={baseClass}
        onClick={onClick}
        aria-label={ariaLabel}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <article className={baseClass} aria-label={ariaLabel}>
      {content}
    </article>
  );
}
