import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { getEnquiry } from "@/lib/enquiries/repository";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const admin = await getCurrentAdmin();
    if (!admin) return NextResponse.json({ code: "unauthenticated", message: "Sign in with an administrator account." }, { status: 401, headers: NO_STORE });
    if (!hasPermission(admin.role, "enquiries.manage")) return NextResponse.json({ code: "permission_denied", message: "Your administrator role does not include enquiries." }, { status: 403, headers: NO_STORE });
    const { id } = await context.params;
    const result = await getEnquiry(id);
    if (!result.ok) return NextResponse.json({ code: result.code, message: result.code === "not_found" ? "This enquiry is no longer available." : "Enquiries could not be loaded." }, { status: result.code === "not_found" ? 404 : 503, headers: NO_STORE });
    return NextResponse.json({ record: result.data }, { headers: NO_STORE });
}
