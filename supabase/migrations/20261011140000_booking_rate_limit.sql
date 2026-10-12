
-- ============================================================
-- 2ND WAVE LAUNDRY SERVICES
-- SPRINT 2B — SHARED BOOKING RATE LIMITER
-- Migration: 20261011140000_booking_rate_limit.sql
-- ============================================================
--
-- Prerequisites:
-- All four Sprint 2A migrations must already be applied.
--
-- Purpose:
-- Implement an atomic, database-backed fixed-window rate limiter
-- shared across all Next.js server instances.
--
-- Security:
-- - No anonymous or authenticated client table access.
-- - Only service_role may execute the consume function.
-- - Buckets must be derived from hashed client identities.
-- - Never send raw IP addresses as buckets.
--
-- No existing Sprint 2A objects are modified.
-- No booking records are created or deleted.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. RATE-LIMIT COUNTER TABLE
-- ============================================================

CREATE TABLE public.booking_rate_limits (
    bucket text NOT NULL,
    window_start timestamptz NOT NULL,
    hits integer NOT NULL DEFAULT 0,

    PRIMARY KEY (bucket, window_start),

    CONSTRAINT booking_rate_limits_bucket_length
        CHECK (
            char_length(bucket) BETWEEN 1 AND 200
        ),

    CONSTRAINT booking_rate_limits_hits
        CHECK (hits >= 0)
);

COMMENT ON TABLE public.booking_rate_limits IS
'Shared fixed-window booking submission rate-limit counters. Buckets contain opaque hashed identifiers, not raw IP addresses or customer information.';

CREATE INDEX booking_rate_limits_window_idx
ON public.booking_rate_limits (window_start);

-- ============================================================
-- 2. SECURITY AND ACCESS CONTROL
-- ============================================================

ALTER TABLE public.booking_rate_limits
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_rate_limits
FROM PUBLIC, anon, authenticated;

-- No client-facing RLS policies are intentionally created.
-- The service_role is used only through a trusted server RPC.

-- ============================================================
-- 3. ATOMIC RATE-LIMIT CONSUMPTION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION
public.booking_rate_limit_consume(
    p_bucket text,
    p_limit integer,
    p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_bucket text;
    v_limit integer;
    v_window_seconds integer;

    v_now timestamptz;
    v_window timestamptz;

    v_hits integer;
    v_retry integer;

    v_allowed boolean;
BEGIN

    -- --------------------------------------------------------
    -- Validate bucket
    -- --------------------------------------------------------

    v_bucket := btrim(coalesce(p_bucket, ''));

    IF char_length(v_bucket) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION
            'BOOKING_RATE_LIMIT_BUCKET: invalid rate-limit bucket.'
            USING ERRCODE = 'P0001';
    END IF;

    -- --------------------------------------------------------
    -- Validate configuration
    -- --------------------------------------------------------

    v_limit := coalesce(p_limit, 5);

    v_window_seconds := coalesce(
        p_window_seconds,
        900
    );

    IF v_limit < 1 OR v_limit > 10000 THEN
        RAISE EXCEPTION
            'BOOKING_RATE_LIMIT_CONFIG: invalid request limit.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_window_seconds < 1
       OR v_window_seconds > 86400 THEN
        RAISE EXCEPTION
            'BOOKING_RATE_LIMIT_CONFIG: invalid window duration.'
            USING ERRCODE = 'P0001';
    END IF;

    -- --------------------------------------------------------
    -- Calculate fixed window using database time
    -- --------------------------------------------------------

    v_now := clock_timestamp();

    v_window := to_timestamp(
        floor(
            extract(epoch FROM v_now)
            / v_window_seconds
        ) * v_window_seconds
    );

    -- --------------------------------------------------------
    -- Atomically consume one attempt
    --
    -- ON CONFLICT serialises concurrent increments
    -- on the same bucket/window.
    --
    -- Saturate at limit + 1 to avoid unbounded growth.
    -- --------------------------------------------------------

    INSERT INTO public.booking_rate_limits (
        bucket,
        window_start,
        hits
    )
    VALUES (
        v_bucket,
        v_window,
        1
    )

    ON CONFLICT (bucket, window_start)

    DO UPDATE SET
        hits = least(
            public.booking_rate_limits.hits + 1,
            v_limit + 1
        )

    RETURNING hits INTO v_hits;

    -- --------------------------------------------------------
    -- Evaluate result
    -- --------------------------------------------------------

    v_allowed := v_hits <= v_limit;

    IF NOT v_allowed THEN

        v_retry := greatest(
            1,
            ceil(
                extract(
                    epoch FROM (
                        v_window
                        + make_interval(
                            secs => v_window_seconds
                        )
                        - clock_timestamp()
                    )
                )
            )::integer
        );

        RETURN jsonb_build_object(
            'allowed', false,
            'remaining', 0,
            'retry_after_seconds', v_retry
        );

    END IF;

    RETURN jsonb_build_object(
        'allowed', true,
        'remaining', greatest(
            0,
            v_limit - v_hits
        ),
        'retry_after_seconds', 0
    );

END;
$$;

COMMENT ON FUNCTION
public.booking_rate_limit_consume(
    text,
    integer,
    integer
)
IS
'Atomically consumes a booking submission rate-limit slot using shared PostgreSQL counters. Callable by service_role only.';

-- ============================================================
-- 4. FUNCTION EXECUTION PERMISSIONS
-- ============================================================

REVOKE ALL ON FUNCTION
public.booking_rate_limit_consume(
    text,
    integer,
    integer
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.booking_rate_limit_consume(
    text,
    integer,
    integer
)
TO service_role;

COMMIT;

-- ============================================================
-- 5. READ-ONLY VERIFICATION
-- ============================================================

-- Expected:
-- booking_rate_limits | true | 0

SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    count(p.polname) AS policies

FROM pg_class AS c

LEFT JOIN pg_policy AS p
    ON p.polrelid = c.oid

WHERE c.oid =
    'public.booking_rate_limits'::regclass

GROUP BY
    c.relname,
    c.relrowsecurity;

-- ============================================================
-- 6. FUNCTION SECURITY VERIFICATION
-- ============================================================

-- Expected:
-- anon_can_execute          false
-- authenticated_can_execute false
-- service_role_can_execute  true

SELECT

    has_function_privilege(
        'anon',
        'public.booking_rate_limit_consume(text,integer,integer)',
        'EXECUTE'
    ) AS anon_can_execute,

    has_function_privilege(
        'authenticated',
        'public.booking_rate_limit_consume(text,integer,integer)',
        'EXECUTE'
    ) AS authenticated_can_execute,

    has_function_privilege(
        'service_role',
        'public.booking_rate_limit_consume(text,integer,integer)',
        'EXECUTE'
    ) AS service_role_can_execute;

-- ============================================================
-- 7. VERIFY FUNCTION DEFINITION
-- ============================================================

SELECT
    p.proname AS function_name,
    p.prosecdef AS security_definer,
    p.provolatile AS volatility,
    pg_get_function_identity_arguments(
        p.oid
    ) AS arguments

FROM pg_proc AS p

JOIN pg_namespace AS n
    ON n.oid = p.pronamespace

WHERE n.nspname = 'public'
  AND p.proname = 'booking_rate_limit_consume';

-- ============================================================
-- END OF SPRINT 2B MIGRATION
-- ============================================================
