"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveSettings, useDemoStore } from "@/lib/mock-store";
import { saveLiveSettings } from "@/lib/website/actions";
import type { Settings } from "@/lib/contracts";
import { demoMode } from "@/lib/demo-mode";
import { clockLabel } from "@/lib/rules";
import { validateSettings } from "@/lib/website/settings-validation";
import { Heading } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import {
  DemoFailure,
  Notice,
  Submit,
  TextField,
} from "@/components/forms/controls";
import { UnsavedGuard } from "./unsaved";
import { BookingAlertRecipients } from "./booking-alert-recipients";

const emptySettings: Settings = {
  email: "",
  phone: "",
  whatsapp: "",
  instagram: "",
  tiktok: "",
  facebook: "",
  acceptBookings: false,
  start: "",
  end: "",
  cutoff: "",
  newsletter: false,
  version: 0,
  bookingVersion: 0,
};

function isSettingsPayload(value: unknown): value is Settings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const settings = value as Record<string, unknown>;
  return (
    [
      "email",
      "phone",
      "whatsapp",
      "instagram",
      "tiktok",
      "facebook",
      "start",
      "end",
      "cutoff",
    ].every((key) => typeof settings[key] === "string") &&
    typeof settings.newsletter === "boolean" &&
    typeof settings.acceptBookings === "boolean" &&
    Number.isSafeInteger(settings.version) &&
    Number.isSafeInteger(settings.bookingVersion)
  );
}

export function SettingsAdmin({
  live = false,
  newsletterInterestEnabled = false,
}: {
  live?: boolean;
  newsletterInterestEnabled?: boolean;
}) {
  const store = useDemoStore();
  // `live` is retained for callers, but the environment—not a default-false
  // presentation prop—is the persistence boundary.
  const isLive = !demoMode;
  void live;
  const [form, setForm] = useState<Settings>(() =>
    isLive ? { ...emptySettings } : { ...store.settings },
  );
  const [baseline, setBaseline] = useState<Settings | null>(() =>
    isLive ? null : { ...store.settings },
  );
  const [loading, setLoading] = useState(isLive);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pause, setPause] = useState(false);
  const loadRequest = useRef<AbortController | null>(null);
  const dirty = baseline !== null && JSON.stringify(form) !== JSON.stringify(baseline);
  const ready = !isLive || (!loading && baseline !== null && !loadError);

  const loadSettings = useCallback(async () => {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoading(true);
    setLoadError("");
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/website?module=settings", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Settings could not be loaded.");
      const body = (await response.json()) as { settings?: unknown };
      if (!isSettingsPayload(body.settings))
        throw new Error("Settings could not be loaded.");
      if (!controller.signal.aborted) {
        setForm({ ...body.settings });
        setBaseline({ ...body.settings });
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setLoadError(
          cause instanceof Error
            ? cause.message
            : "Settings could not be loaded.",
        );
      }
    } finally {
      if (!controller.signal.aborted && loadRequest.current === controller) {
        loadRequest.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (isLive) void loadSettings();
    return () => loadRequest.current?.abort();
  }, [isLive, loadSettings]);

  function updateForm(patch: Partial<Settings>) {
    setForm((current) => ({ ...current, ...patch }));
    setSuccess("");
    setError("");
  }

  async function save() {
    if (busy || !ready) return;
    setError("");
    const validationError = validateSettings(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    try {
      const next = isLive
        ? await saveLiveSettings(form)
        : await saveSettings(form);
      setForm(next);
      setBaseline({ ...next });
      setSuccess("Settings saved.");
      setPause(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (isLive) {
      if (baseline) setForm({ ...baseline });
    } else {
      const savedSettings = { ...store.settings };
      setForm(savedSettings);
      setBaseline(savedSettings);
    }
    setError("");
    setSuccess("");
  }

  return (
    <>
      <UnsavedGuard dirty={dirty} />
      <Heading title="Settings">
        <span className="badge">
          {loading ? "Loading" : dirty ? "Unsaved changes" : "Saved"}
        </span>
      </Heading>
      {loadError && (
        <Notice error>
          <p>{loadError}</p>
          <button
            type="button"
            className="button secondary small"
            disabled={loading}
            onClick={() => void loadSettings()}
          >
            Retry
          </button>
        </Notice>
      )}
      {isLive && loading && !loadError && (
        <p role="status">Loading saved settings…</p>
      )}
      {error && <Notice error>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      <form
        className="settings-form form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          if (baseline?.acceptBookings === true && !form.acceptBookings)
            setPause(true);
          else void save();
        }}
      >
        <section className="panel form-stack">
          <h2>Business details</h2>
          <TextField
            id="business-email"
            label="Business email"
            type="email"
            value={form.email}
            disabled={!ready || busy}
            onChange={(event) => updateForm({ email: event.target.value })}
          />
          <small>Leave unset until the real business email is confirmed.</small>
        </section>
        <section className="panel form-stack">
          <h2>Contacts and social links</h2>
          {(
            ["phone", "whatsapp", "instagram", "tiktok", "facebook"] as const
          ).map((key) => {
            const labels = {
              phone: "Main phone",
              whatsapp: "Main WhatsApp",
              instagram: "Instagram URL",
              tiktok: "TikTok URL",
              facebook: "Facebook URL",
            };
            const social =
              key === "instagram" || key === "tiktok" || key === "facebook";
            const placeholders = {
              instagram: "https://www.instagram.com/yourname",
              tiktok: "https://www.tiktok.com/@yourname",
              facebook: "https://www.facebook.com/yourname",
            };
            return (
              <TextField
                key={key}
                id={`setting-${key}`}
                label={labels[key]}
                value={form[key]}
                disabled={!ready || busy}
                placeholder={social ? placeholders[key] : undefined}
                help={
                  social
                    ? "Shown in the website footer. Leave empty to hide it."
                    : undefined
                }
                onChange={(event) => updateForm({ [key]: event.target.value })}
              />
            );
          })}
        </section>
        <section className="panel form-stack">
          <h2>Booking requests</h2>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.acceptBookings}
              disabled={!ready || busy}
              onChange={(event) =>
                updateForm({ acceptBookings: event.target.checked })
              }
            />
            Accept online pickup requests
          </label>
        </section>
        <section className="panel form-stack">
          <h2>Pickup rules</h2>
          {(["start", "end", "cutoff"] as const).map((key) => (
            <TextField
              key={key}
              id={`setting-${key}`}
              label={
                {
                  start: "Pickup start time",
                  end: "Pickup end time",
                  cutoff: "Express pickup cutoff",
                }[key]
              }
              type="time"
              value={form[key]}
              disabled={!ready || busy}
              onChange={(event) => updateForm({ [key]: event.target.value })}
            />
          ))}
          <p>
            For Express/Same-Day Laundry requiring collection, request pickup by
            {clockLabel(form.cutoff)} for same-day service. The team confirms
            availability, the fee and timing for your items.
          </p>
        </section>
        <section className="panel form-stack">
          <h2>Retention</h2>
          <TextField
            id="record-retention"
            label="Booking record retention"
            value="12 calendar months"
            readOnly
            disabled={!ready || busy}
          />
          <TextField
            id="photo-retention"
            label="Customer photo retention"
            value="90 days"
            readOnly
            disabled={!ready || busy}
          />
          <p>
            Booking records expire after 12 calendar months from creation;
            customer photos expire after 90 days from upload.
          </p>
        </section>
        <section className="panel form-stack">
          <h2>Newsletter interest</h2>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.newsletter}
              disabled={!ready || busy}
              onChange={(event) =>
                updateForm({ newsletter: event.target.checked })
              }
            />
            Enable newsletter interest
          </label>
          {isLive && !newsletterInterestEnabled ? (
            <p>
              Newsletter sign-ups are switched off at server level. This setting
              has no effect until they are enabled.
            </p>
          ) : (
            <p>Email campaigns and provider integration are not enabled.</p>
          )}
        </section>
        <div className="form-actions">
          <Submit
            busy={busy}
            label="Save Settings"
            disabled={!ready}
          />
          <button
            type="button"
            className="button secondary"
            disabled={!ready || busy}
            onClick={cancel}
          >
            Cancel
          </button>
        </div>
        <DemoFailure />
      </form>
      <BookingAlertRecipients live={isLive} />
      <Dialog
        open={pause}
        onClose={() => setPause(false)}
        title="Pause new online requests?"
      >
        <p>Existing requests remain available.</p>
        <div className="actions">
          <button className="button secondary" onClick={() => setPause(false)}>
            Cancel
          </button>
          <button
            className="button danger"
            disabled={busy || !ready}
            onClick={() => void save()}
          >
            Pause Requests
          </button>
        </div>
      </Dialog>
    </>
  );
}
