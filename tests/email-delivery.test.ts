import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  BREVO_API_KEY_VAR,
  BREVO_SENDER_EMAIL_VAR,
  BREVO_SENDER_NAME_VAR,
  BREVO_TEMPLATE_ID_VARS,
  BREVO_WEBHOOK_SECRET_VAR,
  EMAIL_WORKER_SECRET_VAR,
  SITE_URL_VAR,
  TRANSACTIONAL_EMAILS_ENABLED_VAR,
  readBrevoWebhookConfig,
  readSiteUrl,
  readTransactionalEmailConfig,
  readWorkerSecret,
} from "../src/lib/email/config";
import {
  formatFee,
  buildBrevoTemplateParams,
  type BookingEmailContext,
  type EmailTemplate,
} from "../src/lib/email/templates";
import { createBrevoClient, type BrevoSendResult } from "../src/lib/email/brevo";
import {
  retryDelaySeconds,
  runEmailWorker,
  type EmailWorkerDeps,
} from "../src/lib/email/worker";
import type {
  ClaimedOutboxEmail,
  EmailOutboxRepository,
} from "../src/lib/email/outbox-repository";

/**
 * Sprint 2D.2 delivery-layer tests.
 *
 * These use mocked providers and repositories only. No network request reaches
 * Brevo, no email is sent and no customer address is used.
 */

const VALID_ENV = {
  [TRANSACTIONAL_EMAILS_ENABLED_VAR]: "true",
  [BREVO_API_KEY_VAR]: `xkeysib-${"a".repeat(40)}`,
  [BREVO_SENDER_EMAIL_VAR]: "bookings@2ndwave.example",
  [BREVO_SENDER_NAME_VAR]: "2nd Wave Laundry Services",
  [SITE_URL_VAR]: "https://2ndwave.example",
  [EMAIL_WORKER_SECRET_VAR]: `worker-${"w".repeat(40)}`,
  [BREVO_WEBHOOK_SECRET_VAR]: `webhook-${"h".repeat(40)}`,
  [BREVO_TEMPLATE_ID_VARS.booking_created]: "101",
  [BREVO_TEMPLATE_ID_VARS.booking_confirmed]: "102",
  [BREVO_TEMPLATE_ID_VARS.booking_processing_started]: "103",
  [BREVO_TEMPLATE_ID_VARS.booking_ready]: "104",
  [BREVO_TEMPLATE_ID_VARS.booking_completed]: "105",
  [BREVO_TEMPLATE_ID_VARS.booking_cancelled]: "106",
};

const CONTEXT: BookingEmailContext = {
  reference: "2W-7K3M9PQRST",
  customerName: "Ama Mensah",
  serviceTitles: ["Wash, iron & fold"],
  requestedDate: "2099-01-01",
  requestedTime: "09:00",
  agreedPickupAt: "2099-01-01T09:00:00.000Z",
  agreedFee: 50,
  currency: "GHS",
  branch: { title: "Ashaiman–Atadeka" },
};

const ALL_TEMPLATES: EmailTemplate[] = [
  "booking_created",
  "booking_confirmed",
  "booking_processing_started",
  "booking_ready",
  "booking_completed",
  "booking_cancelled",
];

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

test("transactional email is disabled by default and never sends", () => {
  assert.deepEqual(readTransactionalEmailConfig({}), {
    ok: false,
    enabled: false,
    reason: "disabled",
  });
  assert.equal(
    readTransactionalEmailConfig({
      ...VALID_ENV,
      [TRANSACTIONAL_EMAILS_ENABLED_VAR]: "false",
    }).ok,
    false,
  );
});

test("enabled configuration fails closed on each missing or invalid value", () => {
  const cases: Array<[string, string, string]> = [
    [BREVO_API_KEY_VAR, "", "missing-api-key"],
    [BREVO_API_KEY_VAR, "short", "invalid-api-key"],
    [BREVO_SENDER_EMAIL_VAR, "", "missing-sender-email"],
    [BREVO_SENDER_EMAIL_VAR, "not-an-address", "invalid-sender-email"],
    [BREVO_SENDER_NAME_VAR, "", "invalid-sender-name"],
    [SITE_URL_VAR, "", "missing-site-url"],
    [SITE_URL_VAR, "http://example.com", "invalid-site-url"],
    [EMAIL_WORKER_SECRET_VAR, "", "missing-worker-secret"],
    [EMAIL_WORKER_SECRET_VAR, "too-short", "invalid-worker-secret"],
  ];

  for (const [key, value, reason] of cases) {
    const result = readTransactionalEmailConfig({ ...VALID_ENV, [key]: value });
    assert.equal(result.ok, false, key);
    if (!result.ok) assert.equal(result.reason, reason, key);
  }

  for (const variable of Object.values(BREVO_TEMPLATE_ID_VARS)) {
    for (const [value, reason] of [
      ["", "missing-template-id"],
      ["0", "invalid-template-id"],
      ["1.5", "invalid-template-id"],
      ["https://example.test", "invalid-template-id"],
    ] as const) {
      const result = readTransactionalEmailConfig({
        ...VALID_ENV,
        [variable]: value,
      });
      assert.equal(result.ok, false, variable);
      if (!result.ok) {
        assert.equal(result.reason, reason, variable);
        assert.equal(result.templateVariable, variable);
      }
    }
  }

  const duplicateIds = {
    ...VALID_ENV,
    [BREVO_TEMPLATE_ID_VARS.booking_confirmed]:
      VALID_ENV[BREVO_TEMPLATE_ID_VARS.booking_created],
  };
  const duplicateResult = readTransactionalEmailConfig(duplicateIds);
  assert.equal(duplicateResult.ok, false);
  if (!duplicateResult.ok) {
    assert.equal(duplicateResult.reason, "invalid-template-id");
    assert.equal(
      duplicateResult.templateVariable,
      BREVO_TEMPLATE_ID_VARS.booking_confirmed,
    );
  }
});

test("a complete enabled configuration is accepted", () => {
  const result = readTransactionalEmailConfig(VALID_ENV);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.config.senderEmail, "bookings@2ndwave.example");
  assert.equal(result.config.siteUrl, "https://2ndwave.example");
  assert.equal(result.config.apiKey, VALID_ENV[BREVO_API_KEY_VAR]);
  assert.deepEqual(result.config.templateIds, {
    booking_created: 101,
    booking_confirmed: 102,
    booking_processing_started: 103,
    booking_ready: 104,
    booking_completed: 105,
    booking_cancelled: 106,
  });
});

test("each approved event maps to its own configured saved template id", () => {
  const result = readTransactionalEmailConfig(VALID_ENV);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    ALL_TEMPLATES.map((template) => result.config.templateIds[template]),
    [101, 102, 103, 104, 105, 106],
  );
});

test("saved-template parameters use persisted values and matching public headers", () => {
  const params = buildBrevoTemplateParams("booking_confirmed", CONTEXT, {
    siteUrl: "https://2ndwave.example",
  });
  assert.deepEqual(params, {
    customerName: "Ama Mensah",
    bookingReference: CONTEXT.reference,
    bookingStatus: "Confirmed",
    websiteUrl: "https://2ndwave.example",
    contactUrl: "https://2ndwave.example/contact",
    privacyUrl: "https://2ndwave.example/privacy",
    headerImageUrl: "https://2ndwave.example/headers/booking-confirmed.png",
    headerImageAlt: "2nd Wave Laundry booking confirmed",
    serviceSummary: "Wash, iron & fold",
    requestedPickup: "Thursday, 1 January 2099 at 09:00",
    agreedPickup: "Thursday, 1 January 2099 at 09:00 GMT",
    branchName: "Ashaiman–Atadeka",
    confirmedFee: "GHS 50.00",
  });
  assert.equal(
    buildBrevoTemplateParams("booking_created", CONTEXT, {
      siteUrl: "https://2ndwave.example",
    }).bookingStatus,
    "Pending confirmation",
  );
  assert.equal(
    buildBrevoTemplateParams("booking_cancelled", CONTEXT, {
      siteUrl: "https://2ndwave.example",
    }).cancellationReason,
    undefined,
  );
});

test("site URLs allow https and loopback only, without paths or credentials", () => {
  assert.equal(readSiteUrl("https://2ndwave.example"), "https://2ndwave.example");
  assert.equal(readSiteUrl("https://2ndwave.example/"), "https://2ndwave.example");
  assert.equal(readSiteUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(readSiteUrl("http://example.com"), null);
  assert.equal(readSiteUrl("https://user:pass@example.com"), null);
  assert.equal(readSiteUrl("https://example.com/path"), null);
  assert.equal(readSiteUrl("not a url"), null);
});

test("worker and webhook secrets are validated independently", () => {
  assert.equal(readWorkerSecret({}).ok, false);
  assert.equal(
    readWorkerSecret({ [EMAIL_WORKER_SECRET_VAR]: "short" }).ok,
    false,
  );
  assert.equal(readWorkerSecret(VALID_ENV).ok, true);
  assert.equal(readBrevoWebhookConfig({}).ok, false);
  assert.equal(
    readBrevoWebhookConfig({ [BREVO_WEBHOOK_SECRET_VAR]: "short" }).ok,
    false,
  );
  assert.equal(readBrevoWebhookConfig(VALID_ENV).ok, true);
});

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

test("all six saved template events have exact configured parameters and public image URLs", () => {
  const urls = [
    "general-booking.png",
    "booking-confirmed.png",
    "processing-started.png",
    "laundry-ready.png",
    "general-booking.png",
    "general-booking.png",
  ];
  ALL_TEMPLATES.forEach((template, index) => {
    const params = buildBrevoTemplateParams(template, CONTEXT, {
      siteUrl: "https://2ndwave.example",
    });
    assert.equal(params.bookingReference, CONTEXT.reference, template);
    assert.equal(params.headerImageUrl, `https://2ndwave.example/headers/${urls[index]}`);
    assert.equal(params.headerImageAlt.length > 0, true);
    assert.equal(params.contactUrl, "https://2ndwave.example/contact");
    assert.equal(params.privacyUrl, "https://2ndwave.example/privacy");
    assert.equal(params.serviceSummary, "Wash, iron & fold");
  });
  assert.equal(
    buildBrevoTemplateParams("booking_created", CONTEXT, {
      siteUrl: "https://2ndwave.example",
    }).bookingStatus,
    "Pending confirmation",
  );
});

test("confirmed parameters contain persisted branch, agreed pickup and fee", () => {
  const params = buildBrevoTemplateParams("booking_confirmed", CONTEXT, {
    siteUrl: "https://2ndwave.example",
  });
  assert.equal(params.branchName, "Ashaiman–Atadeka");
  assert.match(params.agreedPickup, /09:00/);
  assert.equal(params.confirmedFee, "GHS 50.00");
  assert.match(params.requestedPickup, /09:00/);
});

test("ready template receives status and safe header alt text without delivery promises", () => {
  const params = buildBrevoTemplateParams("booking_ready", CONTEXT, {
    siteUrl: "https://2ndwave.example",
  });
  assert.equal(params.bookingStatus, "Ready");
  assert.match(params.headerImageAlt, /collection or delivery/i);
});

test("cancellation parameters do not include internal cancellation reason or notes", () => {
  const params = buildBrevoTemplateParams("booking_cancelled", CONTEXT, {
    siteUrl: "https://2ndwave.example",
  });
  assert.equal(params.bookingStatus, "Cancelled");
  assert.equal("cancellationReason" in params, false);
  assert.equal("customerNotes" in params, false);
});

test("fee formatting omits an absent fee instead of inventing one", () => {
  assert.equal(formatFee(50, "GHS"), "GHS 50.00");
  assert.equal(formatFee(null, "GHS"), null);
  assert.equal(formatFee(Number.NaN, "GHS"), null);
});

/* -------------------------------------------------------------------------- */
/* Brevo client                                                               */
/* -------------------------------------------------------------------------- */

function brevoFetch(
  body: unknown,
  status = 201,
  headers: Record<string, string> = {},
  calls: Array<{ url: string; init: RequestInit }> = [],
) {
  return async (input: URL | RequestInfo, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  };
}

const SEND_INPUT = {
  to: "customer@example.test",
  templateId: 321,
  params: { bookingReference: CONTEXT.reference },
  idempotencyKey: randomUUID(),
  template: "booking_created",
};

test("a successful Brevo acceptance returns the provider message id", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createBrevoClient(
    {
      apiKey: "xkeysib-test",
      senderEmail: "bookings@example.test",
      senderName: "2nd Wave",
    },
    { fetchImpl: brevoFetch({ messageId: "<provider-1@relay>" }, 201, {}, calls) },
  );

  const result = await client.send(SEND_INPUT);
  assert.deepEqual(result, {
    ok: true,
    providerMessageId: "<provider-1@relay>",
    duplicate: false,
  });

  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(
    (calls[0].init.headers as Record<string, string>)["api-key"],
    "xkeysib-test",
  );
  assert.equal(body.to[0].email, "customer@example.test");
  assert.equal(body.templateId, SEND_INPUT.templateId);
  assert.deepEqual(body.params, SEND_INPUT.params);
  assert.equal("subject" in body, false);
  assert.equal("htmlContent" in body, false);
  assert.equal("textContent" in body, false);
  assert.equal(body.headers.idempotencyKey, SEND_INPUT.idempotencyKey);
  assert.equal(
    body.headers.IdempotencyKey,
    undefined,
    "the MIME-header spelling does not enable Brevo idempotency",
  );
  assert.equal(
    body.headers["X-Mailin-custom"],
    `2ndwave-outbox:${SEND_INPUT.idempotencyKey}`,
  );
  assert.ok(!JSON.stringify(body).includes("xkeysib-test"));
});

test("Brevo duplicate idempotency responses are treated as accepted", async () => {
  const client = createBrevoClient(
    {
      apiKey: "xkeysib-test",
      senderEmail: "bookings@example.test",
      senderName: "2nd Wave",
    },
    {
      fetchImpl: brevoFetch({ code: "duplicate_parameter" }, 400),
    },
  );

  assert.deepEqual(await client.send(SEND_INPUT), {
    ok: true,
    providerMessageId: null,
    duplicate: true,
  });
});

test("Brevo failures are classified without returning raw provider text", async () => {
  const make = (body: unknown, status: number, headers = {}) =>
    createBrevoClient(
      {
        apiKey: "xkeysib-test",
        senderEmail: "bookings@example.test",
        senderName: "2nd Wave",
      },
      { fetchImpl: brevoFetch(body, status, headers) },
    );

  const retryable = await make({ code: "internal_error" }, 500).send(SEND_INPUT);
  assert.equal(retryable.ok, false);
  if (!retryable.ok) {
    assert.equal(retryable.classification, "retryable");
    assert.equal(retryable.reason, "brevo_http_500_internal_error");
  }

  const limited = await make({ code: "too_many_requests" }, 429, {
    "retry-after": "120",
  }).send(SEND_INPUT);
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.equal(limited.retryAfterSeconds, 120);

  const permanent = await make({ code: "unauthorized" }, 401).send(SEND_INPUT);
  assert.equal(permanent.ok, false);
  if (!permanent.ok) assert.equal(permanent.classification, "permanent");
});

test("a timeout is retryable and an invalid idempotency key is permanent", async () => {
  const client = createBrevoClient(
    {
      apiKey: "xkeysib-test",
      senderEmail: "bookings@example.test",
      senderName: "2nd Wave",
    },
    {
      fetchImpl: async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    },
  );

  const timeout = await client.send(SEND_INPUT);
  assert.equal(timeout.ok, false);
  if (!timeout.ok) {
    assert.equal(timeout.classification, "retryable");
    assert.equal(timeout.reason, "brevo_timeout");
  }

  let called = false;
  const invalid = createBrevoClient(
    {
      apiKey: "xkeysib-test",
      senderEmail: "bookings@example.test",
      senderName: "2nd Wave",
    },
    {
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 201 });
      },
    },
  );
  const result = await invalid.send({
    ...SEND_INPUT,
    idempotencyKey: "not-a-uuid",
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.classification, "permanent");
});

test("an invalid saved-template ID is rejected without calling Brevo", async () => {
  let called = false;
  const client = createBrevoClient(
    {
      apiKey: "xkeysib-test",
      senderEmail: "bookings@example.test",
      senderName: "2nd Wave",
    },
    {
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 201 });
      },
    },
  );
  const result = await client.send({ ...SEND_INPUT, templateId: 0 });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "brevo_invalid_template_id");
});

/* -------------------------------------------------------------------------- */
/* Worker                                                                     */
/* -------------------------------------------------------------------------- */

type RepositoryCalls = {
  claimed: boolean;
  sent: Array<{ id: string; providerMessageId: string | null }>;
  retried: Array<{ id: string; delaySeconds: number; error: string }>;
  dead: Array<{ id: string; error: string }>;
};

function row(overrides: Partial<ClaimedOutboxEmail> = {}): ClaimedOutboxEmail {
  return {
    id: randomUUID(),
    bookingId: randomUUID(),
    template: "booking_created",
    recipientEmail: "customer@example.test",
    payload: { booking_reference: CONTEXT.reference, status: "pending" },
    attemptCount: 1,
    maxAttempts: 5,
    ...overrides,
  };
}

function makeRepository(
  options: {
    rows?: ClaimedOutboxEmail[];
    context?: BookingEmailContext | null;
    contextThrows?: boolean;
    markSent?: boolean;
    markRetry?: "retryable_failed" | "dead" | null;
  } = {},
): { repository: EmailOutboxRepository; calls: RepositoryCalls } {
  const calls: RepositoryCalls = {
    claimed: false,
    sent: [],
    retried: [],
    dead: [],
  };

  const repository: EmailOutboxRepository = {
    async reap() {
      return 0;
    },
    async claim() {
      calls.claimed = true;
      return options.rows ?? [row()];
    },
    async markSent(input) {
      calls.sent.push({
        id: input.id,
        providerMessageId: input.providerMessageId,
      });
      return options.markSent ?? true;
    },
    async markRetry(input) {
      calls.retried.push({
        id: input.id,
        delaySeconds: input.delaySeconds,
        error: input.error,
      });
      return options.markRetry ?? "retryable_failed";
    },
    async markDead(input) {
      calls.dead.push({ id: input.id, error: input.error });
      return true;
    },
    async loadBookingContext() {
      if (options.contextThrows) throw new Error("db unavailable");
      return options.context === undefined ? CONTEXT : options.context;
    },
  };

  return { repository, calls };
}

function deps(
  repository: EmailOutboxRepository,
  result: BrevoSendResult = {
    ok: true,
    providerMessageId: "<provider-1@relay>",
    duplicate: false,
  },
  overrides: Partial<EmailWorkerDeps> = {},
): EmailWorkerDeps {
  return {
    enabled: true,
    repository,
    provider: { send: async () => result },
    siteUrl: "https://2ndwave.example",
    templateIds: {
      booking_created: 101,
      booking_confirmed: 102,
      booking_processing_started: 103,
      booking_ready: 104,
      booking_completed: 105,
      booking_cancelled: 106,
    },
    random: () => 0,
    ...overrides,
  };
}

test("disabled delivery claims nothing and never calls the provider", async () => {
  const { repository, calls } = makeRepository();
  let providerCalled = false;
  const result = await runEmailWorker(
    deps(repository, undefined, {
      enabled: false,
      provider: {
        send: async () => {
          providerCalled = true;
          return { ok: true, providerMessageId: null, duplicate: false };
        },
      },
    }),
    { workerId: "worker-1" },
  );

  assert.equal(result.ok, true);
  assert.equal(calls.claimed, false);
  assert.equal(providerCalled, false);
  if (result.ok) assert.equal(result.sent, 0);
});

test("successful provider acceptance records the provider message id", async () => {
  const { repository, calls } = makeRepository();
  const result = await runEmailWorker(deps(repository), { workerId: "worker-1" });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.sent, 1);
    assert.equal(result.claimed, 1);
  }
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].providerMessageId, "<provider-1@relay>");
});

test("worker sends only the event's saved template ID and dynamic params", async () => {
  const { repository } = makeRepository({
    rows: [row({ template: "booking_confirmed", payload: {
      booking_reference: CONTEXT.reference,
      status: "confirmed",
    } })],
  });
  let sentInput:
    | {
        templateId: number;
        params: Record<string, string>;
        to: string;
        idempotencyKey: string;
      }
    | undefined;
  const result = await runEmailWorker(
    deps(repository, undefined, {
      provider: {
        send: async (input) => {
          sentInput = input;
          return { ok: true, providerMessageId: null, duplicate: false };
        },
      },
    }),
    { workerId: "worker-template-test" },
  );

  assert.equal(result.ok, true);
  assert.equal(sentInput?.templateId, 102);
  assert.equal(sentInput?.to, "customer@example.test");
  assert.ok(sentInput?.idempotencyKey);
  assert.equal(sentInput?.params.bookingStatus, "Confirmed");
  assert.equal(sentInput?.params.confirmedFee, "GHS 50.00");
  assert.equal(sentInput?.params.headerImageUrl, "https://2ndwave.example/headers/booking-confirmed.png");
});

test("a retryable failure is scheduled with bounded backoff", async () => {
  const { repository, calls } = makeRepository();
  const result = await runEmailWorker(
    deps(
      repository,
      {
        ok: false,
        classification: "retryable",
        reason: "brevo_http_500_internal_error",
      },
      { random: () => 0 },
    ),
    { workerId: "worker-1" },
  );

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.retried, 1);
  assert.equal(calls.retried.length, 1);
  assert.equal(calls.retried[0].delaySeconds, 60);
  assert.equal(calls.retried[0].error, "brevo_http_500_internal_error");
});

test("a permanent failure is dead-lettered immediately", async () => {
  const { repository, calls } = makeRepository();
  const result = await runEmailWorker(
    deps(repository, {
      ok: false,
      classification: "permanent",
      reason: "brevo_http_401_unauthorized",
    }),
    { workerId: "worker-1" },
  );

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.dead, 1);
  assert.deepEqual(calls.dead.map((entry) => entry.error), [
    "brevo_http_401_unauthorized",
  ]);
  assert.equal(calls.retried.length, 0);
});

test("an exhausted attempt budget becomes a terminal failure", async () => {
  const { repository } = makeRepository({
    rows: [row({ attemptCount: 5, maxAttempts: 5 })],
    markRetry: "dead",
  });
  const result = await runEmailWorker(
    deps(repository, {
      ok: false,
      classification: "retryable",
      reason: "brevo_http_503_unavailable",
    }),
    { workerId: "worker-1" },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.dead, 1);
    assert.equal(result.retried, 0);
  }
});

test("a provider exception is retryable and isolated from booking state", async () => {
  const { repository, calls } = makeRepository();
  const result = await runEmailWorker(
    deps(repository, undefined, {
      provider: {
        send: async () => {
          throw new Error("socket hang up");
        },
      },
    }),
    { workerId: "worker-1" },
  );

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.retried, 1);
  assert.equal(calls.retried[0].error, "email_delivery_exception");
});

test("a missing booking is dead-lettered without calling the provider", async () => {
  const { repository, calls } = makeRepository({ context: null });
  let providerCalled = false;
  const result = await runEmailWorker(
    deps(repository, undefined, {
      provider: {
        send: async () => {
          providerCalled = true;
          return { ok: true, providerMessageId: null, duplicate: false };
        },
      },
    }),
    { workerId: "worker-1" },
  );

  assert.equal(result.ok, true);
  assert.equal(providerCalled, false);
  assert.equal(calls.dead[0].error, "email_booking_missing");
});

test("a transient repository read failure leaves the row leased", async () => {
  const { repository, calls } = makeRepository({ contextThrows: true });
  const result = await runEmailWorker(deps(repository), { workerId: "worker-1" });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.failed, 1);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.retried.length, 0);
  assert.equal(calls.dead.length, 0);
});

test("losing the lease is counted as skipped, not sent", async () => {
  const { repository } = makeRepository({ markSent: false });
  const result = await runEmailWorker(deps(repository), { workerId: "worker-1" });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 1);
  }
});

test("a repository outage is reported instead of throwing into the booking path", async () => {
  const { repository } = makeRepository();
  repository.reap = async () => {
    throw new Error("db unavailable");
  };

  const result = await runEmailWorker(deps(repository), { workerId: "worker-1" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "repository_unavailable");
});

test("an invalid event template is permanent and does not call the provider", async () => {
  const { repository, calls } = makeRepository({
    rows: [row({ template: "not_a_template" as EmailTemplate })],
  });
  let providerCalled = false;
  const result = await runEmailWorker(
    deps(repository, undefined, {
      provider: {
        send: async () => {
          providerCalled = true;
          return { ok: true, providerMessageId: null, duplicate: false };
        },
      },
    }),
    { workerId: "worker-1" },
  );

  assert.equal(result.ok, true);
  assert.equal(providerCalled, false);
  assert.equal(calls.dead[0].error, "email_template_params_failed");
});

test("backoff is exponential, jittered and capped", () => {
  assert.equal(retryDelaySeconds(1, () => 0), 60);
  assert.equal(retryDelaySeconds(2, () => 0), 120);
  assert.equal(retryDelaySeconds(3, () => 0), 240);
  assert.equal(retryDelaySeconds(4, () => 0), 480);
  assert.equal(retryDelaySeconds(5, () => 0), 900);
  assert.equal(retryDelaySeconds(20, () => 0), 900);
  assert.ok(retryDelaySeconds(1, () => 0.99) <= 900);
});
