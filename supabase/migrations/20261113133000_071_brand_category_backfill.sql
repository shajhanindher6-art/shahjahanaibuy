-- 071 — brand/category backfill (Final 100%, F-P1-56).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, `brand_id` /
-- `category_id` stay NULL on all 10 products and brand/category
-- live only as free-text columns (a typo'd brand string silently
-- creates a second brand). Nothing 500s because this file is
-- unapplied.
--
-- APPLY ORDER: only after the 035–058 backlog clears; numeric
-- order 071 after 070. NEVER apply 035, and this file does not
-- depend on 035 or 053.
--
-- DEPENDENCIES: 003 (brands + categories tables), 004 (the
-- brand_id/category_id columns — WITH their FKs already: 004 adds
-- them as `uuid REFERENCES brands(id) / categories(id) ON DELETE
-- SET NULL`, so this file adds NO foreign key; it only populates
-- the columns).
--
-- WHAT IT DOES (exact-match ONLY, by design):
--   * Sets products.brand_id from brands.name where the product's
--     free-text `brand` matches a brand name exactly
--     (case-insensitive, trimmed). Sets products.category_id from
--     categories.name the same way. Only rows whose brand_id /
--     category_id is still NULL are touched; rows already linked
--     are never overwritten.
--   * Unmatched products are LEFT NULL and REPORTED (RAISE NOTICE
--     with the count + the slug list) — a fuzzy match would
--     silently merge distinct brands, so there is no fuzzy leg.
--     The owner reviews the NOTICE report and creates the missing
--     brand/category rows (or corrects the free text) before any
--     re-run; a re-run is safe (it only touches still-NULL rows).
--   * No row is created in brands/categories here — creating a
--     brand is a data decision, not a migration side effect.
--   * No row is deleted. No free-text value is changed.
--
-- ROLLBACK (see also docs/migration-rollback-notes.md):
--   Rollback = set the backfilled columns back to NULL for the
--   slugs the NOTICE report listed as matched:
--     UPDATE public.products SET brand_id = NULL, category_id = NULL
--       WHERE slug IN ('<slug-1>', '<slug-2>', ...);
--   That is a destructive step (it destroys the linkage, not the
--   rows): owner approval is required, and the owner records the
--   matched slug list from the NOTICE output before rolling back.
--   The free-text brand/category columns are never touched by
--   this file, so the original values are always recoverable.
--
-- SAFETY: the UPDATEs are idempotent (WHERE brand_id IS NULL /
-- category_id IS NULL) and scoped to exact matches, so a re-run
-- converges. No explicit transaction is used (Supabase SQL Editor
-- runs statements sequentially). The pre-flight block aborts
-- (changing nothing) if the brands/categories tables are missing.

DO $$
DECLARE
  matched_brands integer := 0;
  matched_categories integer := 0;
  unmatched_brands text := '';
  unmatched_categories text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'brands')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'categories') THEN
    RAISE EXCEPTION '071: brands or categories table missing — migration 003 must be applied first. Aborting before any change.';
  END IF;

  -- Exact-match backfill, brand first (case-insensitive, trimmed).
  UPDATE public.products p
    SET brand_id = b.id
    FROM public.brands b
    WHERE p.brand_id IS NULL
      AND p.brand IS NOT NULL
      AND lower(trim(p.brand)) = lower(trim(b.name));
  GET DIAGNOSTICS matched_brands = ROW_COUNT;

  UPDATE public.products p
    SET category_id = c.id
    FROM public.categories c
    WHERE p.category_id IS NULL
      AND p.category IS NOT NULL
      AND lower(trim(p.category)) = lower(trim(c.name));
  GET DIAGNOSTICS matched_categories = ROW_COUNT;

  -- Report: matched counts + the slugs left unmatched (NULL).
  -- The owner reviews this report; unmatched rows stay NULL
  -- until their brand/category row exists or the text is fixed.
  SELECT COALESCE(string_agg(slug, ', ' ORDER BY slug), '(none)')
    INTO unmatched_brands
    FROM public.products
    WHERE brand_id IS NULL AND brand IS NOT NULL;
  SELECT COALESCE(string_agg(slug, ', ' ORDER BY slug), '(none)')
    INTO unmatched_categories
    FROM public.products
    WHERE category_id IS NULL AND category IS NOT NULL;

  RAISE NOTICE '071: brand backfill matched % product(s); category backfill matched % product(s). Unmatched brands (left NULL): %. Unmatched categories (left NULL): %. Re-run after creating the missing brands/categories rows — already-linked rows are never overwritten.',
    matched_brands, matched_categories, unmatched_brands, unmatched_categories;
END $$;

COMMENT ON COLUMN public.products.brand_id IS
  'Final 100% (071): linked to brands.id by exact free-text match (backfill only; unmatched left NULL). Free-text brand column is the fallback. DO NOT APPLY YET — owner step.';
COMMENT ON COLUMN public.products.category_id IS
  'Final 100% (071): linked to categories.id by exact free-text match (backfill only; unmatched left NULL). Free-text category column is the fallback. DO NOT APPLY YET — owner step.';
