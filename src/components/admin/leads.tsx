"use client";
import Link from "next/link";
import { useState } from "react";
import { updateLead, useDemoStore } from "@/lib/mock-store";
import type { Lead } from "@/lib/contracts";
import { Empty, Heading } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, Notice, TextField } from "@/components/forms/controls";
export function Enquiries({ id, state }: { id?: string; state?: string }) {
  const store = useDemoStore();
  const [tab, setTab] = useState<"general" | "commercial">("general");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [success, setSuccess] = useState("");
  const item = store.leads.find((l) => l.id === id);
  async function update(status: Lead["status"], withNote = false) {
    if (!item || busy) return;
    setBusy(true);
    setError("");
    try {
      await updateLead(item.id, status, withNote ? note : undefined);
      setNote("");
      setSuccess("Enquiry updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (id && !item) return <Empty title="Record not found" />;
  if (item)
    return (
      <>
        <Link href="/admin/enquiries" className="back-link">
          ← Enquiries
        </Link>
        <Heading
          title={
            item.kind === "commercial"
              ? "Commercial Quote Detail"
              : "General Enquiry Detail"
          }
          description={item.fields.name}
        />
        {error && <Notice error>{error}</Notice>}
        {success && <Notice success>{success}</Notice>}
        <div className="admin-columns">
          <section className="panel">
            <h2>Contact details & requirements</h2>
            <dl className="review-list">
              {Object.entries(item.fields).map(([k, v]) => (
                <div key={k}>
                  <dt>{k.replaceAll("_", " ")}</dt>
                  <dd>{v || "Not provided"}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="panel form-stack">
            <h2>Internal notes</h2>
            {item.notes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
            <Field id="lead-note" label="Add Note">
              <textarea
                id="lead-note"
                value={note}
                maxLength={4000}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <button
              className="button secondary"
              disabled={busy || !note.trim()}
              onClick={() => void update(item.status, true)}
            >
              Add Note
            </button>
            <span className="badge">{item.status}</span>
            <button
              className="button"
              disabled={busy || item.status === "contacted"}
              onClick={() => void update("contacted")}
            >
              Mark Contacted
            </button>
            <button
              className="button secondary"
              disabled={busy || item.status === "closed"}
              onClick={() => void update("closed")}
            >
              Close Enquiry
            </button>
          </section>
        </div>
      </>
    );
  const leads =
    state === "empty"
      ? []
      : store.leads.filter(
          (l) =>
            l.kind === tab &&
            JSON.stringify(l.fields)
              .toLowerCase()
              .includes(query.toLowerCase()),
        );
  return (
    <>
      <Heading title="Enquiries" />
      <div className="filters">
        {(["general", "commercial"] as const).map((kind) => (
          <button
            key={kind}
            className={kind === tab ? "active" : ""}
            aria-pressed={kind === tab}
            onClick={() => setTab(kind)}
          >
            {kind === "general" ? "General enquiries" : "Commercial quotes"}
          </button>
        ))}
      </div>
      <TextField
        id="search-enquiries"
        label="Search enquiries"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {leads.length ? (
        <div className="panel">
          {leads.map((l) => (
            <Link
              className="record-row"
              key={l.id}
              href={`/admin/enquiries/${l.id}`}
            >
              <div>
                <h3>{l.fields.business || l.fields.name}</h3>
                <p>{l.fields.message || l.fields.items}</p>
              </div>
              <span className="badge">{l.status}</span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="No enquiries to show yet." />
      )}
    </>
  );
}
export function NewsletterAdmin({ state }: { state?: string }) {
  const store = useDemoStore();
  const leads =
    state === "empty" ? [] : store.leads.filter((l) => l.kind === "newsletter");
  const [selected, setSelected] = useState<Lead>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Heading
        title="Newsletter Interest"
        description="Email campaigns and provider integration are not enabled."
      />
      {error && <Notice error>{error}</Notice>}
      {leads.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email address</th>
                <th>Consent recorded</th>
                <th>Recorded date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>{l.fields.email}</td>
                  <td>{l.fields.consent === "yes" ? "Yes" : "No"}</td>
                  <td>{new Date(l.createdAt).toLocaleDateString("en-GB")}</td>
                  <td>
                    {l.status === "withdrawn"
                      ? "Withdrawn"
                      : "Interest recorded"}
                  </td>
                  <td>
                    <button
                      className="text-link"
                      onClick={() => setSelected(l)}
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No newsletter interest recorded yet." />
      )}
      <Dialog
        open={!!selected}
        onClose={() => setSelected(undefined)}
        title="Newsletter interest details"
      >
        {selected && (
          <>
            <p>{selected.fields.email}</p>
            <p>
              Consent recorded:{" "}
              {selected.fields.consent === "yes" ? "Yes" : "No"}
            </p>
            <p>{selected.createdAt}</p>
            <button
              className="button danger"
              disabled={busy || selected.status === "withdrawn"}
              onClick={async () => {
                setBusy(true);
                try {
                  await updateLead(selected.id, "withdrawn");
                  setSelected(undefined);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Record Withdrawal
            </button>
          </>
        )}
      </Dialog>
    </>
  );
}
