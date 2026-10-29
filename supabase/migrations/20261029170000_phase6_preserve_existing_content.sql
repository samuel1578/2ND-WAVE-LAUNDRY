-- Phase 6 repair — preserve the existing FAQ and gallery content when the
-- durable website-content tables are introduced.
BEGIN;

ALTER TABLE public.website_gallery_media
  DROP CONSTRAINT IF EXISTS website_gallery_media_public_url;
ALTER TABLE public.website_gallery_media
  ADD CONSTRAINT website_gallery_media_public_url CHECK (public_url ~ '^(https://|/images/)');

DO $$
DECLARE
  v_media_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.website_content WHERE module = 'faq') THEN
    INSERT INTO public.website_content
      (module, record_key, payload, published, sort_order)
    VALUES
      ('faq', 'seed-faq-1', '{"question":"Can I bring my items to a branch?","answer":"Yes. Walk-ins and drop-offs are welcome at our three branches. Check the opening hours before visiting.","glow":"three branches","enabled":true}'::jsonb, true, 1),
      ('faq', 'seed-faq-2', '{"question":"When does pickup operate?","answer":"Pickup operates seven days a week, including holidays, from 7am to 5pm.","glow":"seven days a week","enabled":true}'::jsonb, true, 2),
      ('faq', 'seed-faq-3', '{"question":"Do you aim to collect on the same day?","answer":"Yes. We aim to collect as soon as possible, usually the same day, unless you request another date. The team confirms the arrangements with you.","glow":"as soon as possible","enabled":true}'::jsonb, true, 3),
      ('faq', 'seed-faq-4', '{"question":"What does the 11am cutoff mean?","answer":"For Express/Same-Day Laundry requiring pickup for service that day, request collection by 11am. It is not a general cutoff for ordinary same-day collection requests.","glow":"Express/Same-Day Laundry","enabled":true}'::jsonb, true, 4),
      ('faq', 'seed-faq-5', '{"question":"Is same-day service guaranteed?","answer":"No. The team confirms availability, the fee and completion timing for your items.","glow":"confirms availability","enabled":true}'::jsonb, true, 5),
      ('faq', 'seed-faq-6', '{"question":"Where does my pickup request go?","answer":"Pickup requests go to our main team, who arrange the appropriate branch.","glow":"appropriate branch","enabled":true}'::jsonb, true, 6),
      ('faq', 'seed-faq-7', '{"question":"Is my booking confirmed when I submit the form?","answer":"No. Your request is saved as pending until the team confirms the details with you.","glow":"saved as pending","enabled":true}'::jsonb, true, 7),
      ('faq', 'seed-faq-8', '{"question":"Do I pay on the website?","answer":"No. The fee and payment arrangements are discussed with the team.","glow":"payment arrangements","enabled":true}'::jsonb, true, 8),
      ('faq', 'seed-faq-9', '{"question":"Can I change my collection date?","answer":"Contact our team to discuss a change to your request.","glow":"discuss a change","enabled":true}'::jsonb, true, 9),
      ('faq', 'seed-faq-10', '{"question":"Can I add photos?","answer":"Yes. You can optionally add up to three photos, no larger than 5MB each, to your booking request.","glow":"up to three photos","enabled":true}'::jsonb, true, 10),
      ('faq', 'seed-faq-11', '{"question":"What is excluded from Wash, Ironing & Fold?","answer":"Large items, bedding, wedding gowns, suits, Kente clothes, rugs and sneakers do not qualify for Wash, Ironing & Fold. Contact the team to discuss the appropriate service.","glow":"do not qualify","enabled":true}'::jsonb, true, 11);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.website_content WHERE module = 'gallery') THEN
    v_media_id := gen_random_uuid();
    INSERT INTO public.website_gallery_media (id, storage_path, public_url, name, alt, source, permission)
    VALUES (v_media_id, 'legacy/GALLERY-1.jpg', '/images/GALLERY-1.jpg', 'GALLERY-1.jpg', 'Washing', 'Approved design handoff', 'Approved marketing image');
    INSERT INTO public.website_content (module, record_key, payload, published, sort_order)
    VALUES ('gallery', 'seed-gallery-1', jsonb_build_object('media_id', v_media_id::text, 'alt', 'Washing', 'caption', ''), true, 1);
    v_media_id := gen_random_uuid();
    INSERT INTO public.website_gallery_media (id, storage_path, public_url, name, alt, source, permission)
    VALUES (v_media_id, 'legacy/GALLERY-2.jpg', '/images/GALLERY-2.jpg', 'GALLERY-2.jpg', 'Pressing', 'Approved design handoff', 'Approved marketing image');
    INSERT INTO public.website_content (module, record_key, payload, published, sort_order)
    VALUES ('gallery', 'seed-gallery-2', jsonb_build_object('media_id', v_media_id::text, 'alt', 'Pressing', 'caption', ''), true, 2);
    v_media_id := gen_random_uuid();
    INSERT INTO public.website_gallery_media (id, storage_path, public_url, name, alt, source, permission)
    VALUES (v_media_id, 'legacy/GALLERY-3.jpg', '/images/GALLERY-3.jpg', 'GALLERY-3.jpg', 'Garment packaging', 'Approved design handoff', 'Approved marketing image');
    INSERT INTO public.website_content (module, record_key, payload, published, sort_order)
    VALUES ('gallery', 'seed-gallery-3', jsonb_build_object('media_id', v_media_id::text, 'alt', 'Garment packaging', 'caption', ''), true, 3);
    v_media_id := gen_random_uuid();
    INSERT INTO public.website_gallery_media (id, storage_path, public_url, name, alt, source, permission)
    VALUES (v_media_id, 'legacy/GALLERY-4.jpg', '/images/GALLERY-4.jpg', 'GALLERY-4.jpg', 'Linen folding', 'Approved design handoff', 'Approved marketing image');
    INSERT INTO public.website_content (module, record_key, payload, published, sort_order)
    VALUES ('gallery', 'seed-gallery-4', jsonb_build_object('media_id', v_media_id::text, 'alt', 'Linen folding', 'caption', ''), true, 4);
    v_media_id := gen_random_uuid();
    INSERT INTO public.website_gallery_media (id, storage_path, public_url, name, alt, source, permission)
    VALUES (v_media_id, 'legacy/GALLERY-5.jpg', '/images/GALLERY-5.jpg', 'GALLERY-5.jpg', 'Collection handover', 'Approved design handoff', 'Approved marketing image');
    INSERT INTO public.website_content (module, record_key, payload, published, sort_order)
    VALUES ('gallery', 'seed-gallery-5', jsonb_build_object('media_id', v_media_id::text, 'alt', 'Collection handover', 'caption', ''), true, 5);
  END IF;
END;
$$;

UPDATE public.website_content
SET payload = jsonb_set(payload, '{enabled}', 'true'::jsonb, true)
WHERE module = 'faq'
  AND NOT (payload ? 'enabled');

COMMIT;
