import type { Settings } from "@/lib/contracts";
import { validClock, validEmail, validPhone } from "@/lib/rules";

const SOCIAL_HOSTS = {
    instagram: ["instagram.com"],
    tiktok: ["tiktok.com"],
    facebook: ["facebook.com", "fb.com", "fb.me"],
} as const;

type SettingsRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SettingsRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
    return typeof value === "string" ? value.trim() : null;
}

function socialUrlIsValid(value: string, hosts: readonly string[]): boolean {
    if (!value) return true;
    if (value.length > 300) return false;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.port &&
            hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))
        );
    } catch {
        return false;
    }
}

/** Returns a human-readable validation error, or null when settings are valid. */
export function validateSettings(settings: unknown): string | null {
    if (!isRecord(settings)) return "Settings are invalid.";

    const email = stringValue(settings.email);
    const phone = stringValue(settings.phone);
    const whatsapp = stringValue(settings.whatsapp);
    const instagram = stringValue(settings.instagram);
    const tiktok = stringValue(settings.tiktok);
    const facebook = stringValue(settings.facebook);
    const start = stringValue(settings.start);
    const end = stringValue(settings.end);
    const cutoff = stringValue(settings.cutoff);

    if (
        email === null ||
        phone === null ||
        whatsapp === null ||
        instagram === null ||
        tiktok === null ||
        facebook === null ||
        start === null ||
        end === null ||
        cutoff === null ||
        typeof settings.acceptBookings !== "boolean" ||
        typeof settings.newsletter !== "boolean"
    ) {
        return "Settings are invalid.";
    }
    if (email && !validEmail(email)) return "Enter a valid email address.";
    if (
        !validPhone(phone) ||
        !validPhone(`+${whatsapp.replace(/^\+/, "")}`)
    ) {
        return "Enter a valid phone number.";
    }
    if (
        !socialUrlIsValid(instagram, SOCIAL_HOSTS.instagram) ||
        !socialUrlIsValid(tiktok, SOCIAL_HOSTS.tiktok) ||
        !socialUrlIsValid(facebook, SOCIAL_HOSTS.facebook)
    ) {
        return "Enter valid HTTPS social links or leave them empty.";
    }
    if (
        ![start, end, cutoff].every(validClock) ||
        !(start < cutoff && cutoff < end)
    ) {
        return "Pickup start time must be before the express cutoff and pickup end time.";
    }
    return null;
}

/** Validate and whitelist the exact settings payload accepted by persistence. */
export function settingsForWrite(settings: unknown): Settings {
    const error = validateSettings(settings);
    if (error) throw new Error(error);
    if (!isRecord(settings)) throw new Error("Settings are invalid.");

    const version = settings.version;
    const bookingVersion = settings.bookingVersion;
    if (
        !Number.isSafeInteger(version) ||
        (version as number) < 1 ||
        !Number.isSafeInteger(bookingVersion) ||
        (bookingVersion as number) < 1
    ) {
        throw new Error("Settings are invalid. Reload the latest values and try again.");
    }

    return {
        email: (settings.email as string).trim(),
        phone: (settings.phone as string).trim(),
        whatsapp: (settings.whatsapp as string).trim(),
        instagram: (settings.instagram as string).trim(),
        tiktok: (settings.tiktok as string).trim(),
        facebook: (settings.facebook as string).trim(),
        acceptBookings: settings.acceptBookings as boolean,
        start: (settings.start as string).trim(),
        end: (settings.end as string).trim(),
        cutoff: (settings.cutoff as string).trim(),
        newsletter: settings.newsletter as boolean,
        version: version as number,
        bookingVersion: bookingVersion as number,
    };
}
