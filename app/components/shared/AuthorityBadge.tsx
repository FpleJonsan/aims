import type { ReactNode } from "react";

interface AuthorityBadgeProps {
  children: ReactNode;
  ai?: boolean;
  className?: string;
}

export function AuthorityBadge({
  children,
  ai = false,
  className = "",
}: AuthorityBadgeProps) {
  return (
    <span
      className={`${ai ? "authorityBadge aiAuthority" : "authorityBadge"} ${className}`}
      role="img"
      aria-label={ai ? "AI-assisted authority" : "Human authority"}
    >
      {children}
    </span>
  );
}
