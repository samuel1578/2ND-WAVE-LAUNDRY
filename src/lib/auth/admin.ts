import { supabaseConfig, isSupabaseConfigured, supabaseConfigMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  AdminAuthorisationError,
  authorizeAdmin,
  resolveAdminIdentity,
  type AdminIdentity,
  type AdminProfileRow,
  type AdminRole,
  type AuthenticatedUser,
} from "./roles";

/**
 * Server-side administrator identity and role resolution.
 *
 * Rules enforced here:
 * - Identity is verified with `auth.getUser()`, which re-validates the token
 *   with Supabase Auth. The unverified cookie session is never trusted.
 * - The role is read from `public.admin_profiles` under RLS, never from the
 *   client. There is deliberately no parameter that accepts a user id, so a
 *   caller cannot impersonate another administrator.
 * - A missing profile, an unknown role value, a disabled profile, a policy
 *   denial or any query error all resolve to "not an administrator".
 * - Missing Supabase configuration fails closed.
 */

const PROFILE_COLUMNS = "user_id, role, display_name, disabled_at";

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { id: user.id, email: user.email ?? "" };
}

/** The current administrator, or `null` when not an active admin. */
export async function getCurrentAdmin(): Promise<AdminIdentity | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data, error: profileError } = await supabase
    .from("admin_profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle();

  // Any lookup failure (missing table, RLS denial, transport error) denies.
  // Diagnostic only: the PostgREST code and schema-level message identify a
  // missing column, a policy denial (42501) or a transport problem. Neither
  // contains credentials, tokens or personal data, and the browser still
  // receives nothing.
  if (profileError) {
    console.warn(
      `[auth] admin_profiles lookup failed code=${profileError.code ?? "unknown"} message=${profileError.message ?? ""}`,
    );
    return null;
  }

  return resolveAdminIdentity(
    { id: user.id, email: user.email ?? "" },
    (data as AdminProfileRow | null) ?? null,
  );
}

/** Throws a stable denial when there is no active administrator session. */
export async function requireAdmin(): Promise<AdminIdentity> {
  if (!isSupabaseConfigured)
    throw new AdminAuthorisationError(
      "not_configured",
      supabaseConfig.ok
        ? "Administrator authentication is unavailable."
        : supabaseConfigMessage(supabaseConfig.reason),
    );
  return authorizeAdmin(await getCurrentAdmin());
}

/** Throws a stable denial unless the caller holds one of `roles`. */
export async function requireAdminRole(
  roles: readonly AdminRole[],
): Promise<AdminIdentity> {
  if (!isSupabaseConfigured)
    throw new AdminAuthorisationError(
      "not_configured",
      supabaseConfig.ok
        ? "Administrator authentication is unavailable."
        : supabaseConfigMessage(supabaseConfig.reason),
    );
  return authorizeAdmin(await getCurrentAdmin(), roles);
}
