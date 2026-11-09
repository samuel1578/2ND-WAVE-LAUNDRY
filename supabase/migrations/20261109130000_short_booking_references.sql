BEGIN;

-- =========================================================
-- 1. Allow new 4-character references and legacy 10-character
--    references. The 2W- prefix remains unchanged.
-- =========================================================

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_reference_format;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_reference_format
  CHECK (
    reference ~ '^2W-([0-9A-HJKMNP-TV-Z]{4}|[0-9A-HJKMNP-TV-Z]{10})$'
  ) NOT VALID;

ALTER TABLE public.bookings
  VALIDATE CONSTRAINT bookings_reference_format;


ALTER TABLE public.email_outbox
  DROP CONSTRAINT IF EXISTS email_outbox_reference_shape;

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_reference_shape
  CHECK (
    payload->>'booking_reference'
      ~ '^2W-([0-9A-HJKMNP-TV-Z]{4}|[0-9A-HJKMNP-TV-Z]{10})$'
  ) NOT VALID;

ALTER TABLE public.email_outbox
  VALIDATE CONSTRAINT email_outbox_reference_shape;


COMMENT ON COLUMN public.bookings.reference IS
  'Booking reference format: 2W- followed by 4 characters for new bookings. Existing 10-character suffix references remain valid.';


-- =========================================================
-- 2. Generate unique references in the format 2W-XXXX.
--    Raise an error if 20 attempts cannot find an unused code.
-- =========================================================

CREATE OR REPLACE FUNCTION private.booking_reference()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_reference text;
  v_attempt integer;
BEGIN
  FOR v_attempt IN 1..20 LOOP

    SELECT
      '2W-' ||
      string_agg(
        substr(
          '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
          (get_byte(decoded.bytes, i) % 32) + 1,
          1
        ),
        ''
        ORDER BY i
      )
    INTO v_reference
    FROM (
      SELECT decode(
        replace(gen_random_uuid()::text, '-', ''),
        'hex'
      ) AS bytes
    ) AS decoded,
    generate_series(0, 3) AS i;

    IF NOT EXISTS (
      SELECT 1
      FROM public.bookings AS b
      WHERE b.reference = v_reference
    ) THEN
      RETURN v_reference;
    END IF;

  END LOOP;

  RAISE EXCEPTION
    'Unable to generate a unique booking reference after 20 attempts';
END;
$$;

REVOKE ALL ON FUNCTION private.booking_reference()
FROM PUBLIC, anon, authenticated;

COMMIT;