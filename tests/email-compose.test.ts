import test from "node:test";
import assert from "node:assert/strict";
import {
  BREVO_SENDERS_ENDPOINT,
  MANUAL_EMAIL_ENDPOINT,
  listActiveBrevoSenders,
  sanitizeManualEmailHtml,
  sendManualBrevoEmail,
  type BrevoSender,
} from "../src/lib/email/manual";

const ACTIVE_SENDER: BrevoSender = {
  id: 12,
  name: "Orders",
  email: "orders@2ndwavelaundry.com",
};

test("sender listing exposes active verified Brevo senders only", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const senders = await listActiveBrevoSenders(
    "xkeysib-test",
    async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({
        senders: [
          { ...ACTIVE_SENDER, active: true },
          { ...ACTIVE_SENDER, id: 13, email: "pending@example.com", active: false },
          { ...ACTIVE_SENDER, id: "invalid", active: true },
        ],
      });
    },
  );

  assert.deepEqual(senders, [ACTIVE_SENDER]);
  assert.equal(calls[0].url, BREVO_SENDERS_ENDPOINT);
  assert.equal(
    (calls[0].init?.headers as Record<string, string>)["api-key"],
    "xkeysib-test",
  );
});

test("manual email uses the selected sender and preserves safe rich-text HTML", async () => {
  let call: { url: string; init?: RequestInit } | undefined;
  const result = await sendManualBrevoEmail(
    "xkeysib-test",
    {
      sender: ACTIVE_SENDER,
      recipientEmail: "customer@example.com",
      subject: "Booking update",
      messageHtml:
        '<p><strong>Hello customer</strong></p><p>Your <em>order</em> is ready. <a href="https://example.com">View it</a>.</p>',
    },
    async (input, init) => {
      call = { url: String(input), init };
      return Response.json({ messageId: "<sent@brevo>" }, { status: 201 });
    },
  );

  assert.deepEqual(result, {
    ok: true,
    providerMessageId: "<sent@brevo>",
  });
  assert.equal(call?.url, MANUAL_EMAIL_ENDPOINT);
  const body = JSON.parse(String(call?.init?.body));
  assert.deepEqual(body.sender, { id: 12 });
  assert.deepEqual(body.to, [{ email: "customer@example.com" }]);
  assert.equal(body.subject, "Booking update");
  assert.equal(
    body.htmlContent,
    '<p><strong>Hello customer</strong></p><p>Your <em>order</em> is ready. <a href="https://example.com" target="_blank" rel="noopener noreferrer">View it</a>.</p>',
  );
});

test("rich-text sanitizer removes scripts, unsafe links, and unsupported styling", () => {
  const safe = sanitizeManualEmailHtml(
    '<p style="color:red">Hello <strong>there</strong></p><script>alert(1)</script><a href="javascript:alert(2)">bad link</a><a href="https://example.com">safe link</a>',
  );

  assert.equal(
    safe,
    '<p>Hello <strong>there</strong></p><a target="_blank" rel="noopener noreferrer">bad link</a><a href="https://example.com" target="_blank" rel="noopener noreferrer">safe link</a>',
  );
});

test("manual email reports provider failures without exposing provider response text", async () => {
  const result = await sendManualBrevoEmail(
    "xkeysib-test",
    {
      sender: ACTIVE_SENDER,
      recipientEmail: "customer@example.com",
      subject: "Booking update",
      messageHtml: "<p>Your order is ready.</p>",
    },
    async () => new Response("secret provider detail", { status: 400 }),
  );

  assert.deepEqual(result, {
    ok: false,
    reason: "brevo_send_http_400",
  });
});
