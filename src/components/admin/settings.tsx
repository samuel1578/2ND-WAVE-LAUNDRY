"use client";
import { useEffect, useState } from "react";
import { saveSettings, useDemoStore } from "@/lib/mock-store";
import { saveLiveSettings } from "@/lib/website/actions";
import type { Settings } from "@/lib/contracts";
import { demoMode } from "@/lib/demo-mode";
import { validEmail, validPhone, validClock, clockLabel } from "@/lib/rules";
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

export function SettingsAdmin({ live = false }: { live?: boolean }) {
  const store = useDemoStore();
  const [form, setForm] = useState<Settings>({ ...store.settings });
  const [baseline, setBaseline] = useState(JSON.stringify(form));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pause, setPause] = useState(false);
  const dirty = JSON.stringify(form) !== baseline;
  useEffect(() => {
    if (!live || demoMode) return;
    let active = true;
    fetch("/api/admin/website?module=settings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Settings could not be loaded.");
        const body = await response.json() as { settings?: Settings };
        if (!body.settings) throw new Error("Settings could not be loaded.");
        if (active) {
          setForm(body.settings);
          setBaseline(JSON.stringify(body.settings));
        }
      })
      .catch((cause) => {
        if (active) setError((cause as Error).message);
      });
    return () => {
      active = false;
    };
  }, [live]);
  async function save() {
    if (busy) return;
    setError("");
    if (form.email && !validEmail(form.email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (
      !validPhone(form.phone) ||
      !validPhone("+" + form.whatsapp.replace(/^\+/, ""))
    ) {
      setError("Enter a valid phone number.");
      return;
    }
    for (const url of [form.instagram, form.tiktok, form.facebook]) {
      if (url) {
        try {
          if (new URL(url).protocol !== "https:") throw Error();
        } catch {
          setError("Enter valid HTTPS social links or leave them empty.");
          return;
        }
      }
    }
    if (
      ![form.start, form.end, form.cutoff].every(validClock) ||
      !(form.start < form.cutoff && form.cutoff < form.end)
    ) {
      setError(
        "Pickup start time must be before the express cutoff and pickup end time.",
      );
      return;
    }
    setBusy(true);
    try {
      const next = live && !demoMode ? await saveLiveSettings(form) : await saveSettings(form);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setSuccess("Settings saved.");
      setPause(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <UnsavedGuard dirty={dirty} />
      <Heading title="Settings">
        <span className="badge">{dirty ? "Unsaved changes" : "Saved"}</span>
      </Heading>
      {error && <Notice error>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      <form
        className="settings-form form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.acceptBookings && store.settings.acceptBookings)
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
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <small>Leave unset until the real business email is confirmed.</small>
        </section>
        <section className="panel form-stack">
          <h2>Contacts and social links</h2>
          {(
            ["phone", "whatsapp", "instagram", "tiktok", "facebook"] as const
          ).map((key) => (
            <TextField
              key={key}
              id={`setting-${key}`}
              label={
                {
                  phone: "Main phone",
                  whatsapp: "Main WhatsApp",
                  instagram: "Instagram URL",
                  tiktok: "TikTok URL",
                  facebook: "Facebook URL",
                }[key]
              }
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          ))}
        </section>
        <section className="panel form-stack">
          <h2>Booking requests</h2>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.acceptBookings}
              onChange={(e) =>
                setForm({ ...form, acceptBookings: e.target.checked })
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
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          ))}
          <p>
            For Express/Same-Day Laundry requiring collection, request pickup by
            {clockLabel(form.cutoff)} for same-day service. The team confirms availability, the fee
            and timing for your items.
          </p>
        </section>
        <section className="panel form-stack">
          <h2>Retention</h2>
          <TextField
            id="record-retention"
            label="Booking record retention"
            value="12 calendar months"
            readOnly
          />
          <TextField
            id="photo-retention"
            label="Customer photo retention"
            value="90 days"
            readOnly
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
              onChange={(e) =>
                setForm({ ...form, newsletter: e.target.checked })
              }
            />
            Enable newsletter interest
          </label>
          <p>Email campaigns and provider integration are not enabled.</p>
        </section>
        <div className="form-actions">
          <Submit busy={busy} label="Save Settings" />
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setForm({ ...store.settings });
              setBaseline(JSON.stringify(store.settings));
              setError("");
              setSuccess("");
            }}
          >
            Cancel
          </button>
        </div>
        <DemoFailure />
      </form>
      <BookingAlertRecipients live={live} />
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
            disabled={busy}
            onClick={() => void save()}
          >
            Pause Requests
          </button>
        </div>
      </Dialog>
    </>
  );
}
