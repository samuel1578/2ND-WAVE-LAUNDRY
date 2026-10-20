/**
 * Brevo transactional webhook handling.
 *
 * Brevo supports authenticated webhook delivery through its documented
 * `auth: { type: "bearer", token: ... }` webhook configuration (or custom
 * headers). This handler verifies a bearer secret in constant time and rejects
 * everything else before parsing the payload.
 *
 * Only the minimum event fields are persisted:
 *   outbox id, normalised event, replay digest, short sanitised reason, event time.
 * The recipient email, subject, tags, sending IP, links, user agent and raw
 * payload are never stored or returned.
 *
 * Ignored events are acknowledged with 200 so Brevo does not retry them.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const MAX_WEBHOOK_BYTES = 16 * 1024;
export const MAX_WEBHOOK_REASON = 200;

export type NormalisedDeliveryEvent =
  | "delivered"
  | "deferred"
  | "bounced"
  | "complained";

export type BrevoDeliveryRecord = {
  outboxId: string;
  event: NormalisedDeliveryEvent;
  dedupeKey: string;
  reason: string | null;
  providerEventAt: string | null;
};

export type BrevoWebhookRepository = {
  findOutboxId(input: {
    providerMessageId: string | null;
    customHeader: string | null;
  }): Promise<string | null>;
  record(
    input: BrevoDeliveryRecord,
  ): Promise<"recorded" | "duplicate">;
};

export type BrevoWebhookInput = {
  method: string;
  authorization: string | null;
  contentType: string | null;
  bodyText: string;
};

export type BrevoWebhookDeps = {
  secret: string | null;
  repository: BrevoWebhookRepository;
  maxBytes?: number;
  now?: () => Date;
};

export type BrevoWebhookResponse = {
  status: number;
  body: Record<string, unknown>;
};

const NO_STORE: Record<string, string> = { "Cache-Control": "no-store" };

const response = (
  status: number,
  body: Record<string, unknown>,
): BrevoWebhookResponse => ({ status, body });

/** Constant-time comparison that does not short-circuit on length. */
export function secureSecretEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Compare the expected value with itself to keep the work shape stable.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function bearerMatches(
  authorization: string | null,
  secret: string,
): boolean {
  if (!authorization) return false;
  const candidate = authorization.replace(/^\s*bearer\s+/i, "").trim();
  return candidate.length > 0 && secureSecretEqual(candidate, secret);
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown, max = 512): string | null =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;

const sanitiseReason = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, MAX_WEBHOOK_REASON);
};

/** Brevo uses `soft_bounce` / `hard_bounce`; both are normalised to bounced. */
export function normaliseEvent(value: unknown): NormalisedDeliveryEvent | null {
  if (typeof value !== "string") return null;
  switch (value.toLowerCase()) {
    case "delivered":
      return "delivered";
    case "deferred":
      return "deferred";
    case "soft_bounce":
    case "hard_bounce":
    case "blocked":
    case "invalid_email":
    case "error":
      return "bounced";
    case "spam":
      return "complained";
    default:
      return null;
  }
}

/** Parses the opaque correlation header added by the Brevo client. */
export function outboxIdFromCustomHeader(value: unknown): string | null {
  const raw = asString(value, 200);
  if (!raw) return null;
  const match = /^2ndwave-outbox:([0-9a-f-]{36})$/i.exec(raw);
  return match?.[1] ? match[1].toLowerCase() : null;
}

function eventTime(body: Record<string, unknown>): string | null {
  const candidates = [body.ts_event, body.ts_epoch, body.ts];
  for (const candidate of candidates) {
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) continue;
    const milliseconds = candidate > 1e12 ? candidate : candidate * 1000;
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) continue;
    const year = date.getUTCFullYear();
    if (year < 2000 || year > 2100) continue;
    return date.toISOString();
  }
  return null;
}

function dedupeKey(input: {
  providerMessageId: string | null;
  customHeader: string | null;
  outboxId: string;
  event: string;
  providerEventAt: string | null;
}): string {
  // Prefer the provider id, but fall back to the correlation header or the
  // resolved outbox id so a retry that omits one of them still deduplicates.
  const identity =
    input.providerMessageId ?? input.customHeader ?? input.outboxId;

  return createHash("sha256")
    .update(
      [identity, input.event, input.providerEventAt ?? ""].join("|"),
    )
    .digest("hex");
}

export async function handleBrevoWebhook(
  input: BrevoWebhookInput,
  deps: BrevoWebhookDeps,
): Promise<BrevoWebhookResponse> {
  if (input.method.toUpperCase() !== "POST") {
    return response(405, { ok: false, code: "method_not_allowed" });
  }

  if (!deps.secret) {
    return response(503, { ok: false, code: "not_configured" });
  }

  if (!bearerMatches(input.authorization, deps.secret)) {
    return response(401, { ok: false, code: "unauthorized" });
  }

  const mediaType = (input.contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    return response(415, { ok: false, code: "unsupported_media_type" });
  }

  const maxBytes = deps.maxBytes ?? MAX_WEBHOOK_BYTES;
  if (Buffer.byteLength(input.bodyText, "utf8") > maxBytes) {
    return response(413, { ok: false, code: "payload_too_large" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.bodyText);
  } catch {
    return response(400, { ok: false, code: "malformed_json" });
  }

  const body = asRecord(parsed);
  if (!body) return response(400, { ok: false, code: "invalid_payload" });

  const providerMessageId = asString(body["message-id"], 200);
  const customHeader = asString(body["X-Mailin-custom"], 200);
  const customOutboxId = outboxIdFromCustomHeader(customHeader);

  if (!providerMessageId && !customOutboxId) {
    return response(400, { ok: false, code: "invalid_payload" });
  }

  const event = normaliseEvent(body.event);
  if (!event) {
    // Brevo sends many events we do not use (opened, clicked, ...). Acknowledge
    // so they are not retried, but persist nothing.
    return response(200, { ok: true, ignored: true });
  }

  let outboxId: string | null = null;
  try {
    outboxId = await deps.repository.findOutboxId({
      providerMessageId,
      customHeader,
    });
  } catch {
    return response(503, { ok: false, code: "unavailable" });
  }

  if (!outboxId) {
    // Do not reveal whether a message identifier exists.
    return response(200, { ok: true, ignored: true });
  }

  const occurredAt = eventTime(body);
  const record: BrevoDeliveryRecord = {
    outboxId,
    event,
    dedupeKey: dedupeKey({
      providerMessageId,
      customHeader,
      outboxId,
      event,
      providerEventAt: occurredAt,
    }),
    // A successful delivery needs no reason. Only deferrals, bounces and
    // complaints can carry an operationally useful sanitised explanation.
    reason: event === "delivered" ? null : sanitiseReason(body.reason),
    providerEventAt: occurredAt,
  };

  try {
    const outcome = await deps.repository.record(record);
    return response(200, {
      ok: true,
      duplicate: outcome === "duplicate",
    });
  } catch {
    return response(503, { ok: false, code: "unavailable" });
  }
}

export const WEBHOOK_NO_STORE = NO_STORE;
