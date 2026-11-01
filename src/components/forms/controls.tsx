"use client";
import {
  useEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Phone } from "lucide-react";
import { demoMode } from "@/lib/content";
import { simulateNextFailure } from "@/lib/mock-store";
export function Field({
  label,
  error,
  help,
  children,
  id,
}: {
  label: string;
  error?: string;
  help?: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <div className={`field ${error ? "invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {help && <small id={`${id}-help`}>{help}</small>}
      {error && (
        <small className="field-error" id={`${id}-error`}>
          <AlertCircle size={14} />
          {error}
        </small>
      )}
    </div>
  );
}
export function TextField({
  label,
  error,
  help,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  help?: string;
  id: string;
}) {
  return (
    <Field label={label} error={error} help={help} id={id}>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={
          [help ? `${id}-help` : "", error ? `${id}-error` : ""]
            .filter(Boolean)
            .join(" ") || undefined
        }
        // Email inputs are mutated by browser extensions (temp-mail, autofill
        // managers) before React hydrates, so attribute parity cannot be
        // guaranteed. Scope the tolerance to this element only.
        suppressHydrationWarning={props.type === "email"}
        {...props}
      />
    </Field>
  );
}
function formatGhanaPhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  if (trimmed.startsWith("+") && digits.startsWith("233") && digits.length === 12) {
    const local = digits.slice(3);
    return `+233 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
  }
  return value;
}

export function PhoneField({
  label,
  error,
  id,
  value,
  onChange,
  ...props
}: {
  label: string;
  error?: string;
  id: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <Field
      label={label}
      error={error}
      help="Ghana numbers: 0XX XXX XXXX or +233…"
      id={id}
    >
      <div className="phone-field__control">
        <Phone size={18} aria-hidden="true" />
        <input
          {...props}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="024 123 4567"
          maxLength={20}
          minLength={0}
          value={value}
          aria-invalid={!!error}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          onChange={(event) =>
            onChange(event.currentTarget.value.replace(/[^0-9+ ()-]/g, ""))
          }
          onBlur={(event) => {
            onChange(formatGhanaPhone(event.currentTarget.value));
          }}
        />
      </div>
    </Field>
  );
}

export function Notice({
  children,
  error = false,
  success = false,
}: {
  children: ReactNode;
  error?: boolean;
  success?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error, children]);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={error ? "alert" : "status"}
      className={`notice ${error ? "error" : ""} ${success ? "success" : ""}`}
    >
      {success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
      <div>{children}</div>
    </div>
  );
}
export function Submit({
  busy,
  disabled = false,
  label = "Save Changes",
  busyLabel = "Saving…",
}: {
  busy: boolean;
  disabled?: boolean;
  label?: string;
  busyLabel?: string;
}) {
  return (
    <button type="submit" className="button" disabled={busy || disabled}>
      {busy && <LoaderCircle size={18} className="spin" />}
      {busy ? busyLabel : label}
    </button>
  );
}
export function DemoFailure() {
  return demoMode ? (
    <details className="demo-tools">
      <summary>Preview controls</summary>
      <button
        type="button"
        className="button secondary small"
        onClick={(e) => {
          simulateNextFailure();
          e.currentTarget.textContent = "Next save will fail once";
        }}
      >
        Simulate next save failure
      </button>
      <p>
        Demo records are held in memory and reset on refresh. Do not enter real
        customer data.
      </p>
    </details>
  ) : null;
}
