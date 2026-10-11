/**
 * Administrator role model.
 *
 * Roles are an authorised scope extension to the original single-admin
 * assumption (PRD §2a, SRS ADM-01). The database is the source of truth: a
 * client-supplied role value is never trusted anywhere in this codebase.
 */

export const adminRoles = ["full_admin", "operational_admin"] as const;
export type AdminRole = (typeof adminRoles)[number];

/** Minimum administrator password length, enforced server-side. */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

export type AdminIdentity = {
  userId: string;
  email: string;
  role: AdminRole;
  displayName: string;
};

/** Shape of the row read back from `public.admin_profiles`. */
export type AdminProfileRow = {
  user_id: string;
  role: string | null;
  display_name?: string | null;
  disabled_at?: string | null;
};

export type AuthenticatedUser = {
  id: string;
  email?: string | null;
};

export function isAdminRole(value: unknown): value is AdminRole {
  return (
    typeof value === "string" && (adminRoles as readonly string[]).includes(value)
  );
}

export function roleLabel(role: AdminRole): string {
  return role === "full_admin"
    ? "Full administrator"
    : "Operational administrator";
}

/**
 * Resolves a database-backed identity from a verified auth user plus its
 * profile row.
 *
 * Fails closed for every failure mode: no user, no profile, an unrecognised
 * role value, or a disabled profile all resolve to `null`. A missing record can
 * therefore never grant access, and a disabled account cannot reach privileged
 * operations.
 */
export function resolveAdminIdentity(
  user: AuthenticatedUser | null | undefined,
  profile: AdminProfileRow | null | undefined,
): AdminIdentity | null {
  if (!user?.id) return null;
  if (!profile) return null;
  if (profile.user_id !== user.id) return null;
  if (profile.disabled_at) return null;
  if (!isAdminRole(profile.role)) return null;
  const email = (user.email ?? "").trim();
  return {
    userId: user.id,
    email,
    role: profile.role,
    displayName: (profile.display_name ?? "").trim(),
  };
}

export type AdminDenial = "unauthenticated" | "forbidden" | "not_configured";

export class AdminAuthorisationError extends Error {
  constructor(readonly code: AdminDenial, message: string) {
    super(message);
    this.name = "AdminAuthorisationError";
  }
}

/**
 * Authorisation core shared by every privileged server operation.
 *
 * Stable failure codes let Sprint 1B map denials onto route-level responses
 * without re-implementing role logic.
 */
export function authorizeAdmin(
  identity: AdminIdentity | null,
  allowedRoles: readonly AdminRole[] = adminRoles,
): AdminIdentity {
  if (!identity)
    throw new AdminAuthorisationError(
      "unauthenticated",
      "Sign in with an administrator account to continue.",
    );
  if (allowedRoles.length && !allowedRoles.includes(identity.role))
    throw new AdminAuthorisationError(
      "forbidden",
      "Your administrator role does not allow this action.",
    );
  return identity;
}

/**
 * Route and capability decisions live in `src/lib/auth/permissions.ts`.
 *
 * Sprint 1A temporarily withheld the whole console from Operational Admins while
 * the modules were not yet role-scoped. Sprint 1B replaced that coarse check with
 * the central permission registry: Operational Admins now reach Bookings and
 * Reviews, and every protected route is authorised server-side through
 * `resolveAdminRouteAccess`.
 */
