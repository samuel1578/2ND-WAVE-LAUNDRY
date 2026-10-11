import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseConfigError,
  supabaseConfig,
  supabaseConfigMessage,
} from "./config";

let browserClient: SupabaseClient | null = null;

/**
 * Browser client for the public project URL and publishable key only.
 *
 * Only call this from client components. Administrator authorisation is never
 * decided in the browser: every privileged read and write is verified again on
 * the server (src/lib/auth/admin.ts) and by database RLS policies.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (!supabaseConfig.ok) throw new SupabaseConfigError(supabaseConfig.reason);
  browserClient ??= createBrowserClient(supabaseConfig.url, supabaseConfig.key);
  return browserClient;
}

/** Safe description of why the browser client is unavailable. */
export function supabaseBrowserClientError(): string | null {
  return supabaseConfig.ok ? null : supabaseConfigMessage(supabaseConfig.reason);
}
