import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { getEnquirySummary, listEnquiries } from "@/lib/enquiries/repository";
import type { EnquiryKind } from "@/lib/enquiries/validation";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
const denied = (status: number, code: string, message: string) => NextResponse.json({ code, message }, { status, headers: NO_STORE });
export async function GET(request: NextRequest) {
    const admin = await getCurrentAdmin();
    if (!admin) return denied(401, "unauthenticated", "Sign in with an administrator account.");
    if (!hasPermission(admin.role, "enquiries.manage")) return denied(403, "permission_denied", "Your administrator role does not include enquiries.");
    if (request.nextUrl.searchParams.get("view") === "summary") {
        const summary = await getEnquirySummary();
        if (!summary.ok) return denied(503, summary.code, "Enquiries could not be loaded.");
        return NextResponse.json(summary.data, { headers: NO_STORE });
    }
    const kind = request.nextUrl.searchParams.get("kind");
    if (kind !== "general" && kind !== "commercial") return denied(400, "invalid_kind", "Choose general or commercial enquiries.");
    const result = await listEnquiries(kind as EnquiryKind);
    if (!result.ok) return denied(result.code === "not_configured" ? 503 : 503, result.code, "Enquiries could not be loaded.");
    return NextResponse.json({ records: result.data.records, limit: result.data.limit }, { headers: NO_STORE });
}
export function POST() { return denied(405, "method_not_allowed", "Enquiries are submitted through the public form."); }
