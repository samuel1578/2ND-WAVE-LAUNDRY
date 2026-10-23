/**
 * Server-only transactional email configuration.
 *
 * Transactional sending is OFF unless an operator explicitly sets
 * `TRANSACTIONAL_EMAILS_ENABLED=true`. Even then, every required value must be
 * present and well formed: a missing API key, unverified sender address, absent
 * site URL, missing saved-template ID or weak worker secret fails closed.
 *
 * This module never reads a `NEXT_PUBLIC_*` secret and never logs a value.
 * Import it only from server code.
 */

import {
  emailTemplates,
  staffOrderTemplates,
  type EmailTemplate,
  type NotificationTemplate,
  type StaffOrderTemplate,
} from "./templates";

export const TRANSACTIONAL_EMAILS_ENABLED_VAR = "TRANSACTIONAL_EMAILS_ENABLED";
export const BREVO_API_KEY_VAR = "BREVO_API_KEY";
export const BREVO_SENDER_EMAIL_VAR = "BREVO_SENDER_EMAIL";
export const BREVO_SENDER_NAME_VAR = "BREVO_SENDER_NAME";
export const EMAIL_WORKER_SECRET_VAR = "EMAIL_WORKER_SECRET";
export const BREVO_WEBHOOK_SECRET_VAR = "BREVO_WEBHOOK_SECRET";
export const SITE_URL_VAR = "SITE_URL";

export const BREVO_TEMPLATE_ID_VARS: Record<EmailTemplate, string> = {
  booking_created: "BREVO_TEMPLATE_BOOKING_RECEIVED_ID",
  booking_confirmed: "BREVO_TEMPLATE_BOOKING_CONFIRMED_ID",
  booking_processing_started: "BREVO_TEMPLATE_PROCESSING_STARTED_ID",
  booking_ready: "BREVO_TEMPLATE_LAUNDRY_READY_ID",
  booking_completed: "BREVO_TEMPLATE_BOOKING_COMPLETED_ID",
  booking_cancelled: "BREVO_TEMPLATE_BOOKING_CANCELLED_ID",
};

/**
 * Staff alert template IDs are read separately from the six customer IDs. A
 * deployment that has not saved the staff templates in Brevo must not stop the
 * customer notifications that Phase 2D already delivers.
 */
export const BREVO_STAFF_TEMPLATE_ID_VARS: Record<StaffOrderTemplate, string> = {
  staff_order_pending: "BREVO_TEMPLATE_STAFF_ORDER_PENDING_ID",
  staff_order_processing: "BREVO_TEMPLATE_STAFF_ORDER_PROCESSING_ID",
  staff_order_ready: "BREVO_TEMPLATE_STAFF_ORDER_READY_ID",
  staff_order_completed: "BREVO_TEMPLATE_STAFF_ORDER_COMPLETED_ID",
  staff_order_cancelled: "BREVO_TEMPLATE_STAFF_ORDER_CANCELLED_ID",
};

export const MIN_WORKER_SECRET_LENGTH = 32;
export const MIN_WEBHOOK_SECRET_LENGTH = 32;
export const MAX_SENDER_NAME_LENGTH = 70;

export type EmailConfigReason =
  | "disabled"
  | "missing-api-key"
  | "invalid-api-key"
  | "missing-sender-email"
  | "invalid-sender-email"
  | "invalid-sender-name"
  | "missing-site-url"
  | "invalid-site-url"
  | "missing-worker-secret"
  | "invalid-worker-secret"
  | "missing-template-id"
  | "invalid-template-id";

export type TransactionalEmailConfig = {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  /** Public site origin without a trailing slash. */
  siteUrl: string;
  workerSecret: string;
  templateIds: Record<EmailTemplate, number>;
};

export type TransactionalEmailConfigResult =
  | { ok: true; enabled: true; config: TransactionalEmailConfig }
  | {
      ok: false;
      enabled: false;
      reason: EmailConfigReason;
      templateVariable?: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A conservative address shape; Brevo remains the final authority. */
export function isValidSenderEmail(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 254 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
  );
}

/**
 * Validates the public site origin used in email links. Production must use
 * https; loopback is allowed only so a controlled local test can render links.
 */
export function readSiteUrl(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;

  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";

  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
    return null;

  return url.origin;
}

function isStrongSecret(value: string, minimum: number): boolean {
  return value.length >= minimum && value.length <= 512 && !/\s/.test(value);
}

/**
 * Reads and validates everything a live send requires. The result is stable for
 * a deployment: a partial configuration never silently degrades to a weaker path.
 */
export function readTransactionalEmailConfig(
  env: Record<string, string | undefined> = process.env,
): TransactionalEmailConfigResult {
  const enabled =
    (env[TRANSACTIONAL_EMAILS_ENABLED_VAR] ?? "").trim().toLowerCase() === "true";

  if (!enabled) return { ok: false, enabled: false, reason: "disabled" };

  const apiKey = (env[BREVO_API_KEY_VAR] ?? "").trim();
  if (!apiKey) return { ok: false, enabled: false, reason: "missing-api-key" };
  if (apiKey.length < 20 || apiKey.length > 512 || /\s/.test(apiKey))
    return { ok: false, enabled: false, reason: "invalid-api-key" };

  const senderEmail = (env[BREVO_SENDER_EMAIL_VAR] ?? "").trim().toLowerCase();
  if (!senderEmail)
    return { ok: false, enabled: false, reason: "missing-sender-email" };
  if (!isValidSenderEmail(senderEmail))
    return { ok: false, enabled: false, reason: "invalid-sender-email" };

  const senderName = (env[BREVO_SENDER_NAME_VAR] ?? "").trim();
  if (
    senderName.length < 1 ||
    senderName.length > MAX_SENDER_NAME_LENGTH ||
    /[\r\n]/.test(senderName)
  )
    return { ok: false, enabled: false, reason: "invalid-sender-name" };

  const siteUrl = readSiteUrl(env[SITE_URL_VAR]);
  if (!siteUrl)
    return {
      ok: false,
      enabled: false,
      reason: (env[SITE_URL_VAR] ?? "").trim()
        ? "invalid-site-url"
        : "missing-site-url",
    };

  const workerSecret = (env[EMAIL_WORKER_SECRET_VAR] ?? "").trim();
  if (!workerSecret)
    return { ok: false, enabled: false, reason: "missing-worker-secret" };
  if (!isStrongSecret(workerSecret, MIN_WORKER_SECRET_LENGTH))
    return { ok: false, enabled: false, reason: "invalid-worker-secret" };

  const templateIds = {} as Record<EmailTemplate, number>;
  const configuredIds = new Set<number>();
  for (const template of emailTemplates) {
    const variable = BREVO_TEMPLATE_ID_VARS[template];
    const raw = (env[variable] ?? "").trim();
    if (!raw)
      return {
        ok: false,
        enabled: false,
        reason: "missing-template-id",
        templateVariable: variable,
      };
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      return {
        ok: false,
        enabled: false,
        reason: "invalid-template-id",
        templateVariable: variable,
      };
    templateIds[template] = Number(raw);
    if (configuredIds.has(templateIds[template]))
      return {
        ok: false,
        enabled: false,
        reason: "invalid-template-id",
        templateVariable: variable,
      };
    configuredIds.add(templateIds[template]);
  }

  return {
    ok: true,
    enabled: true,
    config: {
      apiKey,
      senderEmail,
      senderName,
      siteUrl,
      workerSecret,
      templateIds,
    },
  };
}

export type StaffTemplateIdsResult =
  | { ok: true; templateIds: Record<StaffOrderTemplate, number> }
  | {
      ok: false;
      reason: "missing-template-id" | "invalid-template-id";
      templateVariable: string;
    };

/**
 * Reads the five optional staff alert template IDs. Missing values do not
 * disable customer sending: the worker retries a staff row whose template is not
 * configured yet, leaving customer delivery untouched.
 */
export function readStaffEmailTemplateIds(
  env: Record<string, string | undefined> = process.env,
): StaffTemplateIdsResult {
  const templateIds = {} as Record<StaffOrderTemplate, number>;
  const configuredIds = new Set<number>();

  for (const template of staffOrderTemplates) {
    const variable = BREVO_STAFF_TEMPLATE_ID_VARS[template];
    const raw = (env[variable] ?? "").trim();
    if (!raw)
      return { ok: false, reason: "missing-template-id", templateVariable: variable };
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      return {
        ok: false,
        reason: "invalid-template-id",
        templateVariable: variable,
      };
    templateIds[template] = Number(raw);
    if (configuredIds.has(templateIds[template]))
      return {
        ok: false,
        reason: "invalid-template-id",
        templateVariable: variable,
      };
    configuredIds.add(templateIds[template]);
  }

  return { ok: true, templateIds };
}

/** Safe operator-facing explanation. Never includes a secret value. */
export function emailConfigMessage(
  reason: EmailConfigReason,
  templateVariable?: string,
): string {
  switch (reason) {
    case "disabled":
      return "Transactional email is disabled. Set TRANSACTIONAL_EMAILS_ENABLED=true only after the Brevo sender is verified.";
    case "missing-api-key":
    case "invalid-api-key":
      return `Transactional email is not configured: set the server-only ${BREVO_API_KEY_VAR} to a Brevo API key.`;
    case "missing-sender-email":
    case "invalid-sender-email":
      return `Transactional email is not configured: set ${BREVO_SENDER_EMAIL_VAR} to a verified Brevo sender address.`;
    case "invalid-sender-name":
      return `Transactional email is not configured: set ${BREVO_SENDER_NAME_VAR} to a display name of at most ${MAX_SENDER_NAME_LENGTH} characters.`;
    case "missing-site-url":
    case "invalid-site-url":
      return `Transactional email is not configured: set ${SITE_URL_VAR} to the verified public https origin.`;
    case "missing-worker-secret":
    case "invalid-worker-secret":
      return `Transactional email is not configured: set ${EMAIL_WORKER_SECRET_VAR} to a random secret of at least ${MIN_WORKER_SECRET_LENGTH} characters.`;
    case "missing-template-id":
    case "invalid-template-id":
      return templateVariable
        ? `Transactional email is not configured: set the server-only ${templateVariable} to the numeric saved-template ID from Brevo.`
        : "Transactional email is not configured: set all six server-only BREVO_TEMPLATE_*_ID variables to numeric saved-template IDs from Brevo.";
  }
}

/**
 * The template ids every delivery path must use.
 *
 * The post-commit dispatch and the protected worker endpoint (the scheduler's
 * path) both need the same set: the six required customer ids plus the staff ids
 * once they are configured. Reading them in one place stops the two paths from
 * drifting, which would otherwise leave staff alerts permanently retrying on the
 * scheduled drain while the post-commit kick could send them.
 *
 * Staff ids are all-or-nothing: one missing or malformed id means no staff ids
 * are returned, so a partially configured account cannot produce an inconsistent
 * subset of alerts. Customer ids are always included when they are valid.
 */
export function readDeliveryTemplateIds(
  env: Record<string, string | undefined> = process.env,
): {
  templateIds: Partial<Record<NotificationTemplate, number>>;
  staffConfigured: boolean;
  /** The first unconfigured staff variable, for operator-facing messaging. */
  staffTemplateVariable: string | null;
} {
  const customer = readTransactionalEmailConfig(env);
  const staff = readStaffEmailTemplateIds(env);

  return {
    templateIds: {
      ...(customer.ok ? customer.config.templateIds : {}),
      ...(staff.ok ? staff.templateIds : {}),
    },
    staffConfigured: staff.ok,
    staffTemplateVariable: staff.ok ? null : staff.templateVariable,
  };
}

/** Safe operator-facing explanation for a staff alert template id. */
export function staffTemplateIdMessage(
  reason: "missing-template-id" | "invalid-template-id",
  templateVariable: string,
): string {
  return reason === "missing-template-id"
    ? `Staff order alerts are not configured: set the server-only ${templateVariable} to the numeric saved-template ID from Brevo.`
    : `Staff order alerts are not configured: ${templateVariable} must be a unique, positive integer saved-template ID.`;
}

export type WebhookConfig =
  | { ok: true; secret: string }
  | { ok: false; reason: "missing" | "invalid" };

/** The webhook secret is independent of sending: verification still fails closed. */
export function readBrevoWebhookConfig(
  env: Record<string, string | undefined> = process.env,
): WebhookConfig {
  const secret = (env[BREVO_WEBHOOK_SECRET_VAR] ?? "").trim();
  if (!secret) return { ok: false, reason: "missing" };
  if (!isStrongSecret(secret, MIN_WEBHOOK_SECRET_LENGTH))
    return { ok: false, reason: "invalid" };
  return { ok: true, secret };
}

/**
 * Reads the worker bearer secret even when sending is disabled, so an
 * unauthenticated caller cannot use configuration state as an oracle.
 */
export function readWorkerSecret(
  env: Record<string, string | undefined> = process.env,
):
  | { ok: true; secret: string }
  | { ok: false; reason: "missing" | "invalid" } {
  const secret = (env[EMAIL_WORKER_SECRET_VAR] ?? "").trim();
  if (!secret) return { ok: false, reason: "missing" };
  if (!isStrongSecret(secret, MIN_WORKER_SECRET_LENGTH))
    return { ok: false, reason: "invalid" };
  return { ok: true, secret };
}

/** Exported for tests that need a shape check without reading process.env. */
export const isEnvRecord = isRecord;
