import type { ReactNode } from "react";

interface AuthorityBadgeProps {
  children: ReactNode;
  ai?: boolean;
  className?: string;
  /** Override accessible name; defaults to visible text or AI/system framing. */
  label?: string;
}

export function AuthorityBadge({
  children,
  ai = false,
  className = "",
  label,
}: AuthorityBadgeProps) {
  const text =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : undefined;
  const ariaLabel =
    label ?? (ai ? `AI interpretation: ${text ?? "advisory"}` : text ?? "Authority marker");

  return (
    <span
      className={`${ai ? "authorityBadge aiAuthority" : "authorityBadge"} ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      {children}
    </span>
  );
}
