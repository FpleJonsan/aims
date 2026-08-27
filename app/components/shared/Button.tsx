import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "text";
  children: ReactNode;
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  children,
  loading = false,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  const variantClass = variant === "primary" ? "primary" : variant === "secondary" ? "secondary" : "";
  const isDisabled = disabled || loading;

  return (
    <button
      className={`${variantClass} ${className}`}
      disabled={isDisabled}
      aria-busy={loading}
      {...props}
    >
      {loading ? "Loading..." : children}
    </button>
  );
}
