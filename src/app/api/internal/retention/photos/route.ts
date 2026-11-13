import { NextResponse, type NextRequest } from "next/server";
import {
  authorizeInternalJobRequest,
  isDryRunRequest,
  RetentionStepError,
} from "@/lib/retention/booking-photos-core";
import { runBookingPhotoRetention } from "@/lib/retention/booking-photos";
import { isElevatedConfigured, SupabaseElevatedConfigError } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Protected booking photo retention job (90-day deletion).
 *
 * Invoked daily by Vercel Cron (GET, see vercel.json) and manually with POST or
 * GET. It uses the same bearer secrets as the email worker (`CRON_SECRET` or
 * `EMAIL_WORKER_SECRET`, constant-time comparison). `?dry_run=1` only counts
 * what is due and which orphaned objects exist; nothing is deleted and no job
 * row is written. The response contains counts only: never keys or customer data.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The job stops itself after a 45 s budget; allow time to record the outcome.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function handle(request: NextRequest) {
  const access = authorizeInternalJobRequest(request.headers.get("authorization"));
  if (access === "not_configured") return json({ ok: false, code: "not_configured" }, 503);
  if (access !== "ok") return json({ ok: false, code: "unauthorized" }, 401);

  if (!isSupabaseConfigured || !isElevatedConfigured)
    return json({ ok: false, code: "storage_not_configured" }, 503);

  const dryRun = isDryRunRequest(request.nextUrl.searchParams.get("dry_run"));

  try {
    const summary = await runBookingPhotoRetention({ dryRun });
    return json({ ok: summary.outcome !== "failed", ...summary });
  } catch (cause) {
    if (cause instanceof SupabaseElevatedConfigError)
      return json({ ok: false, code: "storage_not_configured" }, 503);
    const code = cause instanceof RetentionStepError ? cause.code : "unavailable";
    console.warn(`[retention] booking photos run failed code=${code}`);
    return json({ ok: false, code }, 503);
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function PUT() {
  return json({ ok: false, code: "method_not_allowed" }, 405);
}

export async function PATCH() {
  return json({ ok: false, code: "method_not_allowed" }, 405);
}

export async function DELETE() {
  return json({ ok: false, code: "method_not_allowed" }, 405);
}
