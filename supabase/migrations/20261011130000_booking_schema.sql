-- 2ND WAVE — Sprint 2A
-- Production booking foundation: reference data, scheduling configuration and the
-- core booking tables.
--
-- Requires the Phase 1 migrations:
--   20261010120000_admin_profiles.sql
--   20261010120100_admin_profiles_rls.sql
--   20261011120000_admin_profiles_email.sql
--   20261011120100_audit_events.sql
--   20261011120200_admin_invitations.sql
--   20261011120300_admin_staff_functions.sql
--
-- Apply manually after review. Then apply, in order:
--   20261011130100_booking_rls.sql
--   20261011130200_booking_functions.sql
--   20261011130300_booking_retention.sql
--
-- Nothing in this file grants a client role write access. Anonymous submissions
-- and administrative mutations happen only through the trusted functions created
-- in 20261011130200_booking_functions.sql.

BEGIN;

-- ============================================================
-- 1. STATUS AND CATALOGUE TYPES
-- ============================================================

-- Agreed operational lifecycle. `cancelled` is the only alternative terminal
-- state. The ordering of the labels is intentional and mirrors the documented
-- progression; invalid transitions are rejected by the trusted functions rather
-- than by the type.
CREATE TYPE public.booking_status AS ENUM (
    'pending',
    'confirmed',
    'scheduled',
    'picked_up',
    'processing',
    'ready',
    'out_for_delivery',
    'completed',
    'cancelled'
);

COMMENT ON TYPE public.booking_status IS
'Booking lifecycle. Every new customer booking starts as pending; only the trusted functions may change it.';

-- How a catalogue service participates in a booking.
--   laundry     — a selectable cleaning service
--   modifier    — an option that changes another service (express, stain treatment)
--   information — a fulfilment path, not a selectable item (pickup & delivery)
--   commercial  — the commercial quotation path, never bookable online
CREATE TYPE public.service_kind AS ENUM (
    'laundry',
    'modifier',
    'information',
    'commercial'
);

COMMENT ON TYPE public.service_kind IS
'Catalogue service role. Modifiers appear with a booking but never on their own as an item category.';

-- ============================================================
-- 2. GENERIC updated_at TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION private.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.touch_updated_at() IS
'Keeps updated_at authoritative on every update of a versioned booking table. Trigger-only.';

REVOKE ALL ON FUNCTION private.touch_updated_at()
FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. BRANCHES (reference data)
-- ============================================================

CREATE TABLE public.branches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    title text NOT NULL,
    label text NOT NULL DEFAULT '',
    phone text NOT NULL DEFAULT '',
    sort_order integer NOT NULL DEFAULT 0,
    is_primary boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT branches_slug_format
        CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT branches_title_length
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
    CONSTRAINT branches_label_length
        CHECK (char_length(label) <= 60),
    CONSTRAINT branches_phone_length
        CHECK (char_length(phone) <= 32),
    CONSTRAINT branches_version_positive
        CHECK (version >= 1)
);

COMMENT ON TABLE public.branches IS
'Approved service branches. The production source of truth for booking branch assignment; the public site content layer is reconciled against it in Sprint 2C.';

CREATE INDEX branches_active_order_idx
ON public.branches (active, sort_order);

CREATE TRIGGER branches_touch
BEFORE UPDATE ON public.branches
FOR EACH ROW
EXECUTE FUNCTION private.touch_updated_at();

-- ============================================================
-- 4. SERVICES (approved catalogue)
-- ============================================================

CREATE TABLE public.services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    title text NOT NULL,
    summary text NOT NULL DEFAULT '',
    kind public.service_kind NOT NULL DEFAULT 'laundry',
    bookable boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT services_slug_format
        CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT services_title_length
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
    CONSTRAINT services_summary_length
        CHECK (char_length(summary) <= 2000),
    CONSTRAINT services_version_positive
        CHECK (version >= 1)
);

COMMENT ON TABLE public.services IS
'Approved service catalogue. A booking snapshots the title and slug of every selected service, so later catalogue edits never rewrite a customer request.';

COMMENT ON COLUMN public.services.bookable IS
'True when the public booking form may select this service. Informational and commercial entries are not bookable.';

CREATE INDEX services_active_order_idx
ON public.services (active, sort_order);

CREATE TRIGGER services_touch
BEFORE UPDATE ON public.services
FOR EACH ROW
EXECUTE FUNCTION private.touch_updated_at();

-- ============================================================
-- 5. OPENING HOURS — TWO DISTINCT CONCEPTS
-- ============================================================
--
-- Branch/walk-in opening hours and the pickup operating window are deliberately
-- modelled as separate tables. They are different business rules (07:00–20:00
-- walk-in versus 07:00–17:00 pickup) and must never be derived from one another.

-- Walk-in / counter opening hours (Africa/Accra local times).
CREATE TABLE public.branch_operating_hours (
    branch_id uuid NOT NULL
        REFERENCES public.branches(id) ON DELETE CASCADE,
    weekday smallint NOT NULL,
    opens time NOT NULL DEFAULT '07:00',
    closes time NOT NULL DEFAULT '20:00',

    PRIMARY KEY (branch_id, weekday),

    CONSTRAINT branch_operating_hours_weekday
        CHECK (weekday BETWEEN 1 AND 7),
    CONSTRAINT branch_operating_hours_order
        CHECK (opens < closes)
);

COMMENT ON TABLE public.branch_operating_hours IS
'Walk-in / counter opening hours per branch (default 07:00–20:00). ISO-8601 weekday: 1 = Monday … 7 = Sunday. These hours never restrict the pickup operating window.';

-- Pickup operating window (Africa/Accra local times). Default 07:00–17:00 for
-- every day, including weekends and public holidays.
CREATE TABLE public.branch_pickup_windows (
    branch_id uuid NOT NULL
        REFERENCES public.branches(id) ON DELETE CASCADE,
    weekday smallint NOT NULL,
    opens time NOT NULL DEFAULT '07:00',
    closes time NOT NULL DEFAULT '17:00',
    is_closed boolean NOT NULL DEFAULT false,

    PRIMARY KEY (branch_id, weekday),

    CONSTRAINT branch_pickup_windows_weekday
        CHECK (weekday BETWEEN 1 AND 7),
    CONSTRAINT branch_pickup_windows_order
        CHECK (is_closed OR opens < closes)
);

COMMENT ON TABLE public.branch_pickup_windows IS
'Pickup operating window per branch and weekday (default 07:00–17:00, seven days). Distinct from branch_operating_hours. An absent row falls back to the approved 07:00–17:00 default, never to an unrestricted window.';

-- Date-specific overrides (public holidays, closures, temporary hours).
CREATE TABLE public.branch_pickup_exceptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id uuid NOT NULL
        REFERENCES public.branches(id) ON DELETE CASCADE,
    exception_date date NOT NULL,
    opens time,
    closes time,
    is_closed boolean NOT NULL DEFAULT false,
    reason text NOT NULL DEFAULT '',

    CONSTRAINT branch_pickup_exceptions_unique
        UNIQUE (branch_id, exception_date),
    CONSTRAINT branch_pickup_exceptions_reason_length
        CHECK (char_length(reason) <= 200),
    CONSTRAINT branch_pickup_exceptions_order
        CHECK (is_closed OR (opens IS NOT NULL AND closes IS NOT NULL AND opens < closes))
);

COMMENT ON TABLE public.branch_pickup_exceptions IS
'Optional date-specific pickup overrides. The absence of a row means the normal weekly window applies, so weekends and public holidays are open by default.';

CREATE INDEX branch_pickup_exceptions_date_idx
ON public.branch_pickup_exceptions (exception_date);

-- ============================================================
-- 6. BOOKING SETTINGS (singleton)
-- ============================================================

CREATE TABLE public.booking_settings (
    id boolean PRIMARY KEY DEFAULT true,
    pickup_start time NOT NULL DEFAULT '07:00',
    pickup_end time NOT NULL DEFAULT '17:00',
    express_cutoff time NOT NULL DEFAULT '11:00',
    timezone text NOT NULL DEFAULT 'Africa/Accra',
    accept_public_bookings boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT booking_settings_singleton CHECK (id),
    CONSTRAINT booking_settings_pickup_order CHECK (pickup_start < pickup_end),
    CONSTRAINT booking_settings_version_positive CHECK (version >= 1)
);

COMMENT ON TABLE public.booking_settings IS
'Single-row operational settings. Pickup window 07:00–17:00 and the express/same-day 11:00 cutoff are independent values. Booking collection may be paused without deleting data; activation UI is a later sprint.';

INSERT INTO public.booking_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER booking_settings_touch
BEFORE UPDATE ON public.booking_settings
FOR EACH ROW
EXECUTE FUNCTION private.touch_updated_at();

-- ============================================================
-- 7. BOOKINGS
-- ============================================================

CREATE TABLE public.bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Opaque customer-facing reference. Never an authorisation credential.
    reference text NOT NULL UNIQUE,

    -- Idempotency scope: the submission channel plus the caller-supplied key.
    submission_scope text NOT NULL DEFAULT 'public_booking_form',
    idempotency_key text NOT NULL,
    submission_hash text NOT NULL,

    -- Customer and contact details (personal information).
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    customer_email text,
    whatsapp_phone text,
    same_whatsapp boolean NOT NULL DEFAULT true,
    contact_method text NOT NULL DEFAULT 'phone',

    -- Laundry request.
    item_category text NOT NULL,
    load_size text NOT NULL,
    customer_notes text NOT NULL DEFAULT '',

    -- Pickup / location request.
    pickup_address text NOT NULL,
    pickup_landmark text NOT NULL DEFAULT '',
    pickup_map_url text,
    transport_preference text NOT NULL DEFAULT 'no_preference',

    -- Requested (not reserved) pickup preference.
    requested_date date NOT NULL,
    requested_time time,
    express_requested boolean NOT NULL DEFAULT false,
    requested_timezone text NOT NULL DEFAULT 'Africa/Accra',

    -- Assignment, resolved administratively. Null until an administrator assigns.
    assigned_branch_id uuid
        REFERENCES public.branches(id) ON DELETE SET NULL,

    -- Lifecycle.
    status public.booking_status NOT NULL DEFAULT 'pending',

    -- Agreed operational arrangements (never auto-populated from the request).
    agreed_pickup_at timestamptz,
    agreed_fee numeric(10, 2),
    agreed_fee_currency text NOT NULL DEFAULT 'GHS',
    zero_fee_reason text,
    service_charge numeric(10, 2),
    contact_outcome text,
    confirmation_note text,
    return_details text,

    -- Cancellation.
    cancellation_reason text,
    cancelled_by uuid
        REFERENCES auth.users(id) ON DELETE SET NULL,

    -- Consent provenance for the submitted acknowledgement.
    notice_version text,

    -- Optimistic concurrency.
    version integer NOT NULL DEFAULT 1,

    -- Lifecycle timestamps.
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    scheduled_at timestamptz,
    picked_up_at timestamptz,
    processing_at timestamptz,
    ready_at timestamptz,
    out_for_delivery_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,

    -- Retention: eligible for deletion at creation + 12 calendar months.
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '12 months'),

    CONSTRAINT bookings_reference_format
        CHECK (reference ~ '^2W-[0-9A-HJKMNP-TV-Z]{10}$'),
    CONSTRAINT bookings_scope_length
        CHECK (char_length(submission_scope) BETWEEN 3 AND 60),
    CONSTRAINT bookings_idempotency_key_length
        CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
    CONSTRAINT bookings_submission_hash_length
        CHECK (char_length(submission_hash) = 32),
    CONSTRAINT bookings_name_length
        CHECK (char_length(btrim(customer_name)) BETWEEN 1 AND 120),
    CONSTRAINT bookings_phone_length
        CHECK (char_length(btrim(customer_phone)) BETWEEN 7 AND 20),
    CONSTRAINT bookings_email_length
        CHECK (customer_email IS NULL
            OR char_length(customer_email) BETWEEN 3 AND 254),
    CONSTRAINT bookings_whatsapp_length
        CHECK (whatsapp_phone IS NULL
            OR char_length(btrim(whatsapp_phone)) BETWEEN 7 AND 20),
    CONSTRAINT bookings_contact_method
        CHECK (contact_method IN ('phone', 'whatsapp')),
    CONSTRAINT bookings_item_category
        CHECK (item_category IN ('clothing', 'bedding', 'both', 'other')),
    CONSTRAINT bookings_load_size_length
        CHECK (char_length(btrim(load_size)) BETWEEN 1 AND 200),
    CONSTRAINT bookings_notes_length
        CHECK (char_length(customer_notes) <= 4000),
    CONSTRAINT bookings_address_length
        CHECK (char_length(btrim(pickup_address)) BETWEEN 1 AND 500),
    CONSTRAINT bookings_landmark_length
        CHECK (char_length(pickup_landmark) <= 200),
    CONSTRAINT bookings_map_url_length
        CHECK (pickup_map_url IS NULL
            OR char_length(pickup_map_url) <= 2048),
    CONSTRAINT bookings_transport_preference
        CHECK (transport_preference IN ('no_preference', 'cab', 'motorbike', 'courier')),
    CONSTRAINT bookings_timezone_fixed
        CHECK (requested_timezone = 'Africa/Accra'),
    CONSTRAINT bookings_fee_nonnegative
        CHECK (agreed_fee IS NULL OR agreed_fee >= 0),
    CONSTRAINT bookings_service_charge_nonnegative
        CHECK (service_charge IS NULL OR service_charge >= 0),
    CONSTRAINT bookings_fee_currency
        CHECK (agreed_fee_currency = 'GHS'),
    CONSTRAINT bookings_zero_fee_reason
        CHECK (agreed_fee IS NULL OR agreed_fee <> 0
            OR (zero_fee_reason IS NOT NULL AND btrim(zero_fee_reason) <> '')),
    CONSTRAINT bookings_cancellation_reason
        CHECK (status <> 'cancelled'
            OR (cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')),
    CONSTRAINT bookings_version_positive
        CHECK (version >= 1),
    CONSTRAINT bookings_customer_contact_required
        CHECK (customer_phone IS NOT NULL),

    -- Idempotent replay is scoped to the submission channel.
    CONSTRAINT bookings_idempotency_unique
        UNIQUE (submission_scope, idempotency_key)
);

COMMENT ON TABLE public.bookings IS
'Production bookings. Created only by the trusted public submission function as pending, with no agreed appointment, fee or assignment. Administrative state is changed only by the trusted lifecycle functions.';

COMMENT ON COLUMN public.bookings.reference IS
'Opaque customer-facing reference. Safe to display and quote; never used for authorisation.';
COMMENT ON COLUMN public.bookings.submission_hash IS
'MD5 of the canonical submission payload. A retry with an identical key and a different payload is rejected as a conflict.';
COMMENT ON COLUMN public.bookings.version IS
'Optimistic concurrency version. Every administrative mutation must supply the expected version.';
COMMENT ON COLUMN public.bookings.expires_at IS
'Retention deadline (creation + 12 calendar months). The deletion job is not activated in Sprint 2A.';
COMMENT ON COLUMN public.bookings.agreed_pickup_at IS
'Administratively agreed appointment. Never copied from the customer request automatically.';

CREATE INDEX bookings_status_requested_idx
ON public.bookings (status, requested_date);

CREATE INDEX bookings_branch_requested_idx
ON public.bookings (assigned_branch_id, requested_date);

CREATE INDEX bookings_created_at_idx
ON public.bookings (created_at DESC);

CREATE INDEX bookings_expires_at_idx
ON public.bookings (expires_at);

CREATE TRIGGER bookings_touch
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION private.touch_updated_at();

-- ============================================================
-- 8. BOOKING SERVICES (immutable snapshot)
-- ============================================================

CREATE TABLE public.booking_services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id uuid NOT NULL
        REFERENCES public.bookings(id) ON DELETE CASCADE,
    service_id uuid
        REFERENCES public.services(id) ON DELETE SET NULL,
    service_slug text NOT NULL,
    service_title text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT booking_services_unique_selection
        UNIQUE (booking_id, service_slug),
    CONSTRAINT booking_services_slug_length
        CHECK (char_length(btrim(service_slug)) BETWEEN 1 AND 80),
    CONSTRAINT booking_services_title_length
        CHECK (char_length(btrim(service_title)) BETWEEN 1 AND 120)
);

COMMENT ON TABLE public.booking_services IS
'Immutable snapshot of the services a customer selected. The title and slug are captured at submission, and service_id becomes null if the catalogue entry is ever removed, so the historical request is never rewritten.';

CREATE INDEX booking_services_booking_idx
ON public.booking_services (booking_id);

-- ============================================================
-- 9. BOOKING STATUS HISTORY (append-only)
-- ============================================================

CREATE TABLE public.booking_status_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id uuid NOT NULL
        REFERENCES public.bookings(id) ON DELETE CASCADE,
    from_status public.booking_status,
    to_status public.booking_status NOT NULL,
    actor_id uuid
        REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_kind text NOT NULL DEFAULT 'admin',
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT booking_status_history_actor_kind
        CHECK (actor_kind IN ('customer', 'system', 'admin')),
    CONSTRAINT booking_status_history_reason_length
        CHECK (reason IS NULL OR char_length(reason) <= 2000),
    CONSTRAINT booking_status_history_creation_shape
        CHECK (from_status IS NOT NULL OR to_status = 'pending')
);

COMMENT ON TABLE public.booking_status_history IS
'Append-only lifecycle history. One row per transition, written in the same transaction as the status change.';

CREATE INDEX booking_status_history_booking_idx
ON public.booking_status_history (booking_id, created_at);

-- ============================================================
-- 10. BOOKING NOTES (append-only, private)
-- ============================================================

CREATE TABLE public.booking_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id uuid NOT NULL
        REFERENCES public.bookings(id) ON DELETE CASCADE,
    author_id uuid
        REFERENCES auth.users(id) ON DELETE SET NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT booking_notes_body_length
        CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000)
);

COMMENT ON TABLE public.booking_notes IS
'Private administrative notes. Append-only and never exposed to anonymous or customer-facing surfaces.';

CREATE INDEX booking_notes_booking_idx
ON public.booking_notes (booking_id, created_at);

-- ============================================================
-- 11. BOOKING PHOTOS (retention scaffolding only)
-- ============================================================
--
-- Sprint 2A introduces the retention metadata only: no upload pipeline, no
-- storage bucket and no public URL. The future upload sprint owns the private
-- object lifecycle described in the SRS.

CREATE TABLE public.booking_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id uuid NOT NULL
        REFERENCES public.bookings(id) ON DELETE CASCADE,
    storage_key text NOT NULL UNIQUE,
    mime_type text NOT NULL,
    byte_size integer NOT NULL,
    width integer,
    height integer,
    processing_state text NOT NULL DEFAULT 'pending',
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    -- A STORED generated column based on timestamptz + interval is not
    -- immutable in PostgreSQL (timezone-dependent). Use a trigger instead.
    delete_due_at timestamptz NOT NULL,

    CONSTRAINT booking_photos_mime
        CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT booking_photos_size
        CHECK (byte_size > 0 AND byte_size <= 5000000),
    CONSTRAINT booking_photos_state
        CHECK (processing_state IN ('pending', 'available', 'rejected'))
);

COMMENT ON TABLE public.booking_photos IS
'Retention scaffolding for private customer photos. Photos expire 90 days after upload. No upload path, storage bucket or public URL is introduced in Sprint 2A.';

CREATE INDEX booking_photos_booking_idx
ON public.booking_photos (booking_id);

CREATE INDEX booking_photos_delete_due_idx
ON public.booking_photos (delete_due_at);

-- Ensure the photo deadline is derived from the actual upload timestamp,
-- including inserts that explicitly supply uploaded_at.
CREATE OR REPLACE FUNCTION private.set_booking_photo_due_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    NEW.delete_due_at := NEW.uploaded_at + interval '90 days';
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.set_booking_photo_due_at()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER booking_photos_due_at
BEFORE INSERT OR UPDATE OF uploaded_at, delete_due_at
ON public.booking_photos
FOR EACH ROW
EXECUTE FUNCTION private.set_booking_photo_due_at();

-- ============================================================
-- 12. IMMUTABILITY TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION private.booking_rows_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION
        'Booking history is append-only: % is not permitted on %.',
        TG_OP,
        TG_TABLE_NAME
        USING ERRCODE = 'P0001';
END;
$$;

COMMENT ON FUNCTION private.booking_rows_immutable() IS
'Rejects update and delete on append-only booking history and note tables.';

REVOKE ALL ON FUNCTION private.booking_rows_immutable()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER booking_status_history_immutable
BEFORE UPDATE OR DELETE ON public.booking_status_history
FOR EACH ROW
EXECUTE FUNCTION private.booking_rows_immutable();

CREATE TRIGGER booking_notes_immutable
BEFORE UPDATE OR DELETE ON public.booking_notes
FOR EACH ROW
EXECUTE FUNCTION private.booking_rows_immutable();

-- ============================================================
-- 13. SEED REFERENCE DATA
-- ============================================================
--
-- The three approved branches and the approved service catalogue are seeded from
-- the documented business model. Existing rows are never overwritten.

INSERT INTO public.branches (slug, title, label, phone, sort_order, is_primary)
VALUES
    ('ashaiman-atadeka', 'Ashaiman–Atadeka', 'Main Branch', '059 522 4280', 1, true),
    ('katamanso-no-1', 'Katamanso No. 1', '', '059 814 8620', 2, false),
    ('newland-katamanso', 'Newland Katamanso', '', '024 614 4412', 3, false)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.services (slug, title, summary, kind, bookable, sort_order)
VALUES
    ('wash-ironing-fold', 'Wash, Ironing & Fold', 'Everyday laundry washed, ironed and folded.', 'laundry', true, 1),
    ('wash-and-fold-only', 'Wash and Fold Only', 'Everyday laundry washed and folded without ironing.', 'laundry', true, 2),
    ('ironing', 'Ironing', 'Professional pressing for garments.', 'laundry', true, 3),
    ('shoe-care', 'Shoe Care', 'Cleaning and care for shoes.', 'laundry', true, 4),
    ('stain-treatment', 'Stain Treatment', 'Targeted treatment for marked items.', 'modifier', true, 5),
    ('duvet-and-bedding-cleaning', 'Duvet and Bedding Cleaning', 'Cleaning for duvets and bedding.', 'laundry', true, 6),
    ('curtain-cleaning', 'Curtain Cleaning', 'Cleaning for curtains.', 'laundry', true, 7),
    ('suit-cleaning', 'Suit Cleaning', 'Cleaning for suits.', 'laundry', true, 8),
    ('express-same-day-laundry', 'Express/Same-Day Laundry', 'Same-day service subject to the 11:00 request cutoff.', 'modifier', true, 9),
    ('pickup-and-delivery', 'Pickup & Delivery', 'Fulfilment information, not a selectable laundry item.', 'information', false, 10)
ON CONFLICT (slug) DO NOTHING;

-- Walk-in opening hours: 07:00–20:00 every day, for every branch.
INSERT INTO public.branch_operating_hours (branch_id, weekday, opens, closes)
SELECT b.id, d.weekday, time '07:00', time '20:00'
FROM public.branches AS b
CROSS JOIN generate_series(1, 7) AS d(weekday)
ON CONFLICT (branch_id, weekday) DO NOTHING;

-- Pickup window: 07:00–17:00 every day, including weekends and public holidays.
INSERT INTO public.branch_pickup_windows (branch_id, weekday, opens, closes, is_closed)
SELECT b.id, d.weekday, time '07:00', time '17:00', false
FROM public.branches AS b
CROSS JOIN generate_series(1, 7) AS d(weekday)
ON CONFLICT (branch_id, weekday) DO NOTHING;

COMMIT;

-- ============================================================
-- 14. READ-ONLY VERIFICATION
-- ============================================================
--
-- RLS is enabled on every booking table by the next migration
-- (20261011130100_booking_rls.sql), so `rls_enabled` is false at this point. Re-run
-- this query after applying that migration to see it become true.

SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname IN (
    'branches',
    'services',
    'branch_operating_hours',
    'branch_pickup_windows',
    'branch_pickup_exceptions',
    'booking_settings',
    'bookings',
    'booking_services',
    'booking_status_history',
    'booking_notes',
    'booking_photos'
)
ORDER BY relname;

SELECT
    (SELECT count(*) FROM public.branches) AS branches,
    (SELECT count(*) FROM public.services) AS services,
    (SELECT count(*) FROM public.branch_pickup_windows) AS pickup_windows,
    (SELECT count(*) FROM public.branch_operating_hours) AS operating_hours,
    (SELECT count(*) FROM public.booking_settings) AS settings_rows;
