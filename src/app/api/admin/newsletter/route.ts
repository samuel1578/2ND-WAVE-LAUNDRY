import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { listNewsletterInterest } from "@/lib/newsletter/repository";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

/**
 * Newsletter interest read endpoint (Phase 5 MVP).
 *
 * Authorisation is resolved from the caller's verified session plus the
 * database profile — never from the request — and the `newsletter.manage`
 * capability that gates `/admin/newsletter` gates this endpoint. Operational
 * Admins receive 403 here exactly as they receive the forbidden route.
 *
 * Reads use the server-only elevated client because `newsletter_interest` has
 * RLS enabled with no client policy. The browser never receives a key, and
 * this route has no write operations: the MVP records first-time sign-ups only
 * (no withdrawal, no status changes).
 */
export async function GET() {
    const admin = await getCurrentAdmin();
    if (!admin)
        return NextResponse.json(
            {
                code: "unauthenticated",
                message: "Sign in with an administrator account.",
            },
            { status: 401, headers: NO_STORE },
        );

    if (!hasPermission(admin.role, "newsletter.manage"))
        return NextResponse.json(
            {
                code: "permission_denied",
                message: "Your administrator role does not include newsletter interest.",
            },
            { status: 403, headers: NO_STORE },
        );

    const result = await listNewsletterInterest();
    if (!result.ok)
        return NextResponse.json(
            { code: result.reason, message: "Newsletter interest could not be loaded." },
            { status: 503, headers: NO_STORE },
        );

    return NextResponse.json(
        { records: result.records },
        { headers: NO_STORE },
    );
}

/** Methods other than GET are not part of the read endpoint. */
export function POST() {
    return NextResponse.json(
        { code: "method_not_allowed", message: "Interest is registered through the public site." },
        { status: 405, headers: { ...NO_STORE, Allow: "GET" } },
    );
}

export function PUT() {
    return POST();
}

export function PATCH() {
    return POST();
}

export function DELETE() {
    return POST();
}
