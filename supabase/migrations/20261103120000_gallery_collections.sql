-- Gallery collections.
--
-- Replaces alt-text category inference with explicit, admin-managed collection
-- records stored in `website_content` (module = 'gallery_collection') and an
-- optional `collection_key` on each gallery placement payload.
--
-- Nothing is destructively rewritten:
--   * existing gallery placements keep their row, order, publication state and
--     payload; they simply have no collection until an administrator assigns one
--     (they remain visible in the public "All" filter);
--   * media assets are untouched;
--   * the existing `website_content_replace` RPC keeps working for FAQ (and for
--     gallery saves that do not use collections), so historical compatibility is
--     preserved.
--
-- Apply after 20261102090000_staff_invitation_controls.sql.

BEGIN;

-- 1. Allow the new content module. Kept as a named constraint swap so the
--    existing module list stays authoritative in one place.
ALTER TABLE public.website_content DROP CONSTRAINT website_content_module;
ALTER TABLE public.website_content ADD CONSTRAINT website_content_module
  CHECK (module IN ('blog', 'faq', 'promotion', 'gallery', 'gallery_collection'));

CREATE INDEX IF NOT EXISTS website_content_gallery_collection_order
  ON public.website_content (sort_order, record_key)
  WHERE module = 'gallery_collection';

-- 2. Initial requested collections. This is an explicit, repeatable seed: it
--    never overwrites an existing collection and never assigns an image. The
--    existing five placements keep their current publication state and order and
--    stay unassigned for administrator review.
INSERT INTO public.website_content (module, record_key, payload, published, sort_order)
VALUES
  ('gallery_collection', 'laundry', '{"name":"Laundry","description":""}'::jsonb, true, 1),
  ('gallery_collection', 'garment-care', '{"name":"Garment Care","description":""}'::jsonb, true, 2),
  ('gallery_collection', 'shoe-care', '{"name":"Shoe Care","description":""}'::jsonb, true, 3),
  ('gallery_collection', 'behind-the-scenes', '{"name":"BTS / Behind the Scenes","description":""}'::jsonb, true, 4),
  ('gallery_collection', 'others', '{"name":"Others","description":""}'::jsonb, true, 5)
ON CONFLICT (module, record_key) DO NOTHING;

-- 3. One validated, atomic save for collections and their placements. Splitting
--    them across two calls would allow a saved collection to reference placements
--    that failed to save, so both arrays are written in one transaction.
CREATE OR REPLACE FUNCTION public.website_gallery_save(
  p_actor uuid,
  p_collections jsonb,
  p_collection_versions jsonb,
  p_placements jsonb,
  p_placement_versions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_item jsonb;
  v_key text;
  v_expected integer;
  v_row public.website_content%ROWTYPE;
BEGIN
  SET LOCAL lock_timeout = '5s';

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_profiles a
    WHERE a.user_id = p_actor AND a.role = 'full_admin' AND a.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Validate every argument before any records can be modified.
  -- IS DISTINCT FROM also rejects JSON null and avoids SQL NULL bypasses.
  IF p_collections IS NULL
     OR p_placements IS NULL
     OR p_collection_versions IS NULL
     OR p_placement_versions IS NULL
     OR jsonb_typeof(p_collections) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_placements) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_collection_versions) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_placement_versions) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_collections) > 100
     OR jsonb_array_length(p_placements) > 500 THEN
    RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('website_content:gallery')) THEN
    RAISE EXCEPTION 'CONTENT_BUSY' USING ERRCODE = '55P03';
  END IF;

  -- Collections: keys, payload and optimistic versions.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_collections) LOOP
    v_key := v_item->>'key';
    SELECT (p_collection_versions->>v_key)::integer INTO v_expected;
    SELECT * INTO v_row
    FROM public.website_content
    WHERE module = 'gallery_collection' AND record_key = v_key
    FOR UPDATE;

    IF FOUND AND (v_expected IS NULL OR v_row.version <> v_expected) THEN
      RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = 'PT409';
    END IF;

    IF v_key IS NULL
       OR v_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       OR length(v_key) > 80
       OR jsonb_typeof(v_item->'payload') <> 'object'
       OR length(btrim(coalesce(v_item#>>'{payload,name}', ''))) NOT BETWEEN 1 AND 80
       OR length(coalesce(v_item#>>'{payload,description}', '')) > 300
       OR coalesce((v_item->>'sort_order')::integer, 0) < 0 THEN
      RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_collections) g
    GROUP BY g.value->>'key' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.website_content old
    WHERE old.module = 'gallery_collection'
      AND NOT (old.record_key IN (
        SELECT value->>'key' FROM jsonb_array_elements(p_collections)
      ))
      AND coalesce((p_collection_versions->>old.record_key)::integer, -1) <> old.version
  ) THEN
    RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = 'PT409';
  END IF;

  DELETE FROM public.website_content
  WHERE module = 'gallery_collection'
    AND NOT (record_key IN (
      SELECT value->>'key' FROM jsonb_array_elements(p_collections)
    ));

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_collections) LOOP
    v_key := v_item->>'key';
    INSERT INTO public.website_content
      (module, record_key, payload, published, sort_order, version, updated_by)
    VALUES
      ('gallery_collection', v_key,
       jsonb_build_object(
         'name', btrim(v_item#>>'{payload,name}'),
         'description', btrim(coalesce(v_item#>>'{payload,description}', ''))
       ),
       coalesce((v_item->>'published')::boolean, true),
       coalesce((v_item->>'sort_order')::integer, 0), 1, p_actor)
    ON CONFLICT (module, record_key) DO UPDATE SET
      payload = excluded.payload,
      published = excluded.published,
      sort_order = excluded.sort_order,
      version = public.website_content.version + 1,
      updated_by = p_actor,
      updated_at = now();
  END LOOP;

  -- Placements: existing validation, plus an optional collection reference.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_placements) LOOP
    v_key := v_item->>'key';
    SELECT (p_placement_versions->>v_key)::integer INTO v_expected;
    SELECT * INTO v_row
    FROM public.website_content
    WHERE module = 'gallery' AND record_key = v_key
    FOR UPDATE;

    IF FOUND AND (v_expected IS NULL OR v_row.version <> v_expected) THEN
      RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = 'PT409';
    END IF;

    IF v_key IS NULL
       OR length(v_key) NOT BETWEEN 1 AND 180
       OR jsonb_typeof(v_item->'payload') <> 'object' THEN
      RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
    END IF;

    IF coalesce(v_item#>>'{payload,media_id}', '') !~ '^[0-9a-f-]{36}$'
       OR length(btrim(coalesce(v_item#>>'{payload,alt}', ''))) NOT BETWEEN 1 AND 1000
       OR NOT EXISTS (
         SELECT 1
         FROM public.website_gallery_media m
         WHERE m.id = (v_item#>>'{payload,media_id}')::uuid
           AND (
             NOT m.archived
             OR EXISTS (
               SELECT 1
               FROM public.website_content existing_placement
               WHERE existing_placement.module = 'gallery'
                 AND existing_placement.record_key = v_key
                 AND existing_placement.payload->>'media_id' = m.id::text
             )
           )
       ) THEN
      RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
    END IF;

    IF length(coalesce(v_item#>>'{payload,collection_key}', '')) > 80
       OR (
         coalesce(v_item#>>'{payload,collection_key}', '') <> ''
         AND NOT EXISTS (
           SELECT 1 FROM public.website_content c
           WHERE c.module = 'gallery_collection'
             AND c.record_key = v_item#>>'{payload,collection_key}'
         )
       ) THEN
      RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- One image may sit in several collections (a placement per collection), but
  -- never twice in the same collection.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_placements) g
    WHERE coalesce(g.value#>>'{payload,collection_key}', '') <> ''
    GROUP BY g.value#>>'{payload,collection_key}', g.value#>>'{payload,media_id}'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'CONTENT_DUPLICATE_PLACEMENT' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.website_content old
    WHERE old.module = 'gallery'
      AND NOT (old.record_key IN (
        SELECT value->>'key' FROM jsonb_array_elements(p_placements)
      ))
      AND coalesce((p_placement_versions->>old.record_key)::integer, -1) <> old.version
  ) THEN
    RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = 'PT409';
  END IF;

  DELETE FROM public.website_content
  WHERE module = 'gallery'
    AND NOT (record_key IN (
      SELECT value->>'key' FROM jsonb_array_elements(p_placements)
    ));

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_placements) LOOP
    v_key := v_item->>'key';
    INSERT INTO public.website_content
      (module, record_key, payload, published, sort_order, version, updated_by)
    VALUES
      ('gallery', v_key,
       jsonb_build_object(
         'media_id', v_item#>>'{payload,media_id}',
         'alt', btrim(v_item#>>'{payload,alt}'),
         'caption', btrim(coalesce(v_item#>>'{payload,caption}', '')),
         'collection_key', coalesce(v_item#>>'{payload,collection_key}', '')
       ),
       coalesce((v_item->>'published')::boolean, true),
       coalesce((v_item->>'sort_order')::integer, 0), 1, p_actor)
    ON CONFLICT (module, record_key) DO UPDATE SET
      payload = excluded.payload,
      published = excluded.published,
      sort_order = excluded.sort_order,
      version = public.website_content.version + 1,
      updated_by = p_actor,
      updated_at = now();
  END LOOP;

  PERFORM private.insert_audit_event(
    p_actor, 'content.update', 'website_content', 'gallery', NULL,
    jsonb_build_object(
      'module', 'gallery',
      'collections', jsonb_array_length(p_collections),
      'placements', jsonb_array_length(p_placements)
    ),
    NULL, NULL
  );

  RETURN jsonb_build_object(
    'collections', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'key', record_key, 'payload', payload, 'published', published,
        'sort_order', sort_order, 'version', version
      ) ORDER BY sort_order, record_key), '[]'::jsonb)
      FROM public.website_content WHERE module = 'gallery_collection'
    ),
    'placements', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'key', record_key, 'payload', payload, 'published', published,
        'sort_order', sort_order, 'version', version
      ) ORDER BY sort_order, record_key), '[]'::jsonb)
      FROM public.website_content WHERE module = 'gallery'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.website_gallery_save(uuid, jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_gallery_save(uuid, jsonb, jsonb, jsonb, jsonb)
  TO service_role;

COMMIT;
