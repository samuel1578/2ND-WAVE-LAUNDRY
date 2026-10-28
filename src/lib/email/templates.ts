/**
 * Typed data contract for the saved Brevo transactional templates.
 *
 * Phase 2D defined the six customer notifications. Phase 2E.1 adds the five
 * staff/admin order alerts; both audiences share the same outbox, worker and
 * Brevo parameter conventions. The Phase 5 MVP adds one internal manager alert
 * (`newsletter_interest_received`) that renders only from its committed payload.
 *
 * The Brevo account's template bodies are intentionally not managed here.
 * Configure them to use these New Template Language `params.*` names; the
 * worker sends only `templateId` plus this dynamic parameter object.
 */

import type { BookingStatus } from "@/lib/bookings/types";
export const emailTemplates = [
  "booking_created",
  "booking_confirmed",
  "booking_processing_started",
  "booking_ready",
  "booking_completed",
  "booking_cancelled",
] as const;

export type EmailTemplate = (typeof emailTemplates)[number];

/**
 * Staff/admin order alerts. One template per required order event; there is
 * deliberately no staff alert for `confirmed`, `scheduled`, `picked_up` or
 * `out_for_delivery`.
 */
export const staffOrderTemplates = [
  "staff_order_pending",
  "staff_order_processing",
  "staff_order_ready",
  "staff_order_completed",
  "staff_order_cancelled",
] as const;

export type StaffOrderTemplate = (typeof staffOrderTemplates)[number];

/**
 * Internal manager alert for a first-time newsletter interest sign-up
 * (Phase 5 MVP). It shares the outbox and worker but is not a booking or a
 * subscriber-facing message.
 */
export const newsletterInterestTemplates = [
  "newsletter_interest_received",
] as const;

export type NewsletterInterestTemplate =
  (typeof newsletterInterestTemplates)[number];

export type NotificationTemplate =
  | EmailTemplate
  | StaffOrderTemplate
  | NewsletterInterestTemplate;

export function isNewsletterInterestTemplate(
  value: unknown,
): value is NewsletterInterestTemplate {
  return (
    typeof value === "string" &&
    (newsletterInterestTemplates as readonly string[]).includes(value)
  );
}

/** Required/optional params actually produced by the builders below. */
export const EMAIL_TEMPLATE_PARAM_CONTRACTS: Record<
  NotificationTemplate,
  { required: readonly string[]; optional: readonly string[] }
> = {
  booking_created: {
    required: ["customerName", "bookingReference", "bookingStatus", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup"],
  },
  booking_confirmed: {
    required: ["customerName", "bookingReference", "bookingStatus", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup", "agreedPickup", "branchName", "confirmedFee"],
  },
  booking_processing_started: {
    required: ["customerName", "bookingReference", "bookingStatus", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup", "branchName"],
  },
  booking_ready: {
    required: ["customerName", "bookingReference", "bookingStatus", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup", "branchName"],
  },
  booking_completed: {
    required: ["customerName", "bookingReference", "bookingStatus", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup"],
  },
  booking_cancelled: {
    required: ["customerName", "bookingReference", "bookingStatus", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup"],
  },
  staff_order_pending: {
    required: ["customerName", "bookingReference", "bookingStatus", "actorType", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup", "branchName", "eventAt", "actorName", "actorRole"],
  },
  staff_order_processing: {
    required: ["customerName", "bookingReference", "bookingStatus", "actorType", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup", "branchName", "previousStatus", "eventAt", "actorName", "actorRole"],
  },
  staff_order_ready: {
    required: ["customerName", "bookingReference", "bookingStatus", "actorType", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup", "branchName", "previousStatus", "eventAt", "actorName", "actorRole"],
  },
  staff_order_completed: {
    required: ["customerName", "bookingReference", "bookingStatus", "actorType", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup", "branchName", "previousStatus", "eventAt", "actorName", "actorRole"],
  },
  staff_order_cancelled: {
    required: ["customerName", "bookingReference", "bookingStatus", "actorType", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: ["serviceSummary", "requestedPickup", "branchName", "previousStatus", "eventAt", "actorName", "actorRole", "cancellationReason"],
  },
  newsletter_interest_received: {
    required: ["subscriberEmail", "submittedAt", "source", "websiteUrl", "contactUrl", "privacyUrl", "headerImageUrl", "headerImageAlt"],
    optional: [],
  },
};

/** Rejects missing required params and unexpected keys before any provider call. */
export function validateEmailTemplateParams(
  template: NotificationTemplate,
  params: Record<string, string>,
): void {
  const contract = EMAIL_TEMPLATE_PARAM_CONTRACTS[template];
  const allowed = new Set([...contract.required, ...contract.optional]);
  const missing = contract.required.filter((key) => typeof params[key] !== "string");
  const invalidValues = Object.entries(params).some(([, value]) => typeof value !== "string");
  const unexpected = Object.keys(params).filter((key) => !allowed.has(key));
  if (missing.length || unexpected.length || invalidValues)
    throw new Error(`Invalid ${template} parameter contract.`);
}

/**
 * The authoritative order status each staff alert describes, mapped from the
 * existing `public.booking_status` lifecycle. Statuses without an entry produce
 * no alert.
 */
export const staffOrderTemplateByStatus: Partial<
  Record<BookingStatus, StaffOrderTemplate>
> = {
  pending: "staff_order_pending",
  processing: "staff_order_processing",
  ready: "staff_order_ready",
  completed: "staff_order_completed",
  cancelled: "staff_order_cancelled",
};

export function isStaffOrderTemplate(
  value: unknown,
): value is StaffOrderTemplate {
  return (
    typeof value === "string" &&
    (staffOrderTemplates as readonly string[]).includes(value)
  );
}

export type BookingEmailBranch = {
  title: string;
};

export type BookingEmailContext = {
  reference: string;
  customerName: string;
  serviceTitles: string[];
  requestedDate: string | null;
  requestedTime: string | null;
  agreedPickupAt: string | null;
  agreedFee: number | null;
  currency: string;
  branch: BookingEmailBranch | null;
};

export type BrevoBookingTemplateParams = Record<string, string>;

export type RenderEmailOptions = {
  /** Validated public site origin, without a trailing slash. */
  siteUrl: string;
};

const TEMPLATE_STATUS: Record<EmailTemplate, string> = {
  booking_created: "Pending confirmation",
  booking_confirmed: "Confirmed",
  booking_processing_started: "Processing",
  booking_ready: "Ready",
  booking_completed: "Completed",
  booking_cancelled: "Cancelled",
};

const HEADER_ASSETS: Record<EmailTemplate, string> = {
  booking_created: "general-booking.png",
  booking_confirmed: "booking-confirmed.png",
  booking_processing_started: "processing-started.png",
  booking_ready: "laundry-ready.png",
  booking_completed: "general-booking.png",
  booking_cancelled: "general-booking.png",
};

const HEADER_ALT: Record<EmailTemplate, string> = {
  booking_created: "2nd Wave Laundry booking request received",
  booking_confirmed: "2nd Wave Laundry booking confirmed",
  booking_processing_started: "2nd Wave Laundry processing started",
  booking_ready: "2nd Wave Laundry ready for collection or delivery",
  booking_completed: "2nd Wave Laundry booking completed",
  booking_cancelled: "2nd Wave Laundry booking cancelled",
};

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

export function formatFee(amount: number | null, currency: string): string | null {
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "GHS";
  const number = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${code} ${number}`;
}

function formatAccraDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Accra",
    timeZoneName: "short",
  }).format(date);
}

export function formatAgreedPickup(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatAccraDateTime(date);
}

/** Formats the enqueue timestamp recorded for a staff order alert. */
export function formatEventTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatAccraDateTime(date);
}

/** Formats a requested (not confirmed) date without timezone date-shifting. */
export function formatRequestedPickup(
  requestedDate: string | null,
  requestedTime: string | null,
): string | null {
  if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return null;

  const time =
    requestedTime && /^\d{2}:\d{2}/.test(requestedTime)
      ? requestedTime.slice(0, 5)
      : null;
  const date = new Date(`${requestedDate}T${time ?? "00:00"}:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);

  return time ? `${day} at ${time}` : day;
}

/**
 * Builds the exact parameter contract expected by the saved Brevo templates.
 * Optional booking values are omitted rather than fabricated. Cancellation
 * details are deliberately excluded because persisted cancellation notes may
 * contain private administrator commentary.
 */
export function buildBrevoTemplateParams(
  template: EmailTemplate,
  context: BookingEmailContext,
  options: RenderEmailOptions,
): BrevoBookingTemplateParams {
  if (!(emailTemplates as readonly string[]).includes(template))
    throw new Error("Unknown transactional email template.");

  const siteUrl = options.siteUrl.replace(/\/+$/, "");
  const params: BrevoBookingTemplateParams = {
    customerName: collapse(context.customerName),
    bookingReference: collapse(context.reference),
    bookingStatus: TEMPLATE_STATUS[template],
    websiteUrl: siteUrl,
    contactUrl: `${siteUrl}/contact`,
    privacyUrl: `${siteUrl}/privacy`,
    headerImageUrl: `${siteUrl}/headers/${HEADER_ASSETS[template]}`,
    headerImageAlt: HEADER_ALT[template],
  };

  const serviceSummary = context.serviceTitles
    .map(collapse)
    .filter(Boolean)
    .join(", ");
  if (serviceSummary) params.serviceSummary = serviceSummary;

  const requestedPickup = formatRequestedPickup(
    context.requestedDate,
    context.requestedTime,
  );
  if (requestedPickup) params.requestedPickup = requestedPickup;

  if (template === "booking_confirmed") {
    const agreedPickup = formatAgreedPickup(context.agreedPickupAt);
    const branchName = context.branch?.title
      ? collapse(context.branch.title)
      : null;
    const confirmedFee = formatFee(context.agreedFee, context.currency);
    if (agreedPickup) params.agreedPickup = agreedPickup;
    if (branchName) params.branchName = branchName;
    if (confirmedFee) params.confirmedFee = confirmedFee;
  } else if (
    template === "booking_processing_started" ||
    template === "booking_ready"
  ) {
    if (context.branch?.title)
      params.branchName = collapse(context.branch.title);
  }

  return params;
}

/* -------------------------------------------------------------------------- */
/* Staff/admin order alerts (Phase 2E.1)                                      */
/* -------------------------------------------------------------------------- */

/** Checked-in admin order-alert header assets; no new image URL is invented. */
export const STAFF_HEADER_ASSETS: Record<StaffOrderTemplate, string> = {
  staff_order_pending: "admin-order-pending.jpeg",
  staff_order_processing: "admin-order-processing.jpeg",
  staff_order_ready: "admin-order-ready.jpeg",
  staff_order_completed: "admin-order-completed.jpeg",
  staff_order_cancelled: "admin-order-cancelled.jpeg",
};

const STAFF_HEADER_ALT: Record<StaffOrderTemplate, string> = {
  staff_order_pending: "2nd Wave Laundry staff alert: new order pending",
  staff_order_processing: "2nd Wave Laundry staff alert: order in processing",
  staff_order_ready: "2nd Wave Laundry staff alert: order ready",
  staff_order_completed: "2nd Wave Laundry staff alert: order completed",
  staff_order_cancelled: "2nd Wave Laundry staff alert: order cancelled",
};

export type StaffActorType = "customer" | "admin" | "system";

/**
 * Trusted event metadata captured when the alert is enqueued. Every field is
 * derived on the server from the committed booking and its status history; no
 * value here may come from an editable client request.
 */
export type StaffNotificationContext = {
  previousStatus: BookingStatus | null;
  actorType: StaffActorType;
  actorName: string | null;
  actorRole: string | null;
  occurredAt: string | null;
  cancellationReason: string | null;
};

const STAFF_ORDER_STATUS: Record<StaffOrderTemplate, BookingStatus> = {
  staff_order_pending: "pending",
  staff_order_processing: "processing",
  staff_order_ready: "ready",
  staff_order_completed: "completed",
  staff_order_cancelled: "cancelled",
};

/** Operational status labels, kept distinct from the customer-facing wording. */
const STAFF_STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  scheduled: "Scheduled",
  picked_up: "Picked up",
  processing: "Processing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STAFF_ACTOR_TYPE_LABEL: Record<StaffActorType, string> = {
  customer: "Customer",
  admin: "Administrator",
  system: "System",
};

const STAFF_ACTOR_ROLE_LABEL: Record<string, string> = {
  full_admin: "Full administrator",
  operational_admin: "Operational administrator",
};

export function formatStaffStatus(status: BookingStatus | null): string | null {
  if (!status) return null;
  return STAFF_STATUS_LABEL[status] ?? null;
}

/**
 * Builds the staff alert parameter contract. Optional metadata is omitted rather
 * than fabricated: an unknown actor, an absent previous status or a missing
 * branch simply does not appear in the message.
 */
export function buildStaffOrderTemplateParams(
  template: StaffOrderTemplate,
  context: BookingEmailContext,
  staff: StaffNotificationContext,
  options: RenderEmailOptions,
): BrevoBookingTemplateParams {
  if (!isStaffOrderTemplate(template))
    throw new Error("Unknown staff alert template.");

  const siteUrl = options.siteUrl.replace(/\/+$/, "");
  const params: BrevoBookingTemplateParams = {
    customerName: collapse(context.customerName),
    bookingReference: collapse(context.reference),
    bookingStatus: STAFF_STATUS_LABEL[STAFF_ORDER_STATUS[template]],
    actorType: STAFF_ACTOR_TYPE_LABEL[staff.actorType] ?? "System",
    websiteUrl: siteUrl,
    contactUrl: `${siteUrl}/contact`,
    privacyUrl: `${siteUrl}/privacy`,
    headerImageUrl: `${siteUrl}/headers/${STAFF_HEADER_ASSETS[template]}`,
    headerImageAlt: STAFF_HEADER_ALT[template],
  };

  const serviceSummary = context.serviceTitles
    .map(collapse)
    .filter(Boolean)
    .join(", ");
  if (serviceSummary) params.serviceSummary = serviceSummary;

  const requestedPickup = formatRequestedPickup(
    context.requestedDate,
    context.requestedTime,
  );
  if (requestedPickup) params.requestedPickup = requestedPickup;

  if (context.branch?.title) {
    const branchName = collapse(context.branch.title);
    if (branchName) params.branchName = branchName;
  }

  // A pending order has no previous lifecycle status.
  const previousStatus =
    template === "staff_order_pending"
      ? null
      : formatStaffStatus(staff.previousStatus);
  if (previousStatus) params.previousStatus = previousStatus;

  const eventAt = formatEventTimestamp(staff.occurredAt);
  if (eventAt) params.eventAt = eventAt;

  const actorName = collapse(staff.actorName ?? "");
  if (actorName) params.actorName = actorName;

  const actorRole = staff.actorRole
    ? STAFF_ACTOR_ROLE_LABEL[staff.actorRole]
    : null;
  if (actorRole) params.actorRole = actorRole;

  if (template === "staff_order_cancelled") {
    const reason = collapse(staff.cancellationReason ?? "").slice(0, 500);
    if (reason) params.cancellationReason = reason;
  }

  return params;
}

/* -------------------------------------------------------------------------- */
/* Newsletter interest manager alert (Phase 5 MVP)                             */
/* -------------------------------------------------------------------------- */

/**
 * Trusted render context parsed from the committed outbox payload. Written
 * once by `newsletter_interest_submit` and never client-editable.
 */
export type NewsletterInterestContext = {
  subscriberEmail: string;
  submittedAt: string;
  source: string;
};

/** Checked-in newsletter header asset; no new image URL is invented. */
export const NEWSLETTER_HEADER_ASSET = "newsletter.png";

const NEWSLETTER_SOURCE_LABEL: Record<string, string> = {
  public_newsletter_form: "2nd Wave Laundry website",
};

/**
 * Builds the manager alert parameter contract. There is no booking context by
 * design: the alert reports one consented sign-up and nothing else.
 */
export function buildNewsletterInterestParams(
  context: NewsletterInterestContext,
  options: RenderEmailOptions,
): BrevoBookingTemplateParams {
  const submittedAt = formatEventTimestamp(context.submittedAt);
  if (!submittedAt) throw new Error("Newsletter interest timestamp is missing.");

  const siteUrl = options.siteUrl.replace(/\/+$/, "");
  return {
    subscriberEmail: collapse(context.subscriberEmail),
    submittedAt,
    source: NEWSLETTER_SOURCE_LABEL[context.source] ?? collapse(context.source),
    websiteUrl: siteUrl,
    contactUrl: `${siteUrl}/contact`,
    privacyUrl: `${siteUrl}/privacy`,
    headerImageUrl: `${siteUrl}/headers/${NEWSLETTER_HEADER_ASSET}`,
    headerImageAlt: "2nd Wave Laundry newsletter interest",
  };
}
