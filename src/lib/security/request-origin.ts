/**
 * Origin verification for state-changing requests.
 *
 * Next.js Server Actions already reject cross-origin submissions by comparing the
 * `Origin` header with the `Host` header (and the `X-Forwarded-Host` value behind
 * a proxy). This module performs the same comparison explicitly, so the check also
 * covers route handlers and so a future refactor cannot silently lose it.
 *
 * It deliberately compares the *request's own* hosts rather than a hard-coded
 * production domain, so valid Vercel preview deployments and local development
 * keep working without extra configuration.
 */

export type OriginCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "cross-origin" };

export function checkRequestOrigin(input: {
  origin?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
  siteUrl?: string | null;
}): OriginCheck {
  const origin = normaliseHost(input.origin);
  if (!origin) return { ok: false, reason: "missing" };

  const candidates = [
    normaliseHost(input.host),
    firstForwardedHost(input.forwardedHost),
    normaliseHost(input.siteUrl),
  ].filter((value): value is string => Boolean(value));

  if (candidates.length === 0) return { ok: false, reason: "missing" };
  return candidates.includes(origin)
    ? { ok: true }
    : { ok: false, reason: "cross-origin" };
}

/** Host (with port) of an absolute URL, lower-cased; `null` when unusable. */
function normaliseHost(value?: string | null): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

function firstForwardedHost(value?: string | null): string | null {
  const first = (value ?? "").split(",")[0].trim();
  return first ? normaliseHost(first) : null;
}
