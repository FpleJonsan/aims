/**
 * Utility functions for AIMS application
 */

/**
 * Format major-unit money the way the portal displays amounts (not Intl currency style).
 */
export function formatMoney(
  currency: string | null | undefined,
  value: string | null | undefined
): string {
  if (!value) return "—";
  return `${currency ?? ""} ${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

/**
 * Format currency amount (minor units to major) — Intl style.
 */
export function formatCurrency(
  amount: string | number,
  currency: string = "MYR"
): string {
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(numAmount)) return "—";

  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
  }).format(numAmount);
}

/**
 * Format date for display (date-only strings treated as local calendar days).
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const dateObj =
    typeof date === "string"
      ? /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(`${date}T00:00:00`)
        : new Date(date)
      : date;
  if (isNaN(dateObj.getTime())) return "—";

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(dateObj);
}

export function msg(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong";
}

export function formatErrorMessage(error: unknown): string {
  return msg(error);
}

export function humanizeRequestError(error: unknown): string {
  const value = msg(error).toLowerCase();
  if (value.includes("missing required"))
    return "Complete all required fields before submitting your request.";
  if (value.includes("amount")) return "Enter a valid payment amount.";
  if (value.includes("due date")) return "Enter a valid due date.";
  if (value.includes("currency")) return "Select a valid currency.";
  if (value.includes("document")) return "Check the selected document and try again.";
  if (value.includes("forbidden") || value.includes("permitted"))
    return "You can no longer perform this action. Refresh the request to see its current status.";
  return "AIMS could not complete that action. Review the information and try again.";
}

/**
 * Format date and time for display
 */
export function formatDateTime(date: string | Date | null): string {
  if (!date) return "—";
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return "—";

  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dateObj);
}

/**
 * Format file size
 */
export function formatFileSize(bytes: string | number): string {
  const numBytes = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (isNaN(numBytes)) return "—";

  const units = ["B", "KB", "MB", "GB"];
  let size = numBytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Generate user initials from name
 */
export function getUserInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: never[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Check if workspace view is allowed for user
 */
export function allowedFinanceView(
  session: {
    capabilities: {
      financeAnalysis: boolean;
      approval: boolean;
      financeControl: boolean;
      payment: boolean;
      reporting: boolean;
    };
  },
  view: string
): boolean {
  const c = session.capabilities;
  return view === "work-queue"
    ? c.financeAnalysis
    : view === "approvals"
      ? c.approval
      : view === "finance-control"
        ? c.financeControl
        : view === "payment-queue"
          ? c.payment
          : view === "payment-history"
            ? c.payment || c.reporting
            : view === "dashboard" || view === "ai"
              ? c.reporting
              : false;
}
