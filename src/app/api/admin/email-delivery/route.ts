import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import {
  canManageEmailDelivery,
  normaliseEmailMonitoringQuery,
} from "@/lib/email/monitoring";
import {
  listEmailMonitoring,
} from "@/lib/email/monitoring-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin)
    return NextResponse.json(
      { code: "unauthenticated", message: "Sign in with an administrator account." },
      { status: 401, headers: NO_STORE },
    );

  if (!canManageEmailDelivery(admin.role))
    return NextResponse.json(
      { code: "permission_denied", message: "Your administrator role cannot view email delivery." },
      { status: 403, headers: NO_STORE },
    );

  try {
    const params = request.nextUrl.searchParams;
    const page = await listEmailMonitoring(
      normaliseEmailMonitoringQuery({
        status: params.get("status"),
        eventType: params.get("eventType"),
        bookingId: params.get("bookingId"),
        page: params.get("page"),
        pageSize: params.get("pageSize"),
      }),
    );
    return NextResponse.json(page, { headers: NO_STORE });
  } catch {
    return NextResponse.json(
      { code: "email_monitoring_unavailable", message: "Email delivery information is unavailable." },
      { status: 503, headers: NO_STORE },
    );
  }
}
