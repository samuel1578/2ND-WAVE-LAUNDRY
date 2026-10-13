/**
 * Administrator booking contracts and pure helpers (Sprint 2C).
 *
 * This module is framework-free and side-effect free. It defines the shapes the
 * live administrator booking dashboard consumes, the mapping from persisted
 * `public.bookings` rows to those shapes, and the query/pagination rules. Keeping
 * them pure means the behaviour the database and the server actions rely on can be
 * unit tested without a database or network, and the client component and the
 * server route can never drift apart.
 *
 * The database remains the authority for the lifecycle, confirmation
 * prerequisites, the pickup window and optimistic concurrency. Everything here is
 * a mirror that fails closed when a persisted row does not have the shape it
 * expects (`null`), so a malformed record is reported rather than rendered.
 */

import {
  DEFAULT_PICKUP_WINDOW,
  accraParts,
  clockToSeconds,
  isValidClock,
  isValidDateString,
  type PickupWindow,
  type SchedulingFailure,
} from "./scheduling";
import { bookingStatuses, type BookingStatus } from "./types";

/** Default and maximum page size for the administrator booking list. */
export const BOOKING_LIST_PAGE_SIZE = 20;
export const BOOKING_LIST_MAX_PAGE_SIZE = 50;
/** Maximum number of history/note/audit rows returned for one booking. */
export const BOOKING_DETAIL_HISTORY_LIMIT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

export const isBookingStatus = (value: unknown): value is BookingStatus =>
  typeof value === "string" &&
  (bookingStatuses as readonly string[]).includes(value);

/** A selectable branch, loaded from the persisted `public.branches` table. */
export type BranchOption = {
  id: string;
  slug: string;
  title: string;
  label: string;
  phone: string;
};

/** One persisted service snapshot attached to a booking. */
export type AdminBookingService = { slug: string; title: string };

/** List-row projection of a persisted booking. */
export type AdminBookingSummary = {
  id: string;
  reference: string;
  customerName: string;
  customerPhone: string;
  services: AdminBookingService[];
  itemCategory: string;
  loadSize: string;
  requestedDate: string;
  requestedTime: string | null;
  expressRequested: boolean;
  status: BookingStatus;
  assignedBranch: BranchOption | null;
  agreedPickupAt: string | null;
  agreedFee: number | null;
  version: number;
  createdAt: string;
};

export type BookingHistoryEntry = {
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  actorKind: string;
  actorId: string | null;
  reason: string | null;
  at: string;
};

export type BookingNoteEntry = {
  id: string;
  body: string;
  authorId: string | null;
  at: string;
};

export type BookingAuditEntry = {
  action: string;
  actorId: string | null;
  reason: string | null;
  at: string;
};

/**
 * One customer-attached photo, as the detail view consumes it.
 *
 * Deliberately carries **no** `storage_key`, bucket name or object path: those
 * are server-side credentials in all but name. The interface receives only
 * display metadata plus an opaque id, and asks the authorised endpoint for a
 * short-lived signed URL when it actually wants bytes.
 */
export type AdminBookingPhoto = {
  id: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  uploadedAt: string;
};

/** Full persisted booking, used by the detail view. */
export type AdminBookingDetail = AdminBookingSummary & {
  customerEmail: string | null;
  whatsappPhone: string | null;
  sameWhatsapp: boolean;
  contactMethod: string;
  customerNotes: string;
  pickupAddress: string;
  pickupLandmark: string;
  pickupMapUrl: string | null;
  transportPreference: string;
  agreedFeeCurrency: string;
  zeroFeeReason: string | null;
  serviceCharge: number | null;
  contactOutcome: string | null;
  confirmationNote: string | null;
  returnDetails: string | null;
  cancellationReason: string | null;
  confirmedAt: string | null;
  scheduledAt: string | null;
  pickedUpAt: string | null;
  processingAt: string | null;
  readyAt: string | null;
  outForDeliveryAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  history: BookingHistoryEntry[];
  notes: BookingNoteEntry[];
  audit: BookingAuditEntry[];
  photos: AdminBookingPhoto[];
};

/* -------------------------------------------------------------------------- */
/* Query normalisation and pagination                                          */
/* -------------------------------------------------------------------------- */

export type BookingListQuery = {
  search: string;
  status: BookingStatus | "";
  /** `""` (all), `"unassigned"`, or a branch id. */
  branch: string;
  /** `""` (all) or an `YYYY-MM-DD` requested date. */
  date: string;
  page: number;
  pageSize: number;
};

export type BookingListPage = {
  rows: AdminBookingSummary[];
  total: number;
  page: number;
  pageSize: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Normalises untrusted query-string values into a bounded list query.
 *
 * Invalid filters are dropped rather than forwarded, the page is clamped to a
 * positive integer and the page size is bounded, so a caller can never request an
 * unbounded booking history. The database builds its search pattern only from the
 * sanitised term returned here.
 */
export function normaliseBookingListQuery(
  raw: Record<string, unknown> | null | undefined,
): BookingListQuery {
  const source = isRecord(raw) ? raw : {};

  const statusRaw = typeof source.status === "string" ? source.status.trim() : "";
  const status: BookingStatus | "" = isBookingStatus(statusRaw) ? statusRaw : "";

  const branchRaw = typeof source.branch === "string" ? source.branch.trim() : "";
  const branch =
    branchRaw === "unassigned" || isUuid(branchRaw) ? branchRaw : "";

  const dateRaw = typeof source.date === "string" ? source.date.trim() : "";
  const date = isValidDateString(dateRaw) ? dateRaw : "";

  const pageRaw = Number(source.page);
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const sizeRaw = Number(source.pageSize);
  const pageSize =
    Number.isFinite(sizeRaw) && sizeRaw >= 1
      ? Math.min(Math.floor(sizeRaw), BOOKING_LIST_MAX_PAGE_SIZE)
      : BOOKING_LIST_PAGE_SIZE;

  return {
    search: sanitiseSearchTerm(source.search),
    status,
    branch,
    date,
    page,
    pageSize,
  };
}

/** Inclusive PostgREST range for a normalised list query. */
export function bookingListRange(query: BookingListQuery): {
  from: number;
  to: number;
} {
  const from = (query.page - 1) * query.pageSize;
  return { from, to: from + query.pageSize - 1 };
}

/**
 * Trims and neutralises a free-text search term.
 *
 * PostgREST's `or` filter grammar treats `,`, `(`, `)` and `*` as syntax, so they
 * are removed rather than escaped; the term is also length-bounded. The result is
 * safe to embed in an `ilike` pattern.
 */
export function sanitiseSearchTerm(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[,()*\\%"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/**
 * Builds the PostgREST `or` filter for a search term, or `null` when there is
 * nothing to search. Matches the reference, customer name and phone number.
 */
export function bookingSearchFilter(term: string): string | null {
  const clean = sanitiseSearchTerm(term);
  if (!clean) return null;
  const pattern = `*${clean}*`;
  return [
    `reference.ilike.${pattern}`,
    `customer_name.ilike.${pattern}`,
    `customer_phone.ilike.${pattern}`,
  ].join(",");
}

/**
 * In-memory application of the list filters. The live query applies the same
 * rules in SQL; this mirrors them for tests and so the two cannot diverge.
 */
export function applyBookingFilters(
  rows: AdminBookingSummary[],
  query: BookingListQuery,
): AdminBookingSummary[] {
  const term = query.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (
      term &&
      !`${row.reference} ${row.customerName} ${row.customerPhone}`
        .toLowerCase()
        .includes(term)
    )
      return false;
    if (query.status && row.status !== query.status) return false;
    if (query.branch) {
      if (query.branch === "unassigned") {
        if (row.assignedBranch) return false;
      } else if (row.assignedBranch?.id !== query.branch) return false;
    }
    if (query.date && row.requestedDate !== query.date) return false;
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* Row mapping                                                                 */
/* -------------------------------------------------------------------------- */

const asText = (value: unknown): string =>
  typeof value === "string" ? value : "";

const asNullableText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const asNullableInstant = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
};

const asNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/** Reads a `time` column, normalising `HH:MM:SS` to `HH:MM`. */
const asClock = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{2}:\d{2})/);
  return match ? match[1] : null;
};

function embedObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return isRecord(first) ? first : null;
  }
  return isRecord(value) ? value : null;
}

/** Maps a `public.branches` row (or embedded object) to a `BranchOption`. */
export function mapBranchOption(row: unknown): BranchOption | null {
  const record = embedObject(row);
  if (!record) return null;
  if (!isUuid(record.id) || typeof record.slug !== "string" || typeof record.title !== "string")
    return null;
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    label: asText(record.label),
    phone: asText(record.phone),
  };
}

function mapServices(value: unknown): AdminBookingService[] {
  if (!Array.isArray(value)) return [];
  const services: AdminBookingService[] = [];
  for (const entry of value) {
    const record = embedObject(entry);
    if (!record) continue;
    const slug = asText(record.service_slug);
    const title = asText(record.service_title);
    if (slug) services.push({ slug, title: title || slug });
  }
  return services;
}

/**
 * Maps one persisted booking row to the list projection.
 *
 * Returns `null` when the row is missing an identity, a reference or a valid
 * status, so the caller can report an error instead of rendering a partial record
 * as if it were real.
 */
export function mapBookingSummaryRow(row: unknown): AdminBookingSummary | null {
  if (!isRecord(row)) return null;
  if (!isUuid(row.id)) return null;
  if (typeof row.reference !== "string" || !row.reference) return null;
  if (!isBookingStatus(row.status)) return null;
  return {
    id: row.id,
    reference: row.reference,
    customerName: asText(row.customer_name),
    customerPhone: asText(row.customer_phone),
    services: mapServices(row.booking_services),
    itemCategory: asText(row.item_category),
    loadSize: asText(row.load_size),
    requestedDate: asText(row.requested_date),
    requestedTime: asClock(row.requested_time),
    expressRequested: row.express_requested === true,
    status: row.status,
    assignedBranch: mapBranchOption(row.branches),
    agreedPickupAt: asNullableInstant(row.agreed_pickup_at),
    agreedFee: asNumberOrNull(row.agreed_fee),
    version: Number.isFinite(Number(row.version)) ? Number(row.version) : 1,
    createdAt: asText(row.created_at),
  };
}

function mapHistory(value: unknown): BookingHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: BookingHistoryEntry[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isBookingStatus(item.to_status)) continue;
    entries.push({
      fromStatus: isBookingStatus(item.from_status) ? item.from_status : null,
      toStatus: item.to_status,
      actorKind: asText(item.actor_kind) || "admin",
      actorId: asNullableText(item.actor_id),
      reason: asNullableText(item.reason),
      at: asText(item.created_at),
    });
  }
  return entries;
}

function mapNotes(value: unknown): BookingNoteEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: BookingNoteEntry[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const body = asText(item.body);
    if (!body) continue;
    entries.push({
      id: asText(item.id),
      body,
      authorId: asNullableText(item.author_id),
      at: asText(item.created_at),
    });
  }
  return entries;
}

function mapAudit(value: unknown): BookingAuditEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: BookingAuditEntry[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const action = asText(item.action);
    if (!action) continue;
    entries.push({
      action,
      actorId: asNullableText(item.actor_id),
      reason: asNullableText(item.reason),
      at: asText(item.created_at),
    });
  }
  return entries;
}

/**
 * Maps `public.booking_photos` rows to the display projection.
 *
 * Only rows the caller's session can actually read are passed in — the read
 * policy already withholds photos whose 90-day retention has lapsed — and any
 * row without a usable id is skipped rather than rendered as a phantom image.
 * The object key is never read here, so it can never reach the browser.
 */
function mapPhotos(value: unknown): AdminBookingPhoto[] {
  if (!Array.isArray(value)) return [];
  const photos: AdminBookingPhoto[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (!isUuid(item.id)) continue;
    const byteSize = Number(item.byte_size);
    photos.push({
      id: item.id,
      mimeType: asText(item.mime_type) || "image/jpeg",
      byteSize: Number.isFinite(byteSize) && byteSize > 0 ? byteSize : 0,
      width: asNumberOrNull(item.width),
      height: asNumberOrNull(item.height),
      uploadedAt: asText(item.uploaded_at),
    });
  }
  return photos;
}

/**
 * Maps a persisted booking row plus its history, notes and audit rows to the
 * detail projection. Fails closed (`null`) when the base row is not a real
 * booking.
 */
export function mapBookingDetailRow(
  row: unknown,
  extras: {
    history?: unknown;
    notes?: unknown;
    audit?: unknown;
    photos?: unknown;
  } = {},
): AdminBookingDetail | null {
  const summary = mapBookingSummaryRow(row);
  if (!summary || !isRecord(row)) return null;
  return {
    ...summary,
    customerEmail: asNullableText(row.customer_email),
    whatsappPhone: asNullableText(row.whatsapp_phone),
    sameWhatsapp: row.same_whatsapp !== false,
    contactMethod: asText(row.contact_method) || "phone",
    customerNotes: asText(row.customer_notes),
    pickupAddress: asText(row.pickup_address),
    pickupLandmark: asText(row.pickup_landmark),
    pickupMapUrl: asNullableText(row.pickup_map_url),
    transportPreference: asText(row.transport_preference) || "no_preference",
    agreedFeeCurrency: asText(row.agreed_fee_currency) || "GHS",
    zeroFeeReason: asNullableText(row.zero_fee_reason),
    serviceCharge: asNumberOrNull(row.service_charge),
    contactOutcome: asNullableText(row.contact_outcome),
    confirmationNote: asNullableText(row.confirmation_note),
    returnDetails: asNullableText(row.return_details),
    cancellationReason: asNullableText(row.cancellation_reason),
    confirmedAt: asNullableInstant(row.confirmed_at),
    scheduledAt: asNullableInstant(row.scheduled_at),
    pickedUpAt: asNullableInstant(row.picked_up_at),
    processingAt: asNullableInstant(row.processing_at),
    readyAt: asNullableInstant(row.ready_at),
    outForDeliveryAt: asNullableInstant(row.out_for_delivery_at),
    completedAt: asNullableInstant(row.completed_at),
    cancelledAt: asNullableInstant(row.cancelled_at),
    history: mapHistory(extras.history),
    notes: mapNotes(extras.notes),
    audit: mapAudit(extras.audit),
    photos: mapPhotos(extras.photos),
  };
}

/* -------------------------------------------------------------------------- */
/* Africa/Accra conversions                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Converts an administrator-entered Africa/Accra wall clock (`YYYY-MM-DD`,
 * `HH:MM`) into the UTC instant stored in `timestamptz`.
 *
 * The mapping is verified by round-tripping through the timezone formatter, so if
 * the zone's offset were ever to change the conversion fails closed (`null`)
 * rather than silently recording the wrong instant.
 */
export function accraLocalToIso(
  date: string,
  time: string | null,
): string | null {
  if (!isValidDateString(date)) return null;
  if (time !== null && !isValidClock(time)) return null;
  const instant = new Date(`${date}T${time ?? "00:00"}:00.000Z`);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = accraParts(instant);
  if (parts.date !== date) return null;
  if (time !== null && !parts.time.startsWith(time)) return null;
  return instant.toISOString();
}

/** Formats a stored instant as an Africa/Accra `datetime-local` value. */
export function accraInputValue(iso: string | null): string {
  if (!iso) return "";
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  const parts = accraParts(instant);
  return `${parts.date}T${parts.time.slice(0, 5)}`;
}

/**
 * Validates an administratively agreed pickup against the pickup operating
 * window only.
 *
 * This mirrors the database's `private.assert_pickup_window`, which is what the
 * trusted arrangement function applies: the window bounds and a closed day. It
 * deliberately does not introduce a "past" rule or any administrator bypass, so
 * the interface and the database agree on one rule rather than two.
 */
export function agreedPickupWindowError(
  request: { date: string; time: string | null },
  window: PickupWindow = { ...DEFAULT_PICKUP_WINDOW, closed: false },
): SchedulingFailure | null {
  if (!isValidDateString(request.date))
    return { code: "pickup_date", message: "Choose a valid pickup date." };

  if (window.closed)
    return {
      code: "pickup_closed",
      message: "Pickup is not available on that date.",
    };

  if (request.time !== null && !isValidClock(request.time))
    return { code: "invalid_time", message: "Choose a valid pickup time." };

  if (
    request.time !== null &&
    (clockToSeconds(request.time) < clockToSeconds(window.start) ||
      clockToSeconds(request.time) > clockToSeconds(window.end))
  )
    return {
      code: "pickup_window",
      message: `Choose an agreed pickup time between ${window.start} and ${window.end}.`,
    };

  return null;
}

/** The window rule for an instant already stored as `timestamptz`. */
export function agreedPickupAtWindowError(
  iso: string,
  window: PickupWindow = { ...DEFAULT_PICKUP_WINDOW, closed: false },
): SchedulingFailure | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime()))
    return { code: "pickup_date", message: "Choose a valid pickup date." };
  const parts = accraParts(instant);
  return agreedPickupWindowError(
    { date: parts.date, time: parts.time.slice(0, 5) },
    window,
  );
}
