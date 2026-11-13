# Catalog Quality Report — SmartBuy AI (Section 20)

**Date:** 13 November 2026 (Section 20 build; source: Section 20 audit §2, §6)
**Status:** the catalogue as counted in the repo tree, cross-checked against
the 2026-11-13 07:02 PKT live recheck (25/25 PASS). Counts are from seed files
and code, not a live DB query — no live Supabase read was available to the
audit. Nothing here is invented; where the repo cannot prove something, this
report says so.

## Headline

**10 products. 0 with images, 0 with GTINs, 0 with specs, 0 with reviews,
0 with variants, 0 with fresh prices, 0 with verified prices.** Every price is
11 days stale (last recorded 2026-11-02; threshold 7 days). Every product is
"published" only by fail-open default (migration 045 unapplied), not by a
recorded approval.

## Per-product table (audit §2)

Source of truth: `supabase/seed-products.sql` (10 `INSERT` rows; header states
every row was copied verbatim from live `GET /api/v1/products` fetched
2026-11-12; `sample-laptop` intentionally absent). The 07:02 PKT live recheck
agrees with every count below.

| slug | brand | price (USD) | merchants | image? | GTIN? | specs? | reviews? | price age | status | verification |
|---|---|---|---|---|---|---|---|---|---|---|
| galaxy-s24-ultra | Samsung | 1199 | 2 (Amazon, Best Buy) | ✗ | ✗ | ✗ | ✗ | 11d — stale | published* | unverified |
| sony-wh-1000xm5 | Sony | 399 | 2 | ✗ | ✗ | ✗ | ✗ | 11d — stale | published* | unverified |
| dell-xps-13 | Dell | 1099 | 2 | ✗ | ✗ | ✗ | ✗ | 11d — stale | published* | unverified |
| lenovo-thinkpad-x1 | Lenovo | 1399 | 2 | ✗ | ✗ | ✗ | ✗ | 11d — stale | published* | unverified |
| bose-quietcomfort-ultra | Bose | 429 | 2 | ✗ | ✗ | ✗ | ✗ | 11d — stale | published* | unverified |
| canon-eos-r10 | Canon | 979 | 2 | ✗ | ✗ | ✗ | ✗ | 11d — stale | published* | unverified |
| gopro-hero12 | GoPro | 399 | 2 | ✗ | ✗ | ✗ | ✗ | 11d — stale | published* | unverified |
| garmin-venu-3 | Garmin | 449 | 2 | ✗ | ✗ | ✗ | ✗ | 11d — stale | published* | unverified |
| logitech-mx-master-3s | Logitech | 99 | 2 | ✗ | ✗ | ✗ | ✗ | 11d — stale | published* | unverified |
| macbook-air-13 | Apple | 999 | 2 | ✗ | ✗ | ✗ | ✗ | 11d — stale | published* | unverified |

\* `published` = fail-open default (migration 045 unapplied;
`normalizeProductStatus`, `services/price-verification.ts:50-54`). There is no
live row anywhere with `pending` or `rejected` status, and no way to unpublish
a product through the live DB today except deleting it.

## Exact counts (counted in the tree)

- Products: **10/10**; with images **0/10**; with GTINs **0/10**; with specs
  **0/10**; with reviews **0/10**; with variants **0/10**; with
  `product_images` rows **0/10**; with fresh prices (≤7d) **0/10**; with stale
  prices **10/10** (11 days, threshold 7); published **10/10** (fail-open);
  verified prices **0/10**; with `compare_at_price` **10/10** (20/20 rows);
  with 2 merchants **10/10**; with deals **6/10**; with cashback **10/10**;
  with price history **10/10** (40 points, Amazon only); with
  `confidence_score` 50 **10/10**; with model-number field **0/10** (field
  doesn't exist); with listing currency recorded **0/10** (`currency_id` NULL
  on all 20 merchant rows).
- Duplicate products in the catalog: **0** (exact check); near-duplicate pairs
  by normalized name+brand: **0**.
- **Null/missing per product (all 10 identical):** `image_url` NULL, `gtin`
  NULL, `price_verified_at` NULL (column doesn't exist yet). Descriptions are
  present but minimal one-sentence generics. `data_freshness` = `created_at` =
  `updated_at` = **2026-11-02T07:13:52Z on all 10 rows** — a single seed
  instant, never updated since.
- **Seed honesty note:** `seed-demo-data.sql:15-17` labels the prices
  **"DEMO/placeholder launch prices, not live retailer prices"** — Best Buy
  being exactly +2% on every product proves they are synthetic.
  `merchant_sku`, `url`, `shipping_cost`, `shipping_days`, `stock_quantity`,
  `currency_id` are all NULL on all 20 merchant rows. `brand_id`/`category_id`
  (migration 004) are never populated — brand/category live only as free-text
  columns.
- **Merchant reliability data: none exists.** `merchants` has only
  `status/active/commission_rate` — no trust score, rating, uptime, or
  fulfilment columns. `data_sources.last_sync_status/last_sync_error` exist in
  schema but have zero seed rows and no live sync runs against a real feed.

## Quality by dimension

| Dimension | Score | Evidence |
|---|---|---|
| Identity (name/brand/slug) | 10/10 present | Names + brands present; no model-number field exists anywhere |
| GTIN identity | **0/10** | No GTINs; no check-digit/format validator; no DB UNIQUE on GTIN; same GTIN + different slug passes intake as `valid` |
| Spec completeness | **0/10** | 0 `product_attributes` rows; no category spec templates; no per-spec attribution (`source`/`verified_at`/`verified_by` missing) |
| Images | **0/10** | 0 `product_images` rows; `image_url` NULL on all 10; validation is URL-shape-only; `uploadToStorage` is a log line; product surfaces bypass `next/image` (raw `<img>`, remotePatterns allow only Unsplash + Pexels) |
| Price freshness | **0/10** | All 11 days stale; refresh re-reads the DB only; no live feed |
| Price verification | **0/10** | All unverified; only eBay Browse could ever verify, and it is doubly blocked |
| Reviews | **0/10** | No reviews; review engine exists, data does not; never invent |
| Variants | **0/10** | Schema exists, 0 rows, never read by API/UI |
| Merchant coverage | 2 merchants, seeded rows only | Amazon = tag only; Best Buy = no adapter; eBay = code-built, owner-gated |
| Price history depth | 4 points/product, Amazon only | 40 rows total; 7-day view already empty (honest empty state); 30-day view has 3 of 4 points; nothing re-bases them |
| `confidence_score` | 50 on 10/10 | Field-presence count floored at 50, never computed at intake — **not** a quality measurement (see below) |

### Why "Confidence Score 50%" is not a quality score

It is a field-presence completeness count (name +15, description +15, GTIN
+20, …), floored at 50 on update (`Math.max(score, 50)`,
`services/pipeline/normalization.ts:45-56`), never computed at intake approve
— so every product shows 50% regardless of completeness. The same number feeds
the Deal Score formula (× 0.3) and AI deal ranking (+10 if ≥70) and
recommendations ordering — completeness treated as product quality. Migration
002's comment claims it "reflects data quality (completeness, freshness,
source reliability)" — documented intent ≠ implementation. No transparent
Product Data Quality Score exists: no freshness, source-reliability,
merchant-trust, or GTIN-validity dimension is scored anywhere.

### Deal Score and forecast honesty

- Deal Score yields **100/100 on all products** (4 flat points, 0 discount
  probability, clamped) — a data problem, not a formula problem. The badge is
  withheld below 5 data points on every surface.
- Forecast (≥2 points) and buy-wait (≥2 points) still issue verdicts while the
  badge and Deal Score refuse below 5 — the threshold split is a known
  Section 20 item.
- "X% off" badges come from a list price that was never observed
  (`compare_at_price` seeded, identical across merchants); the deals table
  carries its own seeded 10–20% percentages.

## The honest 50-product assessment (audit §6)

"Verified" means a real fetch checked the price
(`services/price-verification.ts:12-16`). Today exactly **one** fetch path
qualifies — eBay Browse. Manual CSV prices are `unverified` by definition.
Migration 045 (the columns that persist verification status) is NOT applied
live, so even an eBay-approved row currently persists no verification stamp.

| Scenario | Verified products | Honest reading |
|---|---|---|
| **Today, no owner action** | **10 → 10 (0 added)** | Nothing in code can add a verified product without keys. The 10 seed products are themselves unverified + stale since 2026-11-02, with `gtin: null` and `imageUrl: null` on all 10. |
| **After the eBay unblock only** (keys + EPN/Growth Check + `merchants` row `slug='ebay'` + migration 045) | **10 → 50 reachable** — 40 eBay approvals at ~10/preview batch, i.e. ~4–8 admin batches | **Only as thin hand-annotated eBay listings:** eBay title as name (keyword-stuffed, admin must rewrite), no GTIN, no specs, no variants, one hotlinked image, one ephemeral asking price, no price history, no Deal Score. eBay refresh re-verification is keyword-only and will mismatch/skip often. "50 verified" is honest only if the label stays "Live eBay asking price, checked <timestamp>" — it is **not** 50 fully-verified catalog products. |
| **If eBay stays unavailable** | Shortfall is the **full 40** | No other source exists; the ceiling is 10 verified + unlimited unverified hand-typed rows. **50 verified is impossible without eBay** (or a new approved provider, which does not exist). |
| **50 FULLY-verified** (specs + GTIN + images + price history) | **NOT reachable in Section 20 by any path** | No source supplies specs/GTINs, and the intake schema cannot even record specs/variants. |

### Why the other sources add 0 verified products

- **Manual CSV intake:** 0 verified (unlimited *unverified* rows, max
  1,000/batch — but data must be hand-typed from real retailer/manufacturer
  pages, and only `amazon` + `best-buy` merchants exist in the DB).
- **Amazon PA-API / Creators API:** 0 — no adapter exists; PA-API 5.0 retired;
  Creators needs ≥10 qualifying sales/30 days; tag is link-only.
- **Skimlinks:** 0 — not configured; no adapter; would yield affiliate links,
  not product records.
- **Daraz / PriceOye / Flipkart / Noon / AliExpress etc.:** 0 — no adapters;
  no free live-price API; Apify banned.
- **Merchant feeds:** 0 — enum value exists, zero ingestion code, no feed contract.
- **Apify (any actor):** any number, all scraped — **banned by standing rule**,
  code is fail-closed, vars must stay unset.
- **`/find` 500 curated queries / stores directory:** 0 products — affiliate
  *search links*, not catalog records; must not be counted as products.

## What would change the numbers (owner-gated)

1. eBay keys + EPN/Growth Check + `merchants` row `slug='ebay'` — the only
   path to any new verified product.
2. Migration 045 — verification stamp persistence + published status +
   `price_history` UNIQUE.
3. A real source for images/GTINs/specs (merchant feed, GS1, or manual owner
   entry) — none exists in the tree today; guessing, scraping, or using
   mock-provider fake GTINs as real data is rejected.
4. Live DB verification of `price_history` row counts, admin login, and any
   real merchant feed/keys (owner-gated; the audit had no live DB read).
