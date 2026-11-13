-- 063 — Alert expiry + alert_type CHECK (Sections 21–25, Stage F:
-- F6 no alert expiry/cleanup, F8 alert_type has no DB CHECK).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, expiry is fail-open
-- in code (services/alert-expiry.ts): a missing `expires_at`
-- column means every alert is treated as unexpired, and
-- `cleanupExpiredAlerts` reports a clean skip, never a failure.
--
-- APPLY ORDER: only after the 035–058 backlog clears in numeric
-- order (audit §9 runbook: 045 → 047 → 048–050 → 051 → 052 →
-- 054 + 056 → 057 → 058, then 059–062, then 063–067). NEVER apply
-- 035, and this file does not depend on 035 or 053.
--
--   * alerts.expires_at + guest_email_alerts.expires_at
--     (timestamptz, nullable): the instant an alert stops firing.
--     DEFAULT now() + interval '90 days' — the same 90-day rule
--     as alertExpiryDate() in services/alert-expiry.ts (creation
--     + DEFAULT_ALERT_EXPIRY_DAYS), so the SQL default and the
--     code can never silently drift apart. (A DEFAULT cannot
--     reference created_at in Postgres, so now() + 90 days is
--     used — identical at insert time, when created_at is now().)
--     Code never writes the column, so creation works identically
--     before and after this file is applied. Firing an alert does
--     NOT extend expiry. A NULL expires_at never expires by code
--     (fail-open: a row without a recorded expiry is an alert the
--     user still wants).
--   * Backfill: pre-migration rows get created_at + 90 days, so
--     the 90-day rule applies to them exactly as if the column
--     had existed at creation. Rows older than 90 days become
--     expired on apply and are deactivated (never deleted) by the
--     next cleanupExpiredAlerts run — history and unsubscribe
--     tokens are preserved.
--   * alerts.alert_type CHECK: the API Zod enum is the only gate
--     today (app/api/v1/alerts/route.ts), so a bad value could be
--     written by any other path. The CHECK lists exactly the six
--     types the checker handles: price_drop, back_in_stock, deal,
--     significant_drop, trend, opportunity. (price_below is NOT
--     a type — audit §12: covered by price_drop.)
--     Added NOT VALID on purpose: existing rows are NOT
--     re-validated, so the migration cannot fail on a legacy row
--     carrying another value; new and updated rows are gated
--     immediately. The owner validates it later once the data is
--     cleaned: ALTER TABLE public.alerts VALIDATE CONSTRAINT
--     alerts_alert_type_check; guest_email_alerts already has its
--     own CHECK (price_drop, back_in_stock, deal) from 026 and is
--     untouched here.

ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS expires_at timestamptz
    DEFAULT (now() + interval '90 days');

ALTER TABLE public.guest_email_alerts
  ADD COLUMN IF NOT EXISTS expires_at timestamptz
    DEFAULT (now() + interval '90 days');

-- Backfill pre-migration rows: 90 days from their creation.
-- created_at is NOT NULL on both tables, so no row is left NULL
-- by this step; NULL can still arise only for rows created while
-- this file is unapplied (the column does not exist yet), and
-- those never expire by code (fail-open).
UPDATE public.alerts
  SET expires_at = created_at + interval '90 days'
  WHERE expires_at IS NULL;

UPDATE public.guest_email_alerts
  SET expires_at = created_at + interval '90 days'
  WHERE expires_at IS NULL;

-- The cleanup lookup filters active rows by expires_at < now().
CREATE INDEX IF NOT EXISTS idx_alerts_expires_at
  ON public.alerts (expires_at) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_guest_email_alerts_expires_at
  ON public.guest_email_alerts (expires_at) WHERE active = true;

-- F8: gate alert_type at the DB, matching the API Zod enum.
-- NOT VALID: see the header — legacy rows are grandfathered,
-- new/updated rows are gated now, VALIDATE after data cleanup.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'alerts_alert_type_check'
  ) THEN
    ALTER TABLE public.alerts
      ADD CONSTRAINT alerts_alert_type_check
      CHECK (alert_type IN ('price_drop', 'back_in_stock', 'deal', 'significant_drop', 'trend', 'opportunity'))
      NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.alerts.expires_at IS
  'Instant this alert stops firing (Sections 21-25, Stage F, F6). Default now() + 90 days. NULL never expires by code (fail-open). Deactivated, never deleted, by cleanupExpiredAlerts.';
COMMENT ON COLUMN public.guest_email_alerts.expires_at IS
  'Instant this guest alert stops firing (Sections 21-25, Stage F, F6). Default now() + 90 days. NULL never expires by code (fail-open). Deactivated, never deleted, by cleanupExpiredAlerts.';
