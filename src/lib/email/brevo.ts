/**
 * Brevo transactional email client.
 *
 * Endpoint and saved-template payload follow the current official documentation:
 *   POST https://api.brevo.com/v3/smtp/email
 *   `api-key` header, JSON body with `templateId` and `params`, 201 + `messageId`.
 *
 * Idempotency: Brevo accepts a UUID `headers.idempotencyKey` in the JSON body
 * with a documented 30-minute TTL. A duplicate key within that window returns a
 * 400 `duplicate_parameter` / `duplicate_request`, which this client treats as
 * "already accepted" because the prior request was accepted.
 *
 * The idempotency key is passed in the request body's `headers` map as
 * `idempotencyKey`, as documented by Brevo.
 *
 * The client never logs or returns the API key, the raw provider body, the
 * recipient address or a provider message body. Error reasons are reduced to a
 * status/code label that is safe to store in the outbox.
 */

export const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
export const DEFAULT_BREVO_TIMEOUT_MS = 10_000;
const MAX_PROVIDER_ID_LENGTH = 200;
const MAX_RESPONSE_BYTES = 8192;

export type BrevoSendInput = {
  to: string;
  templateId: number;
  params: Record<string, string>;
  /** UUID used by Brevo's 30-minute idempotency window. */
  idempotencyKey: string;
  /** e.g. booking_created; used only as a Brevo tag. */
  template: string;
};

export type BrevoSendResult =
  | {
      ok: true;
      providerMessageId: string | null;
      /** True when Brevo reported the request was already accepted. */
      duplicate: boolean;
    }
  | {
      ok: false;
      classification: "retryable" | "permanent";
      /** Safe label only; never a raw provider message. */
      reason: string;
      retryAfterSeconds?: number;
    };

export type BrevoClient = {
  send(input: BrevoSendInput): Promise<BrevoSendResult>;
};

export type BrevoClientConfig = {
  apiKey: string;
};

export type BrevoClientDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const safeCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  if (!cleaned) return null;
  return cleaned.slice(0, 40);
};

const providerMessageId = (body: unknown): string | null => {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;

  const single = record.messageId;
  if (typeof single === "string" && single.trim()) {
    return single.trim().slice(0, MAX_PROVIDER_ID_LENGTH);
  }

  const many = record.messageIds;
  if (Array.isArray(many) && typeof many[0] === "string" && many[0].trim()) {
    return many[0].trim().slice(0, MAX_PROVIDER_ID_LENGTH);
  }

  return null;
};

const retryAfter = (headers: Headers): number | undefined => {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 1) return undefined;
  return Math.min(900, Math.ceil(seconds));
};

function networkFailure(error: unknown): BrevoSendResult {
  const name =
    typeof error === "object" && error !== null
      ? (error as { name?: unknown }).name
      : undefined;
  const timeout =
    name === "TimeoutError" ||
    name === "AbortError" ||
    (error instanceof Error && /abort|timeout/i.test(error.message));

  return {
    ok: false,
    classification: "retryable",
    reason: timeout ? "brevo_timeout" : "brevo_network_error",
  };
}

/**
 * A caller supplies the API key from server-only configuration; nothing in
 * this module reads `process.env`. Template sends use the sender configured on
 * the selected Brevo template.
 */
export function createBrevoClient(
  config: BrevoClientConfig,
  deps: BrevoClientDeps = {},
): BrevoClient {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, deps.timeoutMs ?? DEFAULT_BREVO_TIMEOUT_MS);

  return {
    async send(input: BrevoSendInput): Promise<BrevoSendResult> {
      if (!UUID_PATTERN.test(input.idempotencyKey)) {
        return {
          ok: false,
          classification: "permanent",
          reason: "brevo_invalid_idempotency_key",
        };
      }
      if (!Number.isSafeInteger(input.templateId) || input.templateId < 1) {
        return {
          ok: false,
          classification: "permanent",
          reason: "brevo_invalid_template_id",
        };
      }

      let response: Response;
      try {
        response = await fetchImpl(BREVO_ENDPOINT, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "api-key": config.apiKey,
          },
          body: JSON.stringify({
            to: [{ email: input.to }],
            templateId: input.templateId,
            params: input.params,
            headers: {
              // Brevo documents this request header for transactional email
              // idempotency, including sends with a saved template.
              idempotencyKey: input.idempotencyKey,
              // Lets a webhook correlate even if it arrives before mark_sent.
              "X-Mailin-custom": `2ndwave-outbox:${input.idempotencyKey}`,
            },
            tags: ["booking_transactional", input.template],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return networkFailure(error);
      }

      const raw = await response.text().catch(() => "");
      const text = raw.slice(0, MAX_RESPONSE_BYTES);
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }

      if (response.ok) {
        return {
          ok: true,
          providerMessageId: providerMessageId(body),
          duplicate: false,
        };
      }

      const code =
        typeof body === "object" && body !== null
          ? safeCode((body as Record<string, unknown>).code)
          : null;

      // Brevo returns these when the same UUID was accepted within 30 minutes.
      if (code === "duplicate_parameter" || code === "duplicate_request") {
        return { ok: true, providerMessageId: null, duplicate: true };
      }

      const reason = code
        ? `brevo_http_${response.status}_${code}`
        : `brevo_http_${response.status}`;

      if (response.status === 429) {
        return {
          ok: false,
          classification: "retryable",
          reason,
          retryAfterSeconds: retryAfter(response.headers),
        };
      }

      if (
        response.status === 408 ||
        response.status === 425 ||
        response.status >= 500
      ) {
        return { ok: false, classification: "retryable", reason };
      }

      return { ok: false, classification: "permanent", reason };
    },
  };
}
