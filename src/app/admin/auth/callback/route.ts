import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { PRIVATE_HEADERS } from "@/lib/supabase/proxy";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reconcileInvitationForUser } from "@/lib/admin/staff-service";

export const dynamic = "force-dynamic";

/**
 * Supabase Auth redirect target for password recovery and administrator
 * invitations.
 *
 * Exchanges the one-time code (PKCE) or token for a session, then redirects to the
 * set-password screen. The destination is fixed, so a crafted callback URL cannot
 * redirect anywhere else. Failures produce the same "link unavailable" state as an
 * expired link.
 *
 * Sprint 1C reconciliation: an invited administrator has an Auth account but no
 * `admin_profiles` row until this point. After the session is verified, any
 * outstanding invitation for the verified address is completed — the profile is
 * created from the invited role and the acceptance is audited. A failure here
 * never blocks the redirect: the account simply holds no role, so the
 * set-password screen shows its "link unavailable" state.
 */
export async function GET(request: NextRequest) {
  const target = (state?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/set-password";
    url.search = state ? `?state=${state}` : "";
    return NextResponse.redirect(url, { headers: PRIVATE_HEADERS });
  };

  if (!isSupabaseConfigured) return target("unavailable");
  if (request.nextUrl.searchParams.get("error"))
    return target("unavailable");

  const supabase = await createSupabaseServerClient();
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return target("unavailable");
    await reconcileInvitedAdministrator();
    return target();
  }

  if (tokenHash && (type === "recovery" || type === "invite")) {
    const { error } = await supabase.auth.verifyOtp({
      type: type === "invite" ? "invite" : "recovery",
      token_hash: tokenHash,
    });
    if (error) return target("unavailable");
    await reconcileInvitedAdministrator();
    return target();
  }

  return target("unavailable");

  /**
   * Best-effort reconciliation of an outstanding administrator invitation. The
   * verified address comes from Supabase Auth, never from the query string, and
   * the invited role comes from the invitation row.
   */
  async function reconcileInvitedAdministrator(): Promise<void> {
    try {
      const sessionClient = await createSupabaseServerClient();
      const {
        data: { user },
      } = await sessionClient.auth.getUser();
      if (!user?.id || !user.email) return;
      await reconcileInvitationForUser({
        id: user.id,
        email: user.email,
        correlationId: crypto.randomUUID(),
      });
    } catch {
      // A reconciliation failure must never break the redirect; the account just
      // holds no administrator role.
    }
  }
}
