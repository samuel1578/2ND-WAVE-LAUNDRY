/**
 * Booking domain types shared by the server-side contracts and validators.
 *
 * These types describe the production booking model introduced in Sprint 2A.
 * They are deliberately framework-free so they can be unit tested, used by the
 * future public submission route (Sprint 2B) and by the administrative booking
 * management screen (Sprint 2C) without duplicating rules.
 *
 * The database is the source of truth for every constraint enforced here (see
 * `supabase/migrations/20261011130000_booking_schema.sql`); the TypeScript layer
 * exists to reject invalid input early with a precise, structured error.
 */

/**
 * The agreed lifecycle. Kept in lockstep with `src/lib/rules.ts` and the
 * `public.booking_status` enum; `tests/bookings.test.ts` asserts that this list,
 * the front-end list and the documented transitions stay identical.
 */
export const bookingStatuses = [
  "pending",
  "confirmed",
  "scheduled",
  "picked_up",
  "processing",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
] as const;

export type BookingStatus = (typeof bookingStatuses)[number];

/** Statuses from which no ordinary transition is possible. */
export const terminalStatuses: readonly BookingStatus[] = ["completed", "cancelled"];

/** True when no ordinary lifecycle transition starts from this status. */
export const isTerminalStatus = (status: BookingStatus): boolean =>
  terminalStatuses.includes(status);

export const itemCategories = ["clothing", "bedding", "both", "other"] as const;
export type ItemCategory = (typeof itemCategories)[number];

export const transportPreferences = [
  "no_preference",
  "cab",
  "motorbike",
  "courier",
] as const;
export type TransportPreference = (typeof transportPreferences)[number];

export const contactMethods = ["phone", "whatsapp"] as const;
export type ContactMethod = (typeof contactMethods)[number];

export const serviceKinds = [
  "laundry",
  "modifier",
  "information",
  "commercial",
] as const;
export type ServiceKind = (typeof serviceKinds)[number];

/** Contact methods as they appear in the approved booking form labels. */
export const contactMethodAliases: Record<string, ContactMethod> = {
  phone: "phone",
  "phone call": "phone",
  call: "phone",
  whatsapp: "whatsapp",
  "whatsapp message": "whatsapp",
};

export const transportAliases: Record<string, TransportPreference> = {
  "no preference": "no_preference",
  none: "no_preference",
  no_preference: "no_preference",
  cab: "cab",
  motorbike: "motorbike",
  courier: "courier",
};

/* -------------------------------------------------------------------------- */
/* Field limits — must match the CHECK constraints on public.bookings           */
/* -------------------------------------------------------------------------- */

export const BOOKING_LIMITS = {
  name: { min: 1, max: 120 },
  phone: { min: 7, max: 20 },
  email: { min: 3, max: 254 },
  address: { min: 1, max: 500 },
  landmark: { max: 200 },
  mapUrl: { max: 2048 },
  loadSize: { min: 1, max: 200 },
  notes: { max: 4000 },
  note: { min: 1, max: 4000 },
  reason: { max: 2000 },
  confirmationText: { max: 2000 },
  noticeVersion: { max: 60 },
  idempotencyKey: { min: 16, max: 128 },
  submissionScope: { min: 3, max: 60 },
  maxServices: 12,
} as const;

/** Retention windows (PRD §9, SRS RET-01). Destructive cleanup is not active in 2A. */
export const RETENTION = {
  bookingMonths: 12,
  photoDays: 90,
} as const;

/* -------------------------------------------------------------------------- */
/* Service catalogue (validation input)                                        */
/* -------------------------------------------------------------------------- */

export type CatalogueService = {
  slug: string;
  title: string;
  kind: ServiceKind;
  bookable: boolean;
  active: boolean;
};

/** Immutable snapshot stored against a booking when the request is committed. */
export type BookingServiceSnapshot = {
  serviceId: string | null;
  slug: string;
  title: string;
};

/* -------------------------------------------------------------------------- */
/* Contracts                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A public booking request after normalisation. Values are already trimmed and
 * canonical; the trusted server never trusts the shape of browser-supplied JSON.
 */
export type NormalisedBookingRequest = {
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  whatsappPhone: string | null;
  sameWhatsapp: boolean;
  contactMethod: ContactMethod;
  itemCategory: ItemCategory;
  loadSize: string;
  customerNotes: string;
  pickupAddress: string;
  pickupLandmark: string;
  pickupMapUrl: string | null;
  transportPreference: TransportPreference;
  /** Africa/Accra calendar date, `YYYY-MM-DD`. */
  requestedDate: string;
  /** Optional preferred clock time, `HH:MM`. */
  requestedTime: string | null;
  expressRequested: boolean;
  services: string[];
};

/** The payload sent to the trusted `booking_submit` database function. */
export type BookingSubmitPayload = Record<string, unknown>;

export type BookingSubmitResult = {
  bookingId: string;
  reference: string;
  status: BookingStatus;
  version: number;
  replayed: boolean;
};

export type BookingMutationResult = {
  bookingId: string;
  reference: string;
  status: BookingStatus;
  version: number;
  previousStatus?: BookingStatus;
};

/** Administrative agreed arrangements (PRD §7). */
export type BookingArrangement = {
  branchId: string | null;
  agreedPickupAt: string | null;
  agreedFee: number | null;
  zeroFeeReason: string | null;
  serviceCharge: number | null;
  contactOutcome: string | null;
  confirmationNote: string | null;
  returnDetails: string | null;
};

export type BookingTransitionInput = {
  bookingId: string;
  expectedVersion: number;
  next: BookingStatus;
  reason?: string | null;
};
