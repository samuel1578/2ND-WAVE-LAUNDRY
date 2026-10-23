import { isAdminRole, type AdminRole } from "./roles";
import { safeAdminPath } from "./redirect";

/**
 * Central administrator permission registry.
 *
 * This is the single source of truth for what each role may do and which
 * administrative routes it may reach. Components must not compare roles
 * directly: they ask this registry (directly, or through the navigation and
 * route helpers below).
 *
 * The registry is intentionally dependency-free and framework-free so it can be
 * unit tested and reused on the server (authorisation) and in the browser
 * (navigation filtering). The browser copy only decides what is *shown*; every
 * protected route and server operation re-resolves the role from the database.
 */

export const permissions = [
  "dashboard.read",
  "bookings.read",
  "bookings.manage",
  "reviews.read",
  "reviews.moderate",
  "reviews.reply",
  "reviews.override",
  "enquiries.manage",
  "newsletter.manage",
  "content.manage",
  "media.manage",
  "settings.manage",
  // Declared now because they define the Full Admin boundary for later phases.
  // No module implements them yet; they grant nothing on their own.
  "staff.manage",
  "email.manage",
] as const;

export type Permission = (typeof permissions)[number];

/**
 * Operational Admins may operate bookings and reviews only. They never receive
 * `reviews.override`: emergency overrides of an already-decided review are a
 * Full Admin capability (PRD §2a, SRS §7).
 */
const operationalAdminPermissions = [
  "bookings.read",
  "bookings.manage",
  "reviews.read",
  "reviews.moderate",
  "reviews.reply",
] as const satisfies readonly Permission[];

export const rolePermissions: Record<AdminRole, readonly Permission[]> = {
  full_admin: permissions,
  operational_admin: operationalAdminPermissions,
};

/**
 * Permissions for a role. Unknown, missing or client-supplied role values
 * resolve to no permissions, so an unrecognised role can never grant access.
 */
export function permissionsFor(
  role: AdminRole | string | null | undefined,
): readonly Permission[] {
  if (!isAdminRole(role)) return [];
  return rolePermissions[role] ?? [];
}

export function hasPermission(
  role: AdminRole | string | null | undefined,
  permission: Permission,
): boolean {
  return permissionsFor(role).includes(permission);
}

export function hasAnyPermission(
  role: AdminRole | string | null | undefined,
  required: readonly Permission[],
): boolean {
  return required.some((permission) => hasPermission(role, permission));
}

export type AdminRouteKey =
  | "dashboard"
  | "bookings"
  | "reviews"
  | "enquiries"
  | "newsletter"
  | "content"
  | "media"
  | "settings"
  | "staff"
  | "emailCompose"
  | "emailDelivery";

export type AdminRouteDefinition = {
  key: AdminRouteKey;
  label: string;
  href: string;
  permission: Permission;
};

/**
 * Canonical administrative routes. Order matches the console navigation and the
 * existing icon order; the icon itself is resolved by route key in the shell.
 */
export const adminRoutes: readonly AdminRouteDefinition[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/admin",
    permission: "dashboard.read",
  },
  {
    key: "bookings",
    label: "Bookings",
    href: "/admin/bookings",
    permission: "bookings.read",
  },
  {
    key: "enquiries",
    label: "Enquiries",
    href: "/admin/enquiries",
    permission: "enquiries.manage",
  },
  {
    key: "reviews",
    label: "Reviews",
    href: "/admin/reviews",
    permission: "reviews.read",
  },
  {
    key: "newsletter",
    label: "Newsletter Interest",
    href: "/admin/newsletter",
    permission: "newsletter.manage",
  },
  {
    key: "content",
    label: "Website Content",
    href: "/admin/content",
    permission: "content.manage",
  },
  {
    key: "media",
    label: "Media Library",
    href: "/admin/media",
    permission: "media.manage",
  },
  {
    key: "settings",
    label: "Settings",
    href: "/admin/settings",
    permission: "settings.manage",
  },
  // Sprint 1C. Full Admin only: `staff.manage` is absent from the Operational
  // Admin permission set, so the route, the navigation entry and the staff API
  // are all denied to that role by this one registry entry.
  {
    key: "staff",
    label: "Staff Management",
    href: "/admin/staff",
    permission: "staff.manage",
  },
  {
    key: "emailCompose",
    label: "Compose Email",
    href: "/admin/email-compose",
    permission: "email.manage",
  },
  {
    key: "emailDelivery",
    label: "Email Delivery",
    href: "/admin/email-delivery",
    permission: "email.manage",
  },
];

/** Routes this role may reach, used for navigation and shortcut rendering. */
export function adminNavigationFor(
  role: AdminRole | string | null | undefined,
): AdminRouteDefinition[] {
  return adminRoutes.filter((route) => hasPermission(role, route.permission));
}

export function adminRoute(key: AdminRouteKey): AdminRouteDefinition {
  const route = adminRoutes.find((entry) => entry.key === key);
  if (!route) throw new Error(`Unknown administrative route key: ${key}`);
  return route;
}

export function canAccessAdminRoute(
  role: AdminRole | string | null | undefined,
  pathname: string,
): boolean {
  const resolution = resolveAdminRoute(pathname);
  return resolution.kind === "known" && hasPermission(role, resolution.route.permission);
}

/**
 * Normalises an administrative pathname.
 *
 * Segment boundaries are respected: `/admin/bookings/42` matches the Bookings
 * route while `/admin/bookingsX` does not match anything, so an unknown route can
 * never inherit a privileged prefix.
 */
function normaliseAdminPath(pathname: string): string | null {
  if (typeof pathname !== "string") return null;
  const trimmed = pathname.trim();
  if (/[\s\\]/.test(trimmed)) return null;
  if (trimmed === "/admin") return "/admin";
  if (!trimmed.startsWith("/admin/")) return null;
  const withoutTrailing = trimmed.replace(/\/+$/, "");
  return withoutTrailing === "/admin" ? "/admin" : withoutTrailing;
}

export type AdminRouteResolution =
  | { kind: "known"; route: AdminRouteDefinition }
  | { kind: "unknown" };

export function resolveAdminRoute(pathname: string): AdminRouteResolution {
  const normalised = normaliseAdminPath(pathname);
  if (!normalised) return { kind: "unknown" };
  // `/admin` is the dashboard root, not a prefix of every nested path: only an
  // exact match may resolve to it, otherwise `/admin/<unknown>` would inherit the
  // dashboard route and render privileged content for an unknown path.
  const match = adminRoutes.find(
    (route) =>
      normalised === route.href ||
      (route.href !== "/admin" && normalised.startsWith(`${route.href}/`)),
  );
  return match ? { kind: "known", route: match } : { kind: "unknown" };
}

/**
 * Server-side decision for one canonical route.
 *
 * `redirect` is only ever returned for the dashboard, and only when the role can
 * actually reach the landing page, so a redirect can never bounce between two
 * inaccessible routes.
 */
export type AdminRouteAccess =
  | { kind: "allowed"; route: AdminRouteDefinition }
  | { kind: "redirect"; to: string; route: AdminRouteDefinition }
  | { kind: "forbidden"; route: AdminRouteDefinition }
  | { kind: "unknown" };

/** Least-privileged landing page for a role; unknown roles get the scoped one. */
export function defaultLandingFor(
  role: AdminRole | string | null | undefined,
): string {
  return role === "full_admin" ? "/admin" : "/admin/bookings";
}

export function resolveAdminRouteAccess(
  role: AdminRole | string | null | undefined,
  pathname: string,
): AdminRouteAccess {
  const resolution = resolveAdminRoute(pathname);
  if (resolution.kind === "unknown") return { kind: "unknown" };
  const { route } = resolution;
  if (hasPermission(role, route.permission)) return { kind: "allowed", route };

  if (route.key === "dashboard") {
    const landing = defaultLandingFor(role);
    const landingAccess = resolveAdminRoute(landing);
    if (
      landingAccess.kind === "known" &&
      hasPermission(role, landingAccess.route.permission)
    )
      return { kind: "redirect", to: landing, route };
  }
  return { kind: "forbidden", route };
}

/**
 * Resolves the destination after sign-in.
 *
 * A requested path is honoured only when it is a same-origin administrative path
 * that the authenticated role is actually permitted to reach; otherwise the
 * role's landing page is used. The requested URL never grants access.
 */
export function resolveLoginDestination(
  role: AdminRole | string | null | undefined,
  requested?: string | null,
): string {
  const landing = defaultLandingFor(role);
  const candidate = safeAdminPath(requested, "");
  if (!candidate) return landing;
  return canAccessAdminRoute(role, candidate) ? candidate : landing;
}
