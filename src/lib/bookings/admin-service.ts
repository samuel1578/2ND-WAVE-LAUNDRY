/**
 * Server-only administrator booking reads (Sprint 2C).
 *
 * Every read runs with the caller's *own* Supabase session client, so row level
 * security decides what is visible. The booking policies allow any active
 * administrator (`private.is_active_admin()`) to read bookings, their service
 * snapshots, their status history, their private notes and the branch/service
 * reference data; the audit log stays readable to Full Admins only, so an
 * Operational Admin receives an empty audit list rather than an error.
 *
 * Queries are always bounded: the list is paginated with an exact count, and the
 * detail history/notes/audit reads are limited. An unbounded booking history is
 * never loaded.
 *
 * Failures are mapped to the `BookingErrorCode` taxonomy; raw database messages,
 * SQL and personal data are never returned to a caller. Never import this module
 * from a Client Component.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseConfigError } from "@/lib/supabase/config";
import type { BookingErrorCode } from "./errors";
import {
  BOOKING_DETAIL_HISTORY_LIMIT,
  bookingListRange,
  bookingSearchFilter,
  isUuid,
  mapBookingDetailRow,
  mapBookingSummaryRow,
  mapBranchOption,
  type AdminBookingDetail,
  type AdminBookingSummary,
  type BookingListPage,
  type BookingListQuery,
  type BranchOption,
} from "./admin";

export type AdminBookingResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: BookingErrorCode };

const fail = (code: BookingErrorCode): { ok: false; code: BookingErrorCode } => ({
  ok: false,
  code,
});

/** Columns for the list projection, including the branch and service embeds. */
const SUMMARY_COLUMNS = [
  "id",
  "reference",
  "customer_name",
  "customer_phone",
  "item_category",
  "load_size",
  "requested_date",
  "requested_time",
  "express_requested",
  "status",
  "assigned_branch_id",
  "agreed_pickup_at",
  "agreed_fee",
  "version",
  "created_at",
  "branches(id, slug, title, label, phone)",
  "booking_services(service_slug, service_title)",
].join(", ");

/** Columns for the detail projection. */
const DETAIL_COLUMNS = [
  SUMMARY_COLUMNS,
  "customer_email",
  "whatsapp_phone",
  "same_whatsapp",
  "contact_method",
  "customer_notes",
  "pickup_address",
  "pickup_landmark",
  "pickup_map_url",
  "transport_preference",
  "agreed_fee_currency",
  "zero_fee_reason",
  "service_charge",
  "contact_outcome",
  "confirmation_note",
  "return_details",
  "cancellation_reason",
  "confirmed_at",
  "scheduled_at",
  "picked_up_at",
  "processing_at",
  "ready_at",
  "out_for_delivery_at",
  "completed_at",
  "cancelled_at",
].join(", ");

const STATUSES_ACTIVE = [
  "confirmed",
  "scheduled",
  "picked_up",
  "processing",
  "ready",
  "out_for_delivery",
] as const;

async function sessionClient() {
  return createSupabaseServerClient();
}

/**
 * The selectable branches, ordered for display.
 *
 * An empty list is a valid, honest answer (no branches configured); a failed read
 * is reported so the interface can disable assignment rather than offer a stale
 * list.
 */
export async function listBranchOptions(): Promise<
  AdminBookingResult<BranchOption[]>
> {
  let supabase;
  try {
    supabase = await sessionClient();
  } catch (error) {
    return fail(error instanceof SupabaseConfigError ? "not_configured" : "conflict");
  }

  const { data, error } = await supabase
    .from("branches")
    .select("id, slug, title, label, phone")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) return fail("permission_denied");

  const branches: BranchOption[] = [];
  for (const row of (data ?? []) as unknown[]) {
    const option = mapBranchOption(row);
    if (option) branches.push(option);
  }
  return { ok: true, data: branches };
}

/**
 * One bounded page of persisted bookings, newest first.
 *
 * The filters (search term, status, branch, requested date) are applied in SQL;
 * `total` is the exact count for the same filter set so the interface can page
 * without loading everything.
 */
export async function listAdminBookings(
  query: BookingListQuery,
): Promise<AdminBookingResult<BookingListPage>> {
  let supabase;
  try {
    supabase = await sessionClient();
  } catch (error) {
    return fail(error instanceof SupabaseConfigError ? "not_configured" : "conflict");
  }

  let request = supabase
    .from("bookings")
    .select(SUMMARY_COLUMNS, { count: "exact" });

  const filter = bookingSearchFilter(query.search);
  if (filter) request = request.or(filter);
  if (query.status) request = request.eq("status", query.status);
  if (query.branch === "unassigned") request = request.is("assigned_branch_id", null);
  else if (query.branch) request = request.eq("assigned_branch_id", query.branch);
  if (query.date) request = request.eq("requested_date", query.date);

  const { from, to } = bookingListRange(query);
  const { data, error, count } = await request
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return fail("permission_denied");

  const rows: AdminBookingSummary[] = [];
  for (const row of (data ?? []) as unknown[]) {
    const mapped = mapBookingSummaryRow(row);
    // A row that cannot be mapped is skipped rather than rendered as a partial
    // record; it never silently becomes sample data.
    if (mapped) rows.push(mapped);
  }

  return {
    ok: true,
    data: {
      rows,
      total: typeof count === "number" ? count : rows.length,
      page: query.page,
      pageSize: query.pageSize,
    },
  };
}

/**
 * One persisted booking with its service snapshots, status history and notes.
 *
 * `audit` is populated from `public.audit_events`, which the established Sprint 1
 * policy exposes to Full Admins only; an Operational Admin therefore receives an
 * empty list, never another role's audit records.
 */
export async function getAdminBooking(
  id: string,
): Promise<AdminBookingResult<AdminBookingDetail>> {
  if (!isUuid(id)) return fail("not_found");

  let supabase;
  try {
    supabase = await sessionClient();
  } catch (error) {
    return fail(error instanceof SupabaseConfigError ? "not_configured" : "conflict");
  }

  const { data, error } = await supabase
    .from("bookings")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) return fail("permission_denied");
  if (!data) return fail("not_found");

  const [history, notes, audit, photos] = await Promise.all([
    supabase
      .from("booking_status_history")
      .select("from_status, to_status, actor_kind, actor_id, reason, created_at")
      .eq("booking_id", id)
      .order("created_at", { ascending: true })
      .limit(BOOKING_DETAIL_HISTORY_LIMIT),
    supabase
      .from("booking_notes")
      .select("id, body, author_id, created_at")
      .eq("booking_id", id)
      .order("created_at", { ascending: true })
      .limit(BOOKING_DETAIL_HISTORY_LIMIT),
    supabase
      .from("audit_events")
      .select("action, actor_id, reason, created_at")
      .eq("entity_type", "booking")
      .eq("entity_id", id)
      .order("created_at", { ascending: true })
      .limit(BOOKING_DETAIL_HISTORY_LIMIT),
    // Read under the caller's own session, so the booking_photos policy both
    // requires an active administrator and withholds any photo whose 90-day
    // retention has lapsed. The storage object key is never selected, so it
    // cannot reach the detail response.
    supabase
      .from("booking_photos")
      .select("id, mime_type, byte_size, width, height, uploaded_at")
      .eq("booking_id", id)
      .order("uploaded_at", { ascending: true })
      .limit(BOOKING_DETAIL_HISTORY_LIMIT),
  ]);

  const booking = mapBookingDetailRow(data, {
    history: history.data,
    notes: notes.data,
    // A read that is filtered out by a policy is treated as "no audit trail
    // visible", not as a failure of the whole detail view.
    audit: audit.error ? [] : audit.data,
    photos: photos.error ? [] : photos.data,
  });

  if (!booking) return fail("conflict");
  return { ok: true, data: booking };
}

export type BookingOperationsSummary = {
  pendingCount: number;
  activeCount: number;
  recent: AdminBookingSummary[];
};

/**
 * Bounded operational counters for the dashboard: pending and active totals plus
 * the five most recent bookings. Counts use exact `head` queries rather than
 * fetching rows.
 */
export async function loadBookingOperationsSummary(): Promise<
  AdminBookingResult<BookingOperationsSummary>
> {
  let supabase;
  try {
    supabase = await sessionClient();
  } catch (error) {
    return fail(error instanceof SupabaseConfigError ? "not_configured" : "conflict");
  }

  const [pending, active, recent] = await Promise.all([
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("status", [...STATUSES_ACTIVE]),
    supabase
      .from("bookings")
      .select(SUMMARY_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (pending.error || active.error || recent.error)
    return fail("permission_denied");

  const recentRows: AdminBookingSummary[] = [];
  for (const row of (recent.data ?? []) as unknown[]) {
    const mapped = mapBookingSummaryRow(row);
    if (mapped) recentRows.push(mapped);
  }

  return {
    ok: true,
    data: {
      pendingCount: typeof pending.count === "number" ? pending.count : 0,
      activeCount: typeof active.count === "number" ? active.count : 0,
      recent: recentRows,
    },
  };
}
