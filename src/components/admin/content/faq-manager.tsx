"use client";
import { useRef, useState, type FormEvent } from "react";
import { Empty } from "@/components/ui";
import { Field, Submit, TextField } from "@/components/forms/controls";
import { Dialog } from "@/components/dialog";
import { UnsavedGuard } from "../unsaved";
import { getFaqs, saveFaqs, useDemoStore } from "@/lib/mock-store";
import { demoMode } from "@/lib/demo-mode";
import { saveLiveFaqs } from "@/lib/website/actions";
import { useEffect } from "react";
import type { FaqItem } from "@/lib/contracts";
import { ModuleShell } from "./shared/module-shell";
import styles from "./content.module.css";
import { BrandedText } from "@/lib/brand-highlight";
export function FaqManager({ state }: { state?: string }) {
  useDemoStore();
  const [draft, setDraft] = useState<FaqItem[]>(() => structuredClone(state === "empty" ? [] : getFaqs()));
  const [loaded, setLoaded] = useState(demoMode);
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(state === "empty" ? [] : getFaqs()),
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [selectedAnswerId, setSelectedAnswerId] = useState("");
  const answerRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  useEffect(() => {
    if (demoMode) return;
    let active = true;
    fetch("/api/website?module=faq", { cache: "no-store" }).then(async r => {
      if (!r.ok) throw new Error("FAQs could not be loaded.");
      const data = await r.json();
      const rows: FaqItem[] = (data.items ?? []).map((row: { id: string; record_key: string; payload: { question?: string; answer?: string; glow?: string; enabled?: boolean }; sort_order: number; version: number }) => ({ id: row.record_key, question: row.payload.question ?? "", answer: row.payload.answer ?? "", glow: row.payload.glow, enabled: row.payload.enabled !== false, order: row.sort_order, version: row.version }));
      if (active) { setDraft(rows); setBaseline(JSON.stringify(rows)); setLoaded(true); }
    }).catch(err => { if (active) { setError(err.message); setLoaded(true); } });
    return () => { active = false; };
  }, []);
  const dirty = JSON.stringify(draft) !== baseline;
  function replace(rows: FaqItem[]) {
    setDraft(rows.map((row, i) => ({ ...row, order: i + 1 })));
    setSuccess("");
  }
  function patch(id: string, changes: Partial<FaqItem>) {
    setDraft((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...changes } : row)),
    );
    setSuccess("");
  }
  function applyBrandStyle(id: string) {
    const textarea = answerRefs.current[id];
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      setError("Select the words to style first.");
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    patch(id, {
      answer: `${value.slice(0, start)}[[brand]]${value.slice(start, end)}[[/brand]]${value.slice(end)}`,
    });
    setSelectedAnswerId("");
    setError("");
  }
  function move(index: number, delta: number) {
    const next = [...draft];
    const target = index + delta;
    [next[index], next[target]] = [next[target], next[index]];
    replace(next);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (!loaded) throw new Error("FAQs are still loading.");
      const saved = demoMode ? await saveFaqs(draft) : await saveLiveFaqs(draft.map(row => ({...row, version: row.version || 0})));
      setDraft(structuredClone(saved));
      setBaseline(JSON.stringify(saved));
      setSuccess("Changes saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <UnsavedGuard dirty={dirty} />
      <form noValidate onSubmit={save}>
        <ModuleShell
          title="FAQs"
          description="Questions and answers shown on the public FAQ page. Reorder, enable or disable individual entries. Add FAQs to manage the full collection."
          backHref="/admin/content"
          backLabel="Website Content"
          badge={
            <div className={styles.cardActions}>
              {dirty && <span className="badge">Unsaved changes</span>}
              <button type="button" className="button secondary" disabled={busy || !loaded} onClick={() => { const item: FaqItem = { id: crypto.randomUUID(), question: "", answer: "", order: draft.length + 1, enabled: false, version: 0 }; replace([...draft, item]); setEditing(item.id); }}>Add FAQ</button>
              <Submit busy={busy || !loaded} label="Save Changes" />
            </div>
          }
          error={error}
          success={success}
        />
        {draft.length ? (
          <div className="stack">
            {draft.map((faq, i) => (
              <article className="panel form-stack" key={faq.id}>
                <div>
                  <span className={`badge status-${faq.enabled ? "enabled" : "disabled"}`}>
                    {faq.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <h2>{faq.question || "Untitled question"}</h2>
                  <p>{faq.answer}</p>
                </div>
                {editing === faq.id && (
                  <>
                    <TextField
                      id={`faq-question-${faq.id}`}
                      label="Question *"
                      value={faq.question}
                      maxLength={300}
                      onChange={(e) =>
                        patch(faq.id, { question: e.target.value })
                      }
                    />
                    <Field id={`faq-answer-${faq.id}`} label="Answer *">
                      <p className={styles.brandingGuide}>
                        <strong>Make the answer first.</strong> Write the complete answer your customer should read.
                        Then select the exact words you want to highlight and apply the branded glow.
                      </p>
                      <textarea
                        id={`faq-answer-${faq.id}`}
                        ref={(element) => {
                          answerRefs.current[faq.id] = element;
                        }}
                        value={faq.answer}
                        rows={6}
                        maxLength={4000}
                        placeholder="Write the complete answer here, then select words for the branded glow."
                        onSelect={(e) =>
                          setSelectedAnswerId(
                            e.currentTarget.selectionStart !== e.currentTarget.selectionEnd
                              ? faq.id
                              : "",
                          )
                        }
                        onChange={(e) =>
                          patch(faq.id, { answer: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy || selectedAnswerId !== faq.id}
                        onClick={() => applyBrandStyle(faq.id)}
                      >
                        Apply branded glow to selected words
                      </button>
                      <small>
                        Select words in the answer above first. The customer preview updates immediately after you apply the glow.
                      </small>
                    </Field>
                    <div className={styles.faqPreview}>
                      <strong>Customer preview</strong>
                      <p><BrandedText text={faq.answer} legacy={faq.glow} /></p>
                    </div>
                  </>
                )}
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className="button secondary"
                    aria-expanded={editing === faq.id}
                    disabled={busy}
                    onClick={() => setEditing(editing === faq.id ? "" : faq.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    aria-label={`Move up: ${faq.question || `FAQ ${i + 1}`}`}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    Move Up
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    aria-label={`Move down: ${faq.question || `FAQ ${i + 1}`}`}
                    disabled={busy || i === draft.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    Move Down
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => patch(faq.id, { enabled: !faq.enabled })}
                  >
                    {faq.enabled ? "Disable FAQ" : "Enable FAQ"}
                  </button>
                  <button
                    type="button"
                    className="button danger"
                    disabled={busy}
                    onClick={() => setConfirmDelete(faq.id)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="No FAQs to show yet."
            body="Seeded questions appear here in the demo workspace."
          />
        )}
        <Dialog
          open={!!confirmDelete}
          onClose={() => setConfirmDelete("")}
          title="Delete this FAQ?"
        >
          <p>
            Remove this question and answer from the collection? Save Changes to
            keep the removal.
          </p>
          <div className="actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfirmDelete("")}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => {
                replace(draft.filter((row) => row.id !== confirmDelete));
                setEditing("");
                setConfirmDelete("");
              }}
            >
              Delete
            </button>
          </div>
        </Dialog>
      </form>
    </>
  );
}
