interface AlertProps {
  type?: "error" | "warning" | "info" | "success";
  message: string;
  onClose?: () => void;
  className?: string;
}

export function Alert({
  type = "info",
  message,
  onClose,
  className = "",
}: AlertProps) {
  if (!message) return null;

  const icons = {
    error: "⚠",
    warning: "⚡",
    info: "ℹ",
    success: "✓",
  };

  const bgColors = {
    error: "bg-red-50 border-red-200 text-red-800",
    warning: "bg-yellow-50 border-yellow-200 text-yellow-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
    success: "bg-green-50 border-green-200 text-green-800",
  };

  return (
    <div
      className={`notice ${bgColors[type]} ${className}`}
      role="alert"
      aria-live="polite"
    >
      <span className="mr-2" aria-hidden="true">
        {icons[type]}
      </span>
      <span>{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="ml-auto text-sm underline"
          aria-label="Dismiss alert"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
