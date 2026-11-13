import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { BOOKING_PHOTOS_BUCKET } from "@/lib/bookings/photos";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  RetentionStepError,
  runBookingPhotoRetentionWith,
  type DuePhoto,
  type PhotoStorage,
  type RetentionOptions,
  type RetentionRepository,
  type RetentionSummary,
} from "./booking-photos-core";

/**
 * Supabase adapters for booking photo retention (service_role only).
 *
 * The RPCs are defined in
 * supabase/migrations/20261113170000_booking_photo_retention.sql. Errors are
 * mapped to stable codes; provider messages are never logged or returned
 * because they could contain object keys.
 */

type DuePhotoRow = { id: string; storage_key: string };
type OrphanRow = { name: string };

function createRepository(client: SupabaseClient): RetentionRepository {
  return {
    async startJob(name) {
      const { data, error } = await client.rpc("retention_job_start", { p_job_name: name });
      if (error || typeof data !== "number") throw new RetentionStepError("job_start_failed");
      return data;
    },
    async countDuePhotos() {
      const { data, error } = await client.rpc("retention_due_summary");
      const value = (data as { photos_due?: unknown } | null)?.photos_due;
      if (error || typeof value !== "number") throw new RetentionStepError("due_count_failed");
      return value;
    },
    async listDuePhotos(limit) {
      const { data, error } = await client.rpc("retention_due_photos", { p_limit: limit });
      if (error || !Array.isArray(data)) throw new RetentionStepError("due_list_failed");
      return (data as DuePhotoRow[]).map(
        (row): DuePhoto => ({ id: row.id, storageKey: row.storage_key }),
      );
    },
    async deletePhotoRows(jobId, ids) {
      const { data, error } = await client.rpc("retention_photos_delete", {
        p_job_id: jobId,
        p_ids: ids,
      });
      if (error || typeof data !== "number") throw new RetentionStepError("row_delete_failed");
      return data;
    },
    async listOrphanObjects(limit) {
      const { data, error } = await client.rpc("retention_orphan_photo_objects", {
        p_limit: limit,
      });
      if (error || !Array.isArray(data)) throw new RetentionStepError("orphan_list_failed");
      return (data as OrphanRow[]).map((row) => row.name);
    },
    async recordOrphansDeleted(jobId, count) {
      const { error } = await client.rpc("retention_orphans_deleted", {
        p_job_id: jobId,
        p_count: count,
      });
      if (error) throw new RetentionStepError("orphan_audit_failed");
    },
    async finishJob(input) {
      const { error } = await client.rpc("retention_job_finish", {
        p_job_id: input.jobId,
        p_outcome: input.outcome,
        p_scanned: input.scanned,
        p_deleted: input.deleted,
        p_retry: input.retry,
        p_error: input.error,
      });
      if (error) throw new RetentionStepError("job_finish_failed");
    },
  };
}

function createStorage(client: SupabaseClient): PhotoStorage {
  return {
    async remove(keys) {
      if (keys.length === 0) return { ok: true, removed: 0 };
      try {
        const { data, error } = await client.storage.from(BOOKING_PHOTOS_BUCKET).remove(keys);
        if (error) return { ok: false };
        // Objects that were already absent are simply not listed: still success.
        return { ok: true, removed: Array.isArray(data) ? data.length : 0 };
      } catch {
        return { ok: false };
      }
    },
  };
}

/** Runs the 90-day booking photo retention job with the elevated client. */
export async function runBookingPhotoRetention(
  options: RetentionOptions = {},
): Promise<RetentionSummary> {
  const client = createSupabaseAdminClient();
  return runBookingPhotoRetentionWith(
    {
      repository: createRepository(client),
      storage: createStorage(client),
      log: (message) => console.info(message),
    },
    options,
  );
}
