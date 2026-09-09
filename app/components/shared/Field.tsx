interface FieldProps {
  id?: string;
  label: string;
  help?: string;
  value: string | null;
  set: (v: string) => void;
  disabled: boolean;
  wide?: boolean;
  required?: boolean;
  optional?: boolean;
  error?: string;
}

export function Field({
  id,
  label,
  help,
  value,
  set,
  disabled,
  wide,
  required,
  optional,
  error,
}: FieldProps) {
  const describedBy =
    [help && id ? `${id}-help` : null, error && id ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <label className={`${wide ? "wide" : ""} ${error ? "fieldInvalid" : ""}`} htmlFor={id}>
      <span>
        {label} {required && <b>Required</b>}
        {optional && <em>Optional</em>}
      </span>
      {help && <small id={id ? `${id}-help` : undefined}>{help}</small>}
      {wide ? (
        <textarea
          id={id}
          value={value ?? ""}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      ) : (
        <input
          id={id}
          value={value ?? ""}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      )}
      {error && (
        <small id={id ? `${id}-error` : undefined} role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
