"use server";
import { headers } from "next/headers";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import { checkRequestOrigin } from "@/lib/security/request-origin";
import { consumeWebsiteWrite, assertWebsiteWritesEnabled } from "@/lib/website/write-guard";
import { getEnquiry, updateEnquiry } from "./repository";

export type EnquiryUpdateResult = { ok: true; version: number } | { ok: false; message: string; conflict?: boolean };
export async function updateLiveEnquiry(id: string, expectedVersion: number, update: { status?: "new" | "contacted" | "closed"; note?: string }): Promise<EnquiryUpdateResult> {
    await assertWebsiteWritesEnabled();
    const admin = await getCurrentAdmin();
    if (!admin) return { ok: false, message: "Sign in with an administrator account." };
    if (!hasPermission(admin.role, "enquiries.manage")) return { ok: false, message: "Your administrator role does not allow this action." };
    const requestHeaders = await headers();
    const origin = checkRequestOrigin({ origin: requestHeaders.get("origin"), host: requestHeaders.get("host"), forwardedHost: requestHeaders.get("x-forwarded-host"), siteUrl: process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null });
    if (!origin.ok) return { ok: false, message: "This request could not be verified." };
    consumeWebsiteWrite(admin.userId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
        return { ok: false, message: "This enquiry could not be updated. Reload and try again." };
    if (update.status !== undefined && !["new", "contacted", "closed"].includes(update.status))
        return { ok: false, message: "Choose a valid enquiry status." };
    const note = update.note?.trim();
    if (update.note !== undefined && (!note || note.length > 4000))
        return { ok: false, message: "Enter a note of 1 to 4,000 characters." };
    if (update.status === undefined && note === undefined)
        return { ok: false, message: "Choose an update or enter a note." };

    const result = await updateEnquiry({ id, expectedVersion, status: update.status, note, actorUserId: admin.userId, correlationId: crypto.randomUUID() });
    if (!result.ok) {
        if (result.code === "conflict") return { ok: false, conflict: true, message: "This enquiry was updated by someone else. Reload and try again." };
        if (result.code === "not_found") return { ok: false, message: "This enquiry is no longer available." };
        if (result.code === "invalid_status") return { ok: false, message: "Choose a valid enquiry status." };
        if (result.code === "invalid_note") return { ok: false, message: "Enter a note of 1 to 4,000 characters." };
        return { ok: false, message: "This enquiry could not be updated. Reload and try again." };
    }
    return { ok: true, version: result.data.version };
}
export async function fetchLiveEnquiry(id: string) {
    const admin = await getCurrentAdmin();
    if (!admin) return { ok: false as const, message: "Sign in with an administrator account." };
    if (!hasPermission(admin.role, "enquiries.manage"))
        return { ok: false as const, message: "Your administrator role does not allow this action." };
    const result = await getEnquiry(id);
    return result.ok ? { ok: true as const, record: result.data } : { ok: false as const, message: result.code === "not_found" ? "This enquiry is no longer available." : "Enquiries could not be loaded. Reload and try again." };
}
