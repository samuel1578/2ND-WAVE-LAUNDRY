/**
 * Public booking request validation.
 *
 * A single pure function turns untrusted form input into a fully normalised
 * request, or a structured set of field errors. It is framework-free so the
 * future public submission route (Sprint 2B) and this sprint's tests exercise the
 * identical rules.
 *
 * The database re-validates everything it cares about; this layer exists to fail
 * fast with a clear, per-field message and to guarantee the shape of the payload
 * handed to the trusted `booking_submit` function.
 */

import { normalisePhone, validEmail, validMap, validPhone } from "../rules";
import {
  BOOKING_LIMITS,
  contactMethodAliases,
  itemCategories,
  transportAliases,
  type BookingSubmitPayload,
  type CatalogueService,
  type NormalisedBookingRequest,
} from "./types";
import type { ValidationResult } from "./errors";
import {
  DEFAULT_EXPRESS_CUTOFF,
  isValidClock,
  isValidDateString,
  schedulingFailure,
  type PickupWindow,
} from "./scheduling";

export const EXPRESS_SERVICE_SLUG = "express-same-day-laundry";

/** Minimum idempotency key length; the database rejects anything shorter. */
export const MIN_IDEMPOTENCY_KEY_LENGTH = BOOKING_LIMITS.idempotencyKey.min;

export type ValidateBookingOptions = {
  services: readonly CatalogueService[];
  now?: Date;
  window?: PickupWindow;
  cutoff?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asTrimmed = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * Validates and normalises a public booking request.
 *
 * Error keys match the booking form field names (`services`, `items`, `address`,
 * `map`, `date`, `time`, `name`, `phone`, `email`, `whatsapp`, `contactMethod`,
 * `notes`) so the interface can highlight the exact field.
 */
export function validatePublicBookingRequest(
  raw: unknown,
  options: ValidateBookingOptions,
): ValidationResult<NormalisedBookingRequest> {
  const fieldErrors: Record<string, string> = {};

  if (!isRecord(raw))
    return { ok: false, code: "invalid_payload", fieldErrors: { form: "Invalid submission." } };

  const catalogue = new Map(
    options.services
      .filter((service) => service.active && service.bookable)
      .map((service) => [service.slug, service]),
  );

  // Services.
  const requestedServices = Array.isArray(raw.services)
    ? raw.services.filter((value): value is string => typeof value === "string")
    : [];
  const services = requestedServices.map((slug) => slug.trim()).filter(Boolean);
  const uniqueServices = new Set(services);
  if (!services.length) fieldErrors.services = "Select at least one service.";
  else if (uniqueServices.size !== services.length)
    fieldErrors.services = "Each service may be selected only once.";
  else if (services.length > BOOKING_LIMITS.maxServices)
    fieldErrors.services = "Select fewer services.";
  else if (services.some((slug) => !catalogue.has(slug)))
    fieldErrors.services = "One of the selected services is no longer available.";

  // Load size.
  const loadSize = asTrimmed(raw.items);
  if (!loadSize) fieldErrors.items = "Select a load size.";
  else if (loadSize.length > BOOKING_LIMITS.loadSize.max)
    fieldErrors.items = "Select a valid load size.";

  // Category.
  const itemCategory = asTrimmed(raw.category).toLowerCase();
  if (!(itemCategories as readonly string[]).includes(itemCategory))
    fieldErrors.category = "Choose an item category.";

  // Notes.
  const customerNotes = asTrimmed(raw.notes);
  if (customerNotes.length > BOOKING_LIMITS.notes.max)
    fieldErrors.notes = "Shorten the notes.";

  // Pickup location.
  const pickupAddress = asTrimmed(raw.address);
  if (!pickupAddress) fieldErrors.address = "Complete this field.";
  else if (pickupAddress.length > BOOKING_LIMITS.address.max)
    fieldErrors.address = "Shorten the pickup address.";

  const pickupLandmark = asTrimmed(raw.landmark).slice(0, BOOKING_LIMITS.landmark.max);

  const mapValue = asTrimmed(raw.map);
  if (mapValue && !validMap(mapValue)) fieldErrors.map = "Enter a valid map link or leave this field empty.";

  // Requested schedule.
  const requestedDate = asTrimmed(raw.date);
  if (!isValidDateString(requestedDate)) fieldErrors.date = "Choose a valid pickup date.";

  const requestedTimeRaw = asTrimmed(raw.time);
  const requestedTime = requestedTimeRaw || null;
  if (requestedTime && !isValidClock(requestedTime))
    fieldErrors.time = "Choose a valid preferred time.";

  // Contact details.
  const customerName = asTrimmed(raw.name);
  if (!customerName) fieldErrors.name = "Complete this field.";
  else if (customerName.length > BOOKING_LIMITS.name.max)
    fieldErrors.name = "Enter a shorter name.";

  const phoneInput = asTrimmed(raw.phone);
  const customerPhone = validPhone(phoneInput) ? normalisePhone(phoneInput) : "";
  if (!customerPhone) fieldErrors.phone = "Enter a valid phone number.";

  const emailInput = asTrimmed(raw.email);
  if (emailInput && !validEmail(emailInput)) fieldErrors.email = "Enter a valid email address.";

  const sameWhatsapp = raw.sameWhatsapp !== false;
  const whatsappInput = asTrimmed(raw.whatsapp);
  let whatsappPhone: string | null = null;
  if (!sameWhatsapp) {
    whatsappPhone = validPhone(whatsappInput) ? normalisePhone(whatsappInput) : null;
    if (!whatsappPhone) fieldErrors.whatsapp = "Enter a valid phone number.";
  }

  const contactMethod =
    contactMethodAliases[asTrimmed(raw.contactMethod).toLowerCase()] ?? null;
  if (!contactMethod) fieldErrors.contactMethod = "Choose a preferred contact method.";

  // The customer must have acknowledged the pending-request notice. The server
  // never trusts a browser-only acknowledgement, so it is checked here.
  if (raw.acknowledged !== true)
    fieldErrors.acknowledged = "Confirm the acknowledgement before submitting.";

  const transportPreference =
    transportAliases[asTrimmed(raw.transport).toLowerCase()] ?? null;
  if (!transportPreference) fieldErrors.transport = "Choose a transport preference.";

  // Express is explicit, or implied by the express service selection.
  const expressRequested =
    raw.express === true || services.includes(EXPRESS_SERVICE_SLUG);

  // Scheduling: only meaningful once the date is valid.
  if (isValidDateString(requestedDate)) {
    const failure = schedulingFailure(
      { date: requestedDate, time: requestedTime, express: expressRequested },
      options.now ?? new Date(),
      { window: options.window, cutoff: options.cutoff ?? DEFAULT_EXPRESS_CUTOFF },
    );
    if (failure) fieldErrors.date = failure.message;
  }

  if (Object.keys(fieldErrors).length)
    return { ok: false, code: "invalid_request", fieldErrors };

  return {
    ok: true,
    value: {
      customerName,
      customerPhone,
      customerEmail: emailInput ? emailInput.toLowerCase() : null,
      whatsappPhone,
      sameWhatsapp,
      contactMethod: contactMethod as NormalisedBookingRequest["contactMethod"],
      itemCategory: itemCategory as NormalisedBookingRequest["itemCategory"],
      loadSize,
      customerNotes,
      pickupAddress,
      pickupLandmark,
      pickupMapUrl: mapValue || null,
      transportPreference:
        transportPreference as NormalisedBookingRequest["transportPreference"],
      requestedDate,
      requestedTime,
      expressRequested,
      noticeVersion: asTrimmed(raw.noticeVersion).slice(0, BOOKING_LIMITS.noticeVersion.max),
      services,
    },
  };
}

/**
 * Builds the JSON payload sent to `public.booking_submit`.
 *
 * The keys are the snake_case names the trusted function reads. Nothing outside
 * this contract is forwarded, so a browser cannot inject extra fields.
 */
export function toBookingSubmitPayload(
  request: NormalisedBookingRequest,
): BookingSubmitPayload {
  return {
    customer_name: request.customerName,
    customer_phone: request.customerPhone,
    customer_email: request.customerEmail,
    whatsapp_phone: request.whatsappPhone,
    same_whatsapp: request.sameWhatsapp,
    contact_method: request.contactMethod,
    item_category: request.itemCategory,
    load_size: request.loadSize,
    customer_notes: request.customerNotes,
    pickup_address: request.pickupAddress,
    pickup_landmark: request.pickupLandmark,
    pickup_map_url: request.pickupMapUrl,
    transport_preference: request.transportPreference,
    requested_date: request.requestedDate,
    requested_time: request.requestedTime,
    express_requested: request.expressRequested,
    notice_version: request.noticeVersion,
  };
}

/** The selected service slugs, in submission order. */
export const selectedServiceSlugs = (
  request: NormalisedBookingRequest,
): string[] => [...request.services];
