-- Sprint 3C — reply drafting and publication for review submissions.
-- Forward-only addition. Do not apply to the hosted project as part of this sprint.
--
-- Reply state machine (from the Phase 3-5 plan):
--   none -> draft -> published
--   draft <-> draft (edit)
--   published -> new draft -> published v2
--
-- A new draft over a published reply copies the prior published text into an
-- append-only revision row before replacing it. Audit events record the state
-- transition only: the project's audit rule forbids customer/admin bodies in
-- audit payloads.

BEGIN;

-- =========================================================
-- 0. PUBLIC SURFACE REFINEMENT
-- =========================================================
--
-- Sprint 3A removed a whole review from public view while a reply draft existed.
-- Sprint 3C allows a replacement reply to be drafted over a published reply, so
-- the review itself must stay visible: the approved publication is unchanged and
-- only the draft reply is withheld. The view's CASE already exposes reply_body
-- exclusively for `reply_status = 'published'`.

DROP POLICY IF EXISTS review_submissions_public_published_read
    ON public.review_submissions;

CREATE POLICY review_submissions_public_published_read
    ON public.review_submissions FOR SELECT TO anon, authenticated
    USING (
        moderation_status = 'approved'
        AND consent IS TRUE
        AND body_published IS NOT NULL
        AND deleted_at IS NULL
    );

CREATE OR REPLACE VIEW public.published_reviews
WITH (security_invoker = true)
AS
SELECT
    id,
    customer_name,
    rating,
    branch,
    body_published,
    published_at,
    published_version,
    CASE WHEN reply_status = 'published' THEN reply_body ELSE NULL END AS reply_body,
    CASE WHEN reply_status = 'published' THEN reply_published_at ELSE NULL END AS reply_published_at
FROM public.review_submissions
WHERE moderation_status = 'approved'
  AND consent IS TRUE
  AND body_published IS NOT NULL
  AND deleted_at IS NULL;

REVOKE ALL ON public.published_reviews FROM PUBLIC, authenticated;
GRANT SELECT ON public.published_reviews TO anon, authenticated;

-- =========================================================
-- 1. PRIOR PUBLISHED REPLY RETAINMENT
-- =========================================================

CREATE TABLE public.review_reply_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id uuid NOT NULL REFERENCES public.review_submissions(id) ON DELETE CASCADE,
    body text NOT NULL,
    reply_published_at timestamptz,
    replaced_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    replaced_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT review_reply_revision_body_length
        CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000)
);

COMMENT ON TABLE public.review_reply_revisions IS
'Append-only retained copies of previously published administrative replies. Replaced text never appears in audit payloads.';

CREATE INDEX review_reply_revisions_review_idx
    ON public.review_reply_revisions (review_id, replaced_at DESC);

CREATE OR REPLACE FUNCTION private.review_reply_revision_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'REVIEW_REPLY_REVISION_IMMUTABLE: retained replies are append-only.'
        USING ERRCODE = 'P0001';
END;
$$;
REVOKE ALL ON FUNCTION private.review_reply_revision_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER review_reply_revision_immutable
    BEFORE UPDATE OR DELETE ON public.review_reply_revisions
    FOR EACH ROW EXECUTE FUNCTION private.review_reply_revision_immutable();

ALTER TABLE public.review_reply_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.review_reply_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.review_reply_revisions TO authenticated;
GRANT SELECT, INSERT ON TABLE public.review_reply_revisions TO service_role;

CREATE POLICY review_reply_revisions_admin_read
    ON public.review_reply_revisions FOR SELECT TO authenticated
    USING (private.current_admin_role() IS NOT NULL);

-- =========================================================
-- 2. DRAFT (create or edit a reply, retaining a prior publication)
-- =========================================================

CREATE OR REPLACE FUNCTION public.review_draft_reply(
    p_actor uuid,
    p_review uuid,
    p_body text,
    p_expected_version integer,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_review public.review_submissions%ROWTYPE;
    v_body text := nullif(btrim(coalesce(p_body, '')), '');
    v_previous_status public.review_reply_status;
BEGIN
    PERFORM private.assert_review_actor(p_actor, false);

    IF v_body IS NULL OR char_length(v_body) > 4000 THEN
        RAISE EXCEPTION 'REVIEW_INVALID_REPLY: enter a reply between 1 and 4000 characters.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_review
    FROM public.review_submissions
    WHERE id = p_review
    FOR UPDATE;

    IF NOT FOUND OR v_review.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'REVIEW_NOT_FOUND: this review is no longer available.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_expected_version IS NULL OR v_review.version <> p_expected_version THEN
        RAISE EXCEPTION 'REVIEW_CONFLICT: this review changed; reload before editing the reply.'
            USING ERRCODE = 'P0001';
    END IF;

    v_previous_status := v_review.reply_status;

    -- Replacing a published reply retains the prior text outside the audit log.
    IF v_previous_status = 'published' AND v_review.reply_body IS NOT NULL THEN
        INSERT INTO public.review_reply_revisions (
            review_id,
            body,
            reply_published_at,
            replaced_by
        ) VALUES (
            v_review.id,
            v_review.reply_body,
            v_review.reply_published_at,
            p_actor
        );
    END IF;

    UPDATE public.review_submissions
    SET reply_body = v_body,
        reply_status = 'draft',
        reply_published_at = NULL,
        reply_published_by = NULL,
        version = version + 1
    WHERE id = p_review
    RETURNING * INTO v_review;

    PERFORM private.insert_audit_event(
        p_actor,
        'review.reply_drafted',
        'review',
        p_review::text,
        jsonb_build_object('reply_status', v_previous_status),
        jsonb_build_object('reply_status', 'draft'),
        NULL,
        p_correlation
    );

    RETURN jsonb_build_object(
        'review_id', v_review.id,
        'reply_status', v_review.reply_status,
        'version', v_review.version
    );
END;
$$;

COMMENT ON FUNCTION public.review_draft_reply(uuid, uuid, text, integer, uuid) IS
'Creates or edits a reply draft, retaining a replaced published reply in the append-only revision table. Any active administrator; service_role only.';

-- =========================================================
-- 3. PUBLISH REPLY
-- =========================================================

CREATE OR REPLACE FUNCTION public.review_reply_publish(
    p_actor uuid,
    p_review uuid,
    p_expected_version integer,
    p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_review public.review_submissions%ROWTYPE;
BEGIN
    PERFORM private.assert_review_actor(p_actor, false);

    SELECT * INTO v_review
    FROM public.review_submissions
    WHERE id = p_review
    FOR UPDATE;

    IF NOT FOUND OR v_review.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'REVIEW_NOT_FOUND: this review is no longer available.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_expected_version IS NULL OR v_review.version <> p_expected_version THEN
        RAISE EXCEPTION 'REVIEW_CONFLICT: this review changed; reload before publishing the reply.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_review.reply_status <> 'draft' OR v_review.reply_body IS NULL THEN
        RAISE EXCEPTION 'REVIEW_INVALID_TRANSITION: save a reply draft before publishing it.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_review.moderation_status <> 'approved' THEN
        RAISE EXCEPTION 'REVIEW_INVALID_TRANSITION: approve the review before publishing a reply.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_review.consent IS NOT TRUE OR v_review.body_published IS NULL THEN
        RAISE EXCEPTION 'REVIEW_INVALID_TRANSITION: publish the review before publishing a reply.'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.review_submissions
    SET reply_status = 'published',
        reply_published_at = now(),
        reply_published_by = p_actor,
        version = version + 1
    WHERE id = p_review
    RETURNING * INTO v_review;

    PERFORM private.insert_audit_event(
        p_actor,
        'review.reply_published',
        'review',
        p_review::text,
        jsonb_build_object('reply_status', 'draft'),
        jsonb_build_object('reply_status', 'published'),
        NULL,
        p_correlation
    );

    RETURN jsonb_build_object(
        'review_id', v_review.id,
        'reply_status', v_review.reply_status,
        'version', v_review.version
    );
END;
$$;

COMMENT ON FUNCTION public.review_reply_publish(uuid, uuid, integer, uuid) IS
'Makes a saved reply draft publicly visible under an approved, published review. Any active administrator; service_role only.';

-- =========================================================
-- 4. EXECUTION PRIVILEGES
-- =========================================================

REVOKE ALL ON FUNCTION public.review_draft_reply(uuid, uuid, text, integer, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_draft_reply(uuid, uuid, text, integer, uuid)
    TO service_role;

REVOKE ALL ON FUNCTION public.review_reply_publish(uuid, uuid, integer, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_reply_publish(uuid, uuid, integer, uuid)
    TO service_role;

COMMIT;
