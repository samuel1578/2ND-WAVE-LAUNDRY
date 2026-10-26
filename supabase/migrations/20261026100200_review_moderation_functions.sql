-- Sprint 3B — trusted review moderation, publication, re-open and override.
-- Forward-only addition. Do not apply to the hosted project as part of this sprint.
--
-- Every entry point is SECURITY DEFINER with an empty search_path, executable only
-- by service_role, and re-validates the acting administrator against
-- public.admin_profiles. A decision, its optimistic version check and its audit
-- event are written in one transaction: either all of it happened or none of it
-- did. Audit payloads carry state identifiers and reasons only — never customer
-- text, moderation notes or IP hashes.

BEGIN;

-- =========================================================
-- 1. ACTOR VERIFICATION
-- =========================================================

CREATE OR REPLACE FUNCTION private.review_actor_role(p_actor uuid)
RETURNS public.admin_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT ap.role
    FROM public.admin_profiles AS ap
    WHERE ap.user_id = p_actor
      AND ap.disabled_at IS NULL;
$$;

REVOKE ALL ON FUNCTION private.review_actor_role(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.assert_review_actor(
    p_actor uuid,
    p_full_admin_only boolean
)
RETURNS public.admin_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.admin_role;
BEGIN
    IF p_actor IS NULL THEN
        RAISE EXCEPTION 'REVIEW_ACTOR_REQUIRED: no administrator identity.'
            USING ERRCODE = 'P0001';
    END IF;

    v_role := private.review_actor_role(p_actor);

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'REVIEW_FORBIDDEN: an active administrator is required.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_full_admin_only AND v_role <> 'full_admin' THEN
        RAISE EXCEPTION 'REVIEW_FORBIDDEN: a Full Admin is required for this action.'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_review_actor(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- =========================================================
-- 2. MODERATE (pending -> approved | rejected)
-- =========================================================

CREATE OR REPLACE FUNCTION public.review_moderate(
    p_actor uuid,
    p_review uuid,
    p_decision text,
    p_note text,
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
    v_note text := nullif(btrim(coalesce(p_note, '')), '');
    v_previous public.review_moderation_status;
BEGIN
    PERFORM private.assert_review_actor(p_actor, false);

    IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'REVIEW_INVALID_OPERATION: choose approve or reject.'
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
        RAISE EXCEPTION 'REVIEW_CONFLICT: this review changed; reload before deciding.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_review.moderation_status <> 'pending' THEN
        RAISE EXCEPTION 'REVIEW_INVALID_TRANSITION: this review has already been decided.'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_decision = 'rejected' AND v_note IS NULL THEN
        RAISE EXCEPTION 'REVIEW_NOTE_REQUIRED: record a reason before rejecting a review.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
        RAISE EXCEPTION 'REVIEW_INVALID_NOTE: the note is too long.'
            USING ERRCODE = 'P0001';
    END IF;

    v_previous := v_review.moderation_status;

    UPDATE public.review_submissions
    SET moderation_status = p_decision::public.review_moderation_status,
        moderated_by = p_actor,
        moderated_at = now(),
        moderation_note = v_note,
        version = version + 1
    WHERE id = p_review
    RETURNING * INTO v_review;

    PERFORM private.insert_audit_event(
        p_actor,
        CASE
            WHEN p_decision = 'approved' THEN 'review.approved'
            ELSE 'review.rejected'
        END,
        'review',
        p_review::text,
        jsonb_build_object('moderation_status', v_previous),
        jsonb_build_object('moderation_status', v_review.moderation_status),
        v_note,
        p_correlation
    );

    RETURN jsonb_build_object(
        'review_id', v_review.id,
        'moderation_status', v_review.moderation_status,
        'published', v_review.body_published IS NOT NULL,
        'published_version', v_review.published_version,
        'version', v_review.version
    );
END;
$$;

COMMENT ON FUNCTION public.review_moderate(uuid, uuid, text, text, integer, uuid) IS
'Approves or rejects one pending review under optimistic concurrency, writing its audit event in the same transaction. Any active administrator; service_role only.';

-- =========================================================
-- 3. PUBLISH / UNPUBLISH / UPDATE PUBLICATION VERSION
-- =========================================================

CREATE OR REPLACE FUNCTION public.review_publish(
    p_actor uuid,
    p_review uuid,
    p_action text,
    p_body_published text,
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
    v_body text := nullif(btrim(coalesce(p_body_published, '')), '');
    v_action text := btrim(coalesce(p_action, ''));
    v_action_name text;
    v_previous_status public.review_moderation_status;
    v_previous_published boolean;
BEGIN
    PERFORM private.assert_review_actor(p_actor, false);

    IF v_action NOT IN ('publish', 'unpublish', 'update') THEN
        RAISE EXCEPTION 'REVIEW_INVALID_OPERATION: unsupported publication action.'
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
        RAISE EXCEPTION 'REVIEW_CONFLICT: this review changed; reload before publishing.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_action IN ('publish', 'update') THEN
        IF v_review.moderation_status <> 'approved' THEN
            RAISE EXCEPTION 'REVIEW_INVALID_TRANSITION: approve the review before publishing it.'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_review.consent IS NOT TRUE THEN
            RAISE EXCEPTION 'REVIEW_CONSENT_REQUIRED: publication permission is not recorded.'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_body IS NULL OR char_length(v_body) > 4000 THEN
            RAISE EXCEPTION 'REVIEW_INVALID_BODY: enter the text to publish, up to 4000 characters.'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    v_previous_status := v_review.moderation_status;
    v_previous_published := v_review.body_published IS NOT NULL;

    IF v_action = 'publish' THEN
        IF v_review.body_published IS NOT NULL THEN
            RAISE EXCEPTION 'REVIEW_INVALID_TRANSITION: this review is already published; publish a new version instead.'
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.review_submissions
        SET body_published = v_body,
            published_at = now(),
            published_by = p_actor,
            published_version = 1,
            version = version + 1
        WHERE id = p_review
        RETURNING * INTO v_review;

        v_action_name := 'review.published';
    ELSIF v_action = 'update' THEN
        IF v_review.body_published IS NULL THEN
            RAISE EXCEPTION 'REVIEW_INVALID_TRANSITION: publish the review before editing its public version.'
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.review_submissions
        SET body_published = v_body,
            published_at = now(),
            published_by = p_actor,
            published_version = coalesce(published_version, 0) + 1,
            version = version + 1
        WHERE id = p_review
        RETURNING * INTO v_review;

        v_action_name := 'review.publication_updated';
    ELSE
        IF v_review.body_published IS NULL THEN
            RAISE EXCEPTION 'REVIEW_STATE_UNCHANGED: this review is not published.'
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.review_submissions
        SET body_published = NULL,
            published_at = NULL,
            published_by = NULL,
            published_version = NULL,
            version = version + 1
        WHERE id = p_review
        RETURNING * INTO v_review;

        v_action_name := 'review.unpublished';
    END IF;

    PERFORM private.insert_audit_event(
        p_actor,
        v_action_name,
        'review',
        p_review::text,
        jsonb_build_object(
            'moderation_status', v_previous_status,
            'published', v_previous_published
        ),
        jsonb_build_object(
            'moderation_status', v_review.moderation_status,
            'published', v_review.body_published IS NOT NULL,
            'published_version', v_review.published_version
        ),
        NULL,
        p_correlation
    );

    RETURN jsonb_build_object(
        'review_id', v_review.id,
        'moderation_status', v_review.moderation_status,
        'published', v_review.body_published IS NOT NULL,
        'published_version', v_review.published_version,
        'version', v_review.version
    );
END;
$$;

COMMENT ON FUNCTION public.review_publish(uuid, uuid, text, text, integer, uuid) IS
'Publishes, unpublishes or edits the public version of an approved review. body_original is never touched. Any active administrator; service_role only.';

-- =========================================================
-- 4. RE-OPEN (rejected -> pending, Full Admin only)
-- =========================================================

CREATE OR REPLACE FUNCTION public.review_open(
    p_actor uuid,
    p_review uuid,
    p_reason text,
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
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
    PERFORM private.assert_review_actor(p_actor, true);

    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'REVIEW_REASON_REQUIRED: record a reason for re-opening the review.'
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
        RAISE EXCEPTION 'REVIEW_CONFLICT: this review changed; reload before re-opening.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_review.moderation_status <> 'rejected' THEN
        RAISE EXCEPTION 'REVIEW_INVALID_TRANSITION: only a rejected review can be re-opened.'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.review_submissions
    SET moderation_status = 'pending',
        moderated_by = NULL,
        moderated_at = NULL,
        moderation_note = NULL,
        body_published = NULL,
        published_at = NULL,
        published_by = NULL,
        published_version = NULL,
        version = version + 1
    WHERE id = p_review
    RETURNING * INTO v_review;

    PERFORM private.insert_audit_event(
        p_actor,
        'review.reopened',
        'review',
        p_review::text,
        jsonb_build_object('moderation_status', 'rejected'),
        jsonb_build_object('moderation_status', 'pending'),
        v_reason,
        p_correlation
    );

    RETURN jsonb_build_object(
        'review_id', v_review.id,
        'moderation_status', v_review.moderation_status,
        'published', false,
        'published_version', NULL,
        'version', v_review.version
    );
END;
$$;

COMMENT ON FUNCTION public.review_open(uuid, uuid, text, integer, uuid) IS
'Re-opens a rejected review as pending with a mandatory reason. Full Admin only; service_role only.';

-- =========================================================
-- 5. OVERRIDE (Full Admin only, mandatory reason)
-- =========================================================

CREATE OR REPLACE FUNCTION public.review_override(
    p_actor uuid,
    p_review uuid,
    p_operation text,
    p_reason text,
    p_body_published text,
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
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
    v_body text := nullif(btrim(coalesce(p_body_published, '')), '');
    v_operation text := btrim(coalesce(p_operation, ''));
    v_previous_status public.review_moderation_status;
    v_previous_published boolean;
    v_action_name text;
BEGIN
    PERFORM private.assert_review_actor(p_actor, true);

    IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'REVIEW_REASON_REQUIRED: an override requires a recorded reason.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_operation NOT IN ('approve', 'reject', 'publish', 'unpublish') THEN
        RAISE EXCEPTION 'REVIEW_INVALID_OPERATION: unsupported override operation.'
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
        RAISE EXCEPTION 'REVIEW_CONFLICT: this review changed; reload before overriding.'
            USING ERRCODE = 'P0001';
    END IF;

    v_previous_status := v_review.moderation_status;
    v_previous_published := v_review.body_published IS NOT NULL;

    IF v_operation = 'approve' THEN
        IF v_previous_status = 'approved' THEN
            RAISE EXCEPTION 'REVIEW_STATE_UNCHANGED: this review is already approved.'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_review.consent IS NOT TRUE THEN
            RAISE EXCEPTION 'REVIEW_CONSENT_REQUIRED: publication permission is not recorded.'
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.review_submissions
        SET moderation_status = 'approved',
            moderated_by = p_actor,
            moderated_at = now(),
            moderation_note = left(v_reason, 500),
            version = version + 1
        WHERE id = p_review
        RETURNING * INTO v_review;

        v_action_name := 'review.override_approve';
    ELSIF v_operation = 'reject' THEN
        IF v_previous_status = 'rejected' AND NOT v_previous_published THEN
            RAISE EXCEPTION 'REVIEW_STATE_UNCHANGED: this review is already rejected.'
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.review_submissions
        SET moderation_status = 'rejected',
            moderated_by = p_actor,
            moderated_at = now(),
            moderation_note = left(v_reason, 500),
            body_published = NULL,
            published_at = NULL,
            published_by = NULL,
            published_version = NULL,
            version = version + 1
        WHERE id = p_review
        RETURNING * INTO v_review;

        v_action_name := 'review.override_reject';
    ELSIF v_operation = 'publish' THEN
        IF v_review.consent IS NOT TRUE THEN
            RAISE EXCEPTION 'REVIEW_CONSENT_REQUIRED: publication permission is not recorded.'
                USING ERRCODE = 'P0001';
        END IF;

        IF v_body IS NULL OR char_length(v_body) > 4000 THEN
            RAISE EXCEPTION 'REVIEW_INVALID_BODY: enter the text to publish, up to 4000 characters.'
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.review_submissions
        SET moderation_status = 'approved',
            moderated_by = p_actor,
            moderated_at = now(),
            body_published = v_body,
            published_at = now(),
            published_by = p_actor,
            published_version = coalesce(published_version, 0) + 1,
            version = version + 1
        WHERE id = p_review
        RETURNING * INTO v_review;

        v_action_name := 'review.override_publish';
    ELSE
        IF NOT v_previous_published THEN
            RAISE EXCEPTION 'REVIEW_STATE_UNCHANGED: this review is not published.'
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.review_submissions
        SET body_published = NULL,
            published_at = NULL,
            published_by = NULL,
            published_version = NULL,
            version = version + 1
        WHERE id = p_review
        RETURNING * INTO v_review;

        v_action_name := 'review.override_unpublish';
    END IF;

    PERFORM private.insert_audit_event(
        p_actor,
        v_action_name,
        'review',
        p_review::text,
        jsonb_build_object(
            'moderation_status', v_previous_status,
            'published', v_previous_published
        ),
        jsonb_build_object(
            'moderation_status', v_review.moderation_status,
            'published', v_review.body_published IS NOT NULL,
            'published_version', v_review.published_version
        ),
        v_reason,
        p_correlation
    );

    RETURN jsonb_build_object(
        'review_id', v_review.id,
        'moderation_status', v_review.moderation_status,
        'published', v_review.body_published IS NOT NULL,
        'published_version', v_review.published_version,
        'version', v_review.version
    );
END;
$$;

COMMENT ON FUNCTION public.review_override(uuid, uuid, text, text, text, integer, uuid) IS
'Emergency moderation or publication override with a mandatory reason and a distinct review.override_* audit action. Full Admin only; service_role only.';

-- =========================================================
-- 6. REVIEW HISTORY READ POLICY
-- =========================================================
--
-- Audit rows remain readable to Full Admins in full. Review history is part of the
-- moderation workflow, so any active administrator may read audit rows for the
-- narrow `review` entity type. No other audit entity is exposed by this policy, and
-- review payloads deliberately carry state identifiers rather than customer text.

CREATE POLICY audit_events_select_review_history
    ON public.audit_events
    FOR SELECT
    TO authenticated
    USING (
        entity_type = 'review'
        AND private.current_admin_role() IS NOT NULL
    );

-- =========================================================
-- 7. EXECUTION PRIVILEGES
-- =========================================================

REVOKE ALL ON FUNCTION public.review_moderate(uuid, uuid, text, text, integer, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_moderate(uuid, uuid, text, text, integer, uuid)
    TO service_role;

REVOKE ALL ON FUNCTION public.review_publish(uuid, uuid, text, text, integer, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_publish(uuid, uuid, text, text, integer, uuid)
    TO service_role;

REVOKE ALL ON FUNCTION public.review_open(uuid, uuid, text, integer, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_open(uuid, uuid, text, integer, uuid)
    TO service_role;

REVOKE ALL ON FUNCTION public.review_override(uuid, uuid, text, text, text, integer, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_override(uuid, uuid, text, text, text, integer, uuid)
    TO service_role;

GRANT USAGE ON SCHEMA private TO service_role;

COMMIT;
