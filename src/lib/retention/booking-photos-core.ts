/**
 * Booking photo retention: framework-free core.
 *
 * Booking photos are retained for 90 days (`booking_photos.delete_due_at`, set by
 * a database trigger). This module deletes what is due in a safe order:
 *
 *   1. remove the Storage objects through the Storage API (an SQL delete on
 *      `storage.objects` would not remove the underlying file);
 *   2. only then delete the `booking_photos` rows whose objects are gone. The
 *      database re-checks the deadline, so nothing is deleted early;
 *   3. sweep orphaned objects (older than 24 hours, no row references them).
 *
 * A Storage failure never deletes rows: that batch is counted as retryable and
 * is picked up by the next run. Every run is recorded in `retention_jobs`.
 *
 * The Supabase-backed adapters live in `./booking-photos.ts` (server-only). This
 * file has no Supabase or `server-only` import so it can be unit tested with
 * in-memory doubles. Nothing here logs or returns a storage key or personal data:
 * only counts and the job id.
 */

import { readVercelCronSecret, readWorkerSecret } from "../email/config";
import { bearerMatches } from "../email/webhook";

export const BOOKING_PHOTO_RETENTION_JOB = "booking_photos_90_day";
export const DUE_PHOTO_BATCH_SIZE = 50;
export const ORPHAN_BATCH_SIZE = 100;
/** Dry runs report orphans up to the database function's own cap. */
export const DRY_RUN_ORPHAN_LIMIT = 500;
export const DEFAULT_TIME_BUDGET_MS = 45_000;

export type DuePhoto = { id: string; storageKey: string };

export type RetentionOutcome = "succeeded" | "partial" | "failed";

export type FinishJobInput = {
  jobId: number;
  outcome: RetentionOutcome;
  scanned: number;
  deleted: number;
  retry: number;
  error: string | null;
};

/** Database operations (service_role RPCs in production). */
export interface RetentionRepository {
  startJob(name: string): Promise<number>;
  /** Total photos past their deadline (for dry runs; not limited to a batch). */
  countDuePhotos(): Promise<number>;
  listDuePhotos(limit: number): Promise<DuePhoto[]>;
  /** Deletes rows that are still due; returns the number deleted. */
  deletePhotoRows(jobId: number, ids: string[]): Promise<number>;
  listOrphanObjects(limit: number): Promise<string[]>;
  recordOrphansDeleted(jobId: number, count: number): Promise<void>;
  finishJob(input: FinishJobInput): Promise<void>;
}

/**
 * Storage removal. `ok: true` means the request succeeded; objects that were
 * already absent count as removed. `removed` is the number of objects the
 * provider reported as deleted.
 */
export interface PhotoStorage {
  remove(keys: string[]): Promise<{ ok: true; removed: number } | { ok: false }>;
}

export type RetentionDependencies = {
  repository: RetentionRepository;
  storage: PhotoStorage;
  now?: () => number;
  log?: (message: string) => void;
};

export type RetentionOptions = {
  dryRun?: boolean;
  timeBudgetMs?: number;
};

export type RetentionSummary = {
  jobId: number | null;
  dryRun: boolean;
  due: number;
  deleted: number;
  orphansFound: number;
  orphansDeleted: number;
  retryable: number;
  outcome: RetentionOutcome | "dry_run";
};

export async function runBookingPhotoRetentionWith(
  deps: RetentionDependencies,
  options: RetentionOptions = {},
): Promise<RetentionSummary> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const dryRun = options.dryRun === true;
  const budget =
    Number.isFinite(options.timeBudgetMs) && (options.timeBudgetMs ?? 0) > 0
      ? (options.timeBudgetMs as number)
      : DEFAULT_TIME_BUDGET_MS;
  const deadline = now() + budget;
  const expired = () => now() >= deadline;

  if (dryRun) {
    const due = await deps.repository.countDuePhotos();
    const orphans = await deps.repository.listOrphanObjects(DRY_RUN_ORPHAN_LIMIT);
    log(`[retention] booking photos dry run due=${due} orphans=${orphans.length}`);
    return {
      jobId: null,
      dryRun: true,
      due,
      deleted: 0,
      orphansFound: orphans.length,
      orphansDeleted: 0,
      retryable: 0,
      outcome: "dry_run",
    };
  }

  const jobId = await deps.repository.startJob(BOOKING_PHOTO_RETENTION_JOB);
  let due = 0;
  let deleted = 0;
  let orphansFound = 0;
  let orphansDeleted = 0;
  let retryable = 0;
  let storageFailures = 0;
  let budgetExhausted = false;
  let outcome: RetentionOutcome = "failed";
  let error: string | null = null;

  try {
    // ---- 1. Photos past their deadline -------------------------------------
    const attemptedPhotos = new Set<string>();
    while (true) {
      if (expired()) {
        budgetExhausted = true;
        break;
      }
      const batch = (await deps.repository.listDuePhotos(DUE_PHOTO_BATCH_SIZE)).filter(
        (photo) => !attemptedPhotos.has(photo.id),
      );
      // Rows from a failed batch are returned again; once only those remain,
      // stop and leave them for the next run instead of looping.
      if (batch.length === 0) break;
      for (const photo of batch) attemptedPhotos.add(photo.id);
      due += batch.length;

      const removal = await deps.storage.remove(batch.map((photo) => photo.storageKey));
      if (!removal.ok) {
        storageFailures += 1;
        retryable += batch.length;
        continue;
      }
      deleted += await deps.repository.deletePhotoRows(
        jobId,
        batch.map((photo) => photo.id),
      );
    }

    // ---- 2. Orphaned objects ----------------------------------------------
    const attemptedObjects = new Set<string>();
    while (!budgetExhausted) {
      if (expired()) {
        budgetExhausted = true;
        break;
      }
      const names = (await deps.repository.listOrphanObjects(ORPHAN_BATCH_SIZE)).filter(
        (name) => !attemptedObjects.has(name),
      );
      if (names.length === 0) break;
      for (const name of names) attemptedObjects.add(name);
      orphansFound += names.length;

      const removal = await deps.storage.remove(names);
      if (!removal.ok) {
        storageFailures += 1;
        retryable += names.length;
        continue;
      }
      orphansDeleted += Math.min(removal.removed, names.length);
    }

    if (orphansDeleted > 0) await deps.repository.recordOrphansDeleted(jobId, orphansDeleted);

    if (storageFailures > 0) {
      outcome = "partial";
      error = `storage_remove_failed batches=${storageFailures}`;
    } else if (budgetExhausted) {
      outcome = "partial";
      error = "time_budget_exhausted";
    } else {
      outcome = "succeeded";
    }
  } catch (cause) {
    outcome = "failed";
    // A stable code only: provider messages could echo keys or identifiers.
    error = cause instanceof RetentionStepError ? cause.code : "unexpected_error";
  } finally {
    try {
      await deps.repository.finishJob({
        jobId,
        outcome,
        scanned: due + orphansFound,
        deleted: deleted + orphansDeleted,
        retry: retryable,
        error,
      });
    } catch {
      log(`[retention] booking photos job=${jobId} could not be finished`);
    }
  }

  log(
    `[retention] booking photos job=${jobId} outcome=${outcome} due=${due} deleted=${deleted} orphans=${orphansFound} orphans_deleted=${orphansDeleted} retryable=${retryable}`,
  );

  return {
    jobId,
    dryRun: false,
    due,
    deleted,
    orphansFound,
    orphansDeleted,
    retryable,
    outcome,
  };
}

/** A failure with a stable, non-identifying code (safe to store and return). */
export class RetentionStepError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RetentionStepError";
  }
}

export type InternalJobAuthorization = "ok" | "not_configured" | "unauthorized";

/**
 * Same bearer rule as the email worker: the Vercel Cron secret or the worker
 * secret (each at least 32 characters), compared in constant time.
 */
export function authorizeInternalJobRequest(
  authorization: string | null,
  env: Record<string, string | undefined> = process.env,
): InternalJobAuthorization {
  const cronSecret = readVercelCronSecret(env);
  const workerSecret = readWorkerSecret(env);
  if (!cronSecret.ok && !workerSecret.ok) return "not_configured";
  const authorised =
    (cronSecret.ok && bearerMatches(authorization, cronSecret.secret)) ||
    (workerSecret.ok && bearerMatches(authorization, workerSecret.secret));
  return authorised ? "ok" : "unauthorized";
}

/** `?dry_run=1` (or `true`/`yes`) requests a count-only run. */
export function isDryRunRequest(value: string | null): boolean {
  if (value === null) return false;
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}
