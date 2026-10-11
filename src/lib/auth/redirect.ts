/**
 * Pure helpers for admin routing, safe return destinations and the auth
 * redirect allow-list. Framework-free so they can be unit tested.
 */

/** Admin routes that must stay reachable without a session. */
export const PUBLIC_ADMIN_ROUTES = [
  "/admin/login",
  "/admin/reset-password",
  "/admin/set-password",
  "/admin/auth/callback",
] as const;

const DEFAULT_ADMIN_PATH = "/admin";

/** True when the path is an admin route that requires an authenticated admin. */
export function protectedAdminPath(pathname: string): boolean {
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return false;
  return !isPublicAdminPath(pathname);
}

export function isPublicAdminPath(pathname: string): boolean {
  return PUBLIC_ADMIN_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Validates a client-supplied return destination.
 *
 * Only same-origin `/admin` paths are accepted, so a crafted `?next=` value can
 * never redirect a signed-in administrator to another site (open redirect).
 */
export function safeAdminPath(
  value: unknown,
  fallback: string = DEFAULT_ADMIN_PATH,
): string {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (!candidate.startsWith("/")) return fallback;
  // Protocol-relative (`//host`), backslash variants (`/\host`, `\/host`) and
  // control characters are all rejected before parsing.
  if (candidate.startsWith("//") || candidate.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  if (candidate.includes("://")) return fallback;

  let url: URL;
  try {
    url = new URL(candidate, "https://admin.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "https://admin.invalid") return fallback;
  const pathname = url.pathname;
  if (pathname !== DEFAULT_ADMIN_PATH && !pathname.startsWith("/admin/"))
    return fallback;
  if (pathname.includes("//")) return fallback;
  if (isPublicAdminPath(pathname)) return fallback;
  return `${pathname}${url.search}`;
}

/**
 * Origins that may receive Supabase Auth redirect links.
 *
 * The only origins trusted without explicit configuration are loopback hosts
 * used for local development. Preview and production origins must be supplied
 * through `SITE_URL`, so no wildcard host (for example `*.vercel.app`, where
 * anyone can deploy) can ever receive a recovery link. Anything else is refused
 * and the caller fails closed.
 */
export function resolveAuthOrigin(input: {
  host?: string | null;
  protocol?: string | null;
  siteUrl?: string | null;
}): string | null {
  const configured = normaliseOrigin(input.siteUrl);
  if (configured) return configured;

  const host = (input.host ?? "").trim().toLowerCase();
  if (!host || /[\s/\\]/.test(host)) return null;
  const [hostname] = host.split(":");
  if (hostname !== "localhost" && hostname !== "127.0.0.1") return null;

  // `x-forwarded-proto` is not guaranteed on every host (it is absent for local
  // `next dev` / `next start`), so an absent value falls back to http, which is
  // the only scheme accepted for loopback.
  const declared = (input.protocol ?? "").trim().toLowerCase();
  const protocol = declared || "http";
  return protocol === "http" ? `http://${host}` : null;
}

function normaliseOrigin(value?: string | null): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && url.hostname === "localhost")
      return url.origin;
    return null;
  } catch {
    return null;
  }
}
