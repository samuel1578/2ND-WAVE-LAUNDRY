-- 2ND WAVE — Phase 2E.1
-- Central administrator/staff alert recipient list.
--
-- Requires the Sprint 2A schema (in particular `private.touch_updated_at`) and
-- the Sprint 2D.1 `public.email_template` enum.
--
-- Scope of this migration:
--   * public.booking_alert_recipients — the single central list every staff
--     order alert is fanned out to. No per-order recipient list exists.
--   * five staff order templates added to the existing `public.email_template`
--     enum, so the Phase 2D outbox, worker and monitoring surfaces are reused
--     instead of building a second delivery system.
--   * deny-by-default RLS: no client role can read or write the list.
--
-- Deliberately NOT implemented here (Sprint 2E.2):
--   * no administrator interface, settings panel, test-send or invite flow;
--   * no seeded addresses. An empty list is valid and sends nothing.
--
-- Forward-only: no earlier migration is edited.

BEGIN;

-- ============================================================
-- 1. STAFF ORDER TEMPLATES
-- ============================================================
--
-- The enum is shared with the Phase 2D customer notifications. Staff alerts are
-- distinguished by an explicit prefix rather than by a second enum or a second
-- outbox table, so the existing claim/retry/monitoring machinery drains them.
-- Only the five required order events are added; there is no staff event for
-- confirmed, scheduled, picked_up or out_for_delivery.

ALTER TYPE public.email_template ADD VALUE IF NOT EXISTS 'staff_order_pending';
ALTER TYPE public.email_template ADD VALUE IF NOT EXISTS 'staff_order_processing';
ALTER TYPE public.email_template ADD VALUE IF NOT EXISTS 'staff_order_ready';
ALTER TYPE public.email_template ADD VALUE IF NOT EXISTS 'staff_order_completed';
ALTER TYPE public.email_template ADD VALUE IF NOT EXISTS 'staff_order_cancelled';

COMMENT ON TYPE public.email_template IS
'Transactional notification templates. Customer templates were added in Sprint 2D.1; staff_order_* templates added in Phase 2E.1. A new value requires a forward-only migration and a saved Brevo template.';

-- ============================================================
-- 2. CENTRAL RECIPIENT LIST
-- ============================================================
--
-- One row per authorised staff alert address. This is the only recipient source
-- for all five staff order events; the enqueue helper reads it directly so the
-- notification engine has a single integration point. Sprint 2E.2 adds the
-- administrator interface and any additional persistence around this table.
--
-- `version` is the optimistic-concurrency token for the future write path. It is
-- not incremented by a trigger because the Sprint 2E.2 update function owns its
-- compare-and-set semantics.

CREATE TABLE public.booking_alert_recipients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Normalised lower-case address. Enforced, so callers cannot store a
    -- duplicate that differs only by case.
    email text NOT NULL,
    label text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT true,

    version integer NOT NULL DEFAULT 1,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT booking_alert_recipients_email_unique UNIQUE (email),

    CONSTRAINT booking_alert_recipients_email_normalised
        CHECK (email = lower(btrim(email))),

    CONSTRAINT booking_alert_recipients_email_shape
        CHECK (
            char_length(email) BETWEEN 3 AND 254
            AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        ),

    CONSTRAINT booking_alert_recipients_label_length
        CHECK (char_length(label) <= 80),

    CONSTRAINT booking_alert_recipients_version
        CHECK (version >= 1)
);

COMMENT ON TABLE public.booking_alert_recipients IS
'Central authorised recipient list for staff/admin order alerts. All five staff order events fan out to the enabled rows here; there are no per-order recipients. Managed by Sprint 2E.2; never readable or writable by a client role.';

COMMENT ON COLUMN public.booking_alert_recipients.email IS
'Normalised lower-case alert address. The outbox copies it at enqueue time; changing this row never redirects an already-queued message.';

COMMENT ON COLUMN public.booking_alert_recipients.enabled IS
'Only enabled rows receive new alerts. Disabling a recipient does not delete its delivery history.';

COMMENT ON COLUMN public.booking_alert_recipients.version IS
'Optimistic-concurrency token for the Sprint 2E.2 management write path.';

CREATE INDEX booking_alert_recipients_enabled_idx
ON public.booking_alert_recipients (enabled)
WHERE enabled;

CREATE TRIGGER booking_alert_recipients_touch
BEFORE UPDATE ON public.booking_alert_recipients
FOR EACH ROW
EXECUTE FUNCTION private.touch_updated_at();

-- ============================================================
-- 3. BOUNDED FAN-OUT
-- ============================================================
--
-- A hard server-side cap keeps one order event from fanning out to an unbounded
-- recipient set, and keeps the per-event Brevo volume predictable. The cap is
-- enforced in the database so it cannot be bypassed by a future caller.

CREATE OR REPLACE FUNCTION private.enforce_booking_alert_recipient_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_enabled integer;
BEGIN
    IF NEW.enabled THEN
        -- Serialize enabled-count checks across concurrent administrator writes.
        -- Without this transaction lock, two inserts at nine recipients could
        -- both observe nine and commit an eleventh recipient.
        PERFORM pg_advisory_xact_lock(
            hashtext('2ndwave.booking_alert_recipients.enabled_cap')
        );

        SELECT count(*) INTO v_enabled
        FROM public.booking_alert_recipients AS r
        WHERE r.enabled
          AND r.id <> NEW.id;

        IF v_enabled >= 10 THEN
            RAISE EXCEPTION
                'BOOKING_ALERT_RECIPIENTS_LIMIT: at most 10 enabled recipients are allowed.'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.enforce_booking_alert_recipient_cap() IS
'Rejects an insert/update that would make more than 10 alert recipients enabled. Trigger-only.';

REVOKE ALL ON FUNCTION private.enforce_booking_alert_recipient_cap()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER booking_alert_recipients_cap
BEFORE INSERT OR UPDATE OF enabled ON public.booking_alert_recipients
FOR EACH ROW
EXECUTE FUNCTION private.enforce_booking_alert_recipient_cap();

-- ============================================================
-- 4. ROW LEVEL SECURITY AND GRANTS
-- ============================================================
--
-- Same deny-by-default model as public.email_outbox: RLS is enabled with no
-- policy for any client role. The trusted server uses the elevated role. The
-- Sprint 2E.2 interface must authorise a Full Admin before touching this table
-- through an elevated server client.

ALTER TABLE public.booking_alert_recipients ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_alert_recipients FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.booking_alert_recipients FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_alert_recipients
TO service_role;

COMMIT;

-- ============================================================
-- 5. READ-ONLY VERIFICATION
-- ============================================================

-- Expected: rls_enabled = true and policies = 0.
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    count(p.polname) AS policies
FROM pg_class AS c
LEFT JOIN pg_policy AS p ON p.polrelid = c.oid
WHERE c.oid = 'public.booking_alert_recipients'::regclass
GROUP BY c.relname, c.relrowsecurity;

-- Expected: false for anon/authenticated, true for service_role.
SELECT
    has_table_privilege('anon', 'public.booking_alert_recipients', 'SELECT') AS anon_select,
    has_table_privilege('authenticated', 'public.booking_alert_recipients', 'SELECT') AS auth_select,
    has_table_privilege('service_role', 'public.booking_alert_recipients', 'SELECT') AS service_select;

-- Expected: the five staff templates are present on the enum.
SELECT e.enumlabel AS template
FROM pg_enum AS e
JOIN pg_type AS t ON t.oid = e.enumtypid
WHERE t.typname = 'email_template'
  AND e.enumlabel LIKE 'staff_order_%'
ORDER BY e.enumlabel;
