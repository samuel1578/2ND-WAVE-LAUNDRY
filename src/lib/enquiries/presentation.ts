import type { EnquiryKind } from "./validation";

/**
 * Kind-aware presentation for the admin enquiry detail view.
 *
 * The `enquiries` table keeps nullable shared columns (`topic`, `message`) for
 * historical records and for general enquiries. A commercial quote never
 * collects those fields, so they must not be projected into its detail view
 * even when a legacy row happens to contain a value.
 */
export type EnquiryPresentationRecord = {
    kind: EnquiryKind;
    name: string;
    business: string | null;
    phone: string;
    email: string | null;
    topic: string | null;
    message: string | null;
    details: Record<string, unknown>;
};

export type EnquiryDetailField = {
    key: string;
    label: string;
    value: string;
};

const text = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";

const COMMERCIAL_FIELDS: Array<{ key: string; label: string; optional: boolean }> = [
    { key: "business", label: "Business", optional: false },
    { key: "name", label: "Contact name", optional: false },
    { key: "phone", label: "Phone", optional: false },
    { key: "email", label: "Email", optional: true },
    { key: "items", label: "Items and quantities", optional: false },
    { key: "frequency", label: "Collection frequency", optional: true },
    { key: "location", label: "Location", optional: true },
    { key: "requirements", label: "Requirements", optional: true },
];

const GENERAL_FIELDS: Array<{ key: string; label: string; optional: boolean }> = [
    { key: "name", label: "Name", optional: false },
    { key: "business", label: "Business", optional: false },
    { key: "phone", label: "Phone", optional: false },
    { key: "email", label: "Email", optional: false },
    { key: "topic", label: "Topic", optional: false },
    { key: "message", label: "Message", optional: false },
];

/**
 * Projects an ordered field list. Commercial quotes never include `topic` or
 * `message`; optional values are omitted when empty so the detail view does not
 * show "Not provided" rows for data the workflow never collects.
 */
export function enquiryDetailFieldsFromValues(
    kind: EnquiryKind,
    values: Record<string, string>,
): EnquiryDetailField[] {
    const definitions = kind === "commercial" ? COMMERCIAL_FIELDS : GENERAL_FIELDS;
    const fields: EnquiryDetailField[] = [];
    for (const definition of definitions) {
        const value = text(values[definition.key]);
        if (!value && definition.optional) continue;
        fields.push({
            key: definition.key,
            label: definition.label,
            value,
        });
    }
    return fields;
}

function flatValues(record: EnquiryPresentationRecord): Record<string, string> {
    const values: Record<string, string> = {
        name: text(record.name),
        business: text(record.business),
        phone: text(record.phone),
        email: text(record.email),
    };
    if (record.kind === "general") {
        values.topic = text(record.topic);
        values.message = text(record.message);
    }
    for (const [key, value] of Object.entries(record.details ?? {})) {
        values[key] = text(value);
    }
    return values;
}

export function enquiryDetailFields(
    record: EnquiryPresentationRecord,
): EnquiryDetailField[] {
    return enquiryDetailFieldsFromValues(record.kind, flatValues(record));
}
