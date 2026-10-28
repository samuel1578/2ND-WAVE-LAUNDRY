"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Empty, Heading } from "@/components/ui";
import { Notice } from "@/components/forms/controls";
import {
  EMAIL_TEMPLATES,
  emailDeliveryStatusLabel,
  emailOutboxStatusLabel,
  emailTemplateLabel,
  type EmailTemplate,
  type EmailStatusFilter,
  type EmailDeliveryEventSummary,
  type OutboxStatus,
} from "@/lib/email/monitoring";

type MonitoringRow = {
  id: string;
  bookingId: string | null;
  bookingReference: string;
  template: EmailTemplate;
  recipientEmail: string;
  status: OutboxStatus;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
  latestDeliveryEvent: EmailDeliveryEventSummary | null;
  isTest: boolean;
  resendOf: string | null;
};

type MonitoringPage = {
  rows: MonitoringRow[];
  total: number;
  page: number;
  pageSize: number;
};

type OperationalConfiguration = {
  transactionalEnabled: boolean;
  apiKeyConfigured: boolean;
  siteUrlConfigured: boolean;
  workerSecretConfigured: boolean;
  cronSecretConfigured: boolean;
  webhookSecretConfigured: boolean;
  testRecipientConfigured: boolean;
  templates: Array<{
    template: EmailTemplate;
    variable: string;
    status: "configured" | "missing" | "invalid";
  }>;
};

const STATUS_FILTERS: Array<[EmailStatusFilter, string]> = [
  ["", "All queue states"],
  ["pending", "Queued"],
  ["sending", "Sending"],
  ["sent", "Accepted by provider"],
  ["retryable_failed", "Retry scheduled"],
  ["dead", "Terminal failure"],
];

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString();
}

function statusClass(status: OutboxStatus, event: EmailDeliveryEventSummary | null) {
  const value = emailDeliveryStatusLabel(status, event).toLowerCase();
  if (value === "delivered") return "success";
  if (status === "dead" || event?.event === "bounced" || event?.event === "complained")
    return "danger";
  if (status === "retryable_failed" || event?.event === "deferred")
    return "warning";
  return "";
}

export function EmailDelivery() {
  const [status, setStatus] = useState<EmailStatusFilter>("");
  const [eventType, setEventType] = useState<EmailTemplate | "">("");
  const [page, setPage] = useState<MonitoringPage | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [configuration, setConfiguration] = useState<OperationalConfiguration | null>(null);
  const [selectedTest, setSelectedTest] = useState<EmailTemplate>("booking_created");
  const [testBusy, setTestBusy] = useState(false);

  const loadConfiguration = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/email-delivery?view=configuration", { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const result = (await response.json()) as { configuration: OperationalConfiguration };
      setConfiguration(result.configuration);
    } catch {
      setConfiguration(null);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        pageSize: "20",
      });
      if (status) params.set("status", status);
      if (eventType) params.set("eventType", eventType);
      const response = await fetch(`/api/admin/email-delivery?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("unavailable");
      setPage((await response.json()) as MonitoringPage);
    } catch {
      setError("Email delivery information could not be loaded. Try again.");
      setPage(null);
    } finally {
      setLoading(false);
    }
  }, [currentPage, eventType, status]);

  useEffect(() => {
    void load();
    void loadConfiguration();
  }, [load, loadConfiguration]);

  async function sendTemplateTest() {
    setTestBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/email-delivery/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: selectedTest }),
      });
      if (!response.ok) throw new Error("test_unavailable");
      setMessage("A controlled test was queued to the configured test recipient.");
      await load();
    } catch {
      setError("The template test could not be queued. Check the test recipient and template configuration.");
    } finally {
      setTestBusy(false);
    }
  }

  async function resend(row: MonitoringRow) {
    const reason = window.prompt(
      `Why should ${emailTemplateLabel(row.template)} for ${row.bookingReference} be deliberately resent?`,
    );
    if (!reason?.trim()) return;
    setRetrying(row.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/admin/email-delivery/${encodeURIComponent(row.id)}/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error("resend_unavailable");
      setMessage("A deliberate resend was queued and recorded in the audit log.");
      await load();
    } catch {
      setError("This notification could not be queued for resend.");
    } finally {
      setRetrying(null);
    }
  }

  async function retry(row: MonitoringRow) {
    if (
      !window.confirm(
        `Queue one additional delivery attempt for ${row.bookingReference} (${emailTemplateLabel(row.template)})?`,
      )
    )
      return;

    setRetrying(row.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch(
        `/api/admin/email-delivery/${encodeURIComponent(row.id)}/retry`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("retry_unavailable");
      setMessage("The failed notification was queued for another attempt.");
      await load();
    } catch {
      setError("This notification could not be queued for retry.");
    } finally {
      setRetrying(null);
    }
  }

  const totalPages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  return (
    <>
      <Heading
        title="Email Delivery"
        description="Customer notifications and their current delivery evidence."
      />
      <p className="demo-caption">
        “Accepted by provider” means Brevo accepted the request, not that it
        reached an inbox. Delivered status appears only after an authenticated
        Brevo delivery event. One-off administrator messages are sent by the
        owner through Gmail Send As, not from this application.
      </p>
      <section className="panel">
        <h2>Transactional email configuration</h2>
        {!configuration ? <p>Configuration status is unavailable.</p> : (
          <>
            <dl className="review-list">
              {[
                ["Transactional sending", configuration.transactionalEnabled ? "Enabled" : "Disabled"],
                ["Brevo API key", configuration.apiKeyConfigured ? "Configured" : "Missing"],
                ["Site URL", configuration.siteUrlConfigured ? "Configured" : "Missing or invalid"],
                ["Worker secret", configuration.workerSecretConfigured ? "Configured" : "Missing or invalid"],
                ["Vercel cron secret", configuration.cronSecretConfigured ? "Configured" : "Missing or invalid"],
                ["Brevo webhook secret", configuration.webhookSecretConfigured ? "Configured" : "Missing or invalid"],
                ["Controlled test recipient", configuration.testRecipientConfigured ? "Configured" : "Missing or invalid"],
              ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            <h3>Saved Brevo template IDs</h3>
            <ul>
              {configuration.templates.map((entry) => (
                <li key={entry.template}>
                  {emailTemplateLabel(entry.template)} — <code>{entry.variable}</code>: {entry.status}
                </li>
              ))}
            </ul>
            <label>
              Send controlled template test
              <select value={selectedTest} onChange={(event) => setSelectedTest(event.target.value as EmailTemplate)}>
                {EMAIL_TEMPLATES.filter((template) => template !== "newsletter_interest_received").map((template) => {
                  const entry = configuration.templates.find((item) => item.template === template);
                  return <option key={template} value={template} disabled={entry?.status !== "configured"}>{emailTemplateLabel(template)}{entry?.status !== "configured" ? " — not configured" : ""}</option>;
                })}
              </select>
            </label>
            <button className="button secondary" disabled={testBusy || !configuration.testRecipientConfigured || !configuration.transactionalEnabled || configuration.templates.find((entry) => entry.template === selectedTest)?.status !== "configured"} onClick={() => void sendTemplateTest()}>
              {testBusy ? "Queueing test…" : "Send template test"}
            </button>
            {!configuration.testRecipientConfigured && <p className="demo-caption">Set the server-only EMAIL_TEST_RECIPIENT to enable controlled tests. No customer recipient is accepted by the test API.</p>}
          </>
        )}
      </section>
      {message && <Notice success>{message}</Notice>}
      {error && (
        <Notice error>
          {error}{" "}
          <button className="text-link" onClick={() => void load()}>
            Reload
          </button>
        </Notice>
      )}
      <section className="panel">
        <div className="form-grid">
          <label>
            Queue status
            <select
              value={status}
              onChange={(event) => {
                setCurrentPage(1);
                setStatus(event.target.value as EmailStatusFilter);
              }}
            >
              {STATUS_FILTERS.map(([value, label]) => (
                <option key={value || "all"} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notification type
            <select
              value={eventType}
              onChange={(event) => {
                setCurrentPage(1);
                setEventType(event.target.value as EmailTemplate | "");
              }}
            >
              <option value="">All notification types</option>
              {EMAIL_TEMPLATES.map((template) => (
                <option key={template} value={template}>
                  {emailTemplateLabel(template)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {loading ? (
        <p role="status">Loading notifications…</p>
      ) : page?.rows.length ? (
        <>
          <div className="stack section">
            {page.rows.map((row) => (
              <article className="panel" key={row.id}>
                <div className="section-title">
                  <div>
                    <p className="eyebrow">{emailTemplateLabel(row.template)}</p>
                    <h2>
                      {row.bookingId ? (
                        <Link href={`/admin/bookings/${row.bookingId}`}>
                          {row.bookingReference}
                        </Link>
                      ) : (
                        row.bookingReference
                      )}
                    </h2>
                  </div>
                  <span className={`badge ${statusClass(row.status, row.latestDeliveryEvent)}`}>
                    {emailDeliveryStatusLabel(row.status, row.latestDeliveryEvent)}
                  </span>
                </div>
                {row.isTest && <p className="eyebrow">Controlled template test</p>}
                {row.resendOf && <p className="demo-caption">Deliberate resend of {row.resendOf}</p>}
                <dl className="review-list">
                  <div>
                    <dt>Recipient</dt>
                    <dd>{row.recipientEmail}</dd>
                  </div>
                  <div>
                    <dt>Queue state</dt>
                    <dd>{emailOutboxStatusLabel(row.status)}</dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>{row.attemptCount} of {row.maxAttempts}</dd>
                  </div>
                  <div>
                    <dt>Last attempt</dt>
                    <dd>
                      {row.attemptCount > 0
                        ? dateLabel(row.lastAttemptAt)
                        : "Not attempted yet"}
                    </dd>
                  </div>
                  <div>
                    <dt>Accepted by provider</dt>
                    <dd>{dateLabel(row.sentAt)}</dd>
                  </div>
                  <div>
                    <dt>Next attempt</dt>
                    <dd>{dateLabel(row.nextAttemptAt)}</dd>
                  </div>
                  {row.latestDeliveryEvent && (
                    <div>
                      <dt>Latest provider event</dt>
                      <dd>
                        {row.latestDeliveryEvent.event} ·{" "}
                        {dateLabel(
                          row.latestDeliveryEvent.providerEventAt ??
                            row.latestDeliveryEvent.receivedAt,
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
                {(row.lastError || row.latestDeliveryEvent?.reason) && (
                  <Notice error={row.status === "dead" || row.latestDeliveryEvent?.event === "bounced"}>
                    {row.latestDeliveryEvent?.reason ?? row.lastError}
                  </Notice>
                )}
                {row.status === "sent" && !row.isTest && (
                  <button className="button secondary" disabled={retrying === row.id} onClick={() => void resend(row)}>
                    {retrying === row.id ? "Queueing…" : "Deliberately resend"}
                  </button>
                )}
                {row.status === "dead" && row.maxAttempts < 20 && (
                  <button
                    className="button secondary"
                    disabled={retrying === row.id}
                    onClick={() => void retry(row)}
                  >
                    {retrying === row.id ? "Queueing…" : "Queue one retry"}
                  </button>
                )}
                {row.status === "dead" && row.maxAttempts >= 20 && (
                  <p className="demo-caption">
                    Retry limit reached. Review the sender or provider issue before
                    taking further action.
                  </p>
                )}
              </article>
            ))}
          </div>
          <nav aria-label="Email delivery pages" className="actions">
            <button
              className="button secondary"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </button>
            <span>
              Page {currentPage} of {totalPages} · {page.total} notifications
            </span>
            <button
              className="button secondary"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((value) => value + 1)}
            >
              Next
            </button>
          </nav>
        </>
      ) : !loading && !error ? (
        <Empty title="No notifications match these filters." />
      ) : null}
    </>
  );
}

export function BookingEmailStatus({ bookingId }: { bookingId: string }) {
  const [page, setPage] = useState<MonitoringPage | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(
      `/api/admin/email-delivery?bookingId=${encodeURIComponent(bookingId)}&pageSize=50`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return (await response.json()) as MonitoringPage;
      })
      .then((result) => {
        if (active) setPage(result);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [bookingId]);

  if (unavailable) return null;
  return (
    <section className="panel">
      <h2>Customer email delivery</h2>
      {!page ? (
        <p>Loading notification status…</p>
      ) : page.rows.length ? (
        <ul>
          {page.rows.map((row) => (
            <li key={row.id}>
              <strong>{emailTemplateLabel(row.template)}</strong>:{" "}
              {emailDeliveryStatusLabel(row.status, row.latestDeliveryEvent)}
              {row.status === "retryable_failed" && row.nextAttemptAt
                ? ` · next attempt ${dateLabel(row.nextAttemptAt)}`
                : ""}
              {row.lastError ? ` · ${row.lastError}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {page.total === 0
            ? "No customer email was queued for this booking."
            : "No notifications to show on this page."}
        </p>
      )}
      <Link className="text-link" href="/admin/email-delivery">
        View delivery monitor
      </Link>
    </section>
  );
}
