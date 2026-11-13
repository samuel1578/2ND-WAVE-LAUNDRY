-- 2ND WAVE — Pre-handover cleanup
--
-- Requires 20261026100000_review_submissions.sql, 20261026100300_review_replies.sql,
-- 20261027120000_newsletter_interest.sql, 20261027120100_newsletter_interest_alerts.sql,
-- 20261019120000_email_outbox.sql and 20261011120300_admin_staff_functions.sql
-- (private.insert_audit_event).
--
-- 1. Reviews: anonymous (publishable-key) callers lose all access to
--    public.review_submissions and public.published_reviews. A column grant
--    included reply_body, so draft replies on published reviews were readable
--    through the Data API. The public site now reads the view on the server with
--    the secret key (src/lib/reviews/public-reader.ts). The anon RLS policy is
--    left in place; without a grant it has no effect. authenticated grants are
--    unchanged. service_role is granted SELECT on the view explicitly so the
--    server read does not depend on default privileges.
--
-- 2. Newsletter: public.newsletter_interest_remove lets a Full Admin delete a
--    subscriber who withdraws consent, together with their queued/sent alert
--    rows in email_outbox (delivery events cascade). The audit event records
--    the removal only, never the address.
--
-- Safe to re-run: REVOKE/GRANT are idempotent; the function uses CREATE OR REPLACE.

BEGIN;

-- ============================================================
-- 1. REVIEWS — REMOVE ANON ACCESS
-- ============================================================

-- Revoking at table level also revokes the column-level SELECT grant.
REVOKE ALL ON TABLE public.review_submissions FROM anon;
REVOKE ALL ON TABLE public.published_reviews FROM anon;

GRANT SELECT ON TABLE public.published_reviews TO service_role;

-- ============================================================
-- 2. NEWSLETTER — REMOVE A SUBSCRIBER
-- ============================================================

CREATE OR REPLACE FUNCTION public.newsletter_interest_remove(
    p_actor uuid,
    p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_email text;
    v_outbox integer := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.admin_profiles AS a
        WHERE a.user_id = p_actor AND a.role = 'full_admin' AND a.disabled_at IS NULL
    ) THEN
        RAISE EXCEPTION 'NEWSLETTER_FORBIDDEN: an active Full Admin is required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_id IS NULL THEN
        RAISE EXCEPTION 'NEWSLETTER_NOT_FOUND: the subscriber no longer exists.'
            USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.newsletter_interest AS n
    WHERE n.id = p_id
    RETURNING n.email INTO v_email;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NEWSLETTER_NOT_FOUND: the subscriber no longer exists.'
            USING ERRCODE = 'P0002';
    END IF;

    -- The manager alert payload holds the subscriber address; remove those rows
    -- too (email_delivery_events cascade from email_outbox).
    DELETE FROM public.email_outbox AS o
    WHERE o.template = 'newsletter_interest_received'
      AND lower(o.payload ->> 'subscriber_email') = lower(v_email);
    GET DIAGNOSTICS v_outbox = ROW_COUNT;

    PERFORM private.insert_audit_event(
        p_actor,
        'newsletter.interest_removed',
        'newsletter_interest',
        p_id::text,
        NULL,
        jsonb_build_object('removed', true),
        NULL,
        NULL
    );

    RETURN jsonb_build_object('removed', true, 'outbox_removed', v_outbox);
END;
$$;

COMMENT ON FUNCTION public.newsletter_interest_remove(uuid, uuid) IS
'Full Admin only. Permanently deletes a newsletter_interest row and the newsletter alert email_outbox rows carrying that address; audits the removal without the address. Service-role only.';

REVOKE ALL ON FUNCTION public.newsletter_interest_remove(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_interest_remove(uuid, uuid) TO service_role;

COMMIT;
