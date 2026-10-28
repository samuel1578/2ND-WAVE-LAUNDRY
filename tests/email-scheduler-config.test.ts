import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BREVO_API_KEY_VAR,
  EMAIL_WORKER_SECRET_VAR,
  SITE_URL_VAR,
  TRANSACTIONAL_EMAILS_ENABLED_VAR,
  VERCEL_CRON_SECRET_VAR,
  BREVO_TEMPLATE_ID_VARS,
  readEmailOperationalConfiguration,
} from "../src/lib/email/config";

test("Vercel Cron schedules the internal worker hourly", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  assert.deepEqual(vercel.crons, [{ path: "/api/internal/email/worker", schedule: "0 * * * *" }]);
  const worker = readFileSync("src/app/api/internal/email/worker/route.ts", "utf8");
  assert.match(worker, /readVercelCronSecret\(\)/);
  assert.match(worker, /readWorkerSecret\(\)/);
  assert.match(worker, /bearerMatches\(authorization/);
});

test("the operator configuration shows secret presence only and identifies missing template IDs", () => {
  const secret = `cron-${"c".repeat(40)}`;
  const config = readEmailOperationalConfiguration({
    [TRANSACTIONAL_EMAILS_ENABLED_VAR]: "true",
    [BREVO_API_KEY_VAR]: `xkeysib-${"a".repeat(40)}`,
    [SITE_URL_VAR]: "https://2ndwave.example",
    [EMAIL_WORKER_SECRET_VAR]: `worker-${"w".repeat(40)}`,
    [VERCEL_CRON_SECRET_VAR]: secret,
    [BREVO_TEMPLATE_ID_VARS.booking_created]: "101",
  });
  assert.equal(config.cronSecretConfigured, true);
  assert.equal(config.workerSecretConfigured, true);
  assert.equal(config.templates.find((item) => item.template === "booking_created")?.status, "configured");
  assert.equal(config.templates.find((item) => item.template === "booking_confirmed")?.status, "missing");
  assert.equal(JSON.stringify(config).includes(secret), false);
  assert.equal(JSON.stringify(config).includes(`xkeysib-${"a".repeat(40)}`), false);
});
