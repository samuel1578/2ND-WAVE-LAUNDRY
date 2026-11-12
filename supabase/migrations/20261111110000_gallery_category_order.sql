BEGIN;

-- Persist Gallery category ordering independently from image placements. The
-- workspace RPC (website_gallery_save) also writes image rows and category
-- metadata, which is wrong for an immediate reorder interaction. This function
-- only changes sort_order/version and the audit metadata; names, descriptions,
-- publication state and image assignments are never rewritten here.
--
-- The elevated server client (service_role) is the only caller. Authorisation is
-- re-checked here even though the server action already validated the session.
CREATE OR REPLACE FUNCTION public.website_gallery_collection_reorder(
  p_actor uuid,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
  v_key text;
  v_expected integer;
  v_position integer;
  v_count integer;
BEGIN
  SET LOCAL lock_timeout = '5s';

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_profiles a
    WHERE a.user_id = p_actor AND a.role = 'full_admin' AND a.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Same advisory lock as website_gallery_save, so a category reorder cannot
  -- interleave with a workspace save that also writes category sort_order.
  IF NOT pg_try_advisory_xact_lock(hashtext('website_content:gallery')) THEN
    RAISE EXCEPTION 'CONTENT_BUSY' USING ERRCODE = '55P03';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.website_content
  WHERE module = 'gallery_collection';

  IF jsonb_array_length(p_items) <> v_count THEN
    RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = 'PT409';
  END IF;

  -- Phase 1: structure and syntax only. Deliberately no integer casts here:
  -- SQL does not guarantee boolean OR evaluation order, so a malformed value
  -- must be rejected by regex before anything casts it.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS requested(value)
    WHERE jsonb_typeof(requested.value) IS DISTINCT FROM 'object'
       OR coalesce(requested.value->>'key', '') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       OR length(requested.value->>'key') > 80
       OR coalesce(requested.value->>'version', '') !~ '^[1-9][0-9]{0,8}$'
       OR coalesce(requested.value->>'sort_order', '') !~ '^[1-9][0-9]{0,8}$'
  ) OR EXISTS (
    SELECT requested.value->>'key'
    FROM jsonb_array_elements(p_items) AS requested(value)
    GROUP BY requested.value->>'key'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = 'PT409';
  END IF;

  -- Phase 2: every submitted key must exist, the submitted position must match
  -- its array index, and the version must still be current. numeric (not
  -- integer) casts are used here so even a validated long digit string cannot
  -- overflow; the values reaching the loop below are therefore safe integers.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS requested(value, ordinality)
    LEFT JOIN public.website_content AS current
      ON current.module = 'gallery_collection'
      AND current.record_key = requested.value->>'key'
    WHERE current.id IS NULL
       OR (requested.value->>'sort_order')::numeric <> requested.ordinality
       OR current.version <> (requested.value->>'version')::numeric
  ) THEN
    RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = 'PT409';
  END IF;

  FOR v_item, v_position IN
    SELECT value, ordinality::integer
    FROM jsonb_array_elements(p_items) WITH ORDINALITY
  LOOP
    v_key := v_item->>'key';
    v_expected := (v_item->>'version')::integer;

    -- version = v_expected was verified above, so a concurrent write between
    -- validation and this update still fails closed through NOT FOUND.
    UPDATE public.website_content
    SET sort_order = v_position,
        version = version + 1,
        updated_by = p_actor,
        updated_at = now()
    WHERE module = 'gallery_collection'
      AND record_key = v_key
      AND version = v_expected;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = 'PT409';
    END IF;
  END LOOP;

  PERFORM private.insert_audit_event(
    p_actor, 'content.update', 'website_content', 'gallery_collection:order', NULL,
    jsonb_build_object('count', v_count), NULL, NULL
  );

  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key', record_key,
      'payload', payload,
      'published', published,
      'sort_order', sort_order,
      'version', version
    ) ORDER BY sort_order, record_key), '[]'::jsonb)
    FROM public.website_content
    WHERE module = 'gallery_collection'
  );
END;
$function$;

-- The function is SECURITY DEFINER and is called only through
-- createSupabaseAdminClient(), which authenticates with the server-only secret
-- key (service_role). Client roles must not be able to call it directly.
REVOKE ALL ON FUNCTION public.website_gallery_collection_reorder(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.website_gallery_collection_reorder(uuid, jsonb)
  TO service_role;

COMMIT;
