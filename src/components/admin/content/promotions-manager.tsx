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
  if (id) {
    const record =
      id === "new"
        ? undefined
        : store.websiteContent.promotions.find((p) => p.id === id);
    if (id !== "new" && !record)
      return (
        <Empty
          title="Record not found"
          body="This promotion is not available in the demo store."
        />
      );
    return <PromotionEditor key={record?.id || "new"} record={record} />;
  }
  const promotions = state === "empty" ? [] : getPromotions();
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
                <span className="badge">{promotionBadge(record)}</span>
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
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const next = await savePromotion(form);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setSuccess("Changes saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: PromotionAction) {
    if (busy || !saved) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
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
  const lifecycleReady = saved && !dirty && !busy;
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
            label="Internal title *"
            value={form.internalTitle}
            maxLength={200}
            onChange={(e) => change({ internalTitle: e.target.value })}
          />
          <TextField
            id="promo-heading"
            label="Heading *"
            value={form.heading}
            maxLength={200}
            onChange={(e) => change({ heading: e.target.value })}
          />
          <Field id="promo-body" label="Offer copy *">
            <textarea
              id="promo-body"
              value={form.body}
              rows={8}
              maxLength={4000}
              onChange={(e) => change({ body: e.target.value })}
            />
          </Field>
          <Field id="promo-terms" label="Terms">
            <textarea
              id="promo-terms"
              value={form.terms}
              rows={4}
              maxLength={4000}
              onChange={(e) => change({ terms: e.target.value })}
            />
          </Field>
          <Field id="promo-exclusions" label="Exclusions">
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
            label="CTA label"
            value={form.ctaLabel}
            maxLength={80}
            onChange={(e) => change({ ctaLabel: e.target.value })}
          />
          <TextField
            id="promo-cta-href"
            label="CTA destination"
            type="url"
            value={form.ctaHref}
            maxLength={500}
            help="Absolute http(s) link for the call to action."
            onChange={(e) => change({ ctaHref: e.target.value })}
          />
        </div>
        <div className="stack">
          <section className="panel form-stack">
            <h2>Schedule</h2>
            <TextField
              id="promo-start"
              label="Start date *"
              type="datetime-local"
              value={form.start}
              onChange={(e) => change({ start: e.target.value })}
            />
            <TextField
              id="promo-end"
              label="End date (exclusive) *"
              type="datetime-local"
              value={form.end}
              onChange={(e) => change({ end: e.target.value })}
            />
            <TextField
              id="promo-placement"
              label="Placement"
              value={form.placement}
              maxLength={120}
              help="Where the campaign is intended to appear."
              onChange={(e) => change({ placement: e.target.value })}
            />
            <TextField
              id="promo-priority"
              label="Priority"
              type="number"
              step={1}
              value={form.priority}
              onChange={(e) => change({ priority: Number(e.target.value) })}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => change({ enabled: e.target.checked })}
              />
              Enabled
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.yearConfirmed}
                onChange={(e) => change({ yearConfirmed: e.target.checked })}
              />
              Offer dates confirmed by the client
            </label>
          </section>
          <section className="panel form-stack">
            <Submit busy={busy} label="Save Changes" />
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
            <strong>Terms:</strong> {form.terms}
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
