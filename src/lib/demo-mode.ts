/**
 * Frontend preview flag. The isolated client demo stays enabled unless a
 * production environment explicitly disables it with
 * `NEXT_PUBLIC_DEMO_MODE=false`.
 *
 * Demo mode never grants production access: it only keeps the in-memory mock
 * workspace and the simulated sign-in entry available. Real administrator
 * authentication requires a Supabase session plus an active `admin_profiles`
 * row regardless of this flag. See docs/implementation/SPRINT_1A_SUPABASE_AUTH.md.
 *
 * Kept in its own module so the Proxy (`src/proxy.ts`) can read the flag
 * without pulling the content data files into its bundle.
 */
export const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
