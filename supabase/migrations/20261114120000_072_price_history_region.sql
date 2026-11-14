-- 072 — price_history.region + backfill from retailers.country
-- (Post-Integration Verification & Real Data Phase, 2026-11-14).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, price_history rows
-- carry their region only on the joined `retailers` row
-- (`retailers.country`, NOT NULL DEFAULT 'US' since migration
-- 002) and code keeps reading that join — nothing 500s because
-- this file is unapplied. The writer
-- (services/price-history-quality.ts insertPriceHistoryRow)
-- writes `region` when the column exists and retries without it
-- on Postgres 42703, so no insert fails over an unapplied
-- migration — rows are just recorded without a stored region,
-- as today.
--
-- APPLY ORDER: only after the 035–058 backlog clears in numeric
-- order and after 060 (the currency-code column): the region
-- backfill below never has to guess a row's provenance, and the
-- writer's tiered retry already knows the 060/057 columns. NEVER
-- apply 035, and this file does not depend on 035 or 053 (053 is
-- dead without 035 and stays dead).
--
--   * `region` (text, nullable, 2-letter ISO region code when
--     present — 'US' for Best Buy and eBay EBAY_US today).
--     NULL means "region unknown", never a guessed value: a row
--     whose retailer carries no country keeps NULL rather than
--     being stamped 'US' by assumption.
--   * BACKFILL: `SET region = r.country` — a verbatim copy of
--     the retailer's recorded country, never an invented one.
--     The WHERE clause scopes it to rows whose retailer HAS a
--     country; a row with no retailer row keeps NULL.
--   * The UPDATE is idempotent: re-running it sets nothing new,
--     because labelled rows no longer match `region IS NULL`.
--   * It does NOT re-run the seed and it inserts no rows. The DO
--     block after the UPDATE reports the counts (labelled vs
--     still unlabelled) as a NOTICE, so the owner can see the
--     split at apply time.

ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS region text;

UPDATE price_history ph
SET region = r.country
FROM retailers r
WHERE ph.retailer_id = r.id
  AND r.country IS NOT NULL
  AND r.country <> ''
  AND ph.region IS NULL;

DO $$
DECLARE
  labelled integer;
  unlabelled integer;
BEGIN
  SELECT count(*) INTO labelled FROM price_history WHERE region IS NOT NULL;
  SELECT count(*) INTO unlabelled FROM price_history WHERE region IS NULL;
  RAISE NOTICE '072: price_history region backfill — % rows labelled, % rows still unlabelled (no retailer country)', labelled, unlabelled;
END $$;
