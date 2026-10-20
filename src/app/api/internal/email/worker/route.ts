import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createBrevoClient } from "@/lib/email/brevo";
import { readTransactionalEmailConfig, readWorkerSecret } from "@/lib/email/config";
import { createEmailOutboxRepository } from "@/lib/email/outbox-repository";
import { bearerMatches } from "@/lib/email/webhook";
import { runEmailWorker } from "@/lib/email/worker";

/**
 * Protected transactional outbox worker.
 *
 * POST for a manual/scheduled invocation; GET is also accepted because some
 * schedulers (including Vercel Cron) invoke with GET. Both are protected by the
 * same strong server-only bearer secret and perform only a fixed, bounded batch.
 * No request body, recipient, template, payload or state is accepted from the
 * caller.
 *
 * This endpoint drains due rows. It is intentionally not a public API and is not
 * reachable without the secret. Scheduling is documented in the sprint report;
 * this sprint does not deploy a scheduler.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function handle(request: NextRequest) {
  const secret = readWorkerSecret();
  if (!secret.ok) return json({ ok: false, code: "not_configured" }, 503);

  if (!bearerMatches(request.headers.get("authorization"), secret.secret)) {
    return json({ ok: false, code: "unauthorized" }, 401);
  }

  const config = readTransactionalEmailConfig();
  if (!config.ok) {
    return json(
      {
        ok: false,
        code: config.reason === "disabled" ? "email_disabled" : config.reason,
      },
      503,
    );
  }

  const repository = createEmailOutboxRepository();
  const provider = createBrevoClient({
    apiKey: config.config.apiKey,
    senderEmail: config.config.senderEmail,
    senderName: config.config.senderName,
  });

  const summary = await runEmailWorker(
    {
      enabled: true,
      repository,
      provider,
      siteUrl: config.config.siteUrl,
      templateIds: config.config.templateIds,
    },
    { workerId: `api-${randomUUID()}` },
  );

  if (!summary.ok) {
    return json({ ok: false, code: summary.error }, 503);
  }

  return json({
    ok: true,
    enabled: summary.enabled,
    reaped: summary.reaped,
    claimed: summary.claimed,
    sent: summary.sent,
    retried: summary.retried,
    dead: summary.dead,
    skipped: summary.skipped,
    failed: summary.failed,
    durationMs: summary.durationMs,
  });
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
