# Staff invitation operations and recovery

## What the sprint implementation expected, and what failed

Sprint 1C documents an intended sequence: `inviteUserByEmail` with an explicit callback URL, then an auth callback exchanges a PKCE code or `token_hash`, reconciles the verified email against `admin_invitations`, creates the profile from the stored invitation role, and forwards to `/admin/set-password`. The sprint log also explicitly says that no hosted migration was applied and no real administrator invitation was sent or verified. The repository therefore does **not** establish that this flow previously worked in production.

The checked-in path had three mismatches that explain the observed homepage landing:

1. The application sent invites to `/admin/auth/callback`, while the required password setup page is `/admin/set-password` and the preferred email-template route is `/auth/confirm`.
2. The repository does not configure the hosted Supabase email template. If that template uses `{{ .SiteURL }}` or a default confirmation URL rather than `{{ .ConfirmationURL }}`/the token-hash confirm route, `redirectTo` is ignored and the link returns to the configured Site URL (the public homepage). A hash-fragment token is not sent to a server route.
3. The root homepage had no fragment catcher, and `/admin/set-password` required a server cookie/profile before rendering its form. It could not consume `#access_token` / `#refresh_token` itself, so a legacy implicit-flow link could not establish the session there.

Invitation history previously supported a `revoked` status in the table constraint, but there was no revoke RPC, server action, safe Auth-user cleanup, or resend UI. The invitation list rendered every non-accepted record as “Pending,” masking failed and revoked history. Duplicate Auth-user errors were collapsed into a generic invite failure.

## New invitation path

Preferred email-template HTML:

```text
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/admin/set-password
```

The `/auth/confirm` handler verifies the invite token hash through the SSR Supabase client (which writes the session cookies), accepts only same-origin `/admin/*` `next` paths, and reconciles the profile from the invitation record. The password form calls `supabase.auth.updateUser({ password })` on the server-side session and redirects by the stored role: Full Admin to `/admin`, Operational Admin to `/admin/bookings`. Later access is through `/admin/login` using email and the password just set.

For older implicit-flow links, the public root forwards invitation/recovery fragments to `/admin/set-password`, where the browser client calls `supabase.auth.setSession`. This compatibility path does not take a role from URL or client input; the password-update server action still reconciles against the invitation row.

## Supabase dashboard settings

In **Authentication → URL Configuration**:

- **Site URL:** `https://www.2ndwavelaundry.com` (canonical host used by the invitation template).
- **Redirect URLs:** add both host patterns so Supabase accepts either origin:
  - `https://www.2ndwavelaundry.com/**`
  - `https://2ndwavelaundry.com/**`
- For local development only, add `http://localhost:3000/**`.
- Add each Vercel preview origin explicitly if testing auth there; do not use a broad preview wildcard.

In **Authentication → Email → Email Templates → Invite user**, replace the confirmation link with exactly:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/admin/set-password">Accept invitation</a>
```

Set the **Email OTP expiry** to `3600` seconds (one hour) or a shorter owner-approved value. This expiry governs the invitation/recovery token; do not configure it above Supabase's supported maximum. Once expired, set-password displays: “Link expired. Ask an admin to resend your invitation.”

## Environment variables

Required for a deployment that sends invitations:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the existing legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` fallback)
- `NEXT_PUBLIC_SITE_URL=https://www.2ndwavelaundry.com` (public origin only; used to build the explicit invite `redirectTo`)
- `SUPABASE_SECRET_KEY` **or** legacy `SUPABASE_SERVICE_ROLE_KEY` (server-only; never use a `NEXT_PUBLIC_` name)

`SITE_URL` remains supported as a server-only compatibility fallback and is already used by other email features. Keep it set to the same canonical origin if those features need it. No Supabase key belongs in `NEXT_PUBLIC_SITE_URL`.

## Staff Management invitation controls

Cancel and resend are server actions guarded by the verified Full Admin identity and `staff.manage`. Revocation is recorded through a service-role-only RPC and audited. Auth deletion happens only after a fresh admin-API lookup confirms the email is unconfirmed, has no `last_sign_in_at`, and has no `admin_profiles` row. Confirmed, signed-in, or profiled users are never deleted. Resend uses the email and role returned by the old invitation row, not client-supplied values.

Apply the migration before deploying the new controls:

```text
supabase/migrations/20261102090000_staff_invitation_controls.sql
```

## Safe cleanup for the three named stuck invitations

The dedicated script defaults to a read-only dry run. It targets only the exact three addresses supplied for this task and only selects `pending` or `sent` invitation rows. In apply mode it requires the ID of an active Full Admin for audited revocation, and deletes an Auth user only after checking that it is unconfirmed, never signed in, and has no staff profile. Confirmed, signed-in, or profiled accounts are left unchanged by default.

A read-only dry run during this task found all three Auth accounts already email-confirmed and with sign-in activity, but without an `admin_profiles` row. Therefore **do not use plain `--apply` to clear these three**: the script will intentionally preserve them and leave their invitations untouched. If these sign-ins represent acceptance of the invitations, `--reconcile-confirmed` explicitly completes those outstanding invitations using each stored role (Operational Admin in the current rows); it never accepts a role from the command line or request body. This is a privileged role grant, so only use that flag if the account owners really accepted the invitations.

1. Apply the migration above.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and one server-only elevated key in the shell.
3. Run a dry run and review the current Auth/profile state:

```sh
node scripts/cleanup-stuck-staff-invites.mjs
```

4. For eligible confirmed accounts whose invitation acceptance should be completed, obtain the UID of an active Full Admin and run explicitly:

```powershell
$env:STAFF_CLEANUP_ACTOR_ID = "<verified-active-full-admin-uuid>"
node scripts/cleanup-stuck-staff-invites.mjs --apply --reconcile-confirmed
```

For unconfirmed, never-used users that should instead be cancelled, omit `--reconcile-confirmed`; the script revokes the invitation and deletes only the verified unused Auth user. The script does not guess the actor ID, delete confirmed/active users, or modify a record when no matching outstanding invitation exists. The live cleanup was **not** applied during this task; the dry run is the read-only preflight and the explicit apply flags are left to the project owner after review.
