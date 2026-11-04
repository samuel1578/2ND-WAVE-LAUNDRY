
BEGIN;

-- Extract media references from the published payload and private draft.
CREATE OR REPLACE FUNCTION private.blog_payload_media_ids(p_payload jsonb)
RETURNS TABLE(media_id text, public_url text)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
    WITH snapshots(payload) AS (
        SELECT p_payload
        UNION ALL
        SELECT p_payload -> 'draft'
    ),
    candidates(media_id, public_url) AS (
        SELECT payload ->> 'imageMediaId', payload ->> 'image'
        FROM snapshots

        UNION ALL

        SELECT payload #>> '{author,imageMediaId}',
               payload #>> '{author,image}'
        FROM snapshots

        UNION ALL

        SELECT block.value ->> 'mediaId',
               block.value ->> 'src'
        FROM snapshots
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(payload -> 'contentBlocks') = 'array'
                THEN payload -> 'contentBlocks'
                ELSE '[]'::jsonb
            END
        ) AS block(value)
        WHERE block.value ->> 'type' = 'image'
    )
    SELECT DISTINCT NULLIF(media_id, ''), public_url
    FROM candidates
    WHERE NULLIF(media_id, '') IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION private.blog_payload_media_ids(jsonb)
FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.website_content_upsert(
    p_actor uuid,
    p_module text,
    p_key text,
    p_payload jsonb,
    p_published boolean,
    p_sort_order integer,
    p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_row public.website_content%ROWTYPE;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_profiles a
        WHERE a.user_id = p_actor
          AND a.role = 'full_admin'
          AND a.disabled_at IS NULL
    ) THEN
        RAISE EXCEPTION 'CONTENT_FORBIDDEN'
            USING ERRCODE = '42501';
    END IF;

    IF p_module NOT IN ('blog', 'promotion')
       OR p_key IS NULL
       OR length(btrim(p_key)) NOT BETWEEN 1 AND 180
       OR p_payload IS NULL
       OR jsonb_typeof(p_payload) <> 'object'
       OR p_sort_order IS NULL
       OR p_sort_order < 0
    THEN
        RAISE EXCEPTION 'CONTENT_INVALID'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_row
    FROM public.website_content
    WHERE module = p_module
      AND record_key = p_key
    FOR UPDATE;

    IF FOUND THEN
        IF p_expected_version IS NULL
           OR v_row.version <> p_expected_version
        THEN
            RAISE EXCEPTION 'CONTENT_CONFLICT'
                USING ERRCODE = 'PT409';
        END IF;
    ELSIF p_expected_version IS NOT NULL THEN
        RAISE EXCEPTION 'CONTENT_CONFLICT'
            USING ERRCODE = 'PT409';
    END IF;

    IF p_module = 'blog' AND p_published IS TRUE THEN
        IF length(btrim(coalesce(p_payload ->> 'title', ''))) = 0
           OR length(btrim(coalesce(p_payload ->> 'summary', ''))) = 0
           OR length(btrim(coalesce(p_payload ->> 'body', ''))) = 0
           OR coalesce(p_payload ->> 'slug', '')
                !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        THEN
            RAISE EXCEPTION 'CONTENT_INVALID'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_module = 'blog' THEN
        -- Lock referenced media rows that currently match the saved ID and URL.
        PERFORM media.id
        FROM public.website_gallery_media AS media
        JOIN private.blog_payload_media_ids(p_payload) AS refs
          ON refs.media_id = media.id::text
         AND refs.public_url = media.public_url
        WHERE media.archived IS FALSE
        FOR SHARE OF media;

        -- Reject missing, archived, or URL-mismatched media references.
        IF EXISTS (
            SELECT 1
            FROM private.blog_payload_media_ids(p_payload) AS refs
            WHERE NOT EXISTS (
                SELECT 1
                FROM public.website_gallery_media AS media
                WHERE media.id::text = refs.media_id
                  AND media.archived IS FALSE
                  AND media.public_url = refs.public_url
            )
        ) THEN
            RAISE EXCEPTION 'BLOG_MEDIA_INVALID'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    INSERT INTO public.website_content (
        module,
        record_key,
        payload,
        published,
        sort_order,
        version,
        updated_by
    )
    VALUES (
        p_module,
        p_key,
        p_payload,
        p_published,
        p_sort_order,
        1,
        p_actor
    )
    ON CONFLICT (module, record_key)
    DO UPDATE SET
        payload = EXCLUDED.payload,
        published = EXCLUDED.published,
        sort_order = EXCLUDED.sort_order,
        version = public.website_content.version + 1,
        updated_by = p_actor,
        updated_at = now()
    RETURNING * INTO v_row;

    PERFORM private.insert_audit_event(
        p_actor,
        'content.update',
        'website_content',
        p_module || ':' || p_key,
        NULL,
        jsonb_build_object(
            'published', p_published,
            'version', v_row.version
        ),
        NULL,
        NULL
    );

    RETURN jsonb_build_object(
        'id', v_row.id,
        'key', v_row.record_key,
        'payload', v_row.payload,
        'published', v_row.published,
        'sort_order', v_row.sort_order,
        'version', v_row.version
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.website_media_upsert(
    p_actor uuid,
    p_id uuid,
    p_storage_path text,
    p_public_url text,
    p_name text,
    p_alt text,
    p_caption text,
    p_source text,
    p_permission text,
    p_archived boolean,
    p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_row public.website_gallery_media%ROWTYPE;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_profiles a
        WHERE a.user_id = p_actor
          AND a.role = 'full_admin'
          AND a.disabled_at IS NULL
    ) THEN
        RAISE EXCEPTION 'MEDIA_FORBIDDEN'
            USING ERRCODE = '42501';
    END IF;

    IF p_storage_path IS NULL
       OR p_storage_path ~ '(^/|\.\.|\\|^booking-photos/)'
       OR p_public_url IS NULL
       OR p_public_url !~ '^https://'
       OR length(btrim(coalesce(p_alt, ''))) = 0
       OR length(p_name) > 255
       OR length(p_alt) > 1000
       OR length(p_caption) > 1000
       OR length(p_source) > 500
       OR length(p_permission) > 1000
    THEN
        RAISE EXCEPTION 'MEDIA_INVALID'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_row
    FROM public.website_gallery_media
    WHERE id = p_id
    FOR UPDATE;

    IF FOUND THEN
        IF p_expected_version IS NULL
           OR v_row.version <> p_expected_version
        THEN
            RAISE EXCEPTION 'MEDIA_CONFLICT_OR_IN_USE'
                USING ERRCODE = '40001';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.website_content c
            WHERE c.module = 'gallery'
              AND c.payload ->> 'media_id' = p_id::text
              AND c.published IS TRUE
              AND p_archived IS TRUE
        ) THEN
            RAISE EXCEPTION 'MEDIA_CONFLICT_OR_IN_USE'
                USING ERRCODE = '40001';
        END IF;

        IF (p_archived IS TRUE
            OR v_row.public_url IS DISTINCT FROM p_public_url)
           AND EXISTS (
               SELECT 1
               FROM public.website_content c
               WHERE c.module = 'blog'
                 AND EXISTS (
                     SELECT 1
                     FROM private.blog_payload_media_ids(c.payload) refs
                     WHERE refs.media_id = p_id::text
                 )
           )
        THEN
            RAISE EXCEPTION 'MEDIA_CONFLICT_OR_IN_USE'
                USING ERRCODE = '40001';
        END IF;
    ELSIF p_expected_version IS NOT NULL THEN
        RAISE EXCEPTION 'MEDIA_CONFLICT_OR_IN_USE'
            USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.website_gallery_media (
        id,
        storage_path,
        public_url,
        name,
        alt,
        caption,
        source,
        permission,
        archived,
        version
    )
    VALUES (
        p_id,
        p_storage_path,
        p_public_url,
        p_name,
        p_alt,
        p_caption,
        p_source,
        p_permission,
        p_archived,
        1
    )
    ON CONFLICT (id)
    DO UPDATE SET
        storage_path = EXCLUDED.storage_path,
        public_url = EXCLUDED.public_url,
        name = EXCLUDED.name,
        alt = EXCLUDED.alt,
        caption = EXCLUDED.caption,
        source = EXCLUDED.source,
        permission = EXCLUDED.permission,
        archived = EXCLUDED.archived,
        version = public.website_gallery_media.version + 1
    RETURNING * INTO v_row;

    PERFORM private.insert_audit_event(
        p_actor,
        'media.update',
        'website_gallery_media',
        p_id::text,
        NULL,
        jsonb_build_object(
            'archived', p_archived,
            'version', v_row.version
        ),
        NULL,
        NULL
    );

    RETURN to_jsonb(v_row);
END;
$function$;

COMMIT;
