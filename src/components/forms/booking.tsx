"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ArrowRight, X, Upload } from "lucide-react";
import { services, contact, copy, demoMode } from "@/lib/content";
import { repository, useDemoStore } from "@/lib/mock-store";
import {
  accraDate,
  defaultPickupDate,
  schedulingError,
  uploadError,
  validEmail,
  validMap,
  validPhone,
  clockLabel,
} from "@/lib/rules";
import type { BookingInput } from "@/lib/contracts";
import { createIdempotencyKey } from "@/lib/bookings/reference";
import { DemoFailure, Field, Notice, Submit, TextField } from "./controls";
import { Glow } from "../brand-text";
import { DottedGlowBackground } from "../dotted-glow-background";
const labels = [
  "Your laundry",
  "Pickup details",
  "Contact details",
  "Review request",
];
export function BookingForm({
  preselect,
  previewState,
}: {
  preselect?: string;
  previewState?: string;
}) {
  const store = useDemoStore();
  const [step, setStep] = useState(0);
  const [input, setInput] = useState<BookingInput>({
    services: services.some((s) => s.slug === preselect && s.bookable)
      ? [preselect!]
      : [],
    category: "Clothing",
    items: "",
    notes: "",
    address: "",
    landmark: "",
    map: "",
    date: defaultPickupDate(new Date(), store.settings.end),
    time: "",
    transport: "No preference",
    name: "",
    phone: "",
    email: "",
    sameWhatsapp: true,
    whatsapp: "",
    contactMethod: "Phone call",
    acknowledged: false,
    photoNames: [],
  });
  const [photos, setPhotos] = useState<{
    name: string;
    url: string;
    file: File;
  }[]>([]);
  const photoRef = useRef(photos);
  useEffect(() => {
    photoRef.current = photos;
  }, [photos]);
  useEffect(
    () => () => photoRef.current.forEach((p) => URL.revokeObjectURL(p.url)),
    [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{
    reference: string;
    photoUploadToken?: string;
  }>();
  const key = useRef("");
  const submittedPayload = useRef("");
  const heading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (!saved) return;
    window.scrollTo(0, 0);
    resultHeading.current?.focus({ preventScroll: true });
  }, [saved]);
  function change<K extends keyof BookingInput>(
    name: K,
    value: BookingInput[K],
  ) {
    setInput((v) => ({ ...v, [name]: value }));
    setErrors((v) => ({ ...v, [name]: "" }));
  }
  const validate = (part: number) => {
    const e: Record<string, string> = {};
    if (part === 0) {
      if (!input.services.length) e.services = "Select at least one service.";
      if (!input.items.trim()) e.items = "Select a load size.";
    }
    if (part === 1) {
      if (!input.address.trim()) e.address = "Complete this field.";
      const schedule = schedulingError(
        input.date,
        input.time,
        input.services.includes("express-same-day-laundry"),
        new Date(),
        store.settings,
      );
      if (schedule) e.date = schedule;
      if (!validMap(input.map))
        e.map = "Enter a valid map link or leave this field empty.";
    }
    if (part === 2) {
      if (!input.name.trim()) e.name = "Complete this field.";
      if (!validPhone(input.phone)) e.phone = "Enter a valid phone number.";
      if (input.email && !validEmail(input.email))
        e.email = "Enter a valid email address.";
      if (!input.sameWhatsapp && !validPhone(input.whatsapp))
        e.whatsapp = "Enter a valid phone number.";
      if (!input.acknowledged) e.acknowledged = "Complete this field.";
    }
    return e;
  };
  function go(next: number) {
    if (next > step) {
      const invalid = validate(step);
      setErrors(invalid);
      if (Object.keys(invalid).length) {
        setError("Please check the highlighted fields.");
        return;
      }
    }
    setError("");
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const incoming = [...files];
    const invalid = uploadError([
      ...photos.map(() => ({ size: 0, type: "image/jpeg" })),
      ...incoming,
    ]);
    if (invalid) {
      setError(invalid);
      return;
    }
    const loaded = incoming.map((file) => ({
      name: file.name,
      url: URL.createObjectURL(file),
      file,
    }));
    setPhotos((p) => [...p, ...loaded]);
    change("photoNames", [...input.photoNames, ...incoming.map((f) => f.name)]);
    setError("");
  }
  /**
   * Production submission.
   *
   * The screen is never told a request succeeded until the trusted server has
   * committed it and returned a reference. A failure preserves every entered
   * value and keeps the same idempotency key, so a retry cannot create a second
   * booking.
   */
  async function submitToServer(idempotencyKey: string): Promise<{
    reference: string;
    photoUploadToken?: string;
  }> {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, idempotencyKey }),
    });
    let data: {
      ok?: boolean;
      reference?: string;
      message?: string;
      photoUploadToken?: string;
      fieldErrors?: Record<string, string>;
    } | null = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (response.ok && data?.reference)
      return { reference: data.reference, photoUploadToken: data.photoUploadToken };
    const fieldErrors = data?.fieldErrors;
    if (fieldErrors && Object.keys(fieldErrors).length) {
      setErrors((current) => ({ ...current, ...fieldErrors }));
      // Return the customer to the earliest step that needs their attention.
      const order: Record<string, number> = {
        services: 0,
        items: 0,
        category: 0,
        notes: 0,
        address: 1,
        landmark: 1,
        map: 1,
        date: 1,
        time: 1,
        transport: 1,
        name: 2,
        phone: 2,
        email: 2,
        whatsapp: 2,
        contactMethod: 2,
        acknowledged: 2,
      };
      const steps = Object.keys(fieldErrors).map((field) => order[field] ?? 3);
      if (steps.length) setStep(Math.min(...steps));
    }
    throw new Error(
      data?.message ??
        "We couldn’t save your request. Your details are still here — please try again.",
    );
  }

  /**
   * Attaches the selected photos to the booking that was just committed.
   *
   * Runs after success and never blocks or reverses it: the booking reference
   * is already on screen, so any failure here is reported as a recoverable
   * notice rather than an error. The request carries the short-lived upload
   * token minted by the submission response — a bare reference grants nothing.
   */
  async function uploadPhotos(uploadToken: string) {
    const files = photoRef.current.map((p) => p.file);
    if (!files.length) return;
    try {
      const body = new FormData();
      body.append("token", uploadToken);
      for (const file of files) body.append("photos", file, file.name);
      const response = await fetch("/api/bookings/photo", {
        method: "POST",
        body,
      });
      if (!response.ok) throw new Error("upload refused");
    } catch {
      setError(
        "Your request is saved, but the photos could not be attached. " +
          "Please send them to the team directly if they are important.",
      );
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step < 3) {
      go(step + 1);
      return;
    }
    if (busy) return;
    for (let i = 0; i < 3; i++) {
      const invalid = validate(i);
      if (Object.keys(invalid).length) {
        setErrors(invalid);
        setStep(i);
        setError("Please check the highlighted fields.");
        return;
      }
    }
    setBusy(true);
    setError("");
    try {
      const payload = JSON.stringify(input);
      if (!key.current || submittedPayload.current !== payload) {
        key.current = createIdempotencyKey();
        submittedPayload.current = payload;
      }
      // Demo mode stays entirely in memory; production must commit on the server
      // before any success is shown.
      const result = demoMode
        ? {
            reference: (await repository.createBooking(input, key.current))
              .reference,
          }
        : await submitToServer(key.current);
      const { reference } = result;
      setSaved({ reference, photoUploadToken: result.photoUploadToken });
      // Photos attach after the booking is committed, never before: a failed or
      // refused upload must not cost the customer their booking (SRS AT-14).
      if (!demoMode && result.photoUploadToken && photoRef.current.length)
        void uploadPhotos(result.photoUploadToken);
      setMessage(
        `Hello 2nd Wave team. I would like to discuss pickup request ${reference}.\nName: ${input.name}\nServices: ${input.services.map((slug) => services.find((s) => s.slug === slug)?.title).join(", ")}\nPreferred date: ${input.date}\nPreferred time: ${input.time || "As soon as possible"}\nPlease contact me to agree the fee and arrangements.`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Your details are still here. Please try again or contact our team.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function clipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(label);
    } catch {
      setFeedback("Copy is unavailable. Select and copy the text manually.");
    }
  }
  if (saved)
    return (
      <div className="booking-result">
        <div className="booking-result__content">
          <div className="booking-result__hero">
            <DottedGlowBackground
              className="booking-result-glow"
              gap={14}
              radius={1.8}
              opacity={0.75}
            />
            <span className="success-symbol">
              <Image
                src="/check.gif"
                alt=""
                width={48}
                height={48}
                unoptimized
                className="success-symbol__icon"
              />
              <Check className="success-symbol__fallback" aria-hidden="true" />
            </span>
            <h1 ref={resultHeading} tabIndex={-1}>
              {copy("06.05", "H1")}
            </h1>
            <Notice success={!demoMode}>
              {demoMode
                ? "Demo request only. The business has not received this request."
                : "Your request has been received and is pending. The team will contact you to confirm the arrangements."}
            </Notice>
          </div>
          <p>{copy("06.05", "Body")}</p>
          <div className="reference">
            <small>Your request reference</small>
            <strong>{saved.reference}</strong>
            <button
              type="button"
              className="button secondary"
              onClick={() => clipboard(saved.reference, "Reference copied")}
            >
              <Copy size={18} />
              Copy Reference
            </button>
          </div>
          <p>{copy("06.05", "Reassurance")}</p>
          <Field id="draft" label="WhatsApp message (optional)">
            <textarea
              id="draft"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
            />
          </Field>
          <p>{copy("06.05", "Explanation")}</p>
          <div className="actions">
            <a
              className="button whatsapp"
              href={`${contact.whatsapp}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
            >
              Continue on WhatsApp <ArrowRight size={18} />
            </a>
            <button
              className="button secondary"
              onClick={() => clipboard(message, "Message copied")}
            >
              Copy Message
            </button>
          </div>
          <p>{copy("06.05", "Fallback")}</p>
          {feedback && <Notice>{feedback}</Notice>}
          <Link className="text-link" href="/">
            Return Home
          </Link>
        </div>
      </div>
    );
  if (!store.settings.acceptBookings || previewState === "paused")
    return (
      <div className="panel">
        <h1>{copy("06.06", "H1")}</h1>
        <p>{copy("06.06", "Body")}</p>
        <div className="actions">
          <a className="button" href={contact.tel}>
            Call Us
          </a>
          <a className="button secondary" href={contact.whatsapp}>
            Chat on WhatsApp
          </a>
          <Link className="button secondary" href="/locations">
            View Locations
          </Link>
        </div>
      </div>
    );
  const text = (
    name: keyof BookingInput,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> & { help?: string } = {},
  ) => (
    <TextField
      id={name}
      label={label}
      value={String(input[name])}
      onChange={(e) => change(name, e.target.value as never)}
      error={errors[name]}
      maxLength={name === "address" ? 500 : 200}
      {...props}
    />
  );
  return (
    <div className="booking-layout">
      <DottedGlowBackground gap={14} radius={1.8} opacity={0.75} />
      <aside className="booking-aside">
        <p className="eyebrow">Book a Pickup</p>
        <h2>Tell us what needs care.</h2>
        <p>{copy("06.01", "Intro")}</p>
        <p>Prefer to bring your items yourself?</p>
        <Link className="text-link" href="/locations">
          View Locations ↗
        </Link>
        <p className="booking-email-contact">
          Booking and pickup questions?{" "}
          <a href={`mailto:${contact.emails.orders}`}>
            <strong>
              <Glow>{contact.emails.orders}</Glow>
            </strong>
          </a>
        </p>
        <div className="booking-note">
          The fee and timing are agreed with the team. No payment is taken on
          this website.
        </div>
      </aside>
      <div>
        <ol className="stepper">
          {labels.map((label, i) => (
            <li
              key={label}
              className={i === step ? "current" : i < step ? "complete" : ""}
              aria-current={i === step ? "step" : undefined}
            >
              <span>{i < step ? <Check size={16} /> : i + 1}</span>
              <small>{label}</small>
            </li>
          ))}
        </ol>
        <form noValidate onSubmit={submit} className="panel form-stack">
          <h2 ref={heading} tabIndex={-1}>
            {copy(`06.0${step + 1}`, step === 0 ? "Heading" : "Heading")}
          </h2>
          {error && <Notice error>{error}</Notice>}
          {step === 0 && (
            <>
              <fieldset className="service-selector">
                <legend>Select your services *</legend>
                <small>You can select more than one service.</small>
                <div className="grid two">
                  {services
                    .filter((s) => s.bookable)
                    .map((s) => (
                      <label
                        className={
                          input.services.includes(s.slug) ? "selected" : ""
                        }
                        key={s.slug}
                      >
                        <input
                          type="checkbox"
                          checked={input.services.includes(s.slug)}
                          onChange={(e) =>
                            change(
                              "services",
                              e.target.checked
                                ? [...input.services, s.slug]
                                : input.services.filter((v) => v !== s.slug),
                            )
                          }
                        />
                        {s.title}
                      </label>
                    ))}
                </div>
                {errors.services && (
                  <p className="field-error">{errors.services}</p>
                )}
              </fieldset>
              {input.services.includes("wash-ironing-fold") && (
                <Notice>{copy("04.01", "Eligibility")}</Notice>
              )}
              <Field id="category" label="Item category *">
                <select
                  id="category"
                  value={input.category}
                  onChange={(e) => change("category", e.target.value)}
                >
                  {["Clothing", "Bedding", "Both", "Other"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field id="items" label="Load Size *" error={errors.items}>
                <select
                  id="items"
                  value={input.items}
                  onChange={(e) => change("items", e.target.value)}
                >
                  <option value="" disabled>
                    Select load size
                  </option>
                  {[
                    "1 Standard Bag",
                    "2 Standard Bags",
                    "3 Standard Bags",
                    "4+ Bags/Large Order",
                  ].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field id="notes" label="Notes or special requests (optional)">
                <textarea
                  id="notes"
                  value={input.notes}
                  maxLength={4000}
                  rows={4}
                  placeholder="eg: Please hang all the shirts and long sleeves.."
                  onChange={(e) => change("notes", e.target.value)}
                />
              </Field>
              <div className="upload-box">
                <Upload />
                <label htmlFor="photos">Add Photos</label>
                <input
                  id="photos"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => {
                    void addPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
                <small>
                  Add up to 3 photos, no larger than 5MB each. JPEG, PNG or
                  WebP.
                </small>
              </div>
              {photos.map((p, i) => (
                <div className="file-row" key={p.url}>
                  <img
                    className="file-row__thumb"
                    src={p.url}
                    alt={p.name}
                    width={56}
                    height={56}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove Photo ${p.name}`}
                    onClick={() => {
                      URL.revokeObjectURL(p.url);
                      setPhotos(photos.filter((_, j) => j !== i));
                      change(
                        "photoNames",
                        input.photoNames.filter((_, j) => j !== i),
                      );
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
              <Link href="/commercial-laundry/quote" className="text-link">
                Request a Commercial Quote ↗
              </Link>
            </>
          )}
          {step === 1 && (
            <>
              {text("address", "Pickup address *", {
                autoComplete: "street-address",
              })}
              {text("landmark", "Nearby landmark (optional)")}
              {text("map", "Map location link (optional)", {
                type: "url",
                maxLength: 2048,
              })}
              <div className="grid two">
                {text("date", "Preferred pickup date *", {
                  type: "date",
                  min: accraDate(),
                })}
                {text("time", "Preferred collection time (optional)", {
                  type: "time",
                  min: store.settings.start,
                  max: store.settings.end,
                })}
              </div>
              <p>{copy("06.02", "Date helper")}</p>
              <p>
                Pickup is available every day, including public holidays, from
                7:00 AM to 5:00 PM. Please choose a time within these hours.
              </p>
              <p>
                Pickup operates from {clockLabel(store.settings.start)} to{" "}
                {clockLabel(store.settings.end)}. Your preferred time is subject
                to confirmation.
              </p>
              <Field id="transport" label="Transport preference *">
                <select
                  id="transport"
                  value={input.transport}
                  onChange={(e) => change("transport", e.target.value)}
                >
                  {["No preference", "Cab", "Motorbike", "Courier"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <p>{copy("06.02", "Transport helper")}</p>
              {input.services.includes("express-same-day-laundry") && (
                <Notice>
                  For Express/Same-Day Laundry requiring pickup for service
                  today, request by {clockLabel(store.settings.cutoff)}. The
                  team confirms availability and completion timing.
                </Notice>
              )}
            </>
          )}
          {step === 2 && (
            <>
              {text("name", "Full name *", {
                autoComplete: "name",
                maxLength: 120,
              })}
              {text("phone", "Phone number *", {
                type: "tel",
                autoComplete: "tel",
              })}
              {text("email", "Email address (optional)", {
                type: "email",
                autoComplete: "email",
                maxLength: 254,
              })}
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={input.sameWhatsapp}
                  onChange={(e) => change("sameWhatsapp", e.target.checked)}
                />
                Use this number for WhatsApp
              </label>
              {!input.sameWhatsapp &&
                text("whatsapp", "WhatsApp number *", { type: "tel" })}
              <Field id="contactMethod" label="Preferred contact method *">
                <select
                  id="contactMethod"
                  value={input.contactMethod}
                  onChange={(e) => change("contactMethod", e.target.value)}
                >
                  <option>Phone call</option>
                  <option>WhatsApp message</option>
                </select>
              </Field>
              <p>
                We’ll use your details to review your request and arrange your
                service. <Link href="/privacy">Read our Privacy Policy.</Link>
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={input.acknowledged}
                  onChange={(e) => change("acknowledged", e.target.checked)}
                />
                {copy("06.03", "Acknowledgement")}
              </label>
              {errors.acknowledged && (
                <p className="field-error">{errors.acknowledged}</p>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <dl className="review-list">
                {Object.entries({
                  Services: input.services
                    .map((s) => services.find((v) => v.slug === s)?.title)
                    .join(", "),
                  "Load Size": input.items,
                  "Pickup date": input.date,
                  "Preferred time": input.time || "As soon as possible",
                  Address: input.address,
                  "Transport preference": input.transport,
                  "Contact details": `${input.name} · ${input.phone}`,
                  Notes: input.notes || "Not provided",
                  Photos: input.photoNames.join(", ") || "Not provided",
                }).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {label === "Photos" && photos.length ? (
                        <span className="photo-thumbs">
                          {photos.map((p) => (
                            <img
                              key={p.url}
                              src={p.url}
                              alt={p.name}
                              title={p.name}
                              width={72}
                              height={72}
                            />
                          ))}
                        </span>
                      ) : (
                        value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <button className="text-link" type="button" onClick={() => go(0)}>
                Edit Details
              </button>
              <Notice>{copy("06.04", "Fee note")}</Notice>
            </>
          )}
          <div className="form-actions">
            {step > 0 && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => go(step - 1)}
              >
                Back
              </button>
            )}
            <Submit
              busy={busy}
              label={
                step === 3
                  ? "Submit Pickup Request"
                  : step === 2
                    ? "Review Request"
                    : "Continue"
              }
              busyLabel="Saving your request…"
            />
          </div>
          <DemoFailure />
        </form>
      </div>
    </div>
  );
}
