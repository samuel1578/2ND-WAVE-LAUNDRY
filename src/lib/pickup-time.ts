export const DEFAULT_PICKUP_START = "07:00";
export const DEFAULT_PICKUP_END = "17:00";

const TIME_PATTERN = /^(?:([01]\d|2[0-3]):([0-5]\d))(?:\:[0-5]\d(?:\.\d+)?)?$/;

/** Normalize a database TIME or HH:mm value, falling back when it is absent or invalid. */
export function normalizePickupTime(value: unknown, fallback: string): string {
    if (typeof value !== "string") return fallback;
    const match = TIME_PATTERN.exec(value.trim());
    return match ? `${match[1]}:${match[2]}` : fallback;
}

function formatTime(value: string): string {
    const [rawHour, minutes] = value.split(":");
    const hour = Number(rawHour);
    const period = hour < 12 ? "am" : "pm";
    const clockHour = hour % 12 || 12;
    return `${clockHour}${minutes === "00" ? "" : `:${minutes}`}${period}`;
}

/** Formats the public pickup pill, using today's 7am–5pm window as its fallback. */
export function formatPickupWindow(
    start?: string | null,
    end?: string | null,
): string {
    const normalizedStart = normalizePickupTime(start, DEFAULT_PICKUP_START);
    const normalizedEnd = normalizePickupTime(end, DEFAULT_PICKUP_END);
    return `${formatTime(normalizedStart)}–${formatTime(normalizedEnd)}`;
}
