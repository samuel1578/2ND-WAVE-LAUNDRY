import { validEmail, validPhone } from "@/lib/rules";

export const ENQUIRY_TOPICS = [
    "Services",
    "Pickup or delivery",
    "Existing request",
    "Commercial laundry",
    "Concern or complaint",
    "Something else",
] as const;

export const ENQUIRY_LIMITS = {
    name: 120,
    business: 120,
    phone: 40,
    email: 254,
    topic: 80,
    message: 4000,
    items: 2000,
    frequency: 120,
    location: 500,
    requirements: 4000,
    idempotencyKeyMin: 16,
    idempotencyKeyMax: 128,
} as const;

export type EnquiryKind = "general" | "commercial";
export type EnquirySubmission = {
    kind: EnquiryKind;
    name: string;
    business: string | null;
    phone: string;
    email: string | null;
    topic: string | null;
    message: string | null;
    details: {
        items?: string;
        frequency?: string;
        location?: string;
        requirements?: string;
    };
};

export type EnquiryValidationCode =
    | "invalid_payload"
    | "invalid_kind"
    | "invalid_field"
    | "spam_rejected";
export type EnquiryValidationResult =
    | { ok: true; value: EnquirySubmission }
    | { ok: false; code: EnquiryValidationCode; fieldErrors: Record<string, string> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function validateEnquirySubmission(raw: unknown): EnquiryValidationResult {
    if (!isRecord(raw))
        return { ok: false, code: "invalid_payload", fieldErrors: { form: "Invalid submission." } };
    if (text(raw.website))
        return { ok: false, code: "spam_rejected", fieldErrors: { form: "The submission could not be accepted." } };
    if (raw.kind !== "general" && raw.kind !== "commercial")
        return { ok: false, code: "invalid_kind", fieldErrors: { form: "Choose a valid enquiry type." } };

    const kind = raw.kind;
    const errors: Record<string, string> = {};
    const name = text(raw.name);
    const phone = text(raw.phone);
    const email = text(raw.email).toLowerCase();
    const business = text(raw.business);
    const topic = text(raw.topic);
    const message = text(raw.message);
    const items = text(raw.items);
    const frequency = text(raw.frequency);
    const location = text(raw.location);
    const requirements = text(raw.requirements);

    if (!name || name.length > ENQUIRY_LIMITS.name) errors.name = "Enter your name (up to 120 characters).";
    if (!phone || phone.length > ENQUIRY_LIMITS.phone || !validPhone(phone)) errors.phone = "Enter a valid phone number.";
    if (email && (email.length > ENQUIRY_LIMITS.email || !validEmail(email))) errors.email = "Enter a valid email address.";

    if (kind === "general") {
        if (!ENQUIRY_TOPICS.includes(topic as (typeof ENQUIRY_TOPICS)[number])) errors.topic = "Choose an enquiry topic.";
        if (!message || message.length > ENQUIRY_LIMITS.message) errors.message = "Enter a message (up to 4,000 characters).";
    } else {
        if (!business || business.length > ENQUIRY_LIMITS.business) errors.business = "Enter a business name (up to 120 characters).";
        if (!items || items.length > ENQUIRY_LIMITS.items) errors.items = "Describe the items and approximate quantities (up to 2,000 characters).";
    }

    const optionalLimits: Array<[string, string, number]> = [
        ["frequency", frequency, ENQUIRY_LIMITS.frequency],
        ["location", location, ENQUIRY_LIMITS.location],
        ["requirements", requirements, ENQUIRY_LIMITS.requirements],
    ];
    for (const [field, value, max] of optionalLimits) {
        if (value.length > max) errors[field] = `Use no more than ${max} characters.`;
    }
    if (kind === "commercial" && requirements.length > ENQUIRY_LIMITS.requirements) {
        errors.requirements = "Use no more than 4,000 characters.";
    }

    if (Object.keys(errors).length)
        return { ok: false, code: "invalid_field", fieldErrors: errors };

    return {
        ok: true,
        value: {
            kind,
            name,
            business: business || null,
            phone,
            email: email || null,
            topic: topic || null,
            message: message || null,
            details: kind === "commercial" ? {
                items,
                ...(frequency ? { frequency } : {}),
                ...(location ? { location } : {}),
                ...(requirements ? { requirements } : {}),
            } : {},
        },
    };
}

export function isValidEnquiryIdempotencyKey(value: string | null): value is string {
    return Boolean(value && value.length >= ENQUIRY_LIMITS.idempotencyKeyMin &&
        value.length <= ENQUIRY_LIMITS.idempotencyKeyMax && value.trim() === value);
}
