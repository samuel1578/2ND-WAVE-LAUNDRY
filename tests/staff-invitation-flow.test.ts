import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("staff invitation links use configured site origin and token-hash confirmation", () => {
    const actions = source("src/lib/admin/staff-actions.ts");
    const confirmRoute = source("src/app/auth/confirm/route.ts");
    const operations = source("docs/implementation/STAFF_INVITATION_OPERATIONS.md");

    assert.match(actions, /resolveCallbackOrigin\(\s*configuredAuthOrigin\(\),?\s*\)/);
    assert.match(actions, /redirectTo: `\$\{siteUrl\}\/admin\/set-password`/);
    assert.match(actions, /function resolveCallbackOrigin\(value: string \| null\): string \| null \{\s*return normaliseOrigin\(value\);/);
    assert.match(confirmRoute, /auth\.verifyOtp\(\{[\s\S]*token_hash: tokenHash/);
    assert.match(confirmRoute, /safeAuthNext\(/);
    assert.match(confirmRoute, /target\.searchParams\.set\("kind", "invite"\)/);
    assert.match(confirmRoute, /reconcileInvitationForUser\(/);
    assert.match(operations, /\{\{ \.SiteURL \}\}\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}&type=invite&next=\/admin\/set-password/);
});

test("set-password accepts legacy fragments and grants the stored role only", () => {
    const authUi = source("src/components/admin/admin-app.tsx");
    const authActions = source("src/lib/auth/actions.ts");
    const root = source("src/components/auth-hash-forwarder.tsx");

    assert.match(root, /type === "invite" \|\| type === "recovery"/);
    assert.match(authUi, /auth\.setSession\(/);
    assert.match(authActions, /auth\.updateUser\(\{ password: input\.password \}\)/);
    assert.match(authActions, /reconcileInvitationForUser\(/);
    assert.match(authActions, /redirect\(defaultLandingFor\(admin\.role\)\)/);
    assert.match(authUi, /Link expired\. Ask an admin to resend your invitation\./);
});

test("invitation controls are server-authorised, audited, and safe for existing accounts", () => {
    const actions = source("src/lib/admin/staff-actions.ts");
    const service = source("src/lib/admin/staff-service.ts");
    const ui = source("src/components/admin/staff-manager.tsx");
    const migration = source("supabase/migrations/20261102090000_staff_invitation_controls.sql");

    assert.match(actions, /cancelAdministratorInvitation/);
    assert.match(actions, /resendAdministratorInvitation/);
    assert.match(actions, /hasPermission\(actor\.role, "staff\.manage"\)/);
    assert.match(service, /staff_revoke_invitation/);
    assert.match(service, /email_confirmed_at/);
    assert.match(service, /last_sign_in_at/);
    assert.match(service, /auth\.admin\.deleteUser\(user\.id\)/);
    assert.match(service, /admin_profiles/);
    assert.match(ui, /Resend/);
    assert.match(ui, /Cancel Invitation/);
    assert.match(ui, /setCancelInvitation\(invitation\)/);
    assert.match(migration, /staff\.invitation_revoked/);
    assert.match(migration, /TO service_role/);
    assert.match(migration, /FROM PUBLIC, anon, authenticated/);
});

test("staff invitations are disclosed lazily and remain server-authorised", () => {
    const ui = source("src/components/admin/staff-manager.tsx");
    const route = source("src/app/api/admin/staff/route.ts");
    const service = source("src/lib/admin/staff-service.ts");

    assert.match(ui, /aria-expanded=\{invitationsOpen\}/);
    assert.match(ui, /aria-controls="staff-invitations-content"/);
    assert.match(ui, /fetch\("\/api\/admin\/staff\?invitations=1"/);
    assert.match(ui, /invitationsStale\.current = true/);
    assert.match(ui, /if \(invitationsOpenRef\.current\) void loadInvitations\(true\)/);
    assert.match(ui, /Try again/);
    assert.doesNotMatch(ui, /directory\.invitations/);
    assert.match(route, /hasPermission\(admin\.role, "staff\.manage"\)/);
    assert.match(route, /searchParams\.has\("invitations"\)/);
    assert.match(service, /listStaffAccounts[\s\S]*?from\("admin_profiles"\)/);
    assert.match(service, /listStaffInvitations[\s\S]*?from\("admin_invitations"\)/);
});

test("admin content stage no longer renders the secondary logo", () => {
    const app = source("src/components/admin/admin-app.tsx");
    const css = source("src/app/ui-fixes.css");

    assert.doesNotMatch(app, /AdminStaticLogo|admin-logo-video/);
    assert.doesNotMatch(css, /admin-content-stage|admin-logo-video|backdrop-filter/);
});

test("the named-invite cleanup tool is dry-run by default and protects active users", () => {
    const script = source("scripts/cleanup-stuck-staff-invites.mjs");
    for (const email of [
        "tettehmikael@gmail.com",
        "samuelbooateng@gmail.com",
        "2ndwavelaundry@gmail.com",
    ])
        assert.ok(script.includes(email));
    assert.match(script, /const APPLY = process\.argv\.includes\("--apply"\)/);
    assert.match(script, /staff_revoke_invitation/);
    assert.match(script, /email_confirmed_at \|\| latest\.last_sign_in_at \|\| latestProfile/);
    assert.match(script, /STAFF_CLEANUP_ACTOR_ID/);
});
