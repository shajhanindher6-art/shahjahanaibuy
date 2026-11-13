-- 056 — GTIN uniqueness (Section 20, §12 #31/#32).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the code dedupe in
-- services/pipeline/deduplication.ts (GTIN → slug match, called
-- from services/pipeline/ingestion.ts) and the intake review
-- (services/catalog-intake.ts, exact slug + normalized name+brand)
-- already collapse duplicates at read/write time, and lib/gtin.ts
-- now validates the check digit before any GTIN is stored. Nothing
-- 500s because this file is unapplied.
--
--   * products.gtin has no UNIQUE constraint anywhere: the same
--     GTIN on two different slugs passes intake as `valid`
--     (audit §12 #31). This partial UNIQUE index makes the
--     database the backstop — one live GTIN per product.
--   * Partial (gtin IS NOT NULL): products without a GTIN (all
--     10 live products today) are unaffected, and NULLs never
--     conflict with each other.
--   * Soft-deleted rows are excluded (deleted_at IS NULL), so a
--     deleted product's GTIN never blocks a live re-creation —
--     the same shape as the 054 deals guard.
--   * product_variants has sku only (migration 004) and no GTIN
--     column at all. The column is added here (nullable — a
--     variant without its own GTIN is normal) with its own
--     partial UNIQUE index, so a variant-level GTIN is unique
--     where recorded.
--
-- PRE-CONDITION — verify before applying (the CREATE will fail
-- if duplicates already exist; the failure is safe, it changes
-- nothing):
--   SELECT gtin, count(*) FROM products
--    WHERE gtin IS NOT NULL AND deleted_at IS NULL
--    GROUP BY gtin HAVING count(*) > 1;
--   SELECT gtin, count(*) FROM product_variants
--    WHERE gtin IS NOT NULL AND deleted_at IS NULL
--    GROUP BY gtin HAVING count(*) > 1;
-- If either returns rows, resolve the duplicates first (keep the
-- earliest created row; clear or correct the GTIN on the rest).
-- Existing GTINs are stored verbatim today; code now normalizes
-- on write (lib/gtin.ts strips spaces/hyphens), so a one-off
-- normalization of stored values is worth doing at apply time:
--   UPDATE products SET gtin = regexp_replace(gtin, '[\s-]', '', 'g')
--    WHERE gtin IS NOT NULL;
-- (Same for product_variants.gtin once rows exist.)

CREATE UNIQUE INDEX IF NOT EXISTS products_gtin_unique_idx
  ON products (gtin)
  WHERE gtin IS NOT NULL AND deleted_at IS NULL;

COMMENT ON INDEX products_gtin_unique_idx IS
  'Section 20 (#31/#32): one live product per GTIN. Partial (GTIN present, not soft-deleted). DO NOT APPLY YET — owner step.';

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS gtin text;

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_gtin_unique_idx
  ON product_variants (gtin)
  WHERE gtin IS NOT NULL AND deleted_at IS NULL;

COMMENT ON INDEX product_variants_gtin_unique_idx IS
  'Section 20 (#31/#32): one live variant per GTIN. Partial (GTIN present, not soft-deleted). DO NOT APPLY YET — owner step.';
