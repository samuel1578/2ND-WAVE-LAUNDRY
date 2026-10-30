"use client";
import {
  useEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
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
