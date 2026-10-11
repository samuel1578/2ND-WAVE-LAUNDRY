import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requireSupabaseConfig } from "./config";

/**
 * Request-scoped server client using Next.js cookie handling.
 *
 * A new client is created for every request. Never cache or share this client
 * across requests, and never reuse it to serve a different signed-in user.
 *
 * Security:
 * - Uses only the public URL and publishable key. No service-role credential is
 *   introduced here; privileged work must go through a reviewed server path.
 * - `setAll` is a no-op during a Server Component render (cookies are read-only
 *   there). `src/proxy.ts` refreshes and persists sessions on every `/admin`
 *   request, which is the supported place to write cookies.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const config = requireSupabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // Server Component render: the proxy owns cookie writes for /admin.
        }
      },
    },
  });
}
