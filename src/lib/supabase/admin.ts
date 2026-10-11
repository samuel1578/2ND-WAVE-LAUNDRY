import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

/**
 * Server-only elevated Supabase client.
 *
 * Used exclusively for the trusted staff-administration operations that require
 * the Supabase Auth Admin API or a privileged database function:
 * inviting an administrator and the atomic staff RPCs in
 * `supabase/migrations/20261011120300_admin_staff_functions.sql`.
 *
 * Rules enforced in this module:
 * - the key is server-only: it is never read from a `NEXT_PUBLIC_*` variable and
 *   the client refuses to initialise in a browser;
 * - the value is never logged, returned or included in an error message;
 * - sessions are not persisted, so this client can never act as a signed-in user;
 * - it is created per operation rather than shared across requests.
 *
 * Authorisation is decided before this client is used: callers must resolve the
 * acting administrator from the verified session (`requireAdminRole`) and the
 * database re-validates the actor inside each function.
 */

export const SERVICE_ROLE_KEY_VAR = "SUPABASE_SERVICE_ROLE_KEY";
export const SECRET_KEY_VAR = "SUPABASE_SECRET_KEY";

export type ElevatedKeyReason = "missing" | "invalid" | "unavailable";

export type ElevatedKey =
  | { ok: true; key: string }
  | { ok: false; reason: ElevatedKeyReason };

/**
 * Validates an elevated key without ever including its value in a message.
 * Accepts the legacy service-role key and the newer secret key.
 */
export function readElevatedKey(env: {
  serviceRoleKey?: string;
  secretKey?: string;
}): ElevatedKey {
  const key = (env.secretKey ?? env.serviceRoleKey ?? "").trim();
  if (!key) return { ok: false, reason: "missing" };
  if (key.length < 20 || /\s/.test(key)) return { ok: false, reason: "invalid" };
  // Shape check: a legacy service-role JWT or a modern secret key. This rejects a
  // publishable key (`sb_publishable_…`) being pasted in by mistake, which would
  // otherwise fail later with a confusing permission error.
  if (!key.startsWith("eyJ") && !key.startsWith("sb_secret_"))
    return { ok: false, reason: "invalid" };
  return { ok: true, key };
}

export const elevatedKey = readElevatedKey({
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  secretKey: process.env.SUPABASE_SECRET_KEY,
});

export const isElevatedConfigured = elevatedKey.ok;

/** Safe, non-secret explanation for the operator. */
export function elevatedConfigMessage(reason: ElevatedErrorReason): string {
  if (reason === "unavailable")
    return "Staff administration is unavailable in this environment: the server cannot reach the Supabase project.";
  return `Staff administration is not configured for this environment. Set the server-only ${SERVICE_ROLE_KEY_VAR} (or ${SECRET_KEY_VAR}) value, never a NEXT_PUBLIC_ variable.`;
}

export type ElevatedErrorReason = ElevatedKeyReason;

export class SupabaseElevatedConfigError extends Error {
  readonly code = "staff_not_configured" as const;
  constructor(readonly reason: ElevatedErrorReason) {
    super(elevatedConfigMessage(reason));
    this.name = "SupabaseElevatedConfigError";
  }
}

/**
 * Creates the elevated client. Throws a safe configuration error when the key or
 * the project URL is missing, so callers fail closed instead of silently
 * degrading to a weaker code path.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  if (typeof window !== "undefined")
    throw new Error(
      "The elevated Supabase client is server-only and must never run in the browser.",
    );
  if (!supabaseConfig.ok) throw new SupabaseElevatedConfigError("unavailable");
  if (!elevatedKey.ok) throw new SupabaseElevatedConfigError(elevatedKey.reason);
  return createClient(supabaseConfig.url, elevatedKey.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "2ndwave-staff-admin" } },
  });
}
