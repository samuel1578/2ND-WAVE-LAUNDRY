BEGIN;

CREATE OR REPLACE FUNCTION public.website_content_replace(
  p_actor uuid, p_module text, p_items jsonb, p_expected_versions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_item jsonb;
  v_key text;
  v_expected integer;
  v_row public.website_content%ROWTYPE;
BEGIN
  -- Row/advisory lock waits are bounded so the admin receives a retryable
  -- error instead of holding a server action open for roughly two minutes.
  SET LOCAL lock_timeout = '5s';

  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_profiles a
    WHERE a.user_id = p_actor
      AND a.role = 'full_admin'
      AND a.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_module NOT IN ('faq', 'gallery')
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('website_content:' || p_module)) THEN
    RAISE EXCEPTION 'CONTENT_BUSY' USING ERRCODE = '55P03';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_key := v_item->>'key';
    SELECT (p_expected_versions->>v_key)::integer INTO v_expected;
    SELECT * INTO v_row
    FROM public.website_content
    WHERE module = p_module AND record_key = v_key
    FOR UPDATE;

    IF FOUND AND (v_expected IS NULL OR v_row.version <> v_expected) THEN
      RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = 'PT409';
    END IF;

    IF v_key IS NULL
       OR length(v_key) NOT BETWEEN 1 AND 180
       OR jsonb_typeof(v_item->'payload') <> 'object' THEN
      RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
    END IF;

    IF p_module = 'faq'
       AND (
         length(btrim(coalesce(v_item#>>'{payload,question}', ''))) NOT BETWEEN 1 AND 300
         OR length(btrim(coalesce(v_item#>>'{payload,answer}', ''))) NOT BETWEEN 1 AND 4000
       ) THEN
      RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
    END IF;

    IF p_module = 'gallery'
       AND (
         coalesce(v_item#>>'{payload,media_id}', '') !~ '^[0-9a-f-]{36}$'
         OR length(btrim(coalesce(v_item#>>'{payload,alt}', ''))) NOT BETWEEN 1 AND 1000
         OR NOT EXISTS (
           SELECT 1
           FROM public.website_gallery_media m
           WHERE m.id = (v_item#>>'{payload,media_id}')::uuid
             AND NOT m.archived
         )
       ) THEN
      RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_module = 'faq' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) a(value)
    JOIN jsonb_array_elements(p_items) b(value)
      ON a.value->>'key' < b.value->>'key'
    WHERE lower(regexp_replace(btrim(a.value#>>'{payload,question}'), '[[:space:]?？.]+$', '', 'g'))
        = lower(regexp_replace(btrim(b.value#>>'{payload,question}'), '[[:space:]?？.]+$', '', 'g'))
  ) THEN
    RAISE EXCEPTION 'CONTENT_DUPLICATE_FAQ' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.website_content old
    WHERE old.module = p_module
      AND NOT (old.record_key IN (
        SELECT value->>'key' FROM jsonb_array_elements(p_items)
      ))
      AND coalesce((p_expected_versions->>old.record_key)::integer, -1) <> old.version
  ) THEN
    RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE = 'PT409';
  END IF;

  DELETE FROM public.website_content
  WHERE module = p_module
    AND NOT (record_key IN (
      SELECT value->>'key' FROM jsonb_array_elements(p_items)
    ));

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_key := v_item->>'key';
    INSERT INTO public.website_content
      (module, record_key, payload, published, sort_order, version, updated_by)
    VALUES
      (p_module, v_key, v_item->'payload',
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
    p_actor, 'content.update', 'website_content', p_module, NULL,
    jsonb_build_object('module', p_module, 'count', jsonb_array_length(p_items)),
    NULL, NULL
  );

  RETURN (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id, 'key', record_key, 'payload', payload,
          'published', published, 'sort_order', sort_order, 'version', version
        )
        ORDER BY sort_order, record_key
      ),
      '[]'::jsonb
    )
    FROM public.website_content
    WHERE module = p_module
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.website_content_upsert(
  p_actor uuid, p_module text, p_key text, p_payload jsonb, p_published boolean,
  p_sort_order integer, p_expected_version integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.website_content%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id=p_actor AND a.role='full_admin' AND a.disabled_at IS NULL) THEN RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_module NOT IN ('blog','promotion') OR p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 1 AND 180 OR jsonb_typeof(p_payload)<>'object' OR p_sort_order<0 THEN RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.website_content WHERE module=p_module AND record_key=p_key FOR UPDATE;
  IF FOUND AND (p_expected_version IS NULL OR v_row.version<>p_expected_version) THEN RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF NOT FOUND AND p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF p_module='blog' AND p_published AND (length(btrim(coalesce(p_payload->>'title','')))=0 OR length(btrim(coalesce(p_payload->>'summary','')))=0 OR length(btrim(coalesce(p_payload->>'body','')))=0 OR (p_payload->>'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO public.website_content(module,record_key,payload,published,sort_order,version,updated_by)
  VALUES(p_module,p_key,p_payload,p_published,p_sort_order,1,p_actor)
  ON CONFLICT(module,record_key) DO UPDATE SET payload=excluded.payload,published=excluded.published,sort_order=excluded.sort_order,version=public.website_content.version+1,updated_by=p_actor,updated_at=now()
  RETURNING * INTO v_row;
  PERFORM private.insert_audit_event(p_actor,'content.update','website_content',p_module||':'||p_key,NULL,jsonb_build_object('published',p_published,'version',v_row.version),NULL,NULL);
  RETURN jsonb_build_object('id',v_row.id,'key',v_row.record_key,'payload',v_row.payload,'published',v_row.published,'sort_order',v_row.sort_order,'version',v_row.version);
END;
$$;

COMMIT;
