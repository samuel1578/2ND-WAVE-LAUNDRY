import test from "node:test";
import assert from "node:assert/strict";
import {
  adminNavigationFor,
  adminRoutes,
  defaultLandingFor,
  hasPermission,
  permissions,
  permissionsFor,
  resolveAdminRoute,
  resolveAdminRouteAccess,
  resolveLoginDestination,
  rolePermissions,
  type Permission,
} from "../src/lib/auth/permissions";
import { resolveAdminIdentity } from "../src/lib/auth/roles";

/**
 * Sprint 1B role matrix.
 *
 * These exercise the same functions the server page and the navigation use, so
 * the "allowed" decisions below are the server-side decisions. Anonymous,
 * disabled and profile-less visitors never reach a route decision at all: Sprint
 * 1A resolves them to no identity (covered in tests/auth.test.ts) and the page
 * redirects to the login screen.
 */

const FULL = "full_admin" as const;
const OPERATIONAL = "operational_admin" as const;
const ANONYMOUS = null;

const operationalPermissions: Permission[] = [
  "bookings.read",
  "bookings.manage",
  "reviews.read",
  "reviews.moderate",
  "reviews.reply",
];

test("permission registry defines the two authorised roles only", () => {
  assert.deepEqual(Object.keys(rolePermissions).sort(), [
    "full_admin",
    "operational_admin",
  ]);
  assert.equal(hasPermission(FULL, "dashboard.read"), true);
  for (const permission of permissions)
    assert.equal(
      hasPermission(FULL, permission),
      true,
      `full admin should hold ${permission}`,
    );
});

test("operational admin holds bookings and reviews permissions only", () => {
  assert.deepEqual([...permissionsFor(OPERATIONAL)].sort(), [
    ...operationalPermissions,
  ].sort());
  for (const permission of operationalPermissions)
    assert.equal(
      hasPermission(OPERATIONAL, permission),
      true,
      `operational admin should hold ${permission}`,
    );
  for (const denied of [
    "dashboard.read",
    "enquiries.manage",
    "newsletter.manage",
    "content.manage",
    "media.manage",
    "settings.manage",
    "staff.manage",
    "email.manage",
    // Emergency overrides stay a Full Admin capability.
    "reviews.override",
  ] as Permission[])
    assert.equal(
      hasPermission(OPERATIONAL, denied),
      false,
      `operational admin must not hold ${denied}`,
    );
  assert.equal(hasPermission(FULL, "reviews.override"), true);
});

test("unknown, missing or client-supplied roles grant nothing", () => {
  for (const role of [
    "super_admin",
    "full_admin ",
    "FULL_ADMIN",
    "true",
    "",
    undefined,
    null,
    ANONYMOUS,
  ])
    assert.deepEqual(permissionsFor(role), [], JSON.stringify(role));
  assert.equal(hasPermission("super_admin", "settings.manage"), false);
  assert.deepEqual(adminNavigationFor("super_admin"), []);
  assert.equal(
    resolveAdminRouteAccess("super_admin", "/admin/bookings").kind,
    "forbidden",
  );
});

test("anonymous visitors are denied every canonical route", () => {
  for (const route of adminRoutes) {
    assert.equal(
      resolveAdminRouteAccess(ANONYMOUS, route.href).kind,
      "forbidden",
      route.href,
    );
    assert.deepEqual(adminNavigationFor(ANONYMOUS), []);
  }
});

test("full admin reaches every canonical route", () => {
  for (const route of adminRoutes) {
    const access = resolveAdminRouteAccess(FULL, route.href);
    assert.equal(access.kind, "allowed", route.href);
    if (access.kind === "allowed")
      assert.equal(access.route.key, route.key);
  }
  assert.equal(resolveAdminRouteAccess(FULL, "/admin/bookings/42").kind, "allowed");
  assert.equal(
    resolveAdminRouteAccess(FULL, "/admin/content/services/wash-ironing-fold").kind,
    "allowed",
  );
});

test("operational admin reaches bookings and reviews, and nothing else", () => {
  assert.equal(
    resolveAdminRouteAccess(OPERATIONAL, "/admin/bookings").kind,
    "allowed",
  );
  assert.equal(
    resolveAdminRouteAccess(OPERATIONAL, "/admin/bookings/demo-1").kind,
    "allowed",
  );
  assert.equal(
    resolveAdminRouteAccess(OPERATIONAL, "/admin/reviews").kind,
    "allowed",
  );
  assert.equal(
    resolveAdminRouteAccess(OPERATIONAL, "/admin/email-delivery").kind,
    "forbidden",
  );
  for (const path of [
    "/admin/settings",
    "/admin/content",
    "/admin/content/services",
    "/admin/media",
    "/admin/newsletter",
    "/admin/enquiries",
    "/admin/enquiries/demo-lead",
  ]) {
    const access = resolveAdminRouteAccess(OPERATIONAL, path);
    assert.equal(access.kind, "forbidden", path);
    if (access.kind === "forbidden")
      assert.ok(access.route.permission.length > 0);
  }
});

test("operational admin entering the dashboard is redirected to bookings", () => {
  assert.deepEqual(resolveAdminRouteAccess(OPERATIONAL, "/admin"), {
    kind: "redirect",
    to: "/admin/bookings",
    route: adminRoutes[0],
  });
  assert.equal(resolveAdminRouteAccess(FULL, "/admin").kind, "allowed");
  assert.equal(defaultLandingFor(FULL), "/admin");
  assert.equal(defaultLandingFor(OPERATIONAL), "/admin/bookings");
  // Unknown roles fall back to the least-privileged landing page.
  assert.equal(defaultLandingFor("super_admin"), "/admin/bookings");
});

test("route resolution respects segment boundaries", () => {
  assert.equal(resolveAdminRoute("/admin").kind, "known");
  assert.equal(resolveAdminRoute("/admin/").kind, "known");
  assert.equal(resolveAdminRoute("/admin/reviews/").kind, "known");
  for (const path of [
    "/admin/unknown",
    "/admin/bookingsX",
    "/admin/reviewsfoo",
    "/admin/administrator",
    "/adminstrator",
    "/unknown",
    "",
    "/admin/unknown/deeper",
  ])
    assert.equal(resolveAdminRoute(path).kind, "unknown", path);
  // An unknown route must never inherit a privileged prefix.
  for (const role of [FULL, OPERATIONAL] as const)
    assert.equal(resolveAdminRouteAccess(role, "/admin/bookingsX").kind, "unknown");
});

test("navigation is filtered from the permission registry", () => {
  const full = adminNavigationFor(FULL);
  assert.deepEqual(
    full.map((route) => route.label),
    [
      "Dashboard",
      "Bookings",
      "Enquiries",
      "Reviews",
      "Newsletter Interest",
      "Website Content",
      "Media Library",
      "Settings",
      // Sprint 1C — Full Admin only.
      "Staff Management",
      "Email Delivery",
    ],
  );
  const operational = adminNavigationFor(OPERATIONAL);
  assert.deepEqual(
    operational.map((route) => route.label),
    ["Bookings", "Reviews"],
  );
  assert.deepEqual(
    operational.map((route) => route.href),
    ["/admin/bookings", "/admin/reviews"],
  );
  // Restricted modules are omitted entirely, not rendered disabled.
  for (const route of operational)
    assert.equal(hasPermission(OPERATIONAL, route.permission), true);
  assert.equal(
    adminNavigationFor(OPERATIONAL).some((route) => route.key === "dashboard"),
    false,
  );
  // Dashboard shortcuts use the same filtered list as the sidebar/mobile menu.
  assert.deepEqual(
    full.filter((route) => route.key !== "dashboard").map((route) => route.href),
    [
      "/admin/bookings",
      "/admin/enquiries",
      "/admin/reviews",
      "/admin/newsletter",
      "/admin/content",
      "/admin/media",
      "/admin/settings",
      "/admin/staff",
      "/admin/email-delivery",
    ],
  );
  assert.deepEqual(
    adminNavigationFor(OPERATIONAL).map((route) => route.href),
    ["/admin/bookings", "/admin/reviews"],
  );
});

test("sign-in returns a permitted destination or the role landing page", () => {
  // A requested path is honoured only when the role may reach it.
  assert.equal(
    resolveLoginDestination(FULL, "/admin/settings"),
    "/admin/settings",
  );
  assert.equal(
    resolveLoginDestination(OPERATIONAL, "/admin/bookings/demo-1"),
    "/admin/bookings/demo-1",
  );
  assert.equal(
    resolveLoginDestination(OPERATIONAL, "/admin/settings"),
    "/admin/bookings",
  );
  assert.equal(
    resolveLoginDestination(OPERATIONAL, "/admin"),
    "/admin/bookings",
  );
  assert.equal(
    resolveLoginDestination(OPERATIONAL, "/admin/login"),
    "/admin/bookings",
  );
  // Off-site, protocol-relative and unknown destinations never win.
  for (const hostile of [
    "https://evil.test/admin/settings",
    "//evil.test/admin/settings",
    "/\\evil.test/admin",
    "/admin/unknown",
    "/help",
    "",
    undefined,
  ])
    assert.equal(
      resolveLoginDestination(OPERATIONAL, hostile),
      "/admin/bookings",
      JSON.stringify(hostile),
    );
  assert.equal(resolveLoginDestination(FULL, undefined), "/admin");
  assert.equal(resolveLoginDestination(ANONYMOUS, "/admin/settings"), "/admin/bookings");
});

test("operational admin navigation still contains only Bookings and Reviews", () => {
  // Sprint 1C adds Staff Management for Full Admins only; this is the assertion
  // that the Operational Admin experience did not grow.
  assert.deepEqual(
    adminNavigationFor(OPERATIONAL).map(({ key, label, href }) => ({ key, label, href })),
    [
      { key: "bookings", label: "Bookings", href: "/admin/bookings" },
      { key: "reviews", label: "Reviews", href: "/admin/reviews" },
    ],
  );
});

test("staff management is a Full Admin capability", () => {
  const staffRoute = adminRoutes.find((route) => route.key === "staff");
  assert.ok(staffRoute, "the registry must define the staff route");
  assert.equal(staffRoute.href, "/admin/staff");
  assert.equal(staffRoute.permission, "staff.manage");
  assert.equal(hasPermission(FULL, "staff.manage"), true);
  assert.equal(hasPermission(OPERATIONAL, "staff.manage"), false);
  assert.equal(hasPermission(ANONYMOUS, "staff.manage"), false);

  assert.equal(resolveAdminRouteAccess(FULL, "/admin/staff").kind, "allowed");
  assert.equal(resolveAdminRoute("/admin/staff").kind, "known");
  for (const role of [OPERATIONAL, ANONYMOUS] as const)
    assert.equal(resolveAdminRouteAccess(role, "/admin/staff").kind, "forbidden");

  // The staff module appears exactly once in the Full Admin navigation and never
  // in the Operational Admin navigation.
  assert.equal(
    adminNavigationFor(FULL).filter((route) => route.key === "staff").length,
    1,
  );
  assert.equal(
    adminNavigationFor(OPERATIONAL).some((route) => route.key === "staff"),
    false,
  );

  // A requested return path cannot be used to reach a denied module.
  assert.equal(resolveLoginDestination(FULL, "/admin/staff"), "/admin/staff");
  assert.equal(
    resolveLoginDestination(OPERATIONAL, "/admin/staff"),
    "/admin/bookings",
  );
});

test("review detail routes inherit the reviews.read capability", () => {
  // Sprint 3B adds `/admin/reviews/<id>` without a new registry entry: the
  // existing prefix match resolves it to the Reviews route, so Operational Admins
  // can open the console they moderate while anonymous callers stay denied.
  const detail = "/admin/reviews/11111111-1111-1111-1111-111111111111";
  assert.equal(resolveAdminRoute(detail).kind, "known");
  for (const role of [FULL, OPERATIONAL] as const)
    assert.equal(resolveAdminRouteAccess(role, detail).kind, "allowed");
  assert.equal(resolveAdminRouteAccess(ANONYMOUS, detail).kind, "forbidden");
  assert.equal(
    resolveLoginDestination(OPERATIONAL, detail),
    detail,
  );
});

test("role changes take effect on the next server verification", () => {
  const changed = resolveAdminIdentity(
    { id: "11111111-1111-1111-1111-111111111111", email: "staff@example.test" },
    {
      user_id: "11111111-1111-1111-1111-111111111111",
      role: "operational_admin",
      disabled_at: null,
    },
  );
  // The same account that previously held settings access now cannot.
  assert.equal(changed?.role, OPERATIONAL);
  assert.equal(
    resolveAdminRouteAccess(changed?.role, "/admin/settings").kind,
    "forbidden",
  );
  // A disabled profile resolves to no identity at all.
  assert.equal(
    resolveAdminIdentity(
      { id: "11111111-1111-1111-1111-111111111111" },
      {
        user_id: "11111111-1111-1111-1111-111111111111",
        role: "full_admin",
        disabled_at: "2026-10-10T00:00:00.000Z",
      },
    ),
    null,
  );
});
