"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { branches, copy, demoMode } from "@/lib/content";
import { repository } from "@/lib/mock-store";
import { validEmail, validPhone } from "@/lib/rules";
import { DemoFailure, Field, Notice, Submit, TextField } from "./controls";
type Kind = "general" | "commercial" | "review" | "newsletter";
type Definition = {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  options?: string[];
  max?: number;
};
const definitions: Record<Kind, Definition[]> = {
  general: [
    { name: "name", label: "Full name", required: true },
    { name: "phone", label: "Phone number", required: true, type: "tel" },
    { name: "email", label: "Email address", type: "email" },
    {
      name: "topic",
      label: "Enquiry topic",
      required: true,
      options: [
        "Services",
        "Pickup or delivery",
        "Existing request",
        "Commercial laundry",
        "Concern or complaint",
        "Something else",
      ],
    },
    {
      name: "message",
      label: "Your message",
      required: true,
      type: "textarea",
      max: 4000,
    },
  ],
  commercial: [
    { name: "business", label: "Business name", required: true },
    { name: "name", label: "Contact name", required: true },
    { name: "phone", label: "Phone number", required: true, type: "tel" },
    { name: "email", label: "Email address", type: "email" },
    {
      name: "items",
      label: "Items and approximate quantities",
      required: true,
      type: "textarea",
      max: 2000,
    },
    { name: "frequency", label: "Service frequency" },
    { name: "location", label: "Collection or service location", max: 500 },
    {
      name: "requirements",
      label: "Additional requirements",
      type: "textarea",
      max: 4000,
    },
  ],
  review: [
    { name: "name", label: "Your name", required: true },
    { name: "rating", label: "Rating", options: ["1", "2", "3", "4", "5"] },
    {
      name: "review",
      label: "Your review",
      required: true,
      type: "textarea",
      max: 4000,
    },
    { name: "branch", label: "Branch", options: branches.map((b) => b.title) },
  ],
  newsletter: [
    { name: "email", label: "Email address", required: true, type: "email" },
  ],
};
export function PublicForm({ kind }: { kind: Kind }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const key = useRef("");
  const [consent, setConsent] = useState(false);
  const config = {
    general: {
      submit: "Send Enquiry",
      busy: "Sending…",
      heading: copy("09", "Success heading"),
      body: copy("09", "Success body"),
    },
    commercial: {
      submit: "Submit Quote Request",
      busy: "Submitting…",
      heading: copy("10.03", "H1"),
      body: copy("10.03", "Message"),
    },
    review: {
      submit: "Submit Review",
      busy: "Submitting…",
      heading: copy("15", "Success heading"),
      body: copy("15", "Success body"),
    },
    newsletter: {
      submit: "Register Interest",
      busy: "Saving…",
      heading: copy("16", "Success heading"),
      body: copy("16", "Success body"),
    },
  }[kind];
  function change(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
    key.current = "";
    setErrors((e) => ({ ...e, [name]: "" }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    for (const field of definitions[kind]) {
      const value = values[field.name]?.trim() || "";
      if (field.required && !value) next[field.name] = "Complete this field.";
      else if (value && field.type === "email" && !validEmail(value))
        next[field.name] = "Enter a valid email address.";
      else if (value && field.type === "tel" && !validPhone(value))
        next[field.name] = "Enter a valid phone number.";
    }
    if ((kind === "review" || kind === "newsletter") && !consent)
      next.consent = "Complete this field.";
    setErrors(next);
    if (Object.keys(next).length) {
      setError("Please check the highlighted fields.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      key.current ||= crypto.randomUUID();
      await repository.createLead(
        kind,
        {
          ...values,
          ...(kind === "review" || kind === "newsletter"
            ? { consent: "yes" }
            : {}),
        },
        key.current,
      );
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We couldn’t save your request. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (saved)
    return (
      <div className="form-success">
        <Notice success>
          <h2>{config.heading}</h2>
          <p>{config.body}</p>
        </Notice>
        {kind === "commercial" && <p>{copy("10.03", "Supporting text")}</p>}
        <Link className="button secondary" href="/">
          Return Home
        </Link>
        <p className="demo-caption">
          Preview result only. Nothing has been sent to the business.
        </p>
      </div>
    );
  if (!demoMode)
    return (
      <Notice>
        Online submissions are not active yet. Please contact our team.
      </Notice>
    );
  return (
    <form onSubmit={submit} noValidate className="form-stack">
      <p className="muted">Fields marked * are required.</p>
      {error && <Notice error>{error}</Notice>}
      <div className={kind === "newsletter" ? "" : "form-grid"}>
        {definitions[kind].map((field) => {
          const label = field.label + (field.required ? " *" : " (optional)");
          const value = values[field.name] || "";
          return (
            <div
              key={field.name}
              className={field.type === "textarea" ? "full-span" : ""}
            >
              {field.options ? (
                <Field
                  id={`${kind}-${field.name}`}
                  label={label}
                  error={errors[field.name]}
                >
                  <select
                    id={`${kind}-${field.name}`}
                    value={value}
                    onChange={(e) => change(field.name, e.target.value)}
                    aria-invalid={!!errors[field.name]}
                    aria-describedby={
                      errors[field.name]
                        ? `${kind}-${field.name}-error`
                        : undefined
                    }
                  >
                    <option value="">Select an option</option>
                    {field.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
              ) : field.type === "textarea" ? (
                <Field
                  id={`${kind}-${field.name}`}
                  label={label}
                  error={errors[field.name]}
                >
                  <textarea
                    id={`${kind}-${field.name}`}
                    rows={5}
                    maxLength={field.max || 4000}
                    value={value}
                    onChange={(e) => change(field.name, e.target.value)}
                    aria-invalid={!!errors[field.name]}
                    aria-describedby={
                      errors[field.name]
                        ? `${kind}-${field.name}-error`
                        : undefined
                    }
                  />
                </Field>
              ) : (
                <TextField
                  id={`${kind}-${field.name}`}
                  label={label}
                  type={field.type || "text"}
                  autoComplete={
                    field.name === "name"
                      ? "name"
                      : field.type === "tel"
                        ? "tel"
                        : field.type === "email"
                          ? "email"
                          : "off"
                  }
                  value={value}
                  onChange={(e) => change(field.name, e.target.value)}
                  error={errors[field.name]}
                  maxLength={field.max || (field.type === "email" ? 254 : 120)}
                />
              )}
            </div>
          );
        })}
      </div>
      {(kind === "review" || kind === "newsletter") && (
        <>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                key.current = "";
              }}
            />
            {kind === "review"
              ? copy("15", "Permission")
              : copy("16", "Opt-in checkbox")}
          </label>
          {errors.consent && <p className="field-error">{errors.consent}</p>}
        </>
      )}
      <p className="privacy">
        {kind === "commercial"
          ? "We’ll use your details to respond to this enquiry."
          : kind === "general"
            ? "We’ll use your details to respond to your enquiry."
            : kind === "review"
              ? "We’ll use your details to review your submission."
              : ""}{" "}
        <Link href="/privacy">Read our Privacy Policy.</Link>
      </p>
      {kind === "commercial" && <p>{copy("10.02", "Note")}</p>}
      <Submit busy={busy} label={config.submit} busyLabel={config.busy} />
      <DemoFailure />
    </form>
  );
}
