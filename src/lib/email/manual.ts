import { validEmail } from "../rules";
import sanitizeHtml from "sanitize-html";

export const BREVO_SENDERS_ENDPOINT = "https://api.brevo.com/v3/senders";
export const MANUAL_EMAIL_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
export const MANUAL_EMAIL_TIMEOUT_MS = 10_000;

export type BrevoSender = {
  id: number;
  name: string;
  email: string;
};

export type ManualEmailInput = {
  sender: BrevoSender;
  recipientEmail: string;
  subject: string;
  messageHtml: string;
};

export type ManualEmailResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; reason: string };

type BrevoFetch = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isActiveSender(value: unknown): value is BrevoSender {
  if (!isRecord(value)) return false;
  return (
    value.active === true &&
    typeof value.id === "number" &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.email === "string" &&
    validEmail(value.email)
  );
}

export async function listActiveBrevoSenders(
  apiKey: string,
  fetchImpl: BrevoFetch = fetch,
): Promise<BrevoSender[]> {
  let response: Response;
  try {
    response = await fetchImpl(BREVO_SENDERS_ENDPOINT, {
      method: "GET",
      headers: { accept: "application/json", "api-key": apiKey },
      signal: AbortSignal.timeout(MANUAL_EMAIL_TIMEOUT_MS),
    });
  } catch {
    throw new Error("brevo_senders_unavailable");
  }

  if (!response.ok) throw new Error(`brevo_senders_http_${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("brevo_senders_invalid_response");
  }
  if (!isRecord(body) || !Array.isArray(body.senders))
    throw new Error("brevo_senders_invalid_response");

  return body.senders.filter(isActiveSender).map((sender) => ({
    id: sender.id,
    name: sender.name.trim(),
    email: sender.email.trim(),
  }));
}

export function sanitizeManualEmailHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "h2",
      "h3",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
    ],
    allowedAttributes: { a: ["href", "title", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  }).trim();
}

export async function sendManualBrevoEmail(
  apiKey: string,
  input: ManualEmailInput,
  fetchImpl: BrevoFetch = fetch,
): Promise<ManualEmailResult> {
  const htmlContent = sanitizeManualEmailHtml(input.messageHtml);
  let response: Response;
  try {
    response = await fetchImpl(MANUAL_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: { id: input.sender.id },
        to: [{ email: input.recipientEmail }],
        subject: input.subject,
        htmlContent,
        tags: ["admin_manual"],
      }),
      signal: AbortSignal.timeout(MANUAL_EMAIL_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "brevo_send_unavailable" };
  }

  if (!response.ok)
    return { ok: false, reason: `brevo_send_http_${response.status}` };

  let providerMessageId: string | null = null;
  try {
    const body: unknown = await response.json();
    if (
      isRecord(body) &&
      typeof body.messageId === "string" &&
      body.messageId.trim()
    )
      providerMessageId = body.messageId.trim().slice(0, 200);
  } catch {
    // Brevo may accept a send without returning a JSON message ID.
  }

  return { ok: true, providerMessageId };
}
