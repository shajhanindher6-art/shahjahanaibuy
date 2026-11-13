-- 066 — products.last_successful_update (Sections 21–25, Stage D).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the timestamp is
-- DERIVED at read time (services/last-successful-update.ts) from
-- durable rows that already exist — latest live-source
-- price_history row + latest merchant_products.last_synced_at —
-- and the writer reports `persisted: false, reason:
-- 'column-missing'` instead of failing. Nothing 500s because
-- this file is unapplied.
--
-- APPLY ORDER: only after the 035–058 backlog clears in numeric
-- order (audit §9 runbook: 045 → 047 → 048–050 → 051 → 052 →
-- 054 + 056 → 057 → 058, then 059–062, then 063–067). This file has
-- no column dependency on 055–062 — `products` exists since 001
-- — but the numeric order keeps the chain auditable. NEVER apply
-- 035, and this file does not depend on 035 or 053 (053 is dead
-- without 035 and stays dead).
--
--   * products.last_successful_update (timestamptz, nullable):
--     the last time a real provider response was validated AND
--     saved for this product. Distinct from data_freshness
--     ("last checked", which moves on any live check even when
--     nothing was saved) and from next_refresh_at (scheduling).
--     NULL = no provider-validated save has been recorded yet —
--     which is the honest state for the whole seeded catalog
--     (all 10 products carry 2026-11-02 seed prices, never a
--     live provider save). No backfill: backfilling from
--     data_freshness would re-introduce exactly the confusion
--     this column exists to remove (a check is not a save).
--     Set ONLY by markProductSuccessfullyUpdated
--     (services/last-successful-update.ts), called from the
--     eBay refresh leg, the pipeline price.refresh processor,
--     and ingestion — each only after its save succeeded.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS last_successful_update timestamptz;

COMMENT ON COLUMN public.products.last_successful_update IS
  'Last time a real provider response was validated and saved for this product (Sections 21-25, Stage D). Distinct from data_freshness (last checked). NULL = no provider-validated save recorded yet. Set only by markProductSuccessfullyUpdated.';
