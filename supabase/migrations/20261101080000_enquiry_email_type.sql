-- Adds the dedicated internal notification type used by persisted enquiries.
-- Keep this enum addition in its own committed migration: newly added enum
-- values cannot be used by constraints/functions until the transaction commits.
BEGIN;
ALTER TYPE public.email_template ADD VALUE IF NOT EXISTS 'enquiry_received';
COMMIT;
