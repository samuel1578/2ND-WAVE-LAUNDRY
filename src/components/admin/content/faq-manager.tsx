"use client";
import { useState, type FormEvent } from "react";
import { Empty } from "@/components/ui";
import { Field, Submit, TextField } from "@/components/forms/controls";
import { Dialog } from "@/components/dialog";
import { UnsavedGuard } from "../unsaved";
import { getFaqs, saveFaqs, useDemoStore } from "@/lib/mock-store";
import type { FaqItem } from "@/lib/contracts";
import { ModuleShell } from "./shared/module-shell";
import styles from "./content.module.css";
export function FaqManager({ state }: { state?: string }) {
  useDemoStore();
  const [draft, setDraft] = useState<FaqItem[]>(() =>
    structuredClone(state === "empty" ? [] : getFaqs()),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(state === "empty" ? [] : getFaqs()),
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
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
      const saved = await saveFaqs(draft);
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
          description="Questions and answers shown on the public FAQ page. Reorder, enable or disable individual entries."
          backHref="/admin/content"
          backLabel="Website Content"
          badge={
            <div className={styles.cardActions}>
              {dirty && <span className="badge">Unsaved changes</span>}
              <Submit busy={busy} label="Save Changes" />
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
                  <span className="badge">
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
                      <textarea
                        id={`faq-answer-${faq.id}`}
                        value={faq.answer}
                        rows={6}
                        maxLength={4000}
                        onChange={(e) =>
                          patch(faq.id, { answer: e.target.value })
                        }
                      />
                    </Field>
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
