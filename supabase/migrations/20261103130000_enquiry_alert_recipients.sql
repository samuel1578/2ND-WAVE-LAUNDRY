-- Enquiry alert recipients.
--
-- Previously `public.enquiry_submit` required the caller to pass a recipient and
-- the server hardcoded manager@2ndwavelaundry.com. That meant the administrator
-- managed recipient list (public.booking_alert_recipients) had no effect on
-- enquiry alerts and only one person ever received them.
--
-- This forward-only migration:
--   * drops the old 12-argument function (the hardcoded-recipient signature);
--   * recreates it with 11 arguments — no recipient parameter at all;
--   * fans the internal `enquiry_received` alert out to every enabled row in
--     public.booking_alert_recipients inside the same transaction as the
--     enquiry insert, so the queue cannot drift from the committed submission;
--   * keeps one outbox row per recipient with a deterministic per-recipient
--     idempotency key, so a replay cannot duplicate an alert;
--   * records only the number of queued alerts in the audit event, never an
--     address.
--
-- The enquiry row, general/commercial validation, idempotency hash and audit
-- behaviour are unchanged. An empty or fully disabled recipient list is valid:
-- the enquiry is still stored and no alert is queued.
--
-- Apply after 20261103120000_gallery_collections.sql.

BEGIN;

DROP FUNCTION IF EXISTS
  public.enquiry_submit(text, text, text, text, text, text, text, jsonb, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.enquiry_submit(
    p_kind text, p_name text, p_business text, p_phone text, p_email text,
    p_topic text, p_message text, p_details jsonb, p_idempotency_key text,
    p_source_ip_hash text, p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_kind text := btrim(coalesce(p_kind, ''));
    v_name text := btrim(coalesce(p_name, ''));
    v_business text := nullif(btrim(coalesce(p_business, '')), '');
    v_phone text := btrim(coalesce(p_phone, ''));
    v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
    v_topic text := nullif(btrim(coalesce(p_topic, '')), '');
    v_message text := nullif(btrim(coalesce(p_message, '')), '');
    v_details jsonb := coalesce(p_details, '{}'::jsonb);
    v_key text := btrim(coalesce(p_idempotency_key, ''));
    v_row public.enquiries;
    v_existing public.enquiries;
    v_hash text;
    v_recipients integer := 0;
BEGIN
    IF char_length(v_key) NOT BETWEEN 16 AND 128 THEN
        RAISE EXCEPTION 'ENQUIRY_IDEMPOTENCY_REQUIRED: a valid key is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_kind NOT IN ('general', 'commercial') THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_KIND: choose a valid enquiry kind.' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(v_name) NOT BETWEEN 1 AND 120 OR char_length(v_phone) NOT BETWEEN 1 AND 40 THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_PAYLOAD: required contact fields are invalid.' USING ERRCODE = 'P0001';
    END IF;
    IF v_business IS NOT NULL AND char_length(v_business) > 120 THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_PAYLOAD: business name is too long.' USING ERRCODE = 'P0001';
    END IF;
    IF v_email IS NOT NULL AND (char_length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_PAYLOAD: email address is invalid.' USING ERRCODE = 'P0001';
    END IF;
    IF v_topic IS NOT NULL AND char_length(v_topic) > 80 THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_PAYLOAD: topic is too long.' USING ERRCODE = 'P0001';
    END IF;
    IF v_message IS NOT NULL AND char_length(v_message) > 4000 THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_PAYLOAD: message is too long.' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(v_details) <> 'object' OR octet_length(v_details::text) > 8000 THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_PAYLOAD: details are invalid.' USING ERRCODE = 'P0001';
    END IF;
    IF v_kind = 'general' AND (v_topic NOT IN ('Services', 'Pickup or delivery', 'Existing request', 'Commercial laundry', 'Concern or complaint', 'Something else') OR v_message IS NULL) THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_PAYLOAD: general enquiry fields are invalid.' USING ERRCODE = 'P0001';
    END IF;
    IF v_kind = 'commercial' AND (v_business IS NULL OR char_length(coalesce(v_details->>'items', '')) NOT BETWEEN 1 AND 2000) THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_PAYLOAD: commercial quote fields are invalid.' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(coalesce(v_details->>'frequency', '')) > 120
       OR char_length(coalesce(v_details->>'location', '')) > 500
       OR char_length(coalesce(v_details->>'requirements', '')) > 4000 THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_PAYLOAD: optional details are too long.' USING ERRCODE = 'P0001';
    END IF;
    IF p_source_ip_hash IS NOT NULL AND p_source_ip_hash !~ '^[a-f0-9]{32,64}$' THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_PAYLOAD: source identity is invalid.' USING ERRCODE = 'P0001';
    END IF;

    v_hash := md5(jsonb_build_object('kind', v_kind, 'name', v_name, 'business', v_business, 'phone', v_phone,
        'email', v_email, 'topic', v_topic, 'message', v_message, 'details', v_details)::text);
    INSERT INTO public.enquiries (kind, name, business, phone, email, topic, message, details, idempotency_key, source_ip_hash)
    VALUES (v_kind, v_name, v_business, v_phone, v_email, v_topic, v_message, v_details, v_key, p_source_ip_hash)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
        SELECT * INTO v_existing FROM public.enquiries WHERE idempotency_key = v_key;
        IF v_existing.id IS NULL OR md5(jsonb_build_object('kind', v_existing.kind, 'name', v_existing.name,
            'business', v_existing.business, 'phone', v_existing.phone, 'email', v_existing.email,
            'topic', v_existing.topic, 'message', v_existing.message, 'details', v_existing.details)::text) <> v_hash THEN
            RAISE EXCEPTION 'ENQUIRY_IDEMPOTENCY_MISMATCH: this key was already used for another request.' USING ERRCODE = 'P0001';
        END IF;
        RETURN jsonb_build_object('enquiry_id', v_existing.id, 'is_new', false);
    END IF;

    -- One alert per enabled administrator recipient, resolved inside this same
    -- transaction. The address is copied at enqueue time: later list changes do
    -- not redirect an already-queued alert. The message body and submitter email
    -- stay out of the payload.
    INSERT INTO public.email_outbox (idempotency_key, template, recipient_email, payload)
    SELECT
        'enquiry:' || v_row.id::text || ':received:' || md5(r.email),
        'enquiry_received',
        r.email,
        jsonb_build_object(
            'enquiry_id', v_row.id::text,
            'kind', v_kind,
            'name', v_name,
            'business', v_business,
            'phone', v_phone,
            'topic', v_topic
        )
    FROM public.booking_alert_recipients AS r
    WHERE r.enabled
    ORDER BY r.email
    ON CONFLICT (idempotency_key) DO NOTHING;

    GET DIAGNOSTICS v_recipients = ROW_COUNT;

    PERFORM private.insert_audit_event(NULL, 'enquiry.submitted', 'enquiry', v_row.id::text,
        NULL, jsonb_build_object(
            'kind', v_kind,
            'status', 'new',
            'alert_queued', v_recipients > 0,
            'alert_recipients', v_recipients
        ), NULL, p_correlation);
    RETURN jsonb_build_object('enquiry_id', v_row.id, 'is_new', true);
END;
$$;

REVOKE ALL ON FUNCTION public.enquiry_submit(text, text, text, text, text, text, text, jsonb, text, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enquiry_submit(text, text, text, text, text, text, text, jsonb, text, text, uuid)
    TO service_role;

COMMIT;

-- Read-only verification (expected: one signature, no client execute right).
SELECT p.oid::regprocedure AS signature
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'enquiry_submit';

SELECT
    has_function_privilege('anon', 'public.enquiry_submit(text,text,text,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', 'public.enquiry_submit(text,text,text,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') AS auth_exec,
    has_function_privilege('service_role', 'public.enquiry_submit(text,text,text,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') AS service_exec;
