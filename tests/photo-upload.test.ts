import test from "node:test";
import assert from "node:assert/strict";
import { handlePhotoUpload } from "../src/lib/bookings/photo-upload";
import type { IncomingPhoto } from "../src/lib/bookings/photos";

const IDENTITY = "photo-test-hashed-identity";
const CORRELATION = "photo-corr-1";

function incomingPhoto(bytes: number): IncomingPhoto {
  const buf = new Uint8Array(Math.max(3, bytes));
  // Minimal JPEG signature; validation sniffs magic numbers, not the declared
  // MIME type, so a one-byte fixture would be correctly rejected.
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return { bytes: buf, declaredType: "image/jpeg", name: "photo.jpg" };
}

function makeDeps(
  overrides: Partial<Parameters<typeof handlePhotoUpload>[1]> = {},
): { deps: Parameters<typeof handlePhotoUpload>[1]; storeCalls: Array<{ bookingId: string; photoCount: number }> } {
  const storeCalls: Array<{ bookingId: string; photoCount: number }> = [];
  const deps: Parameters<typeof handlePhotoUpload>[1] = {
    enabled: true,
    configured: true,
    rateLimiter: {
      consume: async () => ({ status: "allowed", remaining: 9, limit: 10 }),
    } as Parameters<typeof handlePhotoUpload>[1]["rateLimiter"],
    tokenSecret: "photo-secret-v1",
    store: async (_input) => {
      storeCalls.push({ bookingId: _input.bookingId, photoCount: _input.photos.length });
      return { ok: true, stored: _input.photos.length };
    },
    ...overrides,
  };
  return { deps, storeCalls };
}

function makeInput(overrides: Partial<Parameters<typeof handlePhotoUpload>[0]> = {}): Parameters<typeof handlePhotoUpload>[0] {
  return {
    files: [],
    token: null,
    origin: { ok: true } as Parameters<typeof handlePhotoUpload>[0]["origin"],
    identity: IDENTITY,
    correlationId: CORRELATION,
    ...overrides,
  };
}

function assertPhoto(
  actual: { status: number; body: Record<string, unknown> },
  wantStatus: number,
  wantOk: boolean,
  wantCode?:
    | "invalid_upload_token"
    | "upload_failed"
    | "too_many_photos"
    | "photo_too_large"
    | "not_configured",
) {
  assert.equal(actual.status, wantStatus);
  assert.equal(actual.body.ok, wantOk);
  // A successful response carries no error code at all.
  if (wantCode) assert.equal(actual.body.code, wantCode);
  else assert.equal(actual.body.code, undefined);
}

test("a cross-origin request is rejected before anything else", async () => {
  const { deps } = makeDeps({ rateLimiter: null });
  const res = await handlePhotoUpload(
    makeInput({ origin: { ok: false, reason: "cross-origin" } }),
    deps,
  );
  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "origin_rejected");
});

test("a disabled deployment returns 503", async () => {
  const { deps } = makeDeps({ enabled: false });
  const res = await handlePhotoUpload(makeInput(), deps);
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "submissions_disabled");
});

test("an unconfigured deployment returns 503", async () => {
  const { deps } = makeDeps({ configured: false });
  const res = await handlePhotoUpload(makeInput(), deps);
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "not_configured");
});

test("a missing token secret returns 503", async () => {
  const { deps } = makeDeps({ tokenSecret: null });
  const res = await handlePhotoUpload(makeInput(), deps);
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "not_configured");
});

test("a rate-limited caller receives 429", async () => {
  const { deps } = makeDeps({
    rateLimiter: {
      consume: async () =>
        ({ status: "limited", retryAfterSeconds: 12, limit: 10 }),
    } as Parameters<typeof handlePhotoUpload>[1]["rateLimiter"],
  });
  const res = await handlePhotoUpload(makeInput(), deps);
  assert.equal(res.status, 429);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "rate_limited");
  const headers = (res.headers as Record<string, string>) ?? {};
  // The pure handler returns a plain object; Next.js headers are
  // case-insensitive at the HTTP boundary, but this object is not.
  assert.equal(headers["Retry-After"], "12");
});

test("a stale or wrong token is rejected", async () => {
  const { deps } = makeDeps();
  const res = await handlePhotoUpload(
    makeInput({ token: "v1.not-a-real-token" }),
    deps,
  );
  assertPhoto(res, 422, false, "invalid_upload_token");
});

test("an upload attempts the store step", async () => {
  const { deps, storeCalls } = makeDeps();
  const res = await handlePhotoUpload(
    makeInput({
      token: makeUploadToken("26b0d82c-e2c5-4f8b-9a0e-1e2cdf1e6f18", deps.tokenSecret!),
      files: [incomingPhoto(1024)],
    }),
    deps,
  );
  assertPhoto(res, 201, true);
  assert.equal(res.body.stored, 1);
  assert.equal(storeCalls.length, 1, "store was called once");
  assert.equal(storeCalls[0].bookingId, "26b0d82c-e2c5-4f8b-9a0e-1e2cdf1e6f18");
  assert.equal(storeCalls[0].photoCount, 1);
});

test("a store failure is reported as the upload-failed message", async () => {
  const { deps } = makeDeps({
    store: async () => ({ ok: false, code: "upload_failed" }),
  });
  const res = await handlePhotoUpload(
    makeInput({
      token: makeUploadToken("d49e3b19-1b11-41c6-8e7a-d2f42c9a5c10", deps.tokenSecret!),
      files: [incomingPhoto(1024)],
    }),
    deps,
  );
  assertPhoto(res, 422, false, "upload_failed");
});

test("an oversized photo is rejected without echoing byte counts", async () => {
  const { deps } = makeDeps();
  const res = await handlePhotoUpload(
    makeInput({
      token: makeUploadToken("c73a1f0d-bb73-45a0-a1e4-f011d1422513", deps.tokenSecret!),
      files: [incomingPhoto(5000001)],
    }),
    deps,
  );
  assertPhoto(res, 422, false, "photo_too_large");
  assert.ok(
    !JSON.stringify(res.body).includes("5000001"),
    "the response must not echo byte sizes",
  );
});

test("a batch with three bytes-limited files reaches the store step", async () => {
  const { deps, storeCalls } = makeDeps();
  const res = await handlePhotoUpload(
    makeInput({
      token: makeUploadToken("4d2b3f57-9f9b-4ac3-b4e2-2e270b8f8baa", deps.tokenSecret!),
      files: [incomingPhoto(1024), incomingPhoto(2048), incomingPhoto(4096)],
    }),
    deps,
  );
  assertPhoto(res, 201, true);
  assert.equal(res.body.stored, 3);
  assert.equal(storeCalls[0].photoCount, 3);
});

import { createPhotoUploadToken } from "../src/lib/bookings/photos";

function makeUploadToken(bookingId: string, secret: string): string {
  return createPhotoUploadToken(bookingId, secret);
}
