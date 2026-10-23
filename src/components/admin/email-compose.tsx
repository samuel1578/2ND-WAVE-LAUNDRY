"use client";

import { useEffect, useState } from "react";
import { Heading } from "@/components/ui";
import { Notice, Submit } from "@/components/forms/controls";
import type { BrevoSender } from "@/lib/email/manual";
import { EmailRichTextEditor } from "./email-rich-text-editor";
import { EmailSenderPicker } from "./email-sender-picker";

type SenderResponse = { senders: BrevoSender[] };
type ApiError = { code?: string };

const ERROR_MESSAGES: Record<string, string> = {
  email_disabled: "Email sending is currently disabled.",
  not_configured: "Brevo sending is not configured on this deployment.",
  sender_list_unavailable: "Verified Brevo senders could not be loaded. Try again.",
  sender_unavailable: "That sender is no longer active in Brevo. Reload the page.",
  send_failed: "Brevo did not accept the email. Check the sender and try again.",
  send_unavailable: "The email could not be sent. Try again.",
  rate_limited: "Too many emails were sent recently. Wait a few minutes and try again.",
};

export function EmailCompose() {
  const [senders, setSenders] = useState<BrevoSender[]>([]);
  const [sendersLoading, setSendersLoading] = useState(true);
  const [senderError, setSenderError] = useState("");
  const [senderId, setSenderId] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [messageHtml, setMessageHtml] = useState("");
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/admin/email-compose", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as ApiError;
          throw new Error(body.code ?? "sender_list_unavailable");
        }
        return (await response.json()) as SenderResponse;
      })
      .then((data) => {
        if (!active) return;
        setSenders(data.senders);
        setSenderId(data.senders[0] ? String(data.senders[0].id) : "");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        const code = cause instanceof Error ? cause.message : "";
        setSenderError(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.sender_list_unavailable);
      })
      .finally(() => {
        if (active) setSendersLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !senderId) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/admin/email-compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId: Number(senderId),
          recipientEmail,
          subject,
          messageHtml,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        throw new Error(body.code ?? "send_unavailable");
      }
      setSuccess("Brevo accepted the email for sending.");
      setRecipientEmail("");
      setSubject("");
      setMessageHtml("");
      setEditorResetKey((key) => key + 1);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(ERROR_MESSAGES[code] ?? "The email could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading
        title="Compose Email"
        description="Choose a verified Brevo sender, then send a message to one recipient."
      />
      <p className="demo-caption">
        The sender list is loaded from Brevo and includes active, verified senders
        only. Sending an email does not confirm inbox delivery.
      </p>
      {senderError && <Notice error>{senderError}</Notice>}
      {success && <Notice success>{success}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {!senderError && senders.length === 0 && !sendersLoading && (
        <Notice error>
          No active verified senders are available in Brevo. Verify a sender and
          reload this page.
        </Notice>
      )}
      <section className="panel">
        <form className="form-grid" onSubmit={(event) => void send(event)}>
          <EmailSenderPicker
            senders={senders}
            value={senderId}
            loading={sendersLoading}
            disabled={busy}
            onChange={setSenderId}
          />
          <label htmlFor="email-compose-to">
            To
            <input
              id="email-compose-to"
              type="email"
              autoComplete="email"
              maxLength={254}
              value={recipientEmail}
              onChange={(event) => setRecipientEmail(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label htmlFor="email-compose-subject">
            Subject
            <input
              id="email-compose-subject"
              type="text"
              maxLength={200}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
              disabled={busy}
            />
          </label>
          <div className="email-compose-message">
            <label htmlFor="email-compose-message-editor">Message</label>
            <EmailRichTextEditor
              key={editorResetKey}
              resetKey={editorResetKey}
              disabled={busy}
              onChange={setMessageHtml}
            />
            <small>
              Format text, add headings, lists, quotes, and links. Maximum
              message size: 10,000 characters.
            </small>
          </div>
          <Submit
            busy={busy}
            label="Send Email"
            busyLabel="Sending…"
          />
        </form>
      </section>
    </>
  );
}
