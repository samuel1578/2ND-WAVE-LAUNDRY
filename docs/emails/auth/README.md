# Supabase Auth email templates

These templates are pasted into **Supabase Dashboard → Authentication → Email → Templates**. They are sent by Supabase Auth through the custom SMTP configured in the dashboard, not by Brevo.

## Which flows the app uses

The application sends only two kinds of Auth email:

| Supabase template | Triggered by | File | Subject line |
|---|---|---|---|
| **Invite user** | Staff Management → Send Invitation / Resend (`auth.admin.inviteUserByEmail`, `src/lib/admin/staff-service.ts`) | `invite.html`. **The version saved in Supabase is the source of truth.** Export it here when it changes; it is not yet in the repo | (as saved in Supabase) |
| **Reset password** | Admin sign-in → Forgot Password? (`auth.resetPasswordForEmail`, `src/lib/auth/actions.ts`) | `reset-password.html` | Reset your 2nd Wave admin password |

The app never calls sign-up, magic link / OTP sign-in, email change or reauthentication. The **Confirm signup**, **Magic link**, **Change email address** and **Reauthentication** templates are therefore not used by the app and can stay at the Supabase defaults. Turn off **Authentication → Sign In / Providers → Allow new users to sign up** so nobody can create an account with the public key; staff accounts are created only by invitation.

## Link format

Both templates link to `/auth/confirm` with a token hash. The route (`src/app/auth/confirm/route.ts`) verifies it on the server and opens `/admin/set-password`:

- Invite: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/admin/set-password`
- Reset: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/admin/set-password`

`{{ .SiteURL }}` is the **Site URL** under Authentication → URL Configuration. It must be `https://www.2ndwavelaundry.com`.

## Settings to check in the dashboard

- **Email OTP expiry**: governs how long invite and reset links work. The repo documents 3600 seconds (`docs/implementation/STAFF_INVITATION_OPERATIONS.md`). Both templates tell staff the link expires after a short time and to ask a Full Admin if it has.
- **Site URL** and **Redirect URLs**: see `docs/handover/analysis/03-infra-domains.md` §4.
- The templates use only Supabase Go-template variables (`{{ .SiteURL }}`, `{{ .TokenHash }}`, `{{ .Email }}`), inline CSS and table layout. They contain no tracking pixels and no scripts. Images load from `https://www.2ndwavelaundry.com/images/logo.png`.
