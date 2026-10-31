import type { PromotionRecord } from "@/lib/contracts";
import { bookingHref, copy } from "@/lib/content";

export type PromotionServiceOption = {
    slug: string;
    name: string;
    bookable: boolean;
};

export type PromotionCta = { label: string; href: string };

export type PromotionView = {
    heading: string;
    body: string;
    terms: string;
    exclusions: string;
    eyebrow?: string;
    cta?: PromotionCta;
    endDate: string;
    showDetails: boolean;
    legacyDemoFallback: boolean;
};

export function formatPromotionEndDate(value: string): string {
    if (!value.trim()) return "";
    const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    const localValue = value.includes("T")
        ? value.length === 16 ? `${value}:00` : value
        : `${value}T00:00:00`;
    const date = new Date(hasTimeZone ? value : `${localValue}Z`);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Accra",
    }).format(date);
}

export function buildPromotionView(
    promotion: PromotionRecord | undefined,
    services: PromotionServiceOption[] = [],
    allowDemoFallback = false,
): PromotionView {
    const legacyDemoFallback = allowDemoFallback && !promotion;
    const service = promotion?.serviceSlug
        ? services.find((item) => item.slug === promotion.serviceSlug && item.bookable)
        : undefined;
    const customLabel = promotion?.ctaLabel.trim();
    const customHref = promotion?.ctaHref.trim();
    const cta = customLabel && customHref
        ? { label: customLabel, href: customHref }
        : service
            ? { label: `Book ${service.name}`, href: bookingHref(service.slug) }
            : legacyDemoFallback
                ? {
                    label: copy("14", "Actions").split("/")[0]?.trim() || "Book Wash, Ironing & Fold",
                    href: bookingHref("wash-ironing-fold"),
                }
                : undefined;
    const terms = promotion?.terms ?? (legacyDemoFallback ? copy("14", "Terms") : "");
    const exclusions = promotion?.exclusions ?? (legacyDemoFallback ? copy("14", "Terms") : "");

    return {
        heading: promotion?.heading ?? (legacyDemoFallback ? copy("14", "Heading") : ""),
        body: promotion?.body ?? (legacyDemoFallback ? copy("14", "Body") : ""),
        terms,
        exclusions,
        eyebrow: service?.name ?? (legacyDemoFallback ? "Wash, Ironing & Fold" : undefined),
        cta,
        endDate: promotion?.end ? formatPromotionEndDate(promotion.end) : "",
        showDetails: legacyDemoFallback || Boolean(terms.trim() || exclusions.trim()),
        legacyDemoFallback,
    };
}
