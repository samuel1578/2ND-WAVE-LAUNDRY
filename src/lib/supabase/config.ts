/**
 * Supabase public configuration for the browser and the Next.js server.
 *
 * Only the public project URL and publishable key are read here. A service-role
 * or secret key must never be imported into this module (or anything it feeds).
 */

export const SUPABASE_URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

export type SupabaseConfigReason = "missing" | "invalid-url" | "invalid-key";

export type SupabaseConfig =
  | { ok: true; url: string; key: string }
  | { ok: false; reason: SupabaseConfigReason };

export function readSupabaseConfig(env: {
  url?: string;
  key?: string;
}): SupabaseConfig {
  const url = (env.url ?? "").trim();
  const key = (env.key ?? "").trim();
  if (!url || !key) return { ok: false, reason: "missing" };
  if (!/^https:\/\/[^\s/]+/.test(url)) return { ok: false, reason: "invalid-url" };
  if (key.length < 20 || /\s/.test(key))
    return { ok: false, reason: "invalid-key" };
  return { ok: true, url: url.replace(/\/+$/, ""), key };
}

/** Safe, non-secret explanation of a configuration failure. */
export function supabaseConfigMessage(reason: SupabaseConfigReason): string {
  if (reason === "invalid-url")
    return `Administrator authentication is unavailable: ${SUPABASE_URL_VAR} must be the https project URL shown in the Supabase dashboard.`;
  if (reason === "invalid-key")
    return `Administrator authentication is unavailable: ${SUPABASE_KEY_VAR} is not a complete project key.`;
  return `Administrator authentication is not configured for this environment. Set ${SUPABASE_URL_VAR} and ${SUPABASE_KEY_VAR}.`;
}

/**
 * Accepts the current publishable key name and the legacy anon key name so an
 * older project still works. Both are public project keys, never secrets.
 */
export const supabaseConfig = readSupabaseConfig({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

export const isSupabaseConfigured = supabaseConfig.ok;

export class SupabaseConfigError extends Error {
  readonly code = "not_configured" as const;
  constructor(readonly reason: SupabaseConfigReason) {
    super(supabaseConfigMessage(reason));
    this.name = "SupabaseConfigError";
  }
}

/** Fails closed: throws a safe message rather than falling back to demo mode. */
export function requireSupabaseConfig(): { url: string; key: string } {
  if (!supabaseConfig.ok) throw new SupabaseConfigError(supabaseConfig.reason);
  return { url: supabaseConfig.url, key: supabaseConfig.key };
}
