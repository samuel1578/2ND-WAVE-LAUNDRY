#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TARGET_EMAILS = [
    "tettehmikael@gmail.com",
    "samuelbooateng@gmail.com",
    "2ndwavelaundry@gmail.com",
];
const APPLY = process.argv.includes("--apply");
const RECONCILE_CONFIRMED = process.argv.includes("--reconcile-confirmed");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const ACTOR_ID = process.env.STAFF_CLEANUP_ACTOR_ID;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and a server-only SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(2);
}
if (APPLY && !ACTOR_ID) {
    console.error("Apply mode requires STAFF_CLEANUP_ACTOR_ID for an active Full Admin; the revoke RPC verifies it.");
    process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

async function allAuthUsers() {
    const users = [];
    for (let page = 1; page <= 100; page += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(`Auth user scan failed: ${error.code ?? "provider error"}`);
        users.push(...data.users);
        if (data.users.length < 1000) return users;
    }
    throw new Error("Auth user scan exceeded the safety page limit; no cleanup was applied.");
}

function userForEmail(users, email, linkedId) {
    const normalized = email.toLowerCase();
    return users.find((user) => user.id === linkedId && user.email?.toLowerCase() === normalized)
        ?? users.find((user) => user.email?.trim().toLowerCase() === normalized)
        ?? null;
}

async function run() {
    const users = await allAuthUsers();
    let foundCount = 0;

    for (const email of TARGET_EMAILS) {
        const { data: invitations, error } = await supabase
            .from("admin_invitations")
            .select("id,email,role,status,auth_user_id")
            .eq("email", email)
            .in("status", ["pending", "sent"])
            .order("created_at", { ascending: false });
        if (error) throw new Error(`Invitation lookup failed for ${email}: ${error.code ?? "database error"}`);

        const invitation = invitations?.[0];
        if (!invitation) {
            console.log(`${email}: no pending/sent invitation; left unchanged.`);
            continue;
        }
        foundCount += 1;

        const authUser = userForEmail(users, email, invitation.auth_user_id);
        const confirmed = Boolean(authUser?.email_confirmed_at);
        const signedIn = Boolean(authUser?.last_sign_in_at);
        const { data: profile, error: profileError } = authUser
            ? await supabase.from("admin_profiles").select("user_id").eq("user_id", authUser.id).maybeSingle()
            : { data: null, error: null };
        if (profileError) throw new Error(`Profile lookup failed for ${email}; no cleanup was applied.`);
        const protectedAccount = confirmed || signedIn || Boolean(profile);

        const reconcileThisUser =
            RECONCILE_CONFIRMED && confirmed && !profile && Boolean(authUser);
        console.log(JSON.stringify({
            email,
            invitationId: invitation.id,
            status: invitation.status,
            role: invitation.role,
            authUserId: authUser?.id ?? null,
            emailConfirmed: confirmed,
            lastSignInAt: authUser?.last_sign_in_at ?? null,
            hasAdminProfile: Boolean(profile),
            action: !APPLY
                ? reconcileThisUser
                    ? "dry-run: would accept using the role stored in this invitation"
                    : protectedAccount
                        ? "dry-run: protected account; leave unchanged"
                        : "dry-run: would revoke and delete only an unconfirmed, never-used Auth user"
                : reconcileThisUser
                    ? "accept only with --reconcile-confirmed; use the invitation's stored role"
                    : protectedAccount
                        ? "protected account; skip without changing invitation or Auth user"
                        : "revoke; delete only an unconfirmed, never-used Auth user",
        }));

        if (!APPLY) continue;

        if (protectedAccount) {
            if (reconcileThisUser) {
                const { error: completeError } = await supabase.rpc("staff_complete_invitation", {
                    p_invitation: invitation.id,
                    p_user_id: authUser.id,
                    p_email: email,
                    p_correlation: randomUUID(),
                });
                if (completeError) throw new Error(`Invitation reconciliation failed for ${email}: ${completeError.code ?? "RPC rejected"}`);
                console.log(`${email}: invitation accepted; profile role came from the invitation record.`);
            } else {
                console.log(`${email}: account is confirmed, signed-in, or profiled; both Auth user and invitation were left unchanged.`);
            }
            continue;
        }

        const { error: revokeError } = await supabase.rpc("staff_revoke_invitation", {
            p_actor: ACTOR_ID,
            p_invitation: invitation.id,
            p_correlation: randomUUID(),
        });
        if (revokeError) throw new Error(`Revocation failed for ${email}: ${revokeError.code ?? "RPC rejected"}`);

        if (authUser) {
            const { data: latestResult, error: latestError } = await supabase.auth.admin.getUserById(authUser.id);
            if (latestError || !latestResult.user) throw new Error(`Invitation revoked, but current Auth state could not be verified for ${email}; user was not deleted.`);
            const latest = latestResult.user;
            const { data: latestProfile, error: latestProfileError } = await supabase
                .from("admin_profiles")
                .select("user_id")
                .eq("user_id", authUser.id)
                .maybeSingle();
            if (latestProfileError) throw new Error(`Invitation revoked, but profile state could not be verified for ${email}; user was not deleted.`);
            if (latest.email?.trim().toLowerCase() !== email || latest.email_confirmed_at || latest.last_sign_in_at || latestProfile) {
                console.log(`${email}: invitation revoked; latest state is confirmed/active/profiled, so Auth user was preserved.`);
                continue;
            }
            const { error: deleteError } = await supabase.auth.admin.deleteUser(authUser.id);
            if (deleteError) throw new Error(`Invitation revoked, but safe Auth-user deletion failed for ${email}: ${deleteError.code ?? "provider error"}`);
            console.log(`${email}: revoked; unconfirmed, never-used Auth user deleted.`);
        } else {
            console.log(`${email}: revoked; no Auth user existed.`);
        }
    }

    if (!foundCount) console.log("No matching pending/sent invitations were found for the explicit target list.");
    if (!APPLY) console.log("Dry run complete. Review each row, set STAFF_CLEANUP_ACTOR_ID, then rerun with --apply to execute.");
}

run().catch((error) => {
    console.error(error instanceof Error ? error.message : "Cleanup failed.");
    process.exitCode = 1;
});
