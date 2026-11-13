/**
 * Rate-limiter mode selection shared by the public form limiters.
 *
 * Pure (no Supabase / `server-only` import) so it can be unit tested.
 *
 *   * `memory` is honoured only outside production (local development, tests):
 *     in-process counters are per serverless instance and offer no real
 *     protection on Vercel;
 *   * `database` always selects the shared limiter;
 *   * otherwise demo mode uses memory and everything else the database.
 */
export type RateLimitMode = "memory" | "database";

export function resolveRateLimitMode(input: {
  mode: string | undefined;
  nodeEnv: string | undefined;
  demo: boolean;
}): RateLimitMode {
  const mode = (input.mode ?? "").trim().toLowerCase();
  if (mode === "memory" && input.nodeEnv !== "production") return "memory";
  if (mode === "database") return "database";
  return input.demo ? "memory" : "database";
}
