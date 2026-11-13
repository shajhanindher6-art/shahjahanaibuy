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
-- The WHERE clause (source IS NULL) makes the backfill safe to
-- run once and a no-op afterwards. It does NOT re-run the seed
-- and it inserts no rows.
-- If this migration is applied AFTER live (non-seed) rows exist,
-- check first which rows are genuinely seed rows before running
-- the UPDATE — rows recorded after the seed instant with a live
-- source must keep source NULL, not be labelled 'seed'.

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS suspicious_change boolean NOT NULL DEFAULT false;

-- Provenance vocabulary (NULL = no provenance claimed).
ALTER TABLE price_history
  ADD CONSTRAINT price_history_source_check
  CHECK (source IS NULL OR source IN ('seed', 'live', 'manual-intake', 'ebay-browse-api', 'merchant-feed'));

-- Existing rows are the seed/demo rows: label them, and carry
-- their recorded time into observed_at. Never re-run the seed.
UPDATE price_history
  SET source = 'seed',
      observed_at = recorded_at
  WHERE source IS NULL;

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
