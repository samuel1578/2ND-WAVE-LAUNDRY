  BEGIN;

  -- Persist a complete Blog ordering atomically using the existing sort_order field.
  -- Payload, publication state and media references are never changed here.
  CREATE OR REPLACE FUNCTION public.website_blog_reorder(
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
    v_count integer;
    v_position integer;
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_profiles a
      WHERE a.user_id = p_actor AND a.role = 'full_admin' AND a.disabled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_items) > 500 THEN
      RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('website_content:blog'));
    LOCK TABLE public.website_content IN SHARE ROW EXCLUSIVE MODE;
    SELECT count(*) INTO v_count FROM public.website_content WHERE module = 'blog';
    IF jsonb_array_length(p_items) <> v_count THEN
      RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = '40001';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS requested(value)
      LEFT JOIN public.website_content AS current
        ON current.module = 'blog' AND current.record_key = requested.value->>'key'
      WHERE jsonb_typeof(requested.value) IS DISTINCT FROM 'object'
        OR coalesce(requested.value->>'key', '') = ''
        OR coalesce(requested.value->>'version', '') !~ '^[0-9]+$'
        OR current.id IS NULL
        OR current.version <> (requested.value->>'version')::integer
    ) OR EXISTS (
      SELECT requested.value->>'key'
      FROM jsonb_array_elements(p_items) AS requested(value)
      GROUP BY requested.value->>'key'
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = '40001';
    END IF;

    FOR v_item, v_position IN
      SELECT value, ordinality::integer
      FROM jsonb_array_elements(p_items) WITH ORDINALITY
    LOOP
      v_key := v_item->>'key';
      v_expected := (v_item->>'version')::integer;
      UPDATE public.website_content
      SET sort_order = v_position,
          version = version + 1,
          updated_by = p_actor,
          updated_at = now()
      WHERE module = 'blog' AND record_key = v_key AND version = v_expected;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = '40001';
      END IF;
    END LOOP;

    PERFORM private.insert_audit_event(
      p_actor, 'content.update', 'website_content', 'blog:order', NULL,
      jsonb_build_object('count', v_count), NULL, NULL
    );
    RETURN (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'key', record_key, 'payload', payload, 'published', published,
        'sort_order', sort_order, 'version', version
      ) ORDER BY sort_order, record_key), '[]'::jsonb)
      FROM public.website_content WHERE module = 'blog'
    );
  END;
  $function$;

  REVOKE ALL ON FUNCTION public.website_blog_reorder(uuid, jsonb) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.website_blog_reorder(uuid, jsonb) TO service_role;

  COMMIT;
