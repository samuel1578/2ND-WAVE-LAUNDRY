import { NextResponse, type NextRequest } from "next/server";
import { reconcileInvitationForUser } from "@/lib/admin/staff-service";
import { safeAuthNext } from "@/lib/auth/redirect";
import { PRIVATE_HEADERS } from "@/lib/supabase/proxy";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

/** Verify a Supabase email token, persist its cookie session, then continue only
 * to a same-origin /admin/* destination. The invited role is reconciled from the
 * database invitation row and is never accepted from the URL. */
export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const type = params.get("type");
    const next = safeAuthNext(params.get("next"));
    const unavailable = (kind?: string) => {
        const url = request.nextUrl.clone();
        url.pathname = "/admin/set-password";
        url.search = new URLSearchParams({ state: "unavailable", ...(kind ? { kind } : {}) }).toString();
        url.hash = "";
        return NextResponse.redirect(url, { headers: PRIVATE_HEADERS });
    };

    if (!isSupabaseConfigured || (type !== "invite" && type !== "recovery"))
        return unavailable(type === "invite" ? "invite" : undefined);

    const tokenHash = params.get("token_hash");
    if (!tokenHash) return unavailable(type === "invite" ? "invite" : undefined);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
    });
    if (error || !data.user) return unavailable(type === "invite" ? "invite" : undefined);

    if (type === "invite") {
        const reconciled = await reconcileInvitationForUser({
            id: data.user.id,
            email: data.user.email,
            correlationId: crypto.randomUUID(),
        });
        if (!reconciled.ok || !reconciled.data.reconciled)
            return unavailable("invite");
    }

    const target = new URL(next, request.url);
    if (type === "invite") target.searchParams.set("kind", "invite");
    return NextResponse.redirect(target, { headers: PRIVATE_HEADERS });
}
