-- ============================================================
-- 2ND WAVE LAUNDRY
-- SERVICES ADMIN LIFECYCLE REPAIR
-- Migration: 20261109120000_services_admin_lifecycle.sql
--
-- Fixes:
-- 1. Service creation
-- 2. Existing service updates
-- 3. Slug renaming without changing record ID
-- 4. Publish / unpublish functionality
-- 5. Featured image backfill
-- 6. Admin audit logging
--
-- Preserves existing service records and booking references.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. BACKFILL APPROVED SERVICE CONTENT AND FEATURED IMAGES
-- ============================================================

-- Populate approved baseline content only for records that
-- have never been edited through the admin system (version = 1).

UPDATE public.services AS s
SET
    title = v.title,
    summary = v.summary,
    public_image = v.image,
    public_alt = v.alt
FROM (
    VALUES
    (
        'wash-ironing-fold',
        'Wash, Ironing & Fold',
        'Arrange washing, ironing and folding for your everyday laundry. Book a pickup or bring your items to a branch.',
        '/images/wash-ironing-and-fold.jpg',
        'Shirt pressing beside neatly folded clothes'
    ),
    (
        'wash-and-fold-only',
        'Wash and Fold Only',
        'Everyday laundry washed and folded without ironing. Book a pickup or bring your items to one of our branches.',
        '/images/wash-and-fold-only.jpg',
        'Everyday clothes folded without ironing'
    ),
    (
        'ironing',
        'Ironing',
        'Request ironing for your garments. Book a pickup or bring them to a branch.',
        '/images/ironing.jpg',
        'Steam iron resting beside a pressed white shirt on an ironing table in a laundry facility'
    ),
    (
        'shoe-care',
        'Shoe Care',
        'Request shoe care and discuss your items with our team.',
        '/images/shoe-care.jpeg',
        'Laundry specialist in a blue uniform shirt brushing a black leather dress shoe at a shoe-care bench beside polish, brushes and a cloth'
    ),
    (
        'stain-treatment',
        'Stain Treatment',
        'Tell us about the stain and request treatment for your item.',
        '/images/stain-treatment.jpg',
        'Laundry attendant in a blue uniform treating a stain on a white shirt at a stainless-steel table'
    ),
    (
        'duvet-and-bedding-cleaning',
        'Duvet & Bedding Cleaning',
        'Arrange cleaning for your duvets and bedding. Book a pickup or bring your items to a branch.',
        '/images/commercial-linen-stacks.jpg',
        'Freshly folded white towels and linens stacked on a stainless-steel table in a laundry facility'
    ),
    (
        'curtain-cleaning',
        'Curtain Cleaning',
        'Request curtain cleaning and discuss your items with our team.',
        '/images/curtain.png',
        'Laundry technician deep-cleaning a hanging beige curtain with an extraction wand'
    ),
    (
        'suit-cleaning',
        'Suit Cleaning',
        'Arrange cleaning for your suits. Book a pickup or visit one of our branches.',
        '/images/suit.jpg',
        'Row of checked and plaid suit jackets hanging on a wardrobe rail'
    ),
    (
        'express-same-day-laundry',
        'Express/Same-Day Laundry',
        'Need your laundry sooner? Discuss your request and required timing with our team.',
        '/images/same-day-delivery.jpg',
        'Delivery driver in a blue uniform signing paperwork beside stacked parcels at the roadside'
    ),
    (
        'pickup-and-delivery',
        'Pickup & Delivery',
        'Arrange a pickup for your laundry and discuss collection and return details with our team.',
        '/images/pickup.jpg',
        'Laundry attendant at the front counter with a customer''s bag and packaged garments ready for pickup'
    )
) AS v(slug, title, summary, image, alt)

WHERE s.slug = v.slug
  AND s.version = 1;


-- Fill missing featured image references only.
-- Never overwrite an existing administrator-selected image.

UPDATE public.services AS s
SET
    public_image = v.image,
    public_alt = v.alt

FROM (
    VALUES
    ('wash-ironing-fold', '/images/wash-ironing-and-fold.jpg', 'Shirt pressing beside neatly folded clothes'),
    ('wash-and-fold-only', '/images/wash-and-fold-only.jpg', 'Everyday clothes folded without ironing'),
    ('ironing', '/images/ironing.jpg', 'Steam iron resting beside a pressed white shirt on an ironing table in a laundry facility'),
    ('shoe-care', '/images/shoe-care.jpeg', 'Laundry specialist in a blue uniform shirt brushing a black leather dress shoe at a shoe-care bench beside polish, brushes and a cloth'),
    ('stain-treatment', '/images/stain-treatment.jpg', 'Laundry attendant in a blue uniform treating a stain on a white shirt at a stainless-steel table'),
    ('duvet-and-bedding-cleaning', '/images/commercial-linen-stacks.jpg', 'Freshly folded white towels and linens stacked on a stainless-steel table in a laundry facility'),
    ('curtain-cleaning', '/images/curtain.png', 'Laundry technician deep-cleaning a hanging beige curtain with an extraction wand'),
    ('suit-cleaning', '/images/suit.jpg', 'Row of checked and plaid suit jackets hanging on a wardrobe rail'),
    ('express-same-day-laundry', '/images/same-day-delivery.jpg', 'Delivery driver in a blue uniform signing paperwork beside stacked parcels at the roadside'),
    ('pickup-and-delivery', '/images/pickup.jpg', 'Laundry attendant at the front counter with a customer''s bag and packaged garments ready for pickup')
) AS v(slug, image, alt)

WHERE s.slug = v.slug
  AND (
      s.public_image IS NULL
      OR s.public_image = ''
  );


-- ============================================================
-- 2. REPLACE THE UPDATE-ONLY RPC WITH CREATE/UPDATE UPSERT
-- ============================================================

DROP FUNCTION IF EXISTS public.website_service_update(
    uuid,
    text,
    integer,
    text,
    text,
    text,
    text,
    text,
    integer
);


CREATE OR REPLACE FUNCTION public.website_service_upsert(
    p_actor uuid,
    p_service_id uuid,
    p_slug text,
    p_expected_version integer,
    p_title text,
    p_summary text,
    p_body text,
    p_image text,
    p_alt text,
    p_sort_order integer,
    p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$

DECLARE
    v_row public.services%ROWTYPE;

BEGIN

    -- --------------------------------------------------------
    -- ADMIN AUTHORIZATION
    -- --------------------------------------------------------

    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_profiles AS a
        WHERE a.user_id = p_actor
          AND a.role = 'full_admin'
          AND a.disabled_at IS NULL
    ) THEN

        RAISE EXCEPTION 'CONTENT_FORBIDDEN'
            USING ERRCODE = '42501';

    END IF;


    -- --------------------------------------------------------
    -- INPUT VALIDATION
    -- --------------------------------------------------------

    IF p_slug IS NULL
       OR length(p_slug) NOT BETWEEN 1 AND 180
       OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'

       OR length(btrim(coalesce(p_title, ''))) NOT BETWEEN 1 AND 120

       OR length(coalesce(p_summary, '')) > 2000

       OR length(coalesce(p_body, '')) > 50000

       OR length(coalesce(p_image, '')) > 2000

       OR length(coalesce(p_alt, '')) > 1000

       OR p_sort_order IS NULL
       OR p_sort_order < 0

       OR p_active IS NULL

       OR (
           p_active
           AND length(btrim(coalesce(p_summary, ''))) = 0
       )

       OR (
           p_active
           AND coalesce(p_image, '') <> ''
           AND length(btrim(coalesce(p_alt, ''))) = 0
       )

    THEN

        RAISE EXCEPTION 'CONTENT_INVALID'
            USING ERRCODE = '22023';

    END IF;


    -- --------------------------------------------------------
    -- CREATE NEW SERVICE
    -- --------------------------------------------------------

    IF p_service_id IS NULL THEN

        -- New records must not carry an existing version.

        IF p_expected_version IS NOT NULL
           AND p_expected_version <> 0
        THEN

            RAISE EXCEPTION 'CONTENT_CONFLICT'
                USING ERRCODE = '40001';

        END IF;


        BEGIN

            INSERT INTO public.services (
                slug,
                title,
                summary,
                kind,
                bookable,
                sort_order,
                active,
                public_body,
                public_image,
                public_alt
            )

            VALUES (
                p_slug,
                p_title,
                p_summary,
                'laundry',
                true,
                p_sort_order,
                p_active,
                p_body,
                p_image,
                p_alt
            )

            RETURNING * INTO v_row;


        EXCEPTION
            WHEN unique_violation THEN

                RAISE EXCEPTION 'CONTENT_CONFLICT'
                    USING ERRCODE = '40001';

        END;


    -- --------------------------------------------------------
    -- UPDATE EXISTING SERVICE
    -- --------------------------------------------------------

    ELSE

        SELECT *
        INTO v_row

        FROM public.services

        WHERE id = p_service_id

        FOR UPDATE;


        -- Optimistic version check.

        IF NOT FOUND
           OR v_row.version <> p_expected_version
        THEN

            RAISE EXCEPTION 'CONTENT_CONFLICT'
                USING ERRCODE = '40001';

        END IF;


        -- Prevent another service from owning this slug.

        IF EXISTS (
            SELECT 1

            FROM public.services AS other

            WHERE other.slug = p_slug
              AND other.id <> p_service_id
        ) THEN

            RAISE EXCEPTION 'CONTENT_CONFLICT'
                USING ERRCODE = '40001';

        END IF;


        UPDATE public.services

        SET
            slug = p_slug,
            title = p_title,
            summary = p_summary,
            public_body = p_body,
            public_image = p_image,
            public_alt = p_alt,
            sort_order = p_sort_order,
            active = p_active,
            version = version + 1

        WHERE id = p_service_id

        RETURNING * INTO v_row;


    END IF;


    -- --------------------------------------------------------
    -- AUDIT LOG
    -- --------------------------------------------------------

    PERFORM private.insert_audit_event(
        p_actor,
        'content.update',
        'service',
        v_row.id::text,
        NULL,
        jsonb_build_object(
            'slug', v_row.slug,
            'version', v_row.version,
            'active', v_row.active
        ),
        NULL,
        NULL
    );


    -- --------------------------------------------------------
    -- RETURN UPDATED SERVICE
    -- --------------------------------------------------------

    RETURN jsonb_build_object(
        'id', v_row.id,
        'slug', v_row.slug,
        'title', v_row.title,
        'summary', v_row.summary,
        'body', v_row.public_body,
        'image', v_row.public_image,
        'alt', v_row.public_alt,
        'kind', v_row.kind,
        'bookable', v_row.bookable,
        'active', v_row.active,
        'sort_order', v_row.sort_order,
        'version', v_row.version
    );

END;

$$;


-- ============================================================
-- 3. FUNCTION PERMISSIONS
-- ============================================================

REVOKE ALL ON FUNCTION public.website_service_upsert(
    uuid,
    uuid,
    text,
    integer,
    text,
    text,
    text,
    text,
    text,
    integer,
    boolean
)
FROM PUBLIC, anon, authenticated;


GRANT EXECUTE ON FUNCTION public.website_service_upsert(
    uuid,
    uuid,
    text,
    integer,
    text,
    text,
    text,
    text,
    text,
    integer,
    boolean
)
TO service_role;


GRANT USAGE ON SCHEMA private TO service_role;


-- ============================================================
-- 4. COMMIT
-- ============================================================

COMMIT;