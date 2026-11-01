import { contact } from "./content";
import {
  DEFAULT_PICKUP_END,
  DEFAULT_PICKUP_START,
} from "./pickup-time";

/**
 * Pure link helpers and fallback rules for the public site's contact details.
 *
 * No React, Next.js or Supabase imports: the same rules are used by the server
 * settings wrapper, client components and unit tests.
 */

export type SocialLink = { label: string; href: string };

/** The subset of admin Settings that the public site displays. */
export type StoredSiteSettings = {
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
  newsletter?: boolean;
  pickupStart?: string | null;
  pickupEnd?: string | null;
};

export type SiteSettings = {
  phone: string;
  whatsapp: string;
  email: string;
  instagram: string;
  tiktok: string;
  facebook: string;
  pickupStart: string;
  pickupEnd: string;
};

const digitsOnly = (value: string): string => value.replace(/\D/g, "");

/** Ghana numbers: keep +, 233…, or turn a leading 0 into +233. */
function internationalDigits(value: string): string {
  const plain = digitsOnly(value);
  if (!plain) return "";
  if (plain.startsWith("233")) return plain;
  if (plain.startsWith("0")) return `233${plain.slice(1)}`;
  return plain;
}

export function telHref(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("+")) return `tel:${cleaned}`;
  const plain = internationalDigits(cleaned);
  return plain ? `tel:+${plain}` : "";
}

export function whatsappHref(number: string): string {
  const plain = internationalDigits(number);
  return plain ? `https://wa.me/${plain}` : "";
}

/** Only non-empty social links render; a cleared link disappears. */
export function socialLinks(
  settings: Pick<SiteSettings, "instagram" | "tiktok" | "facebook">,
): SocialLink[] {
  return [
    { label: "Instagram", href: settings.instagram.trim() },
    { label: "TikTok", href: settings.tiktok.trim() },
    { label: "Facebook", href: settings.facebook.trim() },
  ].filter((link) => link.href.length > 0);
}

/**
 * Apply the public fallback rules.
 *
 * `null` means "no stored settings" (demo mode or Supabase unconfigured), which
 * renders the built-in `contact` defaults. When stored settings exist, a cleared
 * social link stays hidden, while an empty phone, WhatsApp number or email falls
 * back to the built-in value.
 */
export function resolveSiteSettings(
  stored?: StoredSiteSettings | null,
): SiteSettings {
  if (!stored) {
    return {
      phone: contact.phone,
      whatsapp: contact.whatsapp,
      email: contact.emails.info,
      instagram: contact.instagram,
      tiktok: contact.tiktok,
      facebook: "",
      pickupStart: DEFAULT_PICKUP_START,
      pickupEnd: DEFAULT_PICKUP_END,
    };
  }
  const keep = (value?: string | null) => (value ?? "").trim();
  return {
    phone: keep(stored.phone) || contact.phone,
    whatsapp: keep(stored.whatsapp) || contact.whatsapp,
    email: keep(stored.email) || contact.emails.info,
    instagram: keep(stored.instagram),
    tiktok: keep(stored.tiktok),
    facebook: keep(stored.facebook),
    pickupStart: keep(stored.pickupStart) || DEFAULT_PICKUP_START,
    pickupEnd: keep(stored.pickupEnd) || DEFAULT_PICKUP_END,
  };
}
