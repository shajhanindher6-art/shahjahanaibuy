-- CJ Affiliate — merchant_offers (DHGate product feed import).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). The table starts EMPTY — it stores no data
-- by itself; rows arrive only from scripts/import-cj-feed.ts.
--
-- FILE-NAME CAVEAT: this file is named 20261121_cj_affiliate_offers.sql
-- (8-digit date, no time component), which BREAKS the repo's
-- 14-digit timestamp convention (e.g. 20261114121000_073_...). The
-- name is kept exactly as specified by the owner brief. Lexicographic
-- order still puts it AFTER 073 (20261114... < 20261121...), so the
-- numeric apply order is preserved: apply it only after the 035–058
-- backlog clears, in order, one file at a time, with an M-0 re-query
-- after each file. NEVER apply 035.
--
-- WHAT THIS CREATES:
--   * merchant_offers: one row per (network, advertiser, product)
--     from an affiliate product feed. Network 'cj' is the CJ
--     Affiliate feed (first advertiser: DHGate, CJ ID 3992613,
--     Product Export subscription Id 325295, Shopping Google Format
--     CSV, ~1.1M rows). Network 'amazon' is reserved for a future
--     Amazon feed import using the same shape.
--   * HARD COMPLIANCE GATE: is_public_live defaults to FALSE and
--     must stay FALSE until the CJ Publisher Service Agreement (PSA)
--     display rules are read and verified. The importer enforces
--     this too (CJ_PSA_APPROVED=true is required to set it true).
--     The public SELECT policy below only exposes rows where
--     is_public_live = true, so an unapproved import is invisible
--     to the site even if rows exist.
--   * Idempotent upserts: UNIQUE (network, advertiser_id,
--     external_product_id) — re-running the importer updates rows
--     in place instead of duplicating them.
--   * GTIN is stored digits-only (UPC/EAN/ISBN are GTIN formats)
--     and validated by lib/gtin.ts validateGtin before insert;
--     the column itself holds the normalized value only.
--   * RLS: enabled. Public SELECT for live rows only
--     (TO anon, authenticated USING is_public_live = true).
--     NO anon/authenticated INSERT, UPDATE or DELETE policy —
--     rows are written only through the service-role client
--     (scripts/import-cj-feed.ts), the same pattern as
--     cleanup_actions (migration 070) and error_log (048).
--   * Indexes: gtin, mpn, (is_public_live, availability, price)
--     for the comparison query, and a GIN full-text index on title.
--   * updated_at: bumped on every UPDATE by the shared trigger
--     function public.update_updated_at_column() (migration 001,
--     applied long ago). The upsert helper never sets updated_at,
--     so without this trigger the column would keep its insert
--     time forever and lie about the last import.
--   * NO foreign key to products (deliberate): offers are matched
--     by GTIN / MPN, and feed rows arrive for products not yet in
--     the catalog — an FK would block those imports. The UNIQUE
--     (network, advertiser_id, external_product_id) is the
--     duplicate-prevention key.
--   * NO soft-delete column (known limitation): a product that
--     disappears from the feed keeps its last imported row until
--     it is handled manually — there is no stale-offer expiry
--     sweep yet. The feed file itself is the restorable source.
--
-- ROLLBACK: DROP TABLE IF EXISTS public.merchant_offers;
-- The table is new and empty at apply time, so an immediate
-- rollback (before any import runs) destroys nothing. After an
-- import has run, export the table first — the feed file itself
-- is the restorable source (CJ SFTP, subscription Id 325295).
--
-- SAFETY: every statement is guarded (CREATE TABLE IF NOT EXISTS /
-- CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS before
-- CREATE POLICY), so a re-run converges. No explicit transaction
-- wrapper: the Supabase SQL editor runs the file as one batch.

CREATE TABLE IF NOT EXISTS public.merchant_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network text NOT NULL CHECK (network IN ('cj', 'amazon')),
  advertiser_id text NOT NULL,
  advertiser_name text NOT NULL DEFAULT '',
  external_product_id text NOT NULL,
  gtin text NULL,
  mpn text NULL,
  brand text NULL,
  title text NOT NULL DEFAULT '',
  description text NULL,
  image_url text NULL,
  affiliate_url text NOT NULL DEFAULT '',
  price numeric NOT NULL CHECK (price > 0),
  sale_price numeric NULL CHECK (sale_price IS NULL OR sale_price > 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  availability text NOT NULL DEFAULT 'out_of_stock'
    CHECK (availability IN ('in_stock', 'out_of_stock', 'preorder', 'backorder')),
  category text NULL,
  is_public_live boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_offers_network_advertiser_product_key
    UNIQUE (network, advertiser_id, external_product_id)
);

-- Lookup indexes for the comparison query (GTIN / MPN match).
CREATE INDEX IF NOT EXISTS merchant_offers_gtin_idx
  ON public.merchant_offers (gtin) WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS merchant_offers_mpn_idx
  ON public.merchant_offers (mpn) WHERE mpn IS NOT NULL;

-- Comparison listing: live + in-stock rows ordered by price.
CREATE INDEX IF NOT EXISTS merchant_offers_live_availability_price_idx
  ON public.merchant_offers (is_public_live, availability, price);

-- Full-text search on title (English stemming, same as the
-- catalog search pattern used elsewhere in the repo).
CREATE INDEX IF NOT EXISTS merchant_offers_title_fts_idx
  ON public.merchant_offers
  USING gin (to_tsvector('english', coalesce(title, '')));

-- updated_at auto-bump on every UPDATE, via the shared trigger
-- function from migration 001 (same pattern as retailers and
-- products in migration 002). The upsert helper never sets
-- updated_at itself, so this trigger is what keeps the column
-- truthful across re-imports.
DROP TRIGGER IF EXISTS update_merchant_offers_updated_at ON public.merchant_offers;
CREATE TRIGGER update_merchant_offers_updated_at
  BEFORE UPDATE ON public.merchant_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Row Level Security: public read for live rows only. Writes are
-- service-role only (no INSERT / UPDATE / DELETE policy exists).
ALTER TABLE public.merchant_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS merchant_offers_select_public_live ON public.merchant_offers;
CREATE POLICY merchant_offers_select_public_live ON public.merchant_offers
  FOR SELECT
  TO anon, authenticated
  USING (is_public_live = true);
