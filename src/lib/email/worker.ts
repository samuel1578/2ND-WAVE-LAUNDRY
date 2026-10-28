/**
 * Transactional outbox worker.
 *
 * Pure orchestration over injected repository/provider dependencies so the
 * delivery policy can be tested without a database or a real provider.
 *
 * Guarantees:
 *   * a bounded batch is claimed atomically by the database;
 *   * a row is only processed while its lease is owned by this worker;
 *   * retryable failures use bounded exponential backoff with jitter;
 *   * permanent failures move to the dead-letter state immediately;
 *   * the provider is never called when sending is disabled;
 *   * a delivery failure never touches a booking and never throws out of the
 *     post-commit dispatch path.
 *
 * Delivery is at-least-once, not mathematically exactly-once. A timeout after
 * Brevo accepted a request is inherently ambiguous. The outbox UUID is sent as
 * Brevo's 30-minute idempotency key, so retries within that window cannot create
 * a duplicate; a retry after the window may. See the sprint report.
 */

import type { BrevoClient, BrevoSendResult } from "./brevo";
import type {
  ClaimedOutboxEmail,
  EmailOutboxRepository,
} from "./outbox-repository";
import {
  buildBrevoTemplateParams,
  buildNewsletterInterestParams,
  buildStaffOrderTemplateParams,
  emailTemplates,
  isNewsletterInterestTemplate,
  isStaffOrderTemplate,
  validateEmailTemplateParams,
  type BookingEmailContext,
  type NotificationTemplate,
} from "./templates";

export const WORKER_BATCH_SIZE = 10;
export const WORKER_LEASE_SECONDS = 300;
export const WORKER_REAP_LIMIT = 50;
const MAX_BATCH_SIZE = 25;
const MAX_LEASE_SECONDS = 900;
const RETRY_BASE_SECONDS = 60;
const RETRY_CAP_SECONDS = 900;
const RETRY_JITTER_SECONDS = 30;

export type EmailWorkerDeps = {
  enabled: boolean;
  repository: EmailOutboxRepository;
  provider: BrevoClient;
  siteUrl: string;
  /**
   * Customer template IDs are always present. A staff template ID is absent until
   * the owner saves that template in Brevo; absence is retried, never fabricated.
   */
  templateIds: Partial<Record<NotificationTemplate, number>>;
  batchSize?: number;
  leaseSeconds?: number;
  reapLimit?: number;
  random?: () => number;
  log?: (event: EmailWorkerLogEvent) => void;
};

export type EmailWorkerLogEvent = {
  level: "warn" | "error";
  event: "email_delivery_retry" | "email_delivery_dead" | "email_delivery_skipped";
  outboxId: string;
  template: string;
  reason: string;
};

export type EmailWorkerSummary = {
  ok: true;
  enabled: boolean;
  reaped: number;
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  skipped: number;
  failed: number;
  durationMs: number;
};

export type EmailWorkerFailure = {
  ok: false;
  enabled: boolean;
  error: "repository_unavailable" | "worker_unavailable";
  durationMs: number;
};

export type EmailWorkerResult = EmailWorkerSummary | EmailWorkerFailure;

/**
 * Bounded exponential backoff with jitter. Attempt 1 is roughly one minute, and
 * the ceiling is fifteen minutes. With the default five-attempt budget every
 * retry falls inside Brevo's documented 30-minute idempotency window.
 */
export function retryDelaySeconds(
  attemptCount: number,
  random: () => number = Math.random,
): number {
  const attempt = Math.max(1, Math.min(20, Math.trunc(attemptCount)));
  const exponential = Math.min(
    RETRY_CAP_SECONDS,
    RETRY_BASE_SECONDS * 2 ** (attempt - 1),
  );
  const jitter = Math.floor(RETRY_JITTER_SECONDS * random());
  return Math.max(1, Math.min(RETRY_CAP_SECONDS, exponential + jitter));
}

const boundedBatch = (value: number | undefined): number => {
  if (!Number.isInteger(value) || value === undefined) return WORKER_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, value));
};

const boundedLease = (value: number | undefined): number => {
  if (!Number.isInteger(value) || value === undefined) return WORKER_LEASE_SECONDS;
  return Math.max(30, Math.min(MAX_LEASE_SECONDS, value));
};

const asResult = (
  providerResult: BrevoSendResult,
): BrevoSendResult => providerResult;

export async function runEmailWorker(
  deps: EmailWorkerDeps,
  options: { workerId: string },
): Promise<EmailWorkerResult> {
  const started = Date.now();

  if (!deps.enabled) {
    return {
      ok: true,
      enabled: false,
      reaped: 0,
      claimed: 0,
      sent: 0,
      retried: 0,
      dead: 0,
      skipped: 0,
      failed: 0,
      durationMs: Date.now() - started,
    };
  }

  if (!options.workerId || !deps.provider) {
    return {
      ok: false,
      enabled: true,
      error: "worker_unavailable",
      durationMs: Date.now() - started,
    };
  }

  let reaped = 0;
  let claimedRows;
  try {
    reaped = await deps.repository.reap(deps.reapLimit ?? WORKER_REAP_LIMIT);
    claimedRows = await deps.repository.claim({
      workerId: options.workerId,
      limit: boundedBatch(deps.batchSize),
      leaseSeconds: boundedLease(deps.leaseSeconds),
    });
  } catch {
    return {
      ok: false,
      enabled: true,
      error: "repository_unavailable",
      durationMs: Date.now() - started,
    };
  }

  let sent = 0;
  let retried = 0;
  let dead = 0;
  let skipped = 0;
  let failed = 0;

  /**
   * Provider call plus completion bookkeeping for one already-rendered row.
   * Shared by every template family so retry, dead-letter and lease handling
   * stay identical across customer, staff and newsletter alerts.
   */
  const deliverRow = async (
    row: ClaimedOutboxEmail,
    templateId: number,
    params: Record<string, string>,
  ): Promise<void> => {
    let providerResult: BrevoSendResult;
    try {
      providerResult = asResult(
        await deps.provider.send({
          to: row.recipientEmail,
          templateId,
          params,
          idempotencyKey: row.id,
          template: row.template,
        }),
      );
    } catch {
      // An unexpected provider exception is retryable, never a booking failure.
      providerResult = {
        ok: false,
        classification: "retryable",
        reason: "email_delivery_exception",
      };
    }

    if (providerResult.ok) {
      let marked: boolean;
      try {
        marked = await deps.repository.markSent({
          id: row.id,
          workerId: options.workerId,
          providerMessageId: providerResult.providerMessageId,
        });
      } catch {
        failed += 1;
        return;
      }

      if (marked) sent += 1;
      else {
        // The lease was lost (for example the row was reaped and reclaimed).
        // Never claim a send that this worker can no longer record.
        skipped += 1;
        deps.log?.({
          level: "warn",
          event: "email_delivery_skipped",
          outboxId: row.id,
          template: row.template,
          reason: "lease_not_owned",
        });
      }
      return;
    }

    if (providerResult.classification === "permanent") {
      try {
        const marked = await deps.repository.markDead({
          id: row.id,
          workerId: options.workerId,
          error: providerResult.reason,
        });
        if (marked) dead += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }

      deps.log?.({
        level: "warn",
        event: "email_delivery_dead",
        outboxId: row.id,
        template: row.template,
        reason: providerResult.reason,
      });
      return;
    }

    const backoff = retryDelaySeconds(row.attemptCount, deps.random);
    const delay = Math.min(
      RETRY_CAP_SECONDS,
      Math.max(backoff, providerResult.retryAfterSeconds ?? 0),
    );

    let status: "retryable_failed" | "dead" | null;
    try {
      status = await deps.repository.markRetry({
        id: row.id,
        workerId: options.workerId,
        error: providerResult.reason,
        delaySeconds: delay,
      });
    } catch {
      failed += 1;
      return;
    }

    if (status === "dead") dead += 1;
    else if (status === "retryable_failed") retried += 1;
    else skipped += 1;

    deps.log?.({
      level: "warn",
      event: status === "dead" ? "email_delivery_dead" : "email_delivery_retry",
      outboxId: row.id,
      template: row.template,
      reason: providerResult.reason,
    });
  };

  for (const row of claimedRows) {
    // The newsletter manager alert is not a booking message: it renders purely
    // from its committed payload and never reads a customer record. Its template
    // id is optional (retried until saved in Brevo), exactly like the staff ids.
    if (isNewsletterInterestTemplate(row.template)) {
      let params: Record<string, string>;
      try {
        if (!row.newsletter) throw new Error("Newsletter interest payload is missing.");
        params = buildNewsletterInterestParams(row.newsletter, {
          siteUrl: deps.siteUrl,
        });
        validateEmailTemplateParams(row.template, params);
      } catch {
        try {
          const marked = await deps.repository.markDead({
            id: row.id,
            workerId: options.workerId,
            error: "email_template_params_failed",
          });
          if (marked) dead += 1;
          else skipped += 1;
        } catch {
          failed += 1;
        }
        continue;
      }

      const templateId = deps.templateIds[row.template];
      if (
        typeof templateId !== "number" ||
        !Number.isSafeInteger(templateId) ||
        templateId < 1
      ) {
        try {
          const status = await deps.repository.markRetry({
            id: row.id,
            workerId: options.workerId,
            error: "email_template_not_configured",
            delaySeconds: RETRY_CAP_SECONDS,
          });
          if (status === "dead") dead += 1;
          else if (status === "retryable_failed") retried += 1;
          else skipped += 1;
        } catch {
          failed += 1;
        }
        continue;
      }

      await deliverRow(row, templateId, params);
      continue;
    }

    let context: BookingEmailContext | null | undefined;
    let staffContext = row.staff;
    if ((row.isTest ?? Boolean(row.testContext)) && row.testContext) {
      // Controlled test rows are intentionally bookingless and render only from
      // their fixed, server-created fixture. They never read a customer record.
      context = row.testContext.booking;
      staffContext = staffContext ?? row.testContext.staff;
    } else if (!row.bookingId || row.testContext) {
      try {
        const marked = await deps.repository.markDead({
          id: row.id,
          workerId: options.workerId,
          error: "email_booking_missing",
        });
        if (marked) dead += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
      continue;
    } else {
      try {
        context = await deps.repository.loadBookingContext(row.bookingId);
      } catch {
        // Leave the row leased. The reaper will recover it after the lease
        // expires; a transient database failure must not dead-letter a message.
        failed += 1;
        continue;
      }
    }

    if (!context) {
      try {
        const marked = await deps.repository.markDead({
          id: row.id,
          workerId: options.workerId,
          error: "email_booking_missing",
        });
        if (marked) dead += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
      continue;
    }

    // An unknown template can never be fixed by retrying.
    if (
      !(emailTemplates as readonly string[]).includes(row.template) &&
      !isStaffOrderTemplate(row.template)
    ) {
      try {
        const marked = await deps.repository.markDead({
          id: row.id,
          workerId: options.workerId,
          error: "email_template_params_failed",
        });
        if (marked) dead += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
      continue;
    }

    const templateId = deps.templateIds[row.template];
    if (
      typeof templateId !== "number" ||
      !Number.isSafeInteger(templateId) ||
      templateId < 1
    ) {
      // A staff template that has not been saved in Brevo yet is a deployment
      // gap, not a permanent failure: keep the row and retry after configuration.
      try {
        const status = await deps.repository.markRetry({
          id: row.id,
          workerId: options.workerId,
          error: "email_template_not_configured",
          delaySeconds: RETRY_CAP_SECONDS,
        });
        if (status === "dead") dead += 1;
        else if (status === "retryable_failed") retried += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
      continue;
    }

    let params: Record<string, string>;
    try {
      if (isStaffOrderTemplate(row.template)) {
        if (!staffContext) throw new Error("Staff alert metadata is missing.");
        params = buildStaffOrderTemplateParams(
          row.template,
          context,
          staffContext,
          { siteUrl: deps.siteUrl },
        );
      } else {
        params = buildBrevoTemplateParams(row.template, context, {
          siteUrl: deps.siteUrl,
        });
      }
      validateEmailTemplateParams(row.template, params);
    } catch {
      // Invalid persisted template parameters cannot be fixed by retrying.
      try {
        const marked = await deps.repository.markDead({
          id: row.id,
          workerId: options.workerId,
          error: "email_template_params_failed",
        });
        if (marked) dead += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
      continue;
    }

    await deliverRow(row, templateId, params);
  }

  return {
    ok: true,
    enabled: true,
    reaped,
    claimed: claimedRows.length,
    sent,
    retried,
    dead,
    skipped,
    failed,
    durationMs: Date.now() - started,
  };
}
