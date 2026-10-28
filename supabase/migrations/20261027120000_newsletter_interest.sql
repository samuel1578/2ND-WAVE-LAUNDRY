-- Phase 5 MVP — newsletter interest persistence (submissions only).
--
-- Requires:
--   * 20261011120000_admin_profiles.sql / private schema helpers
--   * 20261019120000_email_outbox.sql (public.email_template enum)
--
-- Scope of this migration:
--   * one enum value for the manager alert template (used by the next
--     migration; the value must be committed before any constraint or
--     function may reference it);
--   * public.newsletter_interest — the minimal, consented, first-time-only
--     interest record. Email is unique and normalised; a duplicate submission
--     is a no-op and never queues a second manager alert.
--
-- Deliberately NOT implemented (deferred to a future authorised phase):
--   * subscriber statuses, withdrawal, unsubscribe tokens, suppression,
--     Brevo contact sync, campaigns or any subscriber-facing email.
--
-- Forward-only: no earlier migration is edited.

BEGIN;

-- ============================================================
-- 1. MANAGER ALERT TEMPLATE
-- ============================================================

ALTER TYPE public.email_template
    ADD VALUE IF NOT EXISTS 'newsletter_interest_received';

COMMENT ON TYPE public.email_template IS
'Transactional notification templates. Customer templates were added in Sprint 2D.1; staff_order_* templates in Phase 2E.1; newsletter_interest_received (internal manager alert only) in the Phase 5 MVP. A new value requires a forward-only migration and a saved Brevo template.';

-- ============================================================
-- 2. NEWSLETTER INTEREST TABLE
-- ============================================================
--
-- One row per first-time consented address. The manager alert email (queued by
-- the next migration) is the operational notification; this table is the
-- durable subscriber record for the administration console. No status machine:
-- rows are append-only and never updated after insert.

CREATE TABLE public.newsletter_interest (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Normalised lower-case address. Enforced, so a duplicate that differs only
    -- in case or surrounding whitespace collides on the unique index.
    email text NOT NULL,

    -- Server-read approved consent wording version (never browser-supplied).
    consent_version text NOT NULL,

    -- Fixed provenance for this phase; no client-controlled source value.
    source text NOT NULL DEFAULT 'public_newsletter_form',

    -- Hashed submitter address for rate-limit forensics; never a raw IP.
    source_ip_hash text,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT newsletter_interest_email_unique UNIQUE (email),

    CONSTRAINT newsletter_interest_email_normalised
        CHECK (email = lower(btrim(email))),

    CONSTRAINT newsletter_interest_email_shape
        CHECK (
            char_length(email) BETWEEN 3 AND 254
            AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        ),

    CONSTRAINT newsletter_interest_consent_version_length
        CHECK (char_length(btrim(consent_version)) BETWEEN 1 AND 60),

    CONSTRAINT newsletter_interest_source_shape
        CHECK (source = 'public_newsletter_form'),

    CONSTRAINT newsletter_interest_source_ip_hash_shape
        CHECK (source_ip_hash IS NULL OR source_ip_hash ~ '^[a-f0-9]{32,64}$')
);

COMMENT ON TABLE public.newsletter_interest IS
'Private, consented newsletter interest submissions (Phase 5 MVP). One row per first-time address; the manager alert is queued only for a newly inserted row. No statuses, withdrawal or campaign state in this phase.';
COMMENT ON COLUMN public.newsletter_interest.email IS
'Normalised lower-case submitter address; unique. Not a booking email and never created by a booking flow.';
COMMENT ON COLUMN public.newsletter_interest.consent_version IS
'Server-read approved opt-in wording version captured with the submission.';

CREATE INDEX newsletter_interest_created_idx
    ON public.newsletter_interest (created_at DESC);

-- The record is append-only: original submission fields never change.
CREATE OR REPLACE FUNCTION private.newsletter_interest_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.email IS DISTINCT FROM OLD.email
       OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'NEWSLETTER_INTEREST_IMMUTABLE: original submission fields cannot be changed.'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.newsletter_interest_immutable()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER newsletter_interest_immutable
    BEFORE UPDATE ON public.newsletter_interest
    FOR EACH ROW EXECUTE FUNCTION private.newsletter_interest_immutable();

-- Deny-by-default: no client role can read or write interest records. Reads in
-- the administration console go through the permission-checked server route
-- with the elevated key; writes only through the trusted submit function.
ALTER TABLE public.newsletter_interest ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.newsletter_interest
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE public.newsletter_interest TO service_role;

-- Read-only verification.
SELECT
    relname AS table_name,
    relrowsecurity AS rls_enabled
FROM pg_class
WHERE oid = 'public.newsletter_interest'::regclass;

COMMIT;
