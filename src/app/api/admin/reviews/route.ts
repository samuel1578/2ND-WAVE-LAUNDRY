import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/admin";
import { hasPermission } from "@/lib/auth/permissions";
import {
  getAdminReview,
  listAdminReviews,
  loadReviewOperationsSummary,
} from "@/lib/reviews/admin-service";
import { normaliseReviewListQuery } from "@/lib/reviews/admin";
import { reviewErrorStatus, type ReviewErrorCode } from "@/lib/reviews/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

/**
 * Administrator review read endpoint (Sprint 3B).
 *
 * Authorisation comes from the caller's verified session plus the database
 * profile — never from the request — and the same `reviews.read` capability that
 * gates `/admin/reviews` gates this endpoint, so an unauthorised caller receives
 * 401/403 before any query runs. The queries then run under row level security
 * with the caller's own client.
 *
 *   GET /api/admin/reviews                 → one filtered page of submissions
 *   GET /api/admin/reviews?id=<uuid>       → one review with its audit history
 *   GET /api/admin/reviews?view=summary    → dashboard counters
 *
 * Nothing here returns an IP hash, an idempotency key, a raw database message or
 * a draft reply.
 */
export async function GET(request: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin)
    return NextResponse.json(
      { code: "actor_required", message: "Sign in with an administrator account." },
      { status: 401, headers: NO_STORE },
    );

  if (!hasPermission(admin.role, "reviews.read"))
    return NextResponse.json(
      {
        code: "permission_denied",
        message: "Your administrator role does not include reviews.",
      },
      { status: 403, headers: NO_STORE },
    );

  const params = request.nextUrl.searchParams;

  const id = params.get("id");
  if (id) {
    const detail = await getAdminReview(id);
    if (!detail.ok) return errorResponse(detail.code);
    return NextResponse.json({ review: detail.data }, { headers: NO_STORE });
  }

  if (params.get("view") === "summary") {
    const summary = await loadReviewOperationsSummary();
    if (!summary.ok) return errorResponse(summary.code);
    return NextResponse.json(summary.data, { headers: NO_STORE });
  }

  const query = normaliseReviewListQuery({
    search: params.get("search") ?? undefined,
    status: params.get("status") ?? undefined,
    branch: params.get("branch") ?? undefined,
    rating: params.get("rating") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });

  const page = await listAdminReviews(query);
  if (!page.ok) return errorResponse(page.code);

  return NextResponse.json(
    {
      rows: page.data.rows,
      total: page.data.total,
      page: page.data.page,
      pageSize: page.data.pageSize,
      // Display-only echo of a capability already enforced above.
      canOverride: hasPermission(admin.role, "reviews.override"),
    },
    { headers: NO_STORE },
  );
}

function errorResponse(code: ReviewErrorCode) {
  return NextResponse.json(
    { code, message: messages[code] ?? messages.conflict },
    { status: reviewErrorStatus(code), headers: NO_STORE },
  );
}

/** Short, safe messages for the read path; richer copy lives in the UI. */
const messages: Partial<Record<ReviewErrorCode, string>> = {
  not_found: "This review is no longer available.",
  permission_denied: "Your administrator role does not allow this action.",
  actor_required: "Sign in with an administrator account.",
  not_configured: "Review operations are not configured for this environment.",
  conflict: "Reviews could not be loaded. Please try again.",
  storage_unavailable: "Reviews could not be loaded. Please try again.",
};
