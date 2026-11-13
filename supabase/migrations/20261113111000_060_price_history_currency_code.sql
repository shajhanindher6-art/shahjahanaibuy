-- 060 — price_history.currency_code + backfill (Sections 21–25, Stage I).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, price_history rows
-- carry their currency only in the existing `currency` column
-- (migration 002) and code keeps reading that column — nothing
-- 500s because this file is unapplied.
--
-- APPLY ORDER: only after the 035–058 backlog clears in numeric
-- order (audit §9 runbook: 045 → 047 → 048–050 → 051 → 052 →
-- 054 + 056 → 057 → 058, then 059–062). Applies after 057: the
-- 057 backfill labels seed rows first, so the currency backfill
-- below never has to guess a row's provenance. NEVER apply 035,
-- and this file does not depend on 035 or 053 (053 is dead
-- without 035 and stays dead).
--
-- PREMISE CORRECTION (audit §9 said "verify no non-USD rows
-- first" as if no currency were recorded): price_history ALREADY
-- has `currency text NOT NULL DEFAULT 'USD'` since migration 002
-- (:164), and the seed inserts 'USD' on all 40 rows — there is no
-- currency-less column to stamp 'USD' onto. A blind 'USD'
-- backfill would MISLABEL any genuinely non-USD row (a EUR
-- listing price recorded later) as USD — fabrication. So this
-- file does NOT stamp 'USD' onto existing rows. Instead:
--
--   * `currency_code` (text, nullable, 3-letter ISO code when
--     present, DEFAULT 'USD' for future rows — matching the
--     existing `currency` default). It is the canonical code the
--     currency-aware surfaces will read; `currency` stays as the
--     legacy column until a later section retires it — this file
--     never drops or renames anything.
--   * PRE-FLIGHT CHECK (first DO block, runs before any change):
--     (a) `price_history.currency` must exist (002 applied) —
--     otherwise the migration aborts with an explicit error
--     instead of failing halfway on a missing column; (b) if ANY
--     existing row has currency <> 'USD', the migration aborts
--     with an explicit error: a non-USD row means the backfill
--     cannot be a plain 'USD' stamp, and the owner must re-scope
--     it (copy `currency` verbatim per row) instead of silently
--     relabelling a EUR price as USD. On the live catalog today
--     (40 rows, all 'USD') the check passes silently.
--   * BACKFILL: `SET currency_code = currency` — a verbatim copy
--     of the recorded value, never an invented one. Rows whose
--     currency is NULL (impossible today — the column is NOT
--     NULL — but guarded anyway) fall back to 'USD', the
--     column's own default, and only those rows.
--   * No index: currency is a display/freshness attribute, not a
--     lookup key; the existing (product_id, recorded_at) indexes
--     cover the read paths.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'price_history'
      AND column_name = 'currency'
  ) THEN
    RAISE EXCEPTION '060: price_history.currency does not exist — migration 002 must be applied first. Aborting before any change.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.price_history WHERE currency IS DISTINCT FROM 'USD'
  ) THEN
    RAISE EXCEPTION '060: price_history holds non-USD rows — a plain USD backfill would mislabel them. De-scope the backfill (copy currency verbatim per row) before re-running. Aborting before any change.';
  END IF;
  RAISE NOTICE '060: pre-flight OK — all price_history rows are USD; backfilling currency_code from the recorded currency value.';
END $$;

ALTER TABLE public.price_history
  ADD COLUMN IF NOT EXISTS currency_code text NULL
    CHECK (currency_code IS NULL OR char_length(currency_code) = 3);

-- Verbatim copy of the recorded currency; NULL currency (not
-- possible under the NOT NULL column, guarded anyway) falls back
-- to 'USD', the legacy column's own default. Never stamps 'USD'
-- over a recorded non-USD value — the pre-flight block above
-- aborts first if such a row exists. The column is added WITHOUT
-- a default on purpose, so this UPDATE does the real backfill;
-- the DEFAULT is attached only after it, for future rows.
UPDATE public.price_history
  SET currency_code = COALESCE(currency, 'USD')
  WHERE currency_code IS NULL;

ALTER TABLE public.price_history
  ALTER COLUMN currency_code SET DEFAULT 'USD';

COMMENT ON COLUMN public.price_history.currency_code IS
  'Sections 21–25 (060): canonical 3-letter currency code, copied verbatim from the recorded currency column (002). NULL = not recorded. DO NOT APPLY YET — owner step.';
