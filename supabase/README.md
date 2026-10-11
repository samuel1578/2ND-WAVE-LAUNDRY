# Supabase migrations

Versioned SQL migrations. Apply them manually with the Supabase CLI or the
dashboard SQL editor — nothing in this repository runs migrations automatically
against a hosted project, and `supabase db reset` must never be run against a
hosted project.

## Execution order

| # | File | Purpose |
| --- | --- | --- |
| 1 | `migrations/20261010120000_admin_profiles.sql` | `private` helper schema, `admin_role` enum, `public.admin_profiles` table, `updated_at` trigger |
| 2 | `migrations/20261010120100_admin_profiles_rls.sql` | RLS enablement, table grants, `private.current_admin_role()` / `private.is_full_admin()`, SELECT policies |

## Other directories

- `bootstrap/` — reviewed provisioning statements. Not migrations; they need a
  real auth user id and are run deliberately by a trusted operator.
  - `001_provision_full_admin.sql` — create the first Full Admin (refuses an
    already-provisioned account).
  - `002_provision_operational_admin.sql` — create an Operational Admin.
  - `003_disable_restore_admin.sql` — revoke or restore access for one account.
  - `004_change_admin_role.sql` — the only supported role change, with an
    explicit confirmation flag.
- `tests/` — database-level privilege and policy checks to run against a local or
  branch database. **Not executed yet**: no local Postgres or Supabase CLI was
  available, and the migrations have not been applied to the hosted project.

## Security notes

- `private` is not exposed by the Supabase Data API, so the security-definer
  helpers cannot be called by a client. `USAGE` on `private` and `EXECUTE` on the
  helpers are granted to `authenticated` only, because RLS policies are evaluated
  as the querying role.
- Both helpers pin `search_path = ''` and fully schema-qualify every identifier.
- No client role can insert, update or delete `admin_profiles`: there is no write
  policy, and the table grants are read-only for `authenticated` with nothing for
  `anon`.

See `docs/implementation/SPRINT_1A_SUPABASE_AUTH.md` for the full activation
procedure.
