-- 045 — Catalog verification + published status (Section 17, Stage C items 14–16).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, every code path that
-- reads or writes these columns degrades honestly: product queries
-- retry without the new columns (Postgres 42703) and treat rows as
-- published + unverified, and the intake approve path retries its
-- inserts without them. Nothing 500s and nothing goes invisible
-- because this file is unapplied.
--
-- Item 14 — price-verification status fields:
--   * merchant_products.price_verification_status ('unverified' |
--     'verified' | 'stale') + price_source ('manual-intake' |
--     'ebay-browse-api' | 'merchant-feed') + price_verified_at.
--     The per-listing truth: a price is only ever called verified
--     when a real fetch checked it (today: the eBay Browse leg).
--     Manual-intake prices are 'unverified' by definition — the UI
--     must never call them "live".
--   * products.price_verification_status + price_verified_at: the
--     per-product rollup of its cheapest listing, so product
--     surfaces (which read `products`, not `merchant_products`)
--     can label the shown price without a second query. There is
--     deliberately NO price_source on `products`: a product can
--     have listings from several sources, so a single product-level
--     source would be ambiguous. No `is_live` boolean anywhere:
--     the status enum is the whole truth, and 'verified' is the
--     only status the UI may render as checked.
--
-- Item 15 — product approval / published status:
--   * products.status ('pending' | 'published' | 'rejected').
--     DEFAULT 'published' is deliberate, not an oversight: the 10
--     live products were already public before this column
--     existed, and every non-intake writer (pipeline ingestion,
--     eBay refresh upserts) keeps its current behaviour. Only the
--     intake approve path writes 'pending' explicitly and flips
--     to 'published' in the same approve call — a row is never
--     public because it was merely inserted. The public product
--     query path (services/products.ts) filters status =
--     'published', so a pending row can never render publicly.
--
-- Item 16 — price_history UNIQUE index. This is deliberately NOT
-- appended to migration 040: 040's own header says the index
-- "requires checking the live table for existing duplicates
-- first, which cannot be done from the repo" and "stays a
-- follow-up". It lives here instead, as a duplicate-guarded DO
-- block: the index is created only when no (product_id,
-- retailer_id, recorded_at) duplicate exists today; if duplicates
-- exist the block raises a NOTICE and applies nothing, so the
-- migration never fails halfway on a live table with history.
-- The key is (product_id, retailer_id, recorded_at): it stops a
-- double-run race from recording the same point twice. It does
-- NOT dedupe a genuinely re-recorded price at a new timestamp —
-- that is refreshTrackedPrices' job (it only inserts on change).
-- A plain CREATE UNIQUE INDEX would fail the whole migration
-- when duplicates exist; the guard keeps the apply safe.

-- ---------------------------------------------------------------------------
-- A. products: status + price-verification rollup (item 14 + 15)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'status') THEN
    ALTER TABLE products ADD COLUMN status text NOT NULL DEFAULT 'published'
      CHECK (status IN ('pending', 'published', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'price_verification_status') THEN
    ALTER TABLE products ADD COLUMN price_verification_status text NOT NULL DEFAULT 'unverified'
      CHECK (price_verification_status IN ('unverified', 'verified', 'stale'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'price_verified_at') THEN
    ALTER TABLE products ADD COLUMN price_verified_at timestamptz NULL DEFAULT NULL;
  END IF;
END $$;

-- Public surfaces filter on status; the verification label reads the
-- rollup next to the shown price.
CREATE INDEX IF NOT EXISTS products_status_idx ON products(status) WHERE status <> 'published';
CREATE INDEX IF NOT EXISTS products_price_verification_idx ON products(price_verification_status);

-- ---------------------------------------------------------------------------
-- B. merchant_products: per-listing verification (item 14)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_products' AND column_name = 'price_verification_status') THEN
    ALTER TABLE merchant_products ADD COLUMN price_verification_status text NOT NULL DEFAULT 'unverified'
      CHECK (price_verification_status IN ('unverified', 'verified', 'stale'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_products' AND column_name = 'price_source') THEN
    ALTER TABLE merchant_products ADD COLUMN price_source text NOT NULL DEFAULT 'manual-intake'
      CHECK (price_source IN ('manual-intake', 'ebay-browse-api', 'merchant-feed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_products' AND column_name = 'price_verified_at') THEN
    ALTER TABLE merchant_products ADD COLUMN price_verified_at timestamptz NULL DEFAULT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- C. price_history UNIQUE index, duplicate-guarded (item 16)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'price_history'
      AND indexname = 'price_history_product_retailer_recorded_uidx'
  ) THEN
    IF EXISTS (
      SELECT product_id, retailer_id, recorded_at
      FROM public.price_history
      GROUP BY product_id, retailer_id, recorded_at
      HAVING COUNT(*) > 1
      LIMIT 1
    ) THEN
      RAISE NOTICE '045: price_history has duplicate (product_id, retailer_id, recorded_at) rows — UNIQUE index NOT created. De-duplicate the live rows first, then re-run this block.';
    ELSE
      CREATE UNIQUE INDEX price_history_product_retailer_recorded_uidx
        ON public.price_history (product_id, retailer_id, recorded_at);
    END IF;
  END IF;
END $$;
