import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  bearerMatches,
  handleBrevoWebhook,
  normaliseEvent,
  outboxIdFromCustomHeader,
  secureSecretEqual,
  type BrevoDeliveryRecord,
  type BrevoWebhookRepository,
} from "../src/lib/email/webhook";

/**
 * Sprint 2D.2 webhook tests.
 *
 * No network and no database: the repository is in-memory. The secret handling
 * and payload minimisation are the properties under test.
 */

const SECRET = `webhook-${"s".repeat(48)}`;
const OUTBOX_ID = "6d9f9b1e-9d1a-4d4c-9f6e-2b6f1e8f3a21";

type Recorded = { records: BrevoDeliveryRecord[]; lookups: number };

function repository(
  options: {
    outboxId?: string | null;
    outcome?: "recorded" | "duplicate";
    throws?: boolean;
  } = {},
): { repository: BrevoWebhookRepository; calls: Recorded } {
  const records: BrevoDeliveryRecord[] = [];
  const calls: Recorded = { records, lookups: 0 };

  return {
    calls,
    repository: {
      async findOutboxId() {
        calls.lookups += 1;
        if (options.throws) throw new Error("db offline");
        return options.outboxId === undefined ? OUTBOX_ID : options.outboxId;
      },
      async record(input) {
        if (options.throws) throw new Error("db offline");
        records.push(input);
        return options.outcome ?? "recorded";
      },
    },
  };
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "delivered",
    email: "customer@example.test",
    id: 123,
    "message-id": "<provider-1@relay>",
    ts: 1_800_000_000,
    ts_event: 1_800_000_001,
    ts_epoch: 1_800_000_001_000,
    subject: "Private subject",
    reason: "ignored by Brevo for delivered",
    tag: '["booking_transactional"]',
    sending_ip: "192.0.2.1",
    ...overrides,
  });
}

function input(overrides: Partial<Parameters<typeof handleBrevoWebhook>[0]> = {}) {
  return {
    method: "POST",
    authorization: `Bearer ${SECRET}`,
    contentType: "application/json; charset=utf-8",
    bodyText: body(),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Authentication primitives                                                  */
/* -------------------------------------------------------------------------- */

test("secret comparison is exact and bearer parsing is case-insensitive", () => {
  assert.equal(secureSecretEqual(SECRET, SECRET), true);
  assert.equal(secureSecretEqual(SECRET, `${SECRET}x`), false);
  assert.equal(secureSecretEqual("", SECRET), false);

  assert.equal(bearerMatches(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(bearerMatches(`bearer   ${SECRET}  `, SECRET), true);
  assert.equal(bearerMatches(SECRET, SECRET), true);
  assert.equal(bearerMatches(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(bearerMatches(null, SECRET), false);
});

test("only supported events are normalised", () => {
  assert.equal(normaliseEvent("delivered"), "delivered");
  assert.equal(normaliseEvent("Deferred"), "deferred");
  assert.equal(normaliseEvent("soft_bounce"), "bounced");
  assert.equal(normaliseEvent("hard_bounce"), "bounced");
  assert.equal(normaliseEvent("spam"), "complained");
  assert.equal(normaliseEvent("opened"), null);
  assert.equal(normaliseEvent("clicked"), null);
  assert.equal(normaliseEvent(42), null);
});

test("the outbox correlation header requires the exact opaque shape", () => {
  assert.equal(
    outboxIdFromCustomHeader(`2ndwave-outbox:${OUTBOX_ID}`),
    OUTBOX_ID,
  );
  assert.equal(outboxIdFromCustomHeader(`2NDWAVE-OUTBOX:${OUTBOX_ID}`), OUTBOX_ID);
  assert.equal(outboxIdFromCustomHeader(`other:${OUTBOX_ID}`), null);
  assert.equal(outboxIdFromCustomHeader("2ndwave-outbox:not-a-uuid"), null);
  assert.equal(outboxIdFromCustomHeader(null), null);
});

/* -------------------------------------------------------------------------- */
/* Request gate                                                               */
/* -------------------------------------------------------------------------- */

test("non-POST methods are rejected before authentication", async () => {
  const { repository: repo, calls } = repository();
  const result = await handleBrevoWebhook(input({ method: "GET" }), {
    secret: SECRET,
    repository: repo,
  });
  assert.equal(result.status, 405);
  assert.equal(calls.lookups, 0);
});

test("an unconfigured webhook fails closed", async () => {
  const { repository: repo } = repository();
  const result = await handleBrevoWebhook(input(), {
    secret: null,
    repository: repo,
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "not_configured");
});

test("a forged or missing bearer token is rejected", async () => {
  const { repository: repo, calls } = repository();

  for (const authorization of [null, "", "Bearer wrong", `Basic ${SECRET}`]) {
    const result = await handleBrevoWebhook(input({ authorization }), {
      secret: SECRET,
      repository: repo,
    });
    assert.equal(result.status, 401, String(authorization));
    assert.equal(result.body.code, "unauthorized");
  }

  assert.equal(calls.lookups, 0);
});

test("non-JSON, oversized and malformed payloads are rejected", async () => {
  const { repository: repo, calls } = repository();

  const wrongType = await handleBrevoWebhook(
    input({ contentType: "text/plain" }),
    { secret: SECRET, repository: repo },
  );
  assert.equal(wrongType.status, 415);

  const tooLarge = await handleBrevoWebhook(
    input({ bodyText: "x".repeat(17 * 1024) }),
    { secret: SECRET, repository: repo },
  );
  assert.equal(tooLarge.status, 413);

  const malformed = await handleBrevoWebhook(input({ bodyText: "{not json" }), {
    secret: SECRET,
    repository: repo,
  });
  assert.equal(malformed.status, 400);

  const notObject = await handleBrevoWebhook(input({ bodyText: "[]" }), {
    secret: SECRET,
    repository: repo,
  });
  assert.equal(notObject.status, 400);

  const noIdentity = await handleBrevoWebhook(
    input({ bodyText: body({ "message-id": undefined }) }),
    { secret: SECRET, repository: repo },
  );
  assert.equal(noIdentity.status, 400);

  assert.equal(calls.lookups, 0);
});

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

test("a delivered event stores only the minimum fields", async () => {
  const { repository: repo, calls } = repository();
  const result = await handleBrevoWebhook(input(), {
    secret: SECRET,
    repository: repo,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.duplicate, false);
  assert.equal(calls.records.length, 1);

  const record = calls.records[0];
  assert.deepEqual(Object.keys(record).sort(), [
    "dedupeKey",
    "event",
    "outboxId",
    "providerEventAt",
    "reason",
  ]);
  assert.equal(record.outboxId, OUTBOX_ID);
  assert.equal(record.event, "delivered");
  assert.equal(record.reason, null);
  assert.equal(record.providerEventAt, "2027-01-15T08:00:01.000Z");
  assert.match(record.dedupeKey, /^[0-9a-f]{64}$/);
  assert.equal(
    record.dedupeKey,
    createHash("sha256")
      .update(
        ["<provider-1@relay>", "delivered", "2027-01-15T08:00:01.000Z"].join(
          "|",
        ),
      )
      .digest("hex"),
  );

  const serialised = JSON.stringify(record);
  assert.ok(!serialised.includes("customer@example.test"));
  assert.ok(!serialised.includes("Private subject"));
  assert.ok(!serialised.includes("192.0.2.1"));
});

test("a hard bounce is normalised and its reason is sanitised", async () => {
  const { repository: repo, calls } = repository();
  const result = await handleBrevoWebhook(
    input({
      bodyText: body({
        event: "hard_bounce",
        reason: "Mailbox  full\n\n" + "x".repeat(400),
      }),
    }),
    { secret: SECRET, repository: repo },
  );

  assert.equal(result.status, 200);
  assert.equal(calls.records[0].event, "bounced");
  assert.equal(calls.records[0].reason?.includes("\n"), false);
  assert.equal(calls.records[0].reason?.length, 200);
});

test("unused events are acknowledged without persistence", async () => {
  const { repository: repo, calls } = repository();
  const result = await handleBrevoWebhook(
    input({ bodyText: body({ event: "opened" }) }),
    { secret: SECRET, repository: repo },
  );

  assert.equal(result.status, 200);
  assert.equal(result.body.ignored, true);
  assert.equal(calls.lookups, 0);
  assert.equal(calls.records.length, 0);
});

test("an unknown provider message is acknowledged without leaking existence", async () => {
  const { repository: repo, calls } = repository({ outboxId: null });
  const result = await handleBrevoWebhook(input(), {
    secret: SECRET,
    repository: repo,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ignored, true);
  assert.equal(calls.records.length, 0);
});

test("a webhook that arrives before mark_sent resolves by correlation header", async () => {
  const { repository: repo, calls } = repository();
  const result = await handleBrevoWebhook(
    input({
      bodyText: body({
        "message-id": undefined,
        "X-Mailin-custom": `2ndwave-outbox:${OUTBOX_ID}`,
      }),
    }),
    { secret: SECRET, repository: repo },
  );

  assert.equal(result.status, 200);
  assert.equal(calls.records[0].outboxId, OUTBOX_ID);
});

test("the dedupe identity prefers the provider id and survives header variation", async () => {
  const { repository: repo, calls } = repository();
  await handleBrevoWebhook(input(), { secret: SECRET, repository: repo });
  await handleBrevoWebhook(
    input({
      bodyText: body({ "X-Mailin-custom": `2ndwave-outbox:${OUTBOX_ID}` }),
    }),
    { secret: SECRET, repository: repo },
  );

  assert.equal(calls.records.length, 2);
  assert.equal(calls.records[0].dedupeKey, calls.records[1].dedupeKey);
});

test("a replay is reported as a duplicate and stored once", async () => {
  const { repository: repo, calls } = repository({ outcome: "duplicate" });
  const result = await handleBrevoWebhook(input(), {
    secret: SECRET,
    repository: repo,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.duplicate, true);
  // The repository is the deduplication authority; the handler does not write
  // twice itself.
  assert.equal(calls.records.length, 1);
});

test("a repository outage returns 503 so Brevo retries", async () => {
  const { repository: repo } = repository({ throws: true });
  const result = await handleBrevoWebhook(input(), {
    secret: SECRET,
    repository: repo,
  });

  assert.equal(result.status, 503);
  assert.equal(result.body.ok, false);
});

test("no response body contains a secret or provider detail", async () => {
  const { repository: repo } = repository();
  const result = await handleBrevoWebhook(input(), {
    secret: SECRET,
    repository: repo,
  });

  assert.deepEqual(result.body, { ok: true, duplicate: false });
  assert.ok(!JSON.stringify(result.body).includes(SECRET));
});
