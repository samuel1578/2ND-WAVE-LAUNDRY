-- Phase 6 — Durable website content and public site settings.
-- Apply manually after all earlier migrations. No hosted project is modified here.
BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS public_map_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS public_hours jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS public_body text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS public_image text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS public_alt text NOT NULL DEFAULT '';

CREATE TABLE public.website_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  record_key text NOT NULL,
  payload jsonb NOT NULL,
  published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_content_module CHECK (module IN ('blog','faq','promotion','gallery')),
  CONSTRAINT website_content_key CHECK (char_length(btrim(record_key)) BETWEEN 1 AND 180),
  CONSTRAINT website_content_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT website_content_version CHECK (version >= 1),
  CONSTRAINT website_content_order CHECK (sort_order >= 0),
  UNIQUE (module, record_key)
);
CREATE INDEX website_content_public_order ON public.website_content(module, sort_order, updated_at DESC) WHERE published;
ALTER TABLE public.website_content ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_content FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_content TO anon, authenticated;
CREATE POLICY website_content_public_published ON public.website_content
  FOR SELECT TO anon, authenticated USING (published);

CREATE TABLE public.website_gallery_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL UNIQUE,
  public_url text NOT NULL,
  name text NOT NULL,
  alt text NOT NULL,
  caption text NOT NULL DEFAULT '',
  source text NOT NULL,
  permission text NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_gallery_media_path CHECK (storage_path !~ '(^/|\.\.|\\|^booking-photos/)'),
  CONSTRAINT website_gallery_media_public_url CHECK (public_url ~ '^https://'),
  CONSTRAINT website_gallery_media_alt CHECK (char_length(btrim(alt)) BETWEEN 1 AND 1000),
  CONSTRAINT website_gallery_media_version CHECK (version >= 1)
);
ALTER TABLE public.website_gallery_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_gallery_media FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_gallery_media TO anon, authenticated;
CREATE POLICY website_gallery_media_public_active ON public.website_gallery_media
  FOR SELECT TO anon, authenticated USING (NOT archived AND EXISTS (
    SELECT 1 FROM public.website_content c
    WHERE c.module = 'gallery' AND c.published
      AND c.payload->>'media_id' = website_gallery_media.id::text
  ));

CREATE TABLE public.public_site_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  business_email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '059 522 4280',
  whatsapp text NOT NULL DEFAULT '233595224280',
  instagram text NOT NULL DEFAULT 'https://www.instagram.com/2ndwave_laundry/',
  tiktok text NOT NULL DEFAULT 'https://www.tiktok.com/@2ndwave.com',
  facebook text NOT NULL DEFAULT '',
  newsletter_visible boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_site_settings_email_len CHECK (char_length(business_email) <= 254),
  CONSTRAINT public_site_settings_phone_len CHECK (char_length(phone) BETWEEN 7 AND 40),
  CONSTRAINT public_site_settings_whatsapp_len CHECK (char_length(whatsapp) BETWEEN 7 AND 40),
  CONSTRAINT public_site_settings_social_urls CHECK (
    (instagram = '' OR instagram ~ '^https://') AND
    (tiktok = '' OR tiktok ~ '^https://') AND
    (facebook = '' OR facebook ~ '^https://')
  )
);
INSERT INTO public.public_site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.public_site_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_site_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_site_settings TO anon, authenticated;
CREATE POLICY public_site_settings_read ON public.public_site_settings
  FOR SELECT TO anon, authenticated USING (id);

-- Admin RPCs require a fresh database role lookup, version match, and audit in the
-- same transaction. A collection write replaces only its module and increments
-- each retained row's version; deleting is represented by omission.
CREATE OR REPLACE FUNCTION public.website_content_replace(
  p_actor uuid, p_module text, p_items jsonb, p_expected_versions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item jsonb; v_key text; v_expected integer; v_row public.website_content%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id = p_actor AND a.role = 'full_admin' AND a.disabled_at IS NULL) THEN
    RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_module NOT IN ('faq','gallery') OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 500 THEN
    RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('website_content:' || p_module));
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_key := v_item->>'key';
    SELECT (p_expected_versions->>v_key)::integer INTO v_expected;
    SELECT * INTO v_row FROM public.website_content WHERE module=p_module AND record_key=v_key FOR UPDATE;
    IF FOUND AND (v_expected IS NULL OR v_row.version <> v_expected) THEN RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE='40001'; END IF;
    IF v_key IS NULL OR length(v_key) NOT BETWEEN 1 AND 180 OR jsonb_typeof(v_item->'payload') <> 'object' THEN RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE='22023'; END IF;
    IF p_module='faq' AND (length(btrim(coalesce(v_item#>>'{payload,question}',''))) NOT BETWEEN 1 AND 300 OR length(btrim(coalesce(v_item#>>'{payload,answer}',''))) NOT BETWEEN 1 AND 4000) THEN RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE='22023'; END IF;
    IF p_module='gallery' AND (coalesce(v_item#>>'{payload,media_id}','') !~ '^[0-9a-f-]{36}$' OR length(btrim(coalesce(v_item#>>'{payload,alt}',''))) NOT BETWEEN 1 AND 1000 OR NOT EXISTS (SELECT 1 FROM public.website_gallery_media m WHERE m.id=(v_item#>>'{payload,media_id}')::uuid AND NOT m.archived)) THEN RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF p_module='faq' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) a(value)
    JOIN jsonb_array_elements(p_items) b(value)
      ON a.value->>'key' < b.value->>'key'
    WHERE lower(regexp_replace(btrim(a.value#>>'{payload,question}'), '[[:space:]?？.]+$', '', 'g'))
      = lower(regexp_replace(btrim(b.value#>>'{payload,question}'), '[[:space:]?？.]+$', '', 'g'))
  ) THEN RAISE EXCEPTION 'CONTENT_DUPLICATE_FAQ' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.website_content old WHERE old.module=p_module AND NOT (old.record_key IN (SELECT value->>'key' FROM jsonb_array_elements(p_items))) AND coalesce((p_expected_versions->>old.record_key)::integer,-1)<>old.version) THEN RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE='40001'; END IF;
  DELETE FROM public.website_content WHERE module=p_module AND NOT (record_key IN (SELECT value->>'key' FROM jsonb_array_elements(p_items)));
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_key := v_item->>'key';
    INSERT INTO public.website_content(module,record_key,payload,published,sort_order,version,updated_by)
    VALUES(p_module,v_key,v_item->'payload',coalesce((v_item->>'published')::boolean,true),coalesce((v_item->>'sort_order')::integer,0),1,p_actor)
    ON CONFLICT(module,record_key) DO UPDATE SET payload=excluded.payload,published=excluded.published,sort_order=excluded.sort_order,version=public.website_content.version+1,updated_by=p_actor,updated_at=now();
  END LOOP;
  PERFORM private.insert_audit_event(p_actor,'content.update','website_content',p_module,NULL,jsonb_build_object('module',p_module,'count',jsonb_array_length(p_items)),NULL,NULL);
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'key',record_key,'payload',payload,'published',published,'sort_order',sort_order,'version',version) ORDER BY sort_order,record_key),'[]'::jsonb) FROM public.website_content WHERE module=p_module);
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
  IF FOUND AND (p_expected_version IS NULL OR v_row.version<>p_expected_version) THEN RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE='40001'; END IF;
  IF NOT FOUND AND p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE='40001'; END IF;
  IF p_module='blog' AND p_published AND (length(btrim(coalesce(p_payload->>'title','')))=0 OR length(btrim(coalesce(p_payload->>'summary','')))=0 OR length(btrim(coalesce(p_payload->>'body','')))=0 OR (p_payload->>'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$') THEN RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO public.website_content(module,record_key,payload,published,sort_order,version,updated_by)
  VALUES(p_module,p_key,p_payload,p_published,p_sort_order,1,p_actor)
  ON CONFLICT(module,record_key) DO UPDATE SET payload=excluded.payload,published=excluded.published,sort_order=excluded.sort_order,version=public.website_content.version+1,updated_by=p_actor,updated_at=now()
  RETURNING * INTO v_row;
  PERFORM private.insert_audit_event(p_actor,'content.update','website_content',p_module||':'||p_key,NULL,jsonb_build_object('published',p_published,'version',v_row.version),NULL,NULL);
  RETURN jsonb_build_object('id',v_row.id,'key',v_row.record_key,'payload',v_row.payload,'published',v_row.published,'sort_order',v_row.sort_order,'version',v_row.version);
END;
$$;

CREATE OR REPLACE FUNCTION public.public_site_settings_update(
  p_actor uuid, p_expected_version integer, p_settings jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.public_site_settings%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id=p_actor AND a.role='full_admin' AND a.disabled_at IS NULL) THEN RAISE EXCEPTION 'SETTINGS_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.public_site_settings WHERE id FOR UPDATE;
  IF v_row.version<>p_expected_version THEN RAISE EXCEPTION 'SETTINGS_CONFLICT' USING ERRCODE='40001'; END IF;
  UPDATE public.public_site_settings SET business_email=p_settings->>'business_email',phone=p_settings->>'phone',whatsapp=p_settings->>'whatsapp',instagram=p_settings->>'instagram',tiktok=p_settings->>'tiktok',facebook=p_settings->>'facebook',newsletter_visible=(p_settings->>'newsletter_visible')::boolean,version=version+1,updated_by=p_actor,updated_at=now() WHERE id RETURNING * INTO v_row;
  PERFORM private.insert_audit_event(p_actor,'settings.update','public_site_settings','singleton',NULL,jsonb_build_object('version',v_row.version),NULL,NULL);
  RETURN to_jsonb(v_row)-'updated_by';
END;
$$;

CREATE OR REPLACE FUNCTION public.phase6_settings_update(
  p_actor uuid,p_site_version integer,p_booking_version integer,p_settings jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.public_site_settings%ROWTYPE; b public.booking_settings%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id=p_actor AND a.role='full_admin' AND a.disabled_at IS NULL) THEN RAISE EXCEPTION 'SETTINGS_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM public.public_site_settings WHERE id FOR UPDATE;
  SELECT * INTO b FROM public.booking_settings WHERE id FOR UPDATE;
  IF s.version<>p_site_version OR b.version<>p_booking_version THEN RAISE EXCEPTION 'SETTINGS_CONFLICT' USING ERRCODE='40001'; END IF;
  IF (p_settings->>'pickup_start')::time >= (p_settings->>'express_cutoff')::time OR (p_settings->>'express_cutoff')::time >= (p_settings->>'pickup_end')::time THEN RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.public_site_settings SET business_email=p_settings->>'business_email',phone=p_settings->>'phone',whatsapp=p_settings->>'whatsapp',instagram=p_settings->>'instagram',tiktok=p_settings->>'tiktok',facebook=p_settings->>'facebook',newsletter_visible=(p_settings->>'newsletter_visible')::boolean,version=version+1,updated_by=p_actor,updated_at=now() WHERE id RETURNING * INTO s;
  UPDATE public.booking_settings SET pickup_start=(p_settings->>'pickup_start')::time,pickup_end=(p_settings->>'pickup_end')::time,express_cutoff=(p_settings->>'express_cutoff')::time,accept_public_bookings=(p_settings->>'accept_public_bookings')::boolean,version=version+1 WHERE id RETURNING * INTO b;
  PERFORM private.insert_audit_event(p_actor,'settings.update','phase6_settings','singleton',NULL,jsonb_build_object('version',s.version,'booking_version',b.version),NULL,NULL);
  RETURN jsonb_build_object('business_email',s.business_email,'phone',s.phone,'whatsapp',s.whatsapp,'instagram',s.instagram,'tiktok',s.tiktok,'facebook',s.facebook,'newsletter_visible',s.newsletter_visible,'pickup_start',b.pickup_start,'pickup_end',b.pickup_end,'express_cutoff',b.express_cutoff,'accept_public_bookings',b.accept_public_bookings,'version',s.version);
END;
$$;

CREATE OR REPLACE FUNCTION public.website_service_update(
  p_actor uuid,p_slug text,p_expected_version integer,p_title text,p_summary text,p_body text,p_image text,p_alt text,p_sort_order integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.services%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id=p_actor AND a.role='full_admin' AND a.disabled_at IS NULL) THEN RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.services WHERE slug=p_slug FOR UPDATE;
  IF NOT FOUND OR v_row.version<>p_expected_version THEN RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE='40001'; END IF;
  IF length(btrim(p_title)) NOT BETWEEN 1 AND 120 OR length(p_summary)>2000 OR length(p_body)>50000 OR length(p_image)>2000 OR length(p_alt)>1000 OR p_sort_order<0 THEN RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.services SET title=p_title,summary=p_summary,public_body=p_body,public_image=p_image,public_alt=p_alt,sort_order=p_sort_order,version=version+1 WHERE id=v_row.id RETURNING * INTO v_row;
  PERFORM private.insert_audit_event(p_actor,'content.update','service',v_row.id::text,NULL,jsonb_build_object('slug',p_slug,'version',v_row.version),NULL,NULL);
  RETURN jsonb_build_object('id',v_row.id,'slug',v_row.slug,'title',v_row.title,'summary',v_row.summary,'body',v_row.public_body,'image',v_row.public_image,'alt',v_row.public_alt,'kind',v_row.kind,'bookable',v_row.bookable,'active',v_row.active,'sort_order',v_row.sort_order,'version',v_row.version);
END;
$$;

CREATE OR REPLACE FUNCTION public.website_branch_update(
  p_actor uuid,p_id uuid,p_expected_version integer,p_title text,p_label text,p_phone text,p_map_url text,p_public_hours jsonb,p_sort_order integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.branches%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id=p_actor AND a.role='full_admin' AND a.disabled_at IS NULL) THEN RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.branches WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_row.version<>p_expected_version THEN RAISE EXCEPTION 'CONTENT_CONFLICT' USING ERRCODE='40001'; END IF;
  IF length(btrim(p_title)) NOT BETWEEN 1 AND 120 OR length(p_label)>60 OR length(p_phone)>32 OR length(p_map_url)>1000 OR p_map_url<>'' AND p_map_url !~ '^https://' OR jsonb_typeof(p_public_hours)<>'array' OR jsonb_array_length(p_public_hours)>14 OR p_sort_order<0 THEN RAISE EXCEPTION 'CONTENT_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.branches SET title=p_title,label=p_label,phone=p_phone,public_map_url=p_map_url,public_hours=p_public_hours,sort_order=p_sort_order,version=version+1 WHERE id=p_id RETURNING * INTO v_row;
  PERFORM private.insert_audit_event(p_actor,'content.update','branch',p_id::text,NULL,jsonb_build_object('slug',v_row.slug,'version',v_row.version),NULL,NULL);
  RETURN jsonb_build_object('id',v_row.id,'slug',v_row.slug,'title',v_row.title,'label',v_row.label,'phone',v_row.phone,'map_url',v_row.public_map_url,'hours',v_row.public_hours,'sort_order',v_row.sort_order,'version',v_row.version);
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_settings_update(
  p_actor uuid,p_expected_version integer,p_pickup_start time,p_pickup_end time,p_express_cutoff time,p_accept_public_bookings boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.booking_settings%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id=p_actor AND a.role='full_admin' AND a.disabled_at IS NULL) THEN RAISE EXCEPTION 'SETTINGS_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.booking_settings WHERE id FOR UPDATE;
  IF v_row.version<>p_expected_version THEN RAISE EXCEPTION 'SETTINGS_CONFLICT' USING ERRCODE='40001'; END IF;
  IF p_pickup_start>=p_express_cutoff OR p_express_cutoff>=p_pickup_end THEN RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.booking_settings SET pickup_start=p_pickup_start,pickup_end=p_pickup_end,express_cutoff=p_express_cutoff,accept_public_bookings=p_accept_public_bookings,version=version+1 WHERE id RETURNING * INTO v_row;
  PERFORM private.insert_audit_event(p_actor,'settings.update','booking_settings','singleton',NULL,jsonb_build_object('version',v_row.version,'accept_public_bookings',v_row.accept_public_bookings),NULL,NULL);
  RETURN jsonb_build_object('pickup_start',v_row.pickup_start,'pickup_end',v_row.pickup_end,'express_cutoff',v_row.express_cutoff,'accept_public_bookings',v_row.accept_public_bookings,'version',v_row.version);
END;
$$;

CREATE OR REPLACE FUNCTION public.website_media_upsert(
  p_actor uuid,p_id uuid,p_storage_path text,p_public_url text,p_name text,p_alt text,p_caption text,p_source text,p_permission text,p_archived boolean,p_expected_version integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.website_gallery_media%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id=p_actor AND a.role='full_admin' AND a.disabled_at IS NULL) THEN RAISE EXCEPTION 'MEDIA_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_storage_path ~ '(^/|\.\.|\\|^booking-photos/)' OR p_public_url !~ '^https://' OR length(btrim(p_alt))=0 OR length(p_name)>255 OR length(p_alt)>1000 OR length(p_caption)>1000 OR length(p_source)>500 OR length(p_permission)>1000 THEN RAISE EXCEPTION 'MEDIA_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.website_gallery_media WHERE id=p_id FOR UPDATE;
  IF FOUND AND (v_row.version<>p_expected_version OR EXISTS(SELECT 1 FROM public.website_content c WHERE c.module='gallery' AND c.payload->>'media_id'=p_id::text AND c.published AND p_archived)) THEN RAISE EXCEPTION 'MEDIA_CONFLICT_OR_IN_USE' USING ERRCODE='40001'; END IF;
  INSERT INTO public.website_gallery_media(id,storage_path,public_url,name,alt,caption,source,permission,archived,version) VALUES(p_id,p_storage_path,p_public_url,p_name,p_alt,p_caption,p_source,p_permission,p_archived,1)
  ON CONFLICT(id) DO UPDATE SET storage_path=excluded.storage_path,public_url=excluded.public_url,name=excluded.name,alt=excluded.alt,caption=excluded.caption,source=excluded.source,permission=excluded.permission,archived=excluded.archived,version=public.website_gallery_media.version+1 RETURNING * INTO v_row;
  PERFORM private.insert_audit_event(p_actor,'media.update','website_gallery_media',p_id::text,NULL,jsonb_build_object('archived',p_archived,'version',v_row.version),NULL,NULL);
  RETURN to_jsonb(v_row);
END;
$$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('website_content_replace','website_content_upsert','public_site_settings_update','website_media_upsert','website_service_update','website_branch_update','booking_settings_update','phase6_settings_update') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA private TO service_role;

-- Import only the existing approved FAQ copy, preserving both established groups.
INSERT INTO public.website_content(module,record_key,payload,published,sort_order)
VALUES
('faq','04.00-01','{"question":"How are the fee and timing confirmed?","answer":"The team agrees the fee and timing with you before confirming your booking.","glow":"fee and timing","enabled":true}'::jsonb,true,1),
('faq','04.00-02','{"question":"Can I request more than one service?","answer":"Yes. You can select multiple services in the booking form.","glow":"multiple services","enabled":true}'::jsonb,true,2),
('faq','04.00-03','{"question":"Do I need an account to book?","answer":"No. You can submit a booking request without creating an account.","glow":"creating an account","enabled":true}'::jsonb,true,3),
('faq','04.00-04','{"question":"Can I bring my items to a branch?","answer":"Yes. Walk-ins and drop-offs are welcome at our three branches. Check the opening hours before visiting.","glow":"three branches","enabled":true}'::jsonb,true,4),
('faq','04.00-05','{"question":"When does pickup operate?","answer":"Pickup operates seven days a week, including holidays, from 7am to 5pm.","glow":"seven days a week","enabled":true}'::jsonb,true,5),
('faq','04.00-06','{"question":"Do you aim to collect on the same day?","answer":"Yes. We aim to collect as soon as possible, usually the same day, unless you request another date. The team confirms the arrangements with you.","glow":"as soon as possible","enabled":true}'::jsonb,true,6),
('faq','04.00-07','{"question":"What does the 11am cutoff mean?","answer":"For Express/Same-Day Laundry requiring pickup for service that day, request collection by 11am. It is not a general cutoff for ordinary same-day collection requests.","glow":"Express/Same-Day Laundry","enabled":true}'::jsonb,true,7),
('faq','04.00-08','{"question":"Is same-day service guaranteed?","answer":"No. The team confirms availability, the fee and completion timing for your items.","glow":"confirms availability","enabled":true}'::jsonb,true,8),
('faq','04.00-09','{"question":"Where does my pickup request go?","answer":"Pickup requests go to our main team, who arrange the appropriate branch.","glow":"appropriate branch","enabled":true}'::jsonb,true,9),
('faq','04.00-10','{"question":"Is my booking confirmed when I submit the form?","answer":"No. Your request is saved as pending until the team confirms the details with you.","glow":"saved as pending","enabled":true}'::jsonb,true,10),
('faq','04.00-11','{"question":"Do I pay on the website?","answer":"No. The fee and payment arrangements are discussed with the team.","glow":"payment arrangements","enabled":true}'::jsonb,true,11),
('faq','04.00-12','{"question":"Can I change my collection date?","answer":"Contact our team to discuss a change to your request.","glow":"discuss a change","enabled":true}'::jsonb,true,12),
('faq','04.00-13','{"question":"Can I add photos?","answer":"Yes. You can optionally add up to three photos, no larger than 5MB each, to your booking request.","glow":"up to three photos","enabled":true}'::jsonb,true,13),
('faq','04.00-14','{"question":"What is excluded from Wash, Ironing & Fold?","answer":"Large items, bedding, wedding gowns, suits, Kente clothes, rugs and sneakers do not qualify for Wash, Ironing & Fold. Contact the team to discuss the appropriate service.","glow":"do not qualify","enabled":true}'::jsonb,true,14),
('faq','13-01','{"question":"Will I receive an instant price?","answer":"No. The team discusses your requirements with you before agreeing a quote.","enabled":true}'::jsonb,true,15),
('faq','13-02','{"question":"Does submitting the form confirm a service?","answer":"No. Submitting the form sends an enquiry. Service arrangements need to be agreed with the team.","enabled":true}'::jsonb,true,16),
('faq','13-03','{"question":"Do I need an account?","answer":"No. You can submit a quote request without creating an account.","enabled":true}'::jsonb,true,17)
ON CONFLICT(module,record_key) DO NOTHING;

COMMIT;

-- Read-only verification: all three tables have RLS and no browser mutation grants.
SELECT c.relname,c.relrowsecurity FROM pg_class c WHERE c.oid IN ('public.website_content'::regclass,'public.website_gallery_media'::regclass,'public.public_site_settings'::regclass) ORDER BY c.relname;
SELECT has_table_privilege('anon','public.website_content','INSERT') AS anon_insert,has_table_privilege('authenticated','public.website_content','UPDATE') AS auth_update,has_function_privilege('anon','public.website_content_replace(uuid,text,jsonb,jsonb)','EXECUTE') AS anon_rpc;
