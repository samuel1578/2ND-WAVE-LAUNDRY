/**
 * Typed data contract for the six saved Brevo transactional templates.
 *
 * The Brevo account's template bodies are intentionally not managed here.
 * Configure them to use these New Template Language `params.*` names; the
 * worker sends only `templateId` plus this dynamic parameter object.
 */

export const emailTemplates = [
  "booking_created",
  "booking_confirmed",
  "booking_processing_started",
  "booking_ready",
  "booking_completed",
  "booking_cancelled",
] as const;

export type EmailTemplate = (typeof emailTemplates)[number];

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

export function formatAgreedPickup(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
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
