-- 057 — price_history provenance + suspicious-change flag
-- (Section 20, §12 #39 / #44).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, every writer that
-- knows about these columns retries without them on Postgres
-- 42703 (services/price-history-quality.ts insertPriceHistoryRow,
-- used by services/price-refresh.ts and
-- services/pipeline/ingestion.ts), so no insert fails over an
-- unapplied migration — rows are just recorded without provenance
-- or a flag, as today.
--
--   * `source` — where the recorded price came from. Values are
--     the provenance vocabulary the code writes: 'seed' (the
--     2026-11-02 demo seed), 'live' (a real-time provider fetch),
--     'manual-intake' (admin-typed CSV price), 'ebay-browse-api'
--     (eBay Browse leg), 'merchant-feed' (provider-pipeline
--     fetch). NULL claims no provenance — a DB re-read
--     (services/price-refresh.ts) deliberately records NULL
--     rather than inventing one for a stored price whose origin
--     is not tracked. The CHECK permits NULL.
--   * `observed_at` — when the price was observed, as distinct
--     from `recorded_at` (when the row was written). For a live
--     fetch they are the same instant; for a re-recorded row the
--     observation time is the fetch time, not the insert time.
--     Backfilled from recorded_at for existing rows (below).
--   * `suspicious_change` — set by the ingestion-time detectors
--     (services/price-history-quality.ts assessPriceChange:
--     25% single-step spike, fake-sale pattern, sustained
--     inflation). A flagged row is stored flagged, never dropped
--     and never silently recorded as normal. Defaults false.
--
-- BACKFILL — the UPDATE below labels the rows that exist today.
-- All live price_history rows are the 2026-11-02 seed/demo rows
-- (40 rows, Amazon only — audit §2), so labelling them 'seed'
-- states what they are; the seed file itself calls them
-- "DEMO/placeholder launch prices, not live retailer prices".
-- The WHERE clause scopes the backfill to the SEED INSTANT ONLY:
-- `recorded_at < DATE '2026-11-03'` (the seed ran 2026-11-02 and
-- every seed row carries recorded_at = seed instant minus 0/7/14/
-- 30 days, so all 40 seed rows are before 2026-11-03 UTC). A row
-- recorded on or after 2026-11-03 is NOT a seed row — it is a
-- live fetch, a manual-intake price, or a DB re-read — and keeps
-- source NULL rather than being mislabelled 'seed'. (Section
-- 21–25 fix, I-P1-6: the previous WHERE clause had no time bound
-- and would have labelled every post-seed row 'seed' as well.)
-- The UPDATE is idempotent: re-running it labels nothing new,
-- because labelled rows no longer match `source IS NULL`.
-- It does NOT re-run the seed and it inserts no rows. The DO
-- block after the UPDATE reports the counts (labelled vs still
-- unlabelled) as a NOTICE, so the owner can see the split at
-- apply time.

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS suspicious_change boolean NOT NULL DEFAULT false;

-- Provenance vocabulary (NULL = no provenance claimed).
-- Section 21–25 fix (I-P1-6): the ADD CONSTRAINT is wrapped in
-- a DO block guarded on pg_constraint, so a re-run is a no-op
-- instead of failing on the duplicate constraint and leaving a
-- half-applied state. (This was the only unguarded statement in
-- the file; every other statement already uses IF NOT EXISTS.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_history_source_check'
      AND conrelid = 'public.price_history'::regclass
  ) THEN
    ALTER TABLE price_history
      ADD CONSTRAINT price_history_source_check
      CHECK (source IS NULL OR source IN ('seed', 'live', 'manual-intake', 'ebay-browse-api', 'merchant-feed'));
  END IF;
END $$;

-- Existing rows are the seed/demo rows: label them, and carry
-- their recorded time into observed_at. Never re-run the seed.
-- Seed-instant scoped (I-P1-6): only rows recorded before
-- 2026-11-03 are seed rows; later rows keep source NULL.
UPDATE price_history
  SET source = 'seed',
      observed_at = recorded_at
  WHERE source IS NULL
    AND recorded_at < DATE '2026-11-03';

-- Apply-time report: how many rows were labelled seed vs left
-- without provenance. NOTICE only — never fails the migration.
DO $$
DECLARE
  labelled int;
  unlabelled int;
BEGIN
  SELECT count(*) INTO labelled FROM public.price_history WHERE source = 'seed';
  SELECT count(*) INTO unlabelled FROM public.price_history WHERE source IS NULL;
  RAISE NOTICE '057: % price_history rows labelled seed; % rows left without provenance (recorded after the 2026-11-02 seed instant).', labelled, unlabelled;
END $$;

CREATE INDEX IF NOT EXISTS price_history_source_idx
  ON price_history (source)
  WHERE source IS NOT NULL;

CREATE INDEX IF NOT EXISTS price_history_suspicious_idx
  ON price_history (product_id, recorded_at DESC)
  WHERE suspicious_change = true;

COMMENT ON COLUMN price_history.source IS
  'Section 20 (#39): provenance of the recorded price (seed | live | manual-intake | ebay-browse-api | merchant-feed). NULL claims no provenance. DO NOT APPLY YET — owner step.';
COMMENT ON COLUMN price_history.observed_at IS
  'Section 20 (#39): when the price was observed (vs recorded_at, when the row was written). DO NOT APPLY YET — owner step.';
COMMENT ON COLUMN price_history.suspicious_change IS
  'Section 20 (#44): ingestion-time abnormal-change flag (spike / fake-sale / inflation pattern). Flagged rows are stored flagged, never dropped. DO NOT APPLY YET — owner step.';
