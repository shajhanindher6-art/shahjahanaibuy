-- ============================================================================
-- Option 2, Worldwide expansion (2026-11-02) — country_stores
-- DIRECTORY table (run once in the Supabase SQL editor).
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
-- The global retailer fallback (Amazon.com, eBay.com, AliExpress,
-- Google Shopping) is intentionally NOT seeded here: it is not a
-- per-country directory, it lives in code only (lib/stores.ts
-- GLOBAL_STORES) and is used for any country with no local rows.
-- QA and ZA are regions without a confirmed local store, so they
-- have no rows below either — they get the fallback, not US rows.
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
  ('AU', 'eBay', 'ebay', 'https://www.ebay.com.au', 'https://www.ebay.com.au/sch/i.html?_nkw={q}'),
  ('JP', 'Mercari', 'mercari', 'https://jp.mercari.com', 'https://jp.mercari.com/search?keyword={q}'),
  ('JP', 'Rakuten', 'rakuten', 'https://www.rakuten.co.jp', 'https://search.rakuten.co.jp/search/mall/{q}/'),
  ('TR', 'Trendyol', 'trendyol', 'https://www.trendyol.com', 'https://www.trendyol.com/sr?q={q}'),
  ('TR', 'Hepsiburada', 'hepsiburada', 'https://www.hepsiburada.com', 'https://www.hepsiburada.com/ara?q={q}'),
  ('KR', 'Coupang', 'coupang', 'https://www.coupang.com', 'https://www.coupang.com/np/search?q={q}'),
  ('PL', 'Allegro', 'allegro', 'https://allegro.pl', 'https://allegro.pl/listing?string={q}'),
  ('CZ', 'Allegro', 'allegro', 'https://allegro.cz', 'https://allegro.cz/vyhledavani?string={q}'),
  ('GR', 'Skroutz', 'skroutz', 'https://www.skroutz.gr', 'https://www.skroutz.gr/search?keyphrase={q}'),
  ('ID', 'Shopee', 'shopee', 'https://shopee.co.id', 'https://shopee.co.id/search?keyword={q}'),
  ('ID', 'Lazada', 'lazada', 'https://www.lazada.co.id', 'https://www.lazada.co.id/catalog/?q={q}'),
  ('MY', 'Shopee', 'shopee', 'https://shopee.com.my', 'https://shopee.com.my/search?keyword={q}'),
  ('MY', 'Lazada', 'lazada', 'https://www.lazada.com.my', 'https://www.lazada.com.my/catalog/?q={q}'),
  ('SG', 'Shopee', 'shopee', 'https://shopee.sg', 'https://shopee.sg/search?keyword={q}'),
  ('SG', 'Lazada', 'lazada', 'https://www.lazada.sg', 'https://www.lazada.sg/catalog/?q={q}'),
  ('TH', 'Shopee', 'shopee', 'https://shopee.co.th', 'https://shopee.co.th/search?keyword={q}'),
  ('TH', 'Lazada', 'lazada', 'https://www.lazada.co.th', 'https://www.lazada.co.th/catalog/?q={q}'),
  ('VN', 'Shopee', 'shopee', 'https://shopee.vn', 'https://shopee.vn/search?keyword={q}'),
  ('VN', 'Lazada', 'lazada', 'https://www.lazada.vn', 'https://www.lazada.vn/catalog/?q={q}'),
  ('PH', 'Shopee', 'shopee', 'https://shopee.ph', 'https://shopee.ph/search?keyword={q}'),
  ('PH', 'Lazada', 'lazada', 'https://www.lazada.com.ph', 'https://www.lazada.com.ph/catalog/?q={q}'),
  ('TW', 'Shopee', 'shopee', 'https://shopee.tw', 'https://shopee.tw/search?keyword={q}'),
  ('BR', 'Mercado Livre', 'mercado-livre', 'https://mercadolivre.com.br', 'https://lista.mercadolivre.com.br/{q}'),
  ('BR', 'Shopee', 'shopee', 'https://shopee.com.br', 'https://shopee.com.br/search?keyword={q}'),
  ('MX', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.mx', 'https://listado.mercadolibre.com.mx/{q}'),
  ('AR', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.ar', 'https://listado.mercadolibre.com.ar/{q}'),
  ('CL', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.cl', 'https://listado.mercadolibre.cl/{q}'),
  ('CO', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.co', 'https://listado.mercadolibre.com.co/{q}'),
  ('PE', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.pe', 'https://listado.mercadolibre.com.pe/{q}'),
  ('UY', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.uy', 'https://listado.mercadolibre.com.uy/{q}'),
  ('BO', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.bo', 'https://listado.mercadolibre.com.bo/{q}'),
  ('PY', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.py', 'https://listado.mercadolibre.com.py/{q}'),
  ('VE', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.ve', 'https://listado.mercadolibre.com.ve/{q}'),
  ('CR', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.co.cr', 'https://listado.mercadolibre.co.cr/{q}'),
  ('EC', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.ec', 'https://listado.mercadolibre.com.ec/{q}'),
  ('GT', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.gt', 'https://listado.mercadolibre.com.gt/{q}'),
  ('DO', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.do', 'https://listado.mercadolibre.com.do/{q}'),
  ('PA', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.pa', 'https://listado.mercadolibre.com.pa/{q}'),
  ('HN', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.hn', 'https://listado.mercadolibre.com.hn/{q}'),
  ('NI', 'Mercado Libre', 'mercado-libre', 'https://mercadolibre.com.ni', 'https://listado.mercadolibre.com.ni/{q}'),
  ('BD', 'Daraz', 'daraz', 'https://www.daraz.com.bd', 'https://www.daraz.com.bd/catalog/?q={q}'),
  ('LK', 'Daraz', 'daraz', 'https://www.daraz.lk', 'https://www.daraz.lk/catalog/?q={q}'),
  ('NP', 'Daraz', 'daraz', 'https://www.daraz.com.np', 'https://www.daraz.com.np/catalog/?q={q}'),
  ('NG', 'Jumia', 'jumia', 'https://www.jumia.com.ng', 'https://www.jumia.com.ng/catalog/?q={q}'),
  ('EG', 'Jumia', 'jumia', 'https://www.jumia.com.eg', 'https://www.jumia.com.eg/catalog/?q={q}'),
  ('KE', 'Jumia', 'jumia', 'https://www.jumia.co.ke', 'https://www.jumia.co.ke/catalog/?q={q}'),
  ('MA', 'Jumia', 'jumia', 'https://www.jumia.ma', 'https://www.jumia.ma/catalog/?q={q}'),
  ('CI', 'Jumia', 'jumia', 'https://www.jumia.ci', 'https://www.jumia.ci/catalog/?q={q}'),
  ('SN', 'Jumia', 'jumia', 'https://www.jumia.sn', 'https://www.jumia.sn/catalog/?q={q}'),
  ('UG', 'Jumia', 'jumia', 'https://www.jumia.ug', 'https://www.jumia.ug/catalog/?q={q}'),
  ('GH', 'Jumia', 'jumia', 'https://www.jumia.com.gh', 'https://www.jumia.com.gh/catalog/?q={q}'),
  ('IE', 'eBay', 'ebay', 'https://www.ebay.ie', 'https://www.ebay.ie/sch/i.html?_nkw={q}'),
  ('AT', 'eBay', 'ebay', 'https://www.ebay.at', 'https://www.ebay.at/sch/i.html?_nkw={q}'),
  ('BE', 'eBay', 'ebay', 'https://www.ebay.be', 'https://www.ebay.be/sch/i.html?_nkw={q}'),
  ('NL', 'eBay', 'ebay', 'https://www.ebay.nl', 'https://www.ebay.nl/sch/i.html?_nkw={q}'),
  ('CH', 'eBay', 'ebay', 'https://www.ebay.ch', 'https://www.ebay.ch/sch/i.html?_nkw={q}')
ON CONFLICT (country_code, store_slug) DO NOTHING;

-- Verify (expect 70 rows on first run across 58 countries: US 3,
-- PK 1, GB 2, DE 1, FR 1, IT 1, ES 1, IN 1, AE 1, SA 1, CA 1, AU 1,
-- JP 2, TR 2, KR 1, PL 1, CZ 1, GR 1, ID 2, MY 2, SG 2, TH 2, VN 2,
-- PH 2, TW 1, BR 2, MX 1, AR 1, CL 1, CO 1, PE 1, UY 1, BO 1, PY 1,
-- VE 1, CR 1, EC 1, GT 1, DO 1, PA 1, HN 1, NI 1, BD 1, LK 1, NP 1,
-- NG 1, EG 1, KE 1, MA 1, CI 1, SN 1, UG 1, GH 1, IE 1, AT 1, BE 1,
-- NL 1, CH 1. QA and ZA intentionally have no rows — they use the
-- code-only global fallback.)
SELECT country_code, count(*) AS stores
FROM public.country_stores
GROUP BY country_code
ORDER BY country_code;
