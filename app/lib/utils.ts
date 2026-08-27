/**
 * Utility functions for AIMS application
 */

/**
 * Format error messages for display
 */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Format currency amount (minor units to major)
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
 * Format date for display
 */
export function formatDate(date: string | Date | null): string {
  if (!date) return "—";
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return "—";

  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(dateObj);
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
export function debounce<T extends (...args: any[]) => any>(
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
