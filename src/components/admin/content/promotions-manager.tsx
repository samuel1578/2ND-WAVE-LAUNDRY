"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Empty } from "@/components/ui";
import { Field, Submit, TextField } from "@/components/forms/controls";
import { Dialog } from "@/components/dialog";
import { UnsavedGuard } from "../unsaved";
import {
  getPromotions,
  savePromotion,
  transitionPromotion,
  useDemoStore,
  type PromotionAction,
} from "@/lib/mock-store";
import type { PromotionRecord } from "@/lib/contracts";
import { promotionBadge } from "@/lib/rules";
import { ModuleShell } from "./shared/module-shell";
import styles from "./content.module.css";
import { demoMode } from "@/lib/demo-mode";
import { useAdminWebsiteData } from "@/lib/website/use-admin-data";
import { saveLivePromotion } from "@/lib/website/actions";
import { promotionCtaError, promotionError } from "@/lib/rules";
import { Promotion } from "@/components/published-content";
import { promotionLinkOptions, promotionLinkSelection } from "@/lib/website/promotion-form";
const blankPromotion: PromotionRecord = {
  id: "",
  internalTitle: "",
  heading: "",
  body: "",
  terms: "",
  exclusions: "",
  start: "",
  end: "",
  placement: "",
  priority: 0,
  ctaLabel: "",
  ctaHref: "",
  enabled: false,
  yearConfirmed: false,
  status: "draft",
  version: 0,
};
export function PromotionsManager({
  id,
  state,
}: {
  id?: string;
  state?: string;
}) {
  const store = useDemoStore();
  const live = useAdminWebsiteData<PromotionRecord>("promotion", []);
  const records = demoMode ? store.websiteContent.promotions : live.items;
  if (id) {
    const record = id === "new" ? undefined : records.find((p) => p.id === id);
    if (id !== "new" && !record)
      return (
        <Empty
          title="Record not found"
          body={live.error || "This promotion is not available."}
        />
      );
    return <PromotionEditor key={record?.id || "new"} record={record} />;
  }
  const promotions = state === "empty" ? [] : demoMode ? getPromotions() : records;
  return (
    <>
      <ModuleShell
        title="Promotions"
        description="Time-boxed campaign records for the admin workspace. Drafts stay here until activated."
        backHref="/admin/content"
        backLabel="Website Content"
        badge={
          <Link className="button" href="/admin/content/promotions/new">
            New Promotion
          </Link>
        }
      />
      {promotions.length ? (
        <div className="grid two">
          {promotions.map((record) => (
            <Link
              className="module-card"
              href={`/admin/content/promotions/${record.id}`}
              key={record.id}
            >
              <div>
                <span className={`badge status-${promotionBadge(record).toLowerCase()}`}>
                  {promotionBadge(record)}
                </span>
                <h2>{record.internalTitle || "Untitled promotion"}</h2>
                <p>{record.heading}</p>
                <small className={styles.count}>
                  {record.start} — {record.end}
                  {record.placement ? ` · ${record.placement}` : ""}
                </small>
              </div>
              <span className="text-link">Edit Promotion</span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          title="No promotions yet."
          body="Create a draft to get started."
        />
      )}
    </>
  );
}
function PromotionEditor({ record }: { record?: PromotionRecord }) {
  const [form, setForm] = useState<PromotionRecord>(() =>
    record ? structuredClone(record) : blankPromotion,
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(record ?? blankPromotion),
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | null>(null);
  const [deleted, setDeleted] = useState(false);
  const dirty = JSON.stringify(form) !== baseline;
  const saved = !!form.id;
  function change(patch: Partial<PromotionRecord>) {
    setForm((f) => ({ ...f, ...patch }));
    setSuccess("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || uploadBusy) return;
    if (form.imageUrl && !form.imageAlt?.trim()) {
      setError("Add alt text for the promotion image.");
      return;
    }
    const ctaError = promotionCtaError(form);
    if (ctaError) {
      setError(ctaError);
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const next = demoMode ? await savePromotion(form) : await saveLivePromotion(form);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setSuccess("Changes saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadImage(file: File) {
    if (busy || uploadBusy) return;
    setUploadBusy(true);
    setError("");
    setSuccess("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/admin/promotion-image", {
        method: "POST",
        body,
      });
      const result = (await response.json()) as { imageUrl?: string; message?: string };
      if (!response.ok || !result.imageUrl)
        throw new Error(result.message || "The image could not be uploaded.");
      change({ imageUrl: result.imageUrl });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadBusy(false);
    }
  }
  async function act(action: PromotionAction) {
    if (busy || !saved) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (!demoMode) {
        if (action === "delete-draft")
          throw new Error("Live drafts cannot be deleted here. Clear the draft fields and save it as a draft.");
        if (action === "activate" || action === "resume") {
          const dateError = promotionError(form, "activate");
          if (dateError) throw new Error(dateError);
        }
        const nextStatus: PromotionRecord["status"] =
          action === "pause"
            ? "paused"
            : action === "end"
              ? "ended"
              : Date.parse(form.start) > Date.now()
                ? "scheduled"
                : "active";
        const next = await saveLivePromotion({ ...form, status: nextStatus });
        setConfirm(null);
        setForm(next);
        setBaseline(JSON.stringify(next));
        setSuccess(
          action === "activate"
            ? "Promotion activated."
            : action === "pause"
              ? "Promotion paused."
              : action === "resume"
                ? "Promotion resumed."
                : "Promotion ended.",
        );
        return;
      }
      const next = await transitionPromotion(form.id, form.version, action);
      setConfirm(null);
      if (action === "delete-draft") {
        setDeleted(true);
        return;
      }
      setForm(next);
      setBaseline(JSON.stringify(next));
      setSuccess(
        action === "activate"
          ? "Promotion activated."
          : action === "pause"
            ? "Promotion paused."
            : action === "resume"
              ? "Promotion resumed."
              : "Promotion ended.",
      );
    } catch (err) {
      setError((err as Error).message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }
  if (deleted)
    return (
      <Empty title="Promotion deleted">
        <Link className="button" href="/admin/content/promotions">
          Return to Promotions
        </Link>
      </Empty>
    );
  const status = form.status;
  const lifecycleReady = saved && !dirty && !busy && !uploadBusy;
  return (
    <>
      <UnsavedGuard dirty={dirty} />
      <ModuleShell
        title={record ? "Edit Promotion" : "New Promotion"}
        description={form.internalTitle || form.heading || undefined}
        backHref="/admin/content/promotions"
        backLabel="Promotions"
        badge={
          <span className="badge">
            {dirty ? "Unsaved changes" : promotionBadge(form)}
          </span>
        }
        error={error}
        success={success}
      />
      <form className="admin-columns" noValidate onSubmit={save}>
        <div className="panel form-stack">
          <TextField
            id="promo-internal-title"
            label="Name (only you see this) *"
            value={form.internalTitle}
            maxLength={200}
            help="Use a short name so your team can find this offer later."
            onChange={(e) => change({ internalTitle: e.target.value })}
          />
          <TextField
            id="promo-heading"
            label="Headline customers will see *"
            value={form.heading}
            maxLength={200}
            onChange={(e) => change({ heading: e.target.value })}
          />
          <Field id="promo-body" label="Offer details *">
            <textarea
              id="promo-body"
              value={form.body}
              rows={8}
              maxLength={4000}
              onChange={(e) => change({ body: e.target.value })}
            />
          </Field>
          <Field id="promo-terms" label="Terms and conditions">
            <textarea
              id="promo-terms"
              value={form.terms}
              rows={4}
              maxLength={4000}
              onChange={(e) => change({ terms: e.target.value })}
            />
          </Field>
          <Field id="promo-exclusions" label="What’s not included">
            <textarea
              id="promo-exclusions"
              value={form.exclusions}
              rows={4}
              maxLength={4000}
              onChange={(e) => change({ exclusions: e.target.value })}
            />
          </Field>
          <TextField
            id="promo-cta-label"
            label="Button wording"
            value={form.ctaLabel}
            maxLength={80}
            help="Optional. If you add this, choose a button link below too."
            onChange={(e) => change({ ctaLabel: e.target.value })}
          />
          <Field id="promo-cta-href" label="Button link">
            <select
              id="promo-cta-href"
              value={promotionLinkSelection(form.ctaHref)}
              onChange={(e) =>
                change({ ctaHref: e.target.value === "custom" ? (form.ctaHref || "https://") : e.target.value })
              }
            >
              {promotionLinkOptions.map(([href, label]) => (
                <option key={href} value={href}>{label}</option>
              ))}
            </select>
            <small>Button wording and button link must be filled in together, or both left empty.</small>
            {promotionCtaError(form) && (
              <small className="field-error">{promotionCtaError(form)}</small>
            )}
            {form.ctaHref && promotionLinkSelection(form.ctaHref) === "custom" ? (
              <TextField
                id="promo-cta-custom"
                label="Website link"
                type="url"
                value={form.ctaHref}
                maxLength={500}
                help="Example: https://example.com/your-offer"
                onChange={(e) => change({ ctaHref: e.target.value })}
              />
            ) : null}
          </Field>
          <Field id="promo-image" label="Promotion image">
            <input
              id="promo-image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || uploadBusy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadImage(file);
                e.currentTarget.value = "";
              }}
            />
            {uploadBusy && <small>Uploading image…</small>}
            {form.imageUrl && (
              <>
                <img
                  className={styles.promotionPreview}
                  src={form.imageUrl}
                  alt={form.imageAlt || "Promotion preview"}
                />
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || uploadBusy}
                  onClick={() => change({ imageUrl: "", imageAlt: "" })}
                >
                  Remove image
                </button>
              </>
            )}
          </Field>
          <TextField
            id="promo-image-alt"
            label={form.imageUrl ? "Image alt text *" : "Image alt text"}
            value={form.imageAlt ?? ""}
            maxLength={500}
            help="Required when an image is set."
            onChange={(e) => change({ imageAlt: e.target.value })}
          />
        </div>
        <div className="stack">
          <section className="panel form-stack">
            <h2>Schedule</h2>
            <TextField
              id="promo-start"
              label="Starts on *"
              help="When customers can begin using the offer."
              type="datetime-local"
              value={form.start}
              onChange={(e) => change({ start: e.target.value })}
            />
            <TextField
              id="promo-end"
              label="Ends on *"
              help="The offer ends at the start of this date."
              type="datetime-local"
              value={form.end}
              onChange={(e) => change({ end: e.target.value })}
            />
              <TextField
                id="promo-priority"
                label="Order when several offers are active"
                type="number"
                step={1}
                help="Lower numbers appear first in the About-page offer list."
                value={form.priority}
              onChange={(e) => change({ priority: Number(e.target.value) })}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => change({ enabled: e.target.checked })}
              />
              Show this offer on the website
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.yearConfirmed}
                onChange={(e) => change({ yearConfirmed: e.target.checked })}
              />
              I have checked the offer dates
            </label>
            <small>Confirm the dates before activating this offer.</small>
          </section>
          <section className="panel form-stack">
            <Submit busy={busy || uploadBusy} label="Save Changes" />
            <button
              type="button"
              className="button secondary"
              onClick={() => setPreview(true)}
            >
              Preview
            </button>
            {saved && status === "draft" && (
              <button
                type="button"
                className="button"
                disabled={!lifecycleReady}
                onClick={() => void act("activate")}
              >
                Activate
              </button>
            )}
            {saved && (status === "scheduled" || status === "active") && (
              <button
                type="button"
                className="button"
                disabled={!lifecycleReady}
                onClick={() => void act("pause")}
              >
                Pause
              </button>
            )}
            {saved && status === "paused" && (
              <button
                type="button"
                className="button"
                disabled={!lifecycleReady}
                onClick={() => void act("resume")}
              >
                Resume
              </button>
            )}
            {saved &&
              (status === "scheduled" ||
                status === "active" ||
                status === "paused") && (
                <button
                  type="button"
                  className="button"
                  disabled={!lifecycleReady}
                  onClick={() => void act("end")}
                >
                  End Promotion
                </button>
              )}
            {saved && status === "draft" && (
              <button
                type="button"
                className="button danger"
                disabled={!lifecycleReady}
                onClick={() => setConfirm("delete")}
              >
                Delete Draft
              </button>
            )}
            <Link
              className="button secondary"
              href="/admin/content/promotions"
            >
              Cancel
            </Link>
          </section>
        </div>
      </form>
      <Dialog
        open={preview}
        onClose={() => setPreview(false)}
        title="Promotion preview"
      >
        <p className="eyebrow">{form.placement || "Promotion"}</p>
        <h2>{form.heading || "Untitled promotion"}</h2>
        <div className="prose">{form.body}</div>
        {form.terms && (
          <p>
            <strong>Terms:</strong>{" "}
            <span className="brand-glow">{form.terms}</span>
          </p>
        )}
        {form.exclusions && (
          <p>
            <strong>Exclusions:</strong> {form.exclusions}
          </p>
        )}
        <p>
          {form.start} — {form.end}
        </p>
        {form.ctaLabel && (
          <p>
            <strong>{form.ctaLabel}</strong> → {form.ctaHref || "No link set"}
          </p>
        )}
        <p className="demo-caption">
          Preview only. This campaign is not published anywhere.
        </p>
      </Dialog>
      <section className="panel promotion-editor-preview">
        <h2>Customer preview</h2>
        <Promotion force previewPromotion={form} />
      </section>
      <Dialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        title="Delete this draft?"
      >
        <p>This removes the draft promotion from the demo workspace.</p>
        <div className="actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => setConfirm(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() => void act("delete-draft")}
          >
            Delete Draft
          </button>
        </div>
      </Dialog>
    </>
  );
}
