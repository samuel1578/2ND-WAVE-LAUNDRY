import { NextResponse } from "next/server";
import { demoMode } from "@/lib/demo-mode";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { loadPublishedReviews } from "@/lib/reviews/public-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Public published-review list (Sprint 3C).
 *
 * No authentication: this is the same content any visitor may see on
 * `/reviews`. It reads the `security_invoker` view, whose base-table policy
 * exposes only approved, consented, published rows, and it projects that data
 * through the `PublicReview` whitelist. Pending or rejected reviews, the
 * original submission, moderation notes, source-IP hashes and reply drafts are
 * never selected, so they cannot appear in this payload.
 *
 * Failures return an empty list — never sample data, diagnostics or database
 * text. `no-store` keeps an unpublish effective immediately.
 */
export async function GET() {
  if (demoMode || !isSupabaseConfigured)
    return NextResponse.json({ reviews: [] }, { headers: NO_STORE });

  const result = await loadPublishedReviews();
  if (!result.ok) {
    // Diagnostic only: a stable code and no row data.
    console.warn(`[reviews] public list unavailable code=${result.code}`);
    return NextResponse.json({ reviews: [] }, { headers: NO_STORE });
  }

  return NextResponse.json({ reviews: result.reviews }, { headers: NO_STORE });
}

export async function POST() {
  return NextResponse.json(
    { ok: false, code: "method_not_allowed", message: "Use GET to read published reviews." },
    { status: 405, headers: { ...NO_STORE, Allow: "GET" } },
  );
}
