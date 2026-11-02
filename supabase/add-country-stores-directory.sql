-- ============================================================================
-- Option 2, Phase 1 — country_stores DIRECTORY table (run once in the
-- Supabase SQL editor).
--
-- DIRECTORY ONLY. This table holds NO prices, NO stock states, NO
-- listings, NO deals, NO coupons and NO ratings. It is a directory of
-- local stores per country whose public search URLs SmartBuy links to.
-- Clicking a store takes the shopper to that store's OWN search
-- results, where the store itself shows its price and availability.
-- No affiliate partnership is claimed for any store listed here.
--
-- NOT WIRED INTO ANYTHING PRICE-RELATED: this table is deliberately
-- NOT read by the homepage stats (which count the merchants table),
-- NOT read by Where-to-Buy prices, and NOT read by any price API.
-- The code registry in lib/stores.ts stays the runtime source of
-- truth, so the live site keeps working even if this SQL has not
-- been run yet. A later phase may read this table for the
-- directory UI; live local prices/deals would still need official
-- store APIs or partnerships — there is no free route to them.
--
-- Idempotent: safe to run more than once (CREATE IF NOT EXISTS +
-- ON CONFLICT DO NOTHING). The seed rows below match lib/stores.ts
-- exactly. Amazon and Best Buy are deliberately absent: they are
-- already the priced Where-to-Buy merchant rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.country_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  store_name text NOT NULL,
  store_slug text NOT NULL,
  website_url text NOT NULL,
  search_url_template text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Supports ON CONFLICT (country_code, store_slug) DO NOTHING below.
CREATE UNIQUE INDEX IF NOT EXISTS country_stores_country_slug_idx
  ON public.country_stores (country_code, store_slug);

-- Seed rows (directory only — templates contain {q}, replaced at
-- render time with the URL-encoded product name).
INSERT INTO public.country_stores
  (country_code, store_name, store_slug, website_url, search_url_template)
VALUES
  ('US', 'eBay', 'ebay', 'https://www.ebay.com', 'https://www.ebay.com/sch/i.html?_nkw={q}'),
  ('US', 'Walmart', 'walmart', 'https://www.walmart.com', 'https://www.walmart.com/search?q={q}'),
  ('US', 'Target', 'target', 'https://www.target.com', 'https://www.target.com/s?searchTerm={q}'),
  ('PK', 'Daraz', 'daraz', 'https://www.daraz.pk', 'https://www.daraz.pk/catalog/?q={q}'),
  ('GB', 'eBay', 'ebay', 'https://www.ebay.co.uk', 'https://www.ebay.co.uk/sch/i.html?_nkw={q}'),
  ('GB', 'Argos', 'argos', 'https://www.argos.co.uk', 'https://www.argos.co.uk/search/{q}/'),
  ('DE', 'eBay', 'ebay', 'https://www.ebay.de', 'https://www.ebay.de/sch/i.html?_nkw={q}'),
  ('FR', 'eBay', 'ebay', 'https://www.ebay.fr', 'https://www.ebay.fr/sch/i.html?_nkw={q}'),
  ('IT', 'eBay', 'ebay', 'https://www.ebay.it', 'https://www.ebay.it/sch/i.html?_nkw={q}'),
  ('ES', 'eBay', 'ebay', 'https://www.ebay.es', 'https://www.ebay.es/sch/i.html?_nkw={q}'),
  ('IN', 'Flipkart', 'flipkart', 'https://www.flipkart.com', 'https://www.flipkart.com/search?q={q}'),
  ('AE', 'Noon', 'noon', 'https://www.noon.com', 'https://www.noon.com/uae-en/search/?q={q}'),
  ('SA', 'Noon', 'noon', 'https://www.noon.com', 'https://www.noon.com/saudi-en/search/?q={q}'),
  ('CA', 'eBay', 'ebay', 'https://www.ebay.ca', 'https://www.ebay.ca/sch/i.html?_nkw={q}'),
  ('AU', 'eBay', 'ebay', 'https://www.ebay.com.au', 'https://www.ebay.com.au/sch/i.html?_nkw={q}')
ON CONFLICT (country_code, store_slug) DO NOTHING;

-- Verify (expect 15 rows on first run: US 3, PK 1, GB 2, DE 1, FR 1,
-- IT 1, ES 1, IN 1, AE 1, SA 1, CA 1, AU 1).
SELECT country_code, count(*) AS stores
FROM public.country_stores
GROUP BY country_code
ORDER BY country_code;
