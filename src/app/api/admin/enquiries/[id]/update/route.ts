import { NextResponse, type NextRequest } from "next/server";
import { updateLiveEnquiry } from "@/lib/enquiries/admin-actions";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ message: "Invalid update." }, { status: 400, headers: NO_STORE }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ message: "Invalid update." }, { status: 400, headers: NO_STORE });
    const value = body as Record<string, unknown>;
    const result = await updateLiveEnquiry(id, Number(value.expectedVersion), {
        ...(typeof value.status === "string" ? { status: value.status as "new" | "contacted" | "closed" } : {}),
        ...(typeof value.note === "string" ? { note: value.note } : {}),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : result.conflict ? 409 : 400, headers: NO_STORE });
}
