import { parsePhoneNumberFromString } from "libphonenumber-js/min";
export const statuses = [
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
export type BookingStatus = (typeof statuses)[number];
export const statusLabel = (status: string) =>
  status.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const transitions: Record<BookingStatus, BookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["scheduled", "picked_up", "cancelled"],
  scheduled: ["picked_up", "cancelled"],
  picked_up: ["processing", "cancelled"],
  processing: ["ready", "cancelled"],
  ready: ["out_for_delivery", "completed", "cancelled"],
  out_for_delivery: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};
export function accraDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export const validClock = (time: string) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
export const clockLabel = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
};
export function defaultPickupDate(now = new Date(), end = "17:00") {
  return accraDate(
    new Date(
      now.getTime() + (now.toISOString().slice(11, 16) >= end ? 86400000 : 0),
    ),
  );
}
export function schedulingError(
  date: string,
  time: string,
  express: boolean,
  now = new Date(),
  rules = { start: "07:00", end: "17:00", cutoff: "11:00" },
): string {
  const today = accraDate(now);
  const seconds =
    now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date + "T00:00:00Z")) ||
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date ||
    date < today
  )
    return "Choose a valid pickup date.";
  const asSeconds = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 3600 + m * 60;
  };
  if (date === today && seconds >= asSeconds(rules.end))
    return "Pickup hours have ended for today. Choose another date or contact the team.";
  if (date === today && express && seconds > asSeconds(rules.cutoff))
    return `The ${clockLabel(rules.cutoff)} cutoff for express orders requiring pickup for service today has passed. Choose another date or contact the team to discuss your request.`;
  if (
    time &&
    (!validClock(time) ||
      time < rules.start ||
      time > rules.end ||
      (date === today && time < now.toISOString().slice(11, 16)))
  )
    return `Choose a preferred time between ${clockLabel(rules.start)} and ${clockLabel(rules.end)} that has not already passed.`;
  return "";
}
export function validPhone(value: string) {
  return !!parsePhoneNumberFromString(value, "GH")?.isValid();
}
export function normalisePhone(value: string) {
  return parsePhoneNumberFromString(value, "GH")?.number ?? value;
}
export function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
export function validMap(value: string) {
  if (!value) return true;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      [
        "maps.app.goo.gl",
        "maps.google.com",
        "www.google.com",
        "google.com",
        "goo.gl",
        "maps.apple.com",
      ].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
export function uploadError(files: Pick<File, "type" | "size">[], max = 3) {
  if (files.length > max) return `Add no more than ${max} photos.`;
  if (files.some((f) => f.size > 5000000))
    return "Each photo must be 5MB or smaller.";
  if (
    files.some(
      (f) => !["image/jpeg", "image/png", "image/webp"].includes(f.type),
    )
  )
    return "Choose a supported image file.";
  return "";
}
export type Arrangement = {
  branch: string;
  agreedPickup: string;
  fee: string;
  zeroReason: string;
  contactOutcome: string;
  confirmationNotes: string;
  returnDetails: string;
};
export function confirmationError(a: Arrangement) {
  if (!a.branch) return "Assign a branch before confirming.";
  if (!a.agreedPickup || !Number.isFinite(Date.parse(a.agreedPickup)))
    return "Record the agreed pickup date and time.";
  if (
    a.fee.trim() === "" ||
    !Number.isFinite(Number(a.fee)) ||
    Number(a.fee) < 0
  )
    return "Record the agreed pickup fee.";
  if (Number(a.fee) === 0 && !a.zeroReason.trim())
    return "Record the reason for a zero pickup fee.";
  if (!a.contactOutcome.trim())
    return "Record the contact outcome before confirming.";
  if (!a.confirmationNotes.trim()) return "Record the confirmation notes.";
  return "";
}
export function promoActive(
  enabled: boolean,
  start: string,
  end: string,
  now = new Date(),
) {
  return (
    enabled &&
    now.getTime() >= Date.parse(start) &&
    now.getTime() < Date.parse(end)
  );
}
/** Normalise a phone number into a tel: link (Ghana 0-prefix → +233). */
export function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  const national = digits.startsWith("+")
    ? digits
    : digits.startsWith("0")
      ? `+233${digits.slice(1)}`
      : digits;
  return `tel:${national}`;
}
/** Opening-hour ranges such as "7am–8pm" or "9am–7:30pm". */
export function validHoursRange(value: string) {
  const time = "\\d{1,2}(?::\\d{2})?\\s*[ap]m";
  return new RegExp(`^${time}\\s*[–-]\\s*${time}$`, "i").test(value.trim());
}
/** Case/whitespace/punctuation-insensitive FAQ question key. */
export function normaliseQuestion(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?？.]+$/g, "");
}
/** Display state for an admin promotion, derived from status + trusted window. */
export function promotionBadge(
  record: { status: string; start: string; end: string },
  now = new Date(),
): "Draft" | "Scheduled" | "Active" | "Paused" | "Ended" {
  if (record.status === "draft") return "Draft";
  if (record.status === "paused") return "Paused";
  if (record.status === "ended") return "Ended";
  const time = now.getTime();
  if (time < Date.parse(record.start)) return "Scheduled";
  if (time >= Date.parse(record.end)) return "Ended";
  return "Active";
}
/** Reject executable or non-http(s) destinations such as javascript: or data:. */
export function safeHttpUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
export function locationError(input: {
  name: string;
  phone: string;
  map: string;
  hours: [string, string][];
}) {
  if (!input.name.trim()) return "Enter the branch name.";
  if (!validPhone(input.phone)) return "Enter a valid phone number.";
  if (!validMap(input.map))
    return "Use a recognised Google or Apple Maps link.";
  if (!safeHttpUrl(input.map)) return "Use a safe http(s) map link.";
  if (input.hours.length && input.hours.some(([day]) => !day.trim()))
    return "Enter a label for every opening-hours row.";
  if (input.hours.some(([, range]) => !validHoursRange(range)))
    return "Use opening-hour ranges such as 7am–8pm.";
  return "";
}
export function galleryError(items: {
  mediaId: string;
  alt: string;
  order: number;
}[]) {
  if (items.some((i) => !i.mediaId)) return "Choose a media asset.";
  if (items.some((i) => !i.alt.trim()))
    return "Describe each image with alt text.";
  if (items.some((i) => !Number.isInteger(i.order) || i.order < 1))
    return "Use whole-number display orders starting at 1.";
  return "";
}
export function faqErrors(items: { question: string; answer: string }[]) {
  if (items.some((i) => !i.question.trim()))
    return "Every FAQ needs a question.";
  if (items.some((i) => !i.answer.trim())) return "Every FAQ needs an answer.";
  const seen = new Set<string>();
  for (const item of items) {
    const key = normaliseQuestion(item.question);
    if (seen.has(key)) return "Questions must be unique.";
    seen.add(key);
  }
  return "";
}
export function promotionError(
  input: { start: string; end: string; yearConfirmed?: boolean },
  action: "save" | "activate" = "save",
) {
  if (
    !Number.isFinite(Date.parse(input.start)) ||
    !Number.isFinite(Date.parse(input.end)) ||
    Date.parse(input.end) <= Date.parse(input.start)
  )
    return "Choose a valid start date and a later end date.";
  if (action === "activate" && input.yearConfirmed !== true)
    return "Confirm the offer dates with the client before activation.";
  return "";
}
export function promotionCtaError(input: { ctaLabel: string; ctaHref: string }) {
  const hasLabel = input.ctaLabel.trim().length > 0;
  const hasHref = input.ctaHref.trim().length > 0;
  if (hasLabel !== hasHref)
    return "Add both a button label and a link, or leave both fields empty.";
  const internalPath = /^\/(?!\/)[^\s]*$/.test(input.ctaHref.trim());
  if (hasHref && !internalPath && !safeHttpUrl(input.ctaHref))
    return "Choose a valid website link for the button.";
  return "";
}
