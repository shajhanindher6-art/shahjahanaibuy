-- 068 — GS1 check-digit CHECK on product + variant GTINs (Final 100%, F-P1-56).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, GTIN validity is
-- enforced in code only (lib/gtin.ts — GS1 mod-10 check digit,
-- wired into intake, pipeline validation and the admin PATCH gate).
-- Nothing 500s because this file is unapplied.
--
-- CORRECTION to the audit brief (verified in the tree, 13 Nov 2026):
-- the variant GTIN *column* is NOT added here — migration 056
-- already adds `product_variants.gtin` (nullable) plus its partial
-- UNIQUE index. 068 adds only what 056 does not: a GS1 check-digit
-- CHECK on BOTH `products.gtin` and `product_variants.gtin`, so a
-- mistyped GTIN can no longer be stored even by a writer that
-- bypasses the code validator. No column is created here.
--
-- APPLY ORDER: after 056 (the variant column must exist first) and
-- after the 035–058 backlog clears; numeric order 068 after 067.
-- NEVER apply 035, and this file does not depend on 035 or 053.
--
-- DEPENDENCIES: 004 (product_variants table), 056 (product_variants.gtin
-- column + partial UNIQUE indexes), 002 (products.gtin column).
--
-- ROLLBACK (see also docs/migration-rollback-notes.md):
--   The CHECK constraints are the only new objects (plus the
--   immutable helper function, which other code does not call).
--   Rollback = drop the two constraints, then drop the function:
--     ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_gtin_gs1_check;
--     ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_gtin_gs1_check;
--     DROP FUNCTION IF EXISTS public.is_valid_gs1_gtin(text);
--   No data is deleted or altered by this file (the pre-flight
--   block below ABORTS the whole apply — changing nothing — if an
--   invalid GTIN already exists; the owner corrects the row first).
--   Owner approval is required before any rollback that drops a
--   constraint on production data.
--
-- SAFETY: every statement is guarded (CREATE OR REPLACE for the
-- function; DO blocks guarded on pg_constraint for the CHECKs), so
-- a re-run converges instead of erroring. No explicit transaction
-- is used (Supabase SQL Editor runs statements sequentially);
-- the pre-flight exception aborts before any change is made.

-- Immutable GS1 check-digit validator (GTIN-8/12/13/14).
-- NULL / empty = "no GTIN recorded" and is VALID here (the column
-- stays nullable; absence is honest, a wrong GTIN is not).
-- Non-digit or wrong-length or bad check digit = INVALID.
CREATE OR REPLACE FUNCTION public.is_valid_gs1_gtin(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NULL
    OR value = ''
    OR (
      value ~ '^[0-9]{8}$'
      OR value ~ '^[0-9]{12}$'
      OR value ~ '^[0-9]{13}$'
      OR value ~ '^[0-9]{14}$'
    )
    AND (
      SELECT (10 - (s % 10)) % 10 = (substring(value from length(value) for 1))::int
      FROM (
        SELECT COALESCE(SUM(
          (substring(value from (length(value) - i) for 1))::int
          * CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END
        ), 0) AS s
        FROM generate_series(1, length(value) - 1) AS i
      ) t
    );
$$;

COMMENT ON FUNCTION public.is_valid_gs1_gtin(text) IS
  'Final 100% (068): GS1 mod-10 check-digit test for GTIN-8/12/13/14. Mirrors lib/gtin.ts. NULL/empty = no GTIN recorded (valid). DO NOT APPLY YET — owner step.';

-- PRE-FLIGHT (safe failure): if any stored GTIN fails the check,
-- abort before adding anything. The owner corrects the row(s)
-- first (the query below lists them); never "fix" a GTIN by
-- deleting the row.
DO $$
DECLARE
  bad_products integer;
  bad_variants integer;
BEGIN
  SELECT count(*) INTO bad_products
    FROM public.products
    WHERE gtin IS NOT NULL AND NOT public.is_valid_gs1_gtin(gtin);
  SELECT count(*) INTO bad_variants
    FROM public.product_variants
    WHERE gtin IS NOT NULL AND NOT public.is_valid_gs1_gtin(gtin);
  IF bad_products > 0 OR bad_variants > 0 THEN
    RAISE EXCEPTION '068: % invalid GTIN(s) on products, % on product_variants — list them with SELECT id, slug, gtin FROM products WHERE gtin IS NOT NULL AND NOT is_valid_gs1_gtin(gtin); correct the values first, then re-run. Nothing was changed.', bad_products, bad_variants;
  END IF;
  RAISE NOTICE '068: pre-flight OK — no invalid GTIN stored (products: %, variants: % checked).', bad_products, bad_variants;
END $$;

-- CHECK on products.gtin — NOT VALID first (no lock on existing
-- rows), then VALIDATE (safe: pre-flight proved every row passes).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_gtin_gs1_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_gtin_gs1_check
      CHECK (public.is_valid_gs1_gtin(gtin))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.products VALIDATE CONSTRAINT products_gtin_gs1_check;

-- CHECK on product_variants.gtin (column added by 056).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_gtin_gs1_check'
  ) THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT product_variants_gtin_gs1_check
      CHECK (public.is_valid_gs1_gtin(gtin))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.product_variants VALIDATE CONSTRAINT product_variants_gtin_gs1_check;

COMMENT ON CONSTRAINT products_gtin_gs1_check ON public.products IS
  'Final 100% (068): products.gtin must pass the GS1 mod-10 check digit (or be NULL). Mirrors lib/gtin.ts. DO NOT APPLY YET — owner step.';
COMMENT ON CONSTRAINT product_variants_gtin_gs1_check ON public.product_variants IS
  'Final 100% (068): product_variants.gtin must pass the GS1 mod-10 check digit (or be NULL). Column added by 056. DO NOT APPLY YET — owner step.';
