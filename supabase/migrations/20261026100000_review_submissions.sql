-- Sprint 3A — durable review submissions and least-privilege public read path.
-- Forward-only addition. Do not apply to the hosted project as part of this sprint.

BEGIN;

CREATE TYPE public.review_moderation_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.review_reply_status AS ENUM ('none', 'draft', 'published');

CREATE TABLE public.review_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name text NOT NULL,
    body_original text NOT NULL,
    rating smallint,
    branch text,
    consent boolean NOT NULL,
    consent_version text NOT NULL,
    notice_version text,
    source_ip_hash text,
    moderation_status public.review_moderation_status NOT NULL DEFAULT 'pending',
    moderated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    moderated_at timestamptz,
    moderation_note text,
    body_published text,
    published_at timestamptz,
    published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    published_version integer,
    reply_body text,
    reply_status public.review_reply_status NOT NULL DEFAULT 'none',
    reply_published_at timestamptz,
    reply_published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    submission_scope text NOT NULL DEFAULT 'public_review_form',
    idempotency_key text NOT NULL,
    submission_hash text NOT NULL,

    CONSTRAINT review_customer_name_length CHECK (char_length(btrim(customer_name)) BETWEEN 1 AND 120),
    CONSTRAINT review_original_body_length CHECK (char_length(btrim(body_original)) BETWEEN 1 AND 4000),
    CONSTRAINT review_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    CONSTRAINT review_branch_length CHECK (branch IS NULL OR char_length(branch) <= 120),
    CONSTRAINT review_consent_version_length CHECK (char_length(btrim(consent_version)) BETWEEN 1 AND 60),
    CONSTRAINT review_notice_version_length CHECK (notice_version IS NULL OR char_length(notice_version) BETWEEN 1 AND 60),
    CONSTRAINT review_source_ip_hash_shape CHECK (source_ip_hash IS NULL OR source_ip_hash ~ '^[a-f0-9]{32,64}$'),
    CONSTRAINT review_moderation_note_length CHECK (moderation_note IS NULL OR char_length(moderation_note) <= 500),
    CONSTRAINT review_published_body_length CHECK (body_published IS NULL OR char_length(btrim(body_published)) BETWEEN 1 AND 4000),
    CONSTRAINT review_reply_body_length CHECK (reply_body IS NULL OR char_length(btrim(reply_body)) BETWEEN 1 AND 4000),
    CONSTRAINT review_published_version_positive CHECK (published_version IS NULL OR published_version > 0),
    CONSTRAINT review_version_positive CHECK (version > 0),
    CONSTRAINT review_submission_scope_shape CHECK (submission_scope = 'public_review_form'),
    CONSTRAINT review_idempotency_key_length CHECK (char_length(btrim(idempotency_key)) BETWEEN 16 AND 128),
    CONSTRAINT review_submission_hash_shape CHECK (submission_hash ~ '^[a-f0-9]{32}$'),
    CONSTRAINT review_moderation_fields_consistent CHECK (
        (moderation_status = 'pending' AND moderated_at IS NULL AND moderated_by IS NULL)
        OR moderation_status <> 'pending'
    ),
    CONSTRAINT review_publication_fields_consistent CHECK (
        body_published IS NULL OR (
            moderation_status = 'approved'
            AND consent
            AND published_at IS NOT NULL
            AND published_version IS NOT NULL
        )
    ),
    CONSTRAINT review_reply_fields_consistent CHECK (
        reply_status = 'none' OR reply_body IS NOT NULL
    ),
    CONSTRAINT review_submission_idempotency_unique UNIQUE (submission_scope, idempotency_key)
);

COMMENT ON TABLE public.review_submissions IS
'Private review submissions. Customer text is plain text; only the explicitly published version is eligible for public display.';
COMMENT ON COLUMN public.review_submissions.body_original IS
'Immutable original customer-submitted text. Public rendering must use body_published only.';
COMMENT ON COLUMN public.review_submissions.submission_hash IS
'Deterministic digest used to reject altered payloads reusing an idempotency key.';

CREATE INDEX review_submissions_moderation_created_idx
    ON public.review_submissions (moderation_status, created_at DESC);
CREATE INDEX review_submissions_publication_idx
    ON public.review_submissions (published_at DESC)
    WHERE moderation_status = 'approved' AND consent AND body_published IS NOT NULL;
CREATE INDEX review_submissions_updated_idx
    ON public.review_submissions (updated_at DESC);

CREATE OR REPLACE FUNCTION private.review_submission_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.customer_name IS DISTINCT FROM OLD.customer_name
       OR NEW.body_original IS DISTINCT FROM OLD.body_original
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'REVIEW_ORIGINAL_IMMUTABLE: original review fields cannot be changed.'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.review_submission_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER review_submission_immutable
    BEFORE UPDATE ON public.review_submissions
    FOR EACH ROW EXECUTE FUNCTION private.review_submission_immutable();

CREATE OR REPLACE FUNCTION private.review_submission_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.review_submission_touch_updated_at() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER review_submission_touch_updated_at
    BEFORE UPDATE ON public.review_submissions
    FOR EACH ROW EXECUTE FUNCTION private.review_submission_touch_updated_at();

ALTER TABLE public.review_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.review_submissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.review_submissions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.review_submissions TO service_role;

CREATE POLICY review_submissions_admin_read
    ON public.review_submissions FOR SELECT TO authenticated
    USING (private.current_admin_role() IS NOT NULL);

CREATE POLICY review_submissions_public_published_read
    ON public.review_submissions FOR SELECT TO anon, authenticated
    USING (
        moderation_status = 'approved'
        AND consent IS TRUE
        AND body_published IS NOT NULL
        AND reply_status <> 'draft'
        AND deleted_at IS NULL
    );

-- Anonymous access is limited to display-safe columns and the predicate columns
-- required by the security-invoker view. No original text, moderation notes,
-- source hash or reply draft is selectable by anon.
GRANT SELECT (
    id, customer_name, rating, branch, consent, moderation_status, deleted_at,
    body_published, published_at, published_version, reply_body,
    reply_status, reply_published_at
) ON public.review_submissions TO anon;

CREATE VIEW public.published_reviews
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
  AND reply_status <> 'draft'
  AND deleted_at IS NULL;

REVOKE ALL ON public.published_reviews FROM PUBLIC, authenticated;
GRANT SELECT ON public.published_reviews TO anon, authenticated;

COMMIT;
