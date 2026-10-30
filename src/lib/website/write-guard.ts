import { headers } from "next/headers";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const DISABLED_STATUS = 503;

export class WebsiteWriteError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 503,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "WebsiteWriteError";
  }
}

export async function assertWebsiteWritesEnabled(): Promise<void> {
  const requestHeaders = await headers();
  console.info("[website-write]", {
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
    vercelId: requestHeaders.get("x-vercel-id") ?? "unknown",
  });
  if (process.env.WEBSITE_CONTENT_WRITES_DISABLED === "true") {
    throw new WebsiteWriteError(
      "Website content writes are temporarily disabled.",
      DISABLED_STATUS,
    );
  }
}

export function consumeWebsiteWrite(userId: string): void {
  const result = consumeRateLimit("website_content", userId);
  if (!result.ok) {
    throw new WebsiteWriteError(
      "Too many website content writes. Wait before trying again.",
      429,
      result.retryAfterSeconds,
    );
  }
}
