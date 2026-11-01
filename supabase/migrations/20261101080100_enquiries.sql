-- Durable public general enquiries and commercial quote requests.
-- Requires 20261101080000_enquiry_email_type.sql, which commits the enum label
-- before this migration uses it in an outbox constraint.
BEGIN;

CREATE TABLE IF NOT EXISTS public.enquiries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN ('general', 'commercial')),
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
    name text NOT NULL,
    business text,
    phone text NOT NULL,
    email text,
    topic text,
    message text,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    notes jsonb NOT NULL DEFAULT '[]'::jsonb,
    version integer NOT NULL DEFAULT 1,
    idempotency_key text NOT NULL UNIQUE,
    source_ip_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT enquiries_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
    CONSTRAINT enquiries_business_length CHECK (business IS NULL OR char_length(business) <= 120),
    CONSTRAINT enquiries_phone_length CHECK (char_length(phone) BETWEEN 1 AND 40),
    CONSTRAINT enquiries_email_length CHECK (email IS NULL OR char_length(email) <= 254),
    CONSTRAINT enquiries_topic_length CHECK (topic IS NULL OR char_length(topic) <= 80),
    CONSTRAINT enquiries_message_length CHECK (message IS NULL OR char_length(message) <= 4000),
    CONSTRAINT enquiries_details_size CHECK (octet_length(details::text) <= 8000),
    CONSTRAINT enquiries_notes_array CHECK (jsonb_typeof(notes) = 'array'),
    CONSTRAINT enquiries_version_positive CHECK (version >= 1),
    CONSTRAINT enquiries_idempotency_shape CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
    CONSTRAINT enquiries_source_ip_hash_shape CHECK (source_ip_hash IS NULL OR source_ip_hash ~ '^[a-f0-9]{32,64}$')
);

CREATE INDEX IF NOT EXISTS enquiries_kind_created_idx ON public.enquiries (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS enquiries_status_idx ON public.enquiries (status);
ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.enquiries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.enquiries TO service_role;

COMMENT ON TABLE public.enquiries IS
'Public general enquiry and commercial quote submissions. Browser roles have no access; trusted server functions write and service_role reads for the authorised admin interface.';
COMMENT ON COLUMN public.enquiries.source_ip_hash IS
'Opaque SHA-256-derived client identity used for abuse investigation; raw client addresses are never stored.';

-- Extend the existing validated outbox payload contract by one minimal internal
-- alert type. The message body and private notes are intentionally excluded.
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_payload_shape;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_payload_shape CHECK (
    jsonb_typeof(payload) = 'object'
    AND (
        (
            payload ? 'booking_reference' AND payload ? 'status'
            AND jsonb_typeof(payload->'booking_reference') = 'string'
            AND jsonb_typeof(payload->'status') = 'string'
            AND (
                (template IN ('booking_created', 'booking_confirmed', 'booking_processing_started', 'booking_ready', 'booking_completed', 'booking_cancelled')
                    AND (payload - 'booking_reference' - 'status') = '{}'::jsonb)
                OR
                (template IN ('staff_order_pending', 'staff_order_processing', 'staff_order_ready', 'staff_order_completed', 'staff_order_cancelled')
                    AND (payload - 'booking_reference' - 'status' - 'previous_status' - 'actor_kind' - 'actor_name' - 'actor_role' - 'occurred_at' - 'cancellation_reason') = '{}'::jsonb
                    AND jsonb_typeof(payload->'previous_status') = 'string'
                    AND jsonb_typeof(payload->'actor_kind') = 'string'
                    AND jsonb_typeof(payload->'actor_name') = 'string'
                    AND jsonb_typeof(payload->'actor_role') = 'string'
                    AND jsonb_typeof(payload->'occurred_at') = 'string'
                    AND jsonb_typeof(payload->'cancellation_reason') = 'string'
                    AND char_length(payload->>'cancellation_reason') <= 500)
            )
        )
        OR
        (template = 'newsletter_interest_received'
            AND payload ? 'subscriber_email' AND payload ? 'submitted_at' AND payload ? 'source'
            AND (payload - 'subscriber_email' - 'submitted_at' - 'source') = '{}'::jsonb
            AND jsonb_typeof(payload->'subscriber_email') = 'string'
            AND jsonb_typeof(payload->'submitted_at') = 'string'
            AND jsonb_typeof(payload->'source') = 'string'
            AND payload->>'subscriber_email' ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
            AND char_length(payload->>'subscriber_email') BETWEEN 3 AND 254
            AND payload->>'source' = 'public_newsletter_form')
        OR
        (template = 'enquiry_received'
            AND payload ? 'enquiry_id' AND payload ? 'kind' AND payload ? 'name'
            AND payload ? 'business' AND payload ? 'phone' AND payload ? 'topic'
            AND (payload - 'enquiry_id' - 'kind' - 'name' - 'business' - 'phone' - 'topic') = '{}'::jsonb
            AND jsonb_typeof(payload->'enquiry_id') = 'string'
            AND jsonb_typeof(payload->'kind') = 'string'
            AND jsonb_typeof(payload->'name') = 'string'
            AND jsonb_typeof(payload->'business') IN ('string', 'null')
            AND jsonb_typeof(payload->'phone') = 'string'
            AND jsonb_typeof(payload->'topic') IN ('string', 'null')
            AND payload->>'enquiry_id' ~ '^[0-9a-fA-F-]{36}$'
            AND payload->>'kind' IN ('general', 'commercial')
            AND char_length(payload->>'name') BETWEEN 1 AND 120
            AND (payload->'business' = 'null'::jsonb OR char_length(payload->>'business') <= 120)
            AND char_length(payload->>'phone') BETWEEN 1 AND 40
            AND (payload->'topic' = 'null'::jsonb OR char_length(payload->>'topic') <= 80))
    )
);

ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_template_status;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_template_status CHECK (
    (template = 'booking_created' AND payload->>'status' = 'pending')
    OR (template = 'booking_confirmed' AND payload->>'status' = 'confirmed')
    OR (template = 'booking_processing_started' AND payload->>'status' = 'processing')
    OR (template = 'booking_ready' AND payload->>'status' = 'ready')
    OR (template = 'booking_completed' AND payload->>'status' = 'completed')
    OR (template = 'booking_cancelled' AND payload->>'status' = 'cancelled')
    OR (template = 'staff_order_pending' AND payload->>'status' = 'pending')
    OR (template = 'staff_order_processing' AND payload->>'status' = 'processing')
    OR (template = 'staff_order_ready' AND payload->>'status' = 'ready')
    OR (template = 'staff_order_completed' AND payload->>'status' = 'completed')
    OR (template = 'staff_order_cancelled' AND payload->>'status' = 'cancelled')
    OR template IN ('newsletter_interest_received', 'enquiry_received')
);

CREATE OR REPLACE FUNCTION public.enquiry_submit(
    p_kind text, p_name text, p_business text, p_phone text, p_email text,
    p_topic text, p_message text, p_details jsonb, p_idempotency_key text,
    p_source_ip_hash text, p_recipient_email text, p_correlation uuid
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
    v_recipient text := lower(btrim(coalesce(p_recipient_email, '')));
    v_row public.enquiries;
    v_existing public.enquiries;
    v_hash text;
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
    IF char_length(v_recipient) NOT BETWEEN 3 AND 254 OR v_recipient !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'ENQUIRY_RECIPIENT_INVALID: manager alert recipient is not configured.' USING ERRCODE = 'P0001';
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

    INSERT INTO public.email_outbox (idempotency_key, template, recipient_email, payload)
    VALUES ('enquiry:' || v_row.id::text || ':received', 'enquiry_received', v_recipient,
        jsonb_build_object('enquiry_id', v_row.id::text, 'kind', v_kind, 'name', v_name,
            'business', v_business, 'phone', v_phone, 'topic', v_topic))
    ON CONFLICT (idempotency_key) DO NOTHING;

    PERFORM private.insert_audit_event(NULL, 'enquiry.submitted', 'enquiry', v_row.id::text,
        NULL, jsonb_build_object('kind', v_kind, 'status', 'new', 'alert_queued', true), NULL, p_correlation);
    RETURN jsonb_build_object('enquiry_id', v_row.id, 'is_new', true);
END;
$$;

REVOKE ALL ON FUNCTION public.enquiry_submit(text, text, text, text, text, text, text, jsonb, text, text, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enquiry_submit(text, text, text, text, text, text, text, jsonb, text, text, text, uuid)
    TO service_role;

CREATE OR REPLACE FUNCTION public.enquiry_update(
    p_id uuid, p_expected_version integer, p_new_status text, p_note text,
    p_actor_user_id uuid, p_correlation uuid
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_row public.enquiries;
    v_old_status text;
    v_status text := nullif(btrim(coalesce(p_new_status, '')), '');
    v_note text := nullif(btrim(coalesce(p_note, '')), '');
    v_now timestamptz := clock_timestamp();
    v_notes jsonb;
BEGIN
    IF p_actor_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.admin_profiles
        WHERE user_id = p_actor_user_id AND role = 'full_admin' AND disabled_at IS NULL
    ) THEN
        RAISE EXCEPTION 'ENQUIRY_ACTOR_REQUIRED: an active Full Admin is required.' USING ERRCODE = 'P0001';
    END IF;
    IF v_status IS NOT NULL AND v_status NOT IN ('new', 'contacted', 'closed') THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_STATUS: choose a valid enquiry status.' USING ERRCODE = 'P0001';
    END IF;
    IF p_note IS NOT NULL AND (v_note IS NULL OR char_length(v_note) > 4000) THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_NOTE: note must contain 1 to 4000 characters.' USING ERRCODE = 'P0001';
    END IF;
    IF v_status IS NULL AND v_note IS NULL THEN
        RAISE EXCEPTION 'ENQUIRY_INVALID_NOTE: provide a status change or a note.' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_row FROM public.enquiries WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ENQUIRY_NOT_FOUND: enquiry no longer exists.' USING ERRCODE = 'P0001';
    END IF;
    IF v_row.version <> p_expected_version THEN
        RAISE EXCEPTION 'ENQUIRY_VERSION_CONFLICT: record has changed.' USING ERRCODE = 'P0001';
    END IF;
    v_old_status := v_row.status;
    v_notes := v_row.notes;
    IF v_note IS NOT NULL THEN
        v_notes := v_notes || jsonb_build_array(jsonb_build_object('text', v_note, 'at', v_now, 'by', p_actor_user_id::text));
    END IF;
    UPDATE public.enquiries SET
        status = coalesce(v_status, status), notes = v_notes,
        version = version + 1, updated_at = v_now
    WHERE id = p_id RETURNING * INTO v_row;

    IF v_status IS NOT NULL AND v_status IS DISTINCT FROM v_old_status THEN
        PERFORM private.insert_audit_event(p_actor_user_id, 'enquiry.status_changed', 'enquiry', p_id::text,
            NULL, jsonb_build_object('status', v_row.status, 'version', v_row.version), NULL, p_correlation);
    END IF;
    IF v_note IS NOT NULL THEN
        PERFORM private.insert_audit_event(p_actor_user_id, 'enquiry.note_added', 'enquiry', p_id::text,
            NULL, jsonb_build_object('version', v_row.version), NULL, p_correlation);
    END IF;
    RETURN jsonb_build_object('version', v_row.version, 'status', v_row.status);
END;
$$;

REVOKE ALL ON FUNCTION public.enquiry_update(uuid, integer, text, text, uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enquiry_update(uuid, integer, text, text, uuid, uuid)
    TO service_role;

COMMIT;
