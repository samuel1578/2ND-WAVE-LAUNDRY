import test from "node:test";
import assert from "node:assert/strict";
import {
  AdminAuthorisationError,
  adminRoles,
  authorizeAdmin,
  roleLabel,
  resolveAdminIdentity,
} from "../src/lib/auth/roles";
import {
  isPublicAdminPath,
  protectedAdminPath,
  resolveAuthOrigin,
  safeAdminPath,
} from "../src/lib/auth/redirect";
import {
  readSupabaseConfig,
  supabaseConfigMessage,
} from "../src/lib/supabase/config";

const user = { id: "11111111-1111-1111-1111-111111111111", email: "a@b.test" };

test("unauthenticated and profile-less users are not administrators", () => {
  assert.equal(resolveAdminIdentity(null, null), null);
  assert.equal(resolveAdminIdentity(user, null), null);
  assert.equal(resolveAdminIdentity(user, undefined), null);
  assert.equal(
    resolveAdminIdentity(user, {
      user_id: user.id,
      role: null,
      disabled_at: null,
    }),
    null,
  );
});

test("a profile that does not belong to the verified user is rejected", () => {
  assert.equal(
    resolveAdminIdentity(user, {
      user_id: "22222222-2222-2222-2222-222222222222",
      role: "full_admin",
      disabled_at: null,
    }),
    null,
  );
});

test("disabled administrators and unknown roles resolve to no access", () => {
  assert.equal(
    resolveAdminIdentity(user, {
      user_id: user.id,
      role: "full_admin",
      disabled_at: "2026-10-10T00:00:00.000Z",
    }),
    null,
  );
  assert.equal(
    resolveAdminIdentity(user, {
      user_id: user.id,
      role: "super_admin",
      disabled_at: null,
    }),
    null,
  );
});

test("both authorised roles are recognised with their database value", () => {
  const full = resolveAdminIdentity(user, {
    user_id: user.id,
    role: "full_admin",
    display_name: "  Primary  ",
    disabled_at: null,
  });
  const operational = resolveAdminIdentity(user, {
    user_id: user.id,
    role: "operational_admin",
    display_name: "",
    disabled_at: null,
  });
  assert.deepEqual(full, {
    userId: user.id,
    email: "a@b.test",
    role: "full_admin",
    displayName: "Primary",
  });
  assert.equal(operational?.role, "operational_admin");
  assert.deepEqual(adminRoles, ["full_admin", "operational_admin"]);
  assert.equal(roleLabel("full_admin"), "Full administrator");
  assert.equal(roleLabel("operational_admin"), "Operational administrator");
});

test("authorisation returns stable denial codes", () => {
  const operational = resolveAdminIdentity(user, {
    user_id: user.id,
    role: "operational_admin",
    disabled_at: null,
  });
  assert.throws(
    () => authorizeAdmin(null),
    (error: unknown) =>
      error instanceof AdminAuthorisationError &&
      error.code === "unauthenticated",
  );
  assert.throws(
    () => authorizeAdmin(operational, ["full_admin"]),
    (error: unknown) =>
      error instanceof AdminAuthorisationError && error.code === "forbidden",
  );
  assert.equal(authorizeAdmin(operational, ["operational_admin"])?.role, "operational_admin");
  assert.equal(authorizeAdmin(operational)?.role, "operational_admin");
});

// The Sprint 1A coarse console gate (`canAccessAdminModules`) was replaced in
// Sprint 1B by the central permission registry; the role matrix now lives in
// tests/permissions.test.ts.

test("missing or malformed Supabase configuration fails closed without leaking values", () => {
  const secret = "sb_secret_do_not_echo_0123456789";
  assert.deepEqual(readSupabaseConfig({}), { ok: false, reason: "missing" });
  assert.deepEqual(readSupabaseConfig({ url: "https://x.supabase.co" }), {
    ok: false,
    reason: "missing",
  });
  assert.deepEqual(
    readSupabaseConfig({ url: "http://x.supabase.co", key: secret }),
    { ok: false, reason: "invalid-url" },
  );
  assert.deepEqual(
    readSupabaseConfig({ url: "https://x.supabase.co", key: "short" }),
    { ok: false, reason: "invalid-key" },
  );
  for (const reason of ["missing", "invalid-url", "invalid-key"] as const) {
    const message = supabaseConfigMessage(reason);
    assert.ok(message.length > 0);
    assert.ok(!message.includes(secret));
    assert.ok(!message.includes("http://x.supabase.co"));
  }
  const ok = readSupabaseConfig({
    url: "https://project.supabase.co/",
    key: "sb_publishable_0123456789abcdef",
  });
  assert.deepEqual(ok, {
    ok: true,
    url: "https://project.supabase.co",
    key: "sb_publishable_0123456789abcdef",
  });
});

test("protected admin routes exclude every public authentication route", () => {
  for (const route of [
    "/admin/login",
    "/admin/reset-password",
    "/admin/set-password",
    "/admin/auth/callback",
  ]) {
    assert.equal(isPublicAdminPath(route), true, route);
    assert.equal(protectedAdminPath(route), false, route);
  }
  assert.equal(protectedAdminPath("/admin"), true);
  assert.equal(protectedAdminPath("/admin/bookings/42"), true);
  assert.equal(protectedAdminPath("/"), false);
  assert.equal(protectedAdminPath("/adminstrator"), false);
});

test("safe return destinations reject open redirects", () => {
  assert.equal(safeAdminPath("/admin/bookings"), "/admin/bookings");
  assert.equal(safeAdminPath("/admin/bookings?status=new"), "/admin/bookings?status=new");
  assert.equal(safeAdminPath("/admin/../admin/x"), "/admin/x");
  for (const hostile of [
    "https://evil.test/admin",
    "//evil.test/admin",
    "/\\evil.test/admin",
    "javascript:alert(1)",
    "admin/bookings",
    "",
    null,
    undefined,
    42,
    "/admin/login",
    "/admin/reset-password",
    "/admin/set-password?next=/admin",
    "/help",
    "/admin/boo\u0000king",
  ])
    assert.equal(safeAdminPath(hostile), "/admin", JSON.stringify(hostile));
});

test("auth redirect origins come from an explicit allow-list", () => {
  assert.equal(
    resolveAuthOrigin({ siteUrl: "https://2ndwavelaundry.com/admin" }),
    "https://2ndwavelaundry.com",
  );
  assert.equal(
    resolveAuthOrigin({
      host: "localhost:3000",
      protocol: "http",
      siteUrl: null,
    }),
    "http://localhost:3000",
  );
  // `x-forwarded-proto` is absent on some hosts; loopback still resolves to http.
  assert.equal(
    resolveAuthOrigin({ host: "localhost:3000", siteUrl: null }),
    "http://localhost:3000",
  );
  // No wildcard host is trusted: a preview origin must be configured explicitly.
  assert.equal(
    resolveAuthOrigin({
      host: "preview-branch.vercel.app",
      protocol: "https",
      siteUrl: null,
    }),
    null,
  );
  assert.equal(
    resolveAuthOrigin({
      host: "preview-branch.vercel.app",
      protocol: "https",
      siteUrl: "https://preview-branch.vercel.app",
    }),
    "https://preview-branch.vercel.app",
  );
  for (const host of [
    "evil.test",
    "evil.vercel.app.evil.test",
    "preview-branch.vercel.app",
    "2ndwavelaundry.com",
    "",
    null,
  ]) {
    assert.equal(
      resolveAuthOrigin({ host, protocol: "https", siteUrl: null }),
      null,
      String(host),
    );
  }
  assert.equal(
    resolveAuthOrigin({ host: "localhost:3000", protocol: "https", siteUrl: null }),
    null,
  );
  assert.equal(
    resolveAuthOrigin({
      host: "evil.test",
      protocol: "https",
      siteUrl: "javascript:alert(1)",
    }),
    null,
  );
});
