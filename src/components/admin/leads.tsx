"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { updateLead, useDemoStore } from "@/lib/mock-store";
import type { Lead } from "@/lib/contracts";
import { Empty, Heading } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, Notice, TextField } from "@/components/forms/controls";
type EnquiryView = {
  id: string;
  kind: "general" | "commercial";
  status: "new" | "contacted" | "closed";
  fields: Record<string, string>;
  notes: string[];
  version: number;
};
function liveEnquiryView(record: {
  id: string;
  kind: "general" | "commercial";
  status: "new" | "contacted" | "closed";
  name: string;
  business: string | null;
  phone: string;
  email: string | null;
  topic: string | null;
  message: string | null;
  details: Record<string, unknown>;
  notes: Array<{ text: string }>;
  version: number;
}): EnquiryView {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    fields: {
      name: record.name,
      business: record.business ?? "",
      phone: record.phone,
      email: record.email ?? "",
      topic: record.topic ?? "",
      message: record.message ?? "",
      ...Object.fromEntries(Object.entries(record.details).map(([key, value]) => [key, typeof value === "string" ? value : ""])),
    },
    notes: record.notes.map((note) => note.text),
    version: record.version,
  };
}
export function Enquiries({ id, state, demo = false }: { id?: string; state?: string; demo?: boolean }) {
  const store = useDemoStore();
  const [tab, setTab] = useState<"general" | "commercial">("general");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [records, setRecords] = useState<EnquiryView[] | null>(demo ? [] : null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [success, setSuccess] = useState("");
  const demoItem = demo ? store.leads.find((lead) => lead.id === id && ["general", "commercial"].includes(lead.kind)) : undefined;
  const item: EnquiryView | undefined = demoItem
    ? { id: demoItem.id, kind: demoItem.kind as EnquiryView["kind"], status: demoItem.status as EnquiryView["status"], fields: demoItem.fields, notes: demoItem.notes, version: 1 }
    : records?.find((record) => record.id === id);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await fetch(
          id ? `/api/admin/enquiries/${encodeURIComponent(id)}` : `/api/admin/enquiries?kind=${tab}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const message = response.status === 401
            ? "Sign in with an administrator account."
            : response.status === 403
              ? "Your administrator role does not include enquiries."
              : response.status === 404
                ? "This enquiry is no longer available."
                : "Enquiries could not be loaded. Reload the page and try again.";
          if (!cancelled) { setLoadError(message); setRecords(null); }
          return;
        }
        const payload = await response.json() as { record?: Parameters<typeof liveEnquiryView>[0]; records?: Parameters<typeof liveEnquiryView>[0][] };
        if (!cancelled) {
          setRecords(id ? (payload.record ? [liveEnquiryView(payload.record)] : []) : (payload.records ?? []).map(liveEnquiryView));
          setLoadError("");
        }
      } catch {
        if (!cancelled) { setLoadError("Enquiries could not be loaded. Reload the page and try again."); setRecords(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [demo, id, tab]);

  async function update(status: EnquiryView["status"], withNote = false) {
    if (!item || busy) return;
    setBusy(true);
    setError("");
    try {
      if (demo) {
        await updateLead(item.id, status, withNote ? note : undefined);
      } else {
        const response = await fetch(`/api/admin/enquiries/${encodeURIComponent(item.id)}/update`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedVersion: item.version, status, ...(withNote ? { note } : {}) }),
        });
        const result = await response.json() as { ok?: boolean; version?: number; message?: string };
        if (!response.ok || result.ok !== true || typeof result.version !== "number")
          throw new Error(result.message || "This enquiry could not be updated. Reload and try again.");
        setRecords((current) => current?.map((record) => record.id === item.id
          ? { ...record, status, version: result.version!, notes: withNote ? [...record.notes, note.trim()] : record.notes }
          : record) ?? current);
      }
      setNote("");
      setSuccess("Enquiry updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading && !records) return <Empty title="Loading enquiries…" />;
  if (loadError && !records) return <Notice error>{loadError}</Notice>;
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
  const demoLeads: EnquiryView[] = store.leads
    .filter((lead) => ["general", "commercial"].includes(lead.kind) && lead.kind === tab)
    .map((lead) => ({
      id: lead.id,
      kind: lead.kind as EnquiryView["kind"],
      status: lead.status as EnquiryView["status"],
      fields: lead.fields,
      notes: lead.notes,
      version: 1,
    }));
  const leads = (demo ? (state === "empty" ? [] : demoLeads) : records ?? [])
    .filter((lead) => lead.kind === tab && JSON.stringify(lead.fields).toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <Heading title="Enquiries" />
      {loadError && <Notice error>{loadError}</Notice>}
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
      {loading ? (
        <Empty title="Loading enquiries…" />
      ) : leads.length ? (
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
type NewsletterInterestRecord = {
  id: string;
  email: string;
  consentVersion: string;
  source: string;
  createdAt: string;
};

export function NewsletterAdmin({
  state,
  demo = false,
}: {
  state?: string;
  demo?: boolean;
}) {
  const store = useDemoStore();
  const demoLeads = demo
    ? state === "empty"
      ? []
      : store.leads.filter((l) => l.kind === "newsletter")
    : [];
  const [records, setRecords] = useState<NewsletterInterestRecord[] | null>(
    demo ? [] : null,
  );
  const [loading, setLoading] = useState(!demo);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Lead>();
  const [selectedRecord, setSelectedRecord] = useState<NewsletterInterestRecord>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/admin/newsletter", {
          cache: "no-store",
        });
        if (!response.ok) {
          if (!cancelled) {
            setLoadError(
              response.status === 401
                ? "Sign in with an administrator account."
                : response.status === 403
                  ? "Your administrator role does not include newsletter interest."
                  : "Newsletter interest could not be loaded. Reload the page and try again.",
            );
            setRecords(null);
          }
          return;
        }
        const payload = (await response.json()) as {
          records?: NewsletterInterestRecord[];
        };
        if (!cancelled) {
          setRecords(payload.records ?? []);
          setLoadError("");
        }
      } catch {
        if (!cancelled) {
          setLoadError(
            "Newsletter interest could not be loaded. Reload the page and try again.",
          );
          setRecords(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const rows = demo
    ? demoLeads.map((lead) => ({
      key: lead.id,
      email: lead.fields.email,
      consent: lead.fields.consent === "yes" ? "Yes" : "No",
      date: new Date(lead.createdAt).toLocaleDateString("en-GB"),
      status: lead.status === "withdrawn" ? "Withdrawn" : "Interest recorded",
      lead,
      record: undefined,
    }))
    : (records ?? []).map((record) => ({
      key: record.id,
      email: record.email,
      consent: record.consentVersion,
      date: record.createdAt
        ? new Date(record.createdAt).toLocaleDateString("en-GB")
        : "—",
      status: "Interest recorded",
      lead: undefined,
      record,
    }));

  return (
    <>
      <Heading
        title="Newsletter Interest"
        description="Email campaigns and provider integration are not enabled."
      />
      {error && <Notice error>{error}</Notice>}
      {loadError && <Notice error>{loadError}</Notice>}
      {loading ? (
        <p role="status">Loading newsletter interest…</p>
      ) : rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email address</th>
                <th>Consent</th>
                <th>Recorded date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.email}</td>
                  <td>{row.consent}</td>
                  <td>{row.date}</td>
                  <td>{row.status}</td>
                  <td>
                    <button
                      className="text-link"
                      onClick={() =>
                        row.lead
                          ? setSelected(row.lead)
                          : setSelectedRecord(row.record)
                      }
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
      <Dialog
        open={!!selectedRecord}
        onClose={() => setSelectedRecord(undefined)}
        title="Newsletter interest details"
      >
        {selectedRecord && (
          <>
            <p>{selectedRecord.email}</p>
            <p>Consent notice: {selectedRecord.consentVersion}</p>
            <p>
              Recorded:{" "}
              {selectedRecord.createdAt
                ? new Date(selectedRecord.createdAt).toLocaleString("en-GB")
                : "—"}
            </p>
            <p>Source: {selectedRecord.source}</p>
            <p className="demo-caption">
              Withdrawal and campaign controls are not part of this phase.
            </p>
          </>
        )}
      </Dialog>
    </>
  );
}
