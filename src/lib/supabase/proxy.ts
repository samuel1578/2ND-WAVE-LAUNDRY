import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { requireSupabaseConfig, supabaseConfig } from "./config";

/**
 * Response headers required for any authenticated request. Refreshed auth
 * cookies must never be cached by a CDN or reverse proxy, otherwise one user's
 * session could be served to another.
 */
export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
} as const;

export type SessionRefresh = {
  response: NextResponse;
  user: User | null;
  configured: boolean;
};

/**
 * Refreshes the Supabase session on the incoming request and returns a response
 * carrying any refreshed cookies for both the downstream server request and the
 * browser.
 *
 * A failed verification is treated as "no user" (fail closed). Protection still
 * happens again in the server page and in every server operation — the proxy is
 * a redirect convenience, not the authorisation boundary.
 */
export async function refreshSession(
  request: NextRequest,
): Promise<SessionRefresh> {
  let response = NextResponse.next({ request });
  if (!supabaseConfig.ok) return { response, user: null, configured: false };

  const config = requireSupabaseConfig();
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet)
          request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers))
          response.headers.set(name, value);
      },
    },
  });

  // `getUser()` re-validates the token with Supabase Auth instead of trusting
  // the unverified session payload held in the cookie.
  const { data, error } = await supabase.auth.getUser();

  return { response, user: error ? null : (data.user ?? null), configured: true };
}
