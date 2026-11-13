-- 059 — products data-quality persistence (Sections 21–25, Stage I).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the 7-dimension
-- quality score stays computed at read time
-- (services/product-quality-score.ts) and nothing persists it —
-- the admin data-quality panel keeps working exactly as today.
--
-- APPLY ORDER: only after the 035–058 backlog clears in numeric
-- order (audit §9 runbook: 045 → 047 → 048–050 → 051 → 052 →
-- 054 + 056 → 057 → 058, then 059–062). This file has no column
-- dependency on 055–058 — `products` exists since 001 — but the
-- numeric order keeps the chain auditable. NEVER apply 035, and
-- this file does not depend on 035 or 053 (053 is dead without
-- 035 and stays dead).
--
--   * products.data_quality_score (integer, nullable, 0–100):
--     the persisted 7-dimension total from
--     services/product-quality-score.ts (weights identity 15,
--     specs 20, images 15, freshness 20, merchants 10, GTIN 10,
--     attribution 10). NO floor: a product with nothing recorded
--     persists a low score, never 50. NULL = never computed.
--   * products.data_quality_dimensions (jsonb, nullable): the
--     per-dimension breakdown (key / label / weight / score /
--     points / missingFields) exactly as the scorer returns it,
--     so the admin panel can render the breakdown without
--     recomputing. NULL = never computed.
--   * products.data_quality_computed_at (timestamptz, nullable):
--     when the persisted score was computed. NULL = never
--     computed. A reader MUST treat a score as stale when this
--     timestamp is older than the product's last price check —
--     a persisted score is a snapshot, not live truth.
--   * NO grade column: the grade ('good' ≥ 80, 'fair' ≥ 50, else
--     'poor') is derived from the score at read time
--     (dataQualityGrade), never stored stale — the same rule
--     migration 033 enforces for derived values.
--   * NO BACKFILL: no score is computed or written here. The
--     live catalog scores 25/100 (poor) on all 10 products today
--     (audit §2), but persisting that number without a real
--     scorer run would freeze a stale snapshot; the first real
--     scorer run after apply writes the values. NULL rows read
--     as "not computed yet" (honest empty state), never as 0.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS data_quality_score integer NULL
    CHECK (data_quality_score IS NULL OR (data_quality_score >= 0 AND data_quality_score <= 100));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS data_quality_dimensions jsonb NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS data_quality_computed_at timestamptz NULL;

-- Admin quality reads: only rows that carry a persisted score.
CREATE INDEX IF NOT EXISTS idx_products_data_quality_score
  ON public.products (data_quality_score DESC)
  WHERE data_quality_score IS NOT NULL;

COMMENT ON COLUMN public.products.data_quality_score IS
  'Sections 21–25 (059): persisted 7-dimension data-quality total, 0–100, no floor. NULL = never computed. DO NOT APPLY YET — owner step.';
COMMENT ON COLUMN public.products.data_quality_dimensions IS
  'Sections 21–25 (059): persisted per-dimension quality breakdown (jsonb, scorer shape). NULL = never computed. DO NOT APPLY YET — owner step.';
COMMENT ON COLUMN public.products.data_quality_computed_at IS
  'Sections 21–25 (059): when the persisted quality score was computed. NULL = never computed; treat a score as stale when this predates the last price check. DO NOT APPLY YET — owner step.';
