# Product Data Architecture — SmartBuy AI (Section 20)

**Date:** 13 November 2026 (Section 20 build; audit `~/workspace/section20-audit.md`)
**Status:** documentation of the system as built in Sections 1–19. Nothing in this
document invents data — every count below comes from the Section 20 audit
(§2, §6, §7), counted in the repo tree and cross-checked against the
2026-11-13 07:02 PKT live recheck (25/25 PASS).

## Baseline the numbers rest on (Section 20 audit, 13 Nov 2026 ~08:22 PKT)

- `npx tsc --noEmit`: 0 errors. Full vitest: **286 files / 3,425 tests passed,
  4 skipped, 0 failed**. a11y 31/31. Lint 0 errors, 0 warnings.
- Clean build (Section 19 gate): 802 pages, `/products/[slug]` First Load 338 kB.
- API: **187 route files / 253 handlers**; `docs/openapi.json` matches exactly.
- Migrations: **52 files** (001–054, gaps 024/025/046, plus unnumbered
  `20260718060823_fix_anonymous_access_policies.sql`); **18 DO NOT APPLY**
  (035–043, 045, 047–054). Applied status of every migration is UNKNOWN from
  the repo — only the owner can check `supabase_migrations.schema_migrations`.
- i18n: 167 keys, 20 languages. Press counts: 3,425/286.

## The catalogue as it actually is

| Measure | Count |
|---|---|
| Products | **10** |
| With images | **0/10** (`image_url` NULL on all 10) |
| With GTINs | **0/10** (`gtin` NULL on all 10) |
| With specs (`product_attributes` rows) | **0/10** |
| With reviews | **0/10** |
| With variants | **0/10** |
| With fresh prices (≤ 7 days) | **0/10** |
| With stale prices | **10/10** (11 days old; threshold `STALE_PRICE_DAYS = 7`, `lib/price-freshness.ts:59`) |
| With verified prices | **0/10** (`priceVerificationStatus: unverified` on all 10, live API) |
| Published | **10/10** — fail-open default, not a recorded approval (migration 045 unapplied) |
| With `compare_at_price` | **10/10** (20/20 merchant rows) |
| With 2 merchants | **10/10** (Amazon + Best Buy, seeded rows only) |
| With deals | 6/10; with cashback 10/10; with price history 10/10 (40 points, Amazon only) |
| With `confidence_score` 50 | **10/10** (see "Quality scoring" below) |
| With a model-number field | **0/10** — the field does not exist anywhere in schema, types, or seed |
| With listing currency recorded | **0/10** (`currency_id` NULL on all 20 `merchant_products` rows) |
| Duplicate products | **0** (exact check); near-duplicate pairs by normalized name+brand: **0** |

All 10 rows share one seed instant: `data_freshness` = `created_at` =
`updated_at` = **2026-11-02T07:13:52Z**, never updated since. The seed file
itself labels the prices **"DEMO/placeholder launch prices, not live retailer
prices"** (`supabase/seed-demo-data.sql:15-17`) — Best Buy being exactly +2% on
every product proves they are synthetic. `merchant_sku`, `url`,
`shipping_cost`, `shipping_days`, `stock_quantity`, `currency_id` are all NULL
on all 20 merchant rows. `brand_id`/`category_id` (migration 004) are never
populated — brand/category live only as free-text columns.

Per-product table (audit §2; prices USD, all stale 11 days, all unverified):

| slug | brand | price | merchants | image | GTIN | specs | reviews |
|---|---|---|---|---|---|---|---|
| galaxy-s24-ultra | Samsung | 1199 | 2 | ✗ | ✗ | ✗ | ✗ |
| sony-wh-1000xm5 | Sony | 399 | 2 | ✗ | ✗ | ✗ | ✗ |
| dell-xps-13 | Dell | 1099 | 2 | ✗ | ✗ | ✗ | ✗ |
| lenovo-thinkpad-x1 | Lenovo | 1399 | 2 | ✗ | ✗ | ✗ | ✗ |
| bose-quietcomfort-ultra | Bose | 429 | 2 | ✗ | ✗ | ✗ | ✗ |
| canon-eos-r10 | Canon | 979 | 2 | ✗ | ✗ | ✗ | ✗ |
| gopro-hero12 | GoPro | 399 | 2 | ✗ | ✗ | ✗ | ✗ |
| garmin-venu-3 | Garmin | 449 | 2 | ✗ | ✗ | ✗ | ✗ |
| logitech-mx-master-3s | Logitech | 99 | 2 | ✗ | ✗ | ✗ | ✗ |
| macbook-air-13 | Apple | 999 | 2 | ✗ | ✗ | ✗ | ✗ |

## Schema — the product-data tables

Core tables (migration 002 unless noted):

- **`products`** — id, slug, name, description, brand/category (free text),
  `image_url` (NULL on all 10), `gtin` (NULL on all 10), `confidence_score`,
  `data_freshness`, `refresh_status`, `next_refresh_at`. There is **no**
  `model_number` column, no `price_verification_status` column, and no
  approval/published/status column in the live schema — those arrive only with
  migration 045 (written, **NOT applied**).
- **`merchants`** — exactly **2 rows** live (Amazon, Best Buy — seeded rows
  only). No `ebay` row exists; nothing in code ever creates a `merchants` row.
  Columns are `status`/`active`/`commission_rate` only — no trust score,
  rating, uptime, or fulfilment columns.
- **`merchant_products`** — 20 rows (2 per product). Price, `compare_at_price`,
  `currency_id` NULL on all 20. No listing currency is recorded anywhere.
- **`price_history`** — 40 rows, Amazon only, 4 points per product, all
  relative to 2026-11-02. **No `source` column** — a row cannot be told apart
  as seed/demo vs live vs re-recorded. No suspicious-change flag, no per-row
  verification flag, no UNIQUE constraint live (045 §C, NOT applied). The seed
  itself warns re-running it duplicates rows.
- **`product_attributes`** (migration 004) — EAV spec store,
  UNIQUE(product_id, key), public-read RLS. **0 rows live.** No
  `source`/`verified_at`/`verified_by` columns (per-spec attribution missing).
- **`product_variants`** — schema exists (`sku` only, no variant-level GTIN);
  **0 rows**; no API/UI caller reads it (`services/products.ts:625-649`).
- **`product_images`** — schema exists; **0 rows**. `uploadToStorage` is a log
  line, not an implementation — no CDN, no resized variants, no optimization.
- **`data_sources` / `product_sources`** — schema exists; **0 rows**. The whole
  data-source config layer is schema-only.
- **`deals`** (6/10 products), **`cashback`** (10/10) — seeded rows; deal
  percentages (10–20%) are seeded, not observed.
- **`price_refresh_runs`** — schema in migration 040, **NOT applied**, so no
  refresh run is ever recorded live; `/status` shows "No price refresh run has
  been recorded yet".

## Data flows (what actually moves data)

### 1. CSV intake — admin-typed, never auto-insert

`app/api/v1/admin/intake/route.ts` + `services/catalog-intake.ts`, UI
`app/admin/intake/page.tsx`. Preview → review → approve; ≤2 MB / ≤1,000 rows
per batch; the merchant must already exist in `merchants`. Intake validates
name/slug/brand/category/price/currency/merchant rigorously, but `imageUrl`
passes through **unvalidated** (`catalog-intake.ts:217,426`) and GTIN is
zod `.max(50)` only — no check-digit/format validation anywhere in the repo.
Prices from CSV are `unverified` **by definition** (see
`docs/product-verification-policy.md`). Intake approve inserts directly and is
born `pending` in code with a publish flip only after the listing exists — but
with 045 unapplied the columns do not exist, so live rows are "published" by
fail-open default. Intake approve audits via a direct insert, bypassing
`recordAdminAction` (no uniform schema/IP capture).

### 2. eBay pipeline — the only real live source, code-complete, owner-gated

`services/ebay-browse.ts` (Browse API, OAuth client-credentials, 10 s timeout,
429 → distinct `rate-limited`), `services/ebay-intake.ts`,
`app/api/v1/admin/ebay/preview/route.ts`. Preview → review → approve, never
auto-inserts. **Blocked twice over live:** `EBAY_CLIENT_ID` /
`EBAY_CLIENT_SECRET` unset, AND no `merchants` row `slug='ebay'`. Even with
keys tomorrow, step 0 returns `merchant-missing`. eBay refresh upsert writes
no `price_verification_status`/`price_source` — once 045 applies, refreshed
eBay rows default to `unverified`/`manual-intake` (wrong label).

### 3. Price refresh — re-reads the database, fetches nothing live

`app/api/v1/prices/refresh/route.ts` (CRON_SECRET, every 6 h via cron-job.org —
the only scheduler; whether the job exists/fires is owner-verified only).
Wave structure: A: eBay → pipeline; B: refresh + stock in parallel; C:
alerts + hunts + digest + savedSearches; D: notifications + guestAlerts; E:
guestEmail; then outcomes. The `refresh` step re-reads `merchant_products`
(2026-11-02 seed values) and inserts `price_history` only on change — it never
changes, so it inserts nothing — yet still moves `data_freshness` /
`next_refresh_at` forward. The pipeline leg is always `available: false,
reason: 'no-available-provider'` in production (registry empty). Full detail:
`docs/price-data-pipeline.md`.

### 4. Provider registry — empty in production

`services/providers/registry.ts:141-167` registers only Apify (fail-closed,
banned by standing rule — vars must stay unset) + non-prod Mock. Zero
`official_api` / `affiliate_feed` providers exist. `CsvProvider`
(`services/providers/csv-provider.ts`) exists but is **never registered**;
`data_sources`/`product_sources` have zero rows. Amazon has no adapter; Best
Buy has no adapter. The "84 stores" directory is static search-links, not the
`merchants` table.

## Quality scoring — what the numbers mean (and do not mean)

- **`confidence_score`** is a field-presence completeness count (name +15,
  description +15, GTIN +20, …), **floored at 50** on update
  (`Math.max(score, 50)`, `services/pipeline/normalization.ts:45-56`), never
  computed at intake approve — so every product shows **50%** regardless of
  completeness. Migration 002's comment claims it "reflects data quality
  (completeness, freshness, source reliability)" — documented intent ≠
  implementation. The same number feeds the Deal Score formula (× 0.3) and AI
  deal ranking (+10 if ≥70) and recommendations ordering — completeness
  treated as product quality.
- **No transparent Product Data Quality Score exists.** No freshness,
  source-reliability, merchant-trust, or GTIN-validity dimension is scored;
  price freshness and merchant reliability live in separate systems never
  folded into any score.
- **Deal Score** yields 100/100 on the live 4-point flat series, but the badge
  is withheld below 5 data points on every surface (`lib/deal-score.ts`).
  Forecast (≥2 points) and buy-wait (≥2 points) still issue verdicts while the
  badge refuses below 5 — the threshold split is a known Section 20 item.
- **Merchant reliability data: none exists.** `services/merchant-reliability.ts`
  "catalog coverage" is listing-count points, not history coverage; no
  per-source success/failure table.

## API endpoints (product data)

- `GET /api/v1/products` — 10 products; every row `priceVerificationStatus:
  unverified`, `imageUrl: null`, `gtin: null` (live recheck 07:02 PKT).
- `GET /api/v1/products/[slug]` — detail; variants are never read by this
  route (`services/products.ts:625-649` is dead code from the API's view).
- `GET /api/v1/merchants` — the 2 seeded merchants; the Amazon tag
  `smartbuy-20` is reported here as configured for US (tag only — see
  `docs/merchant-integration-guide.md`).
- `POST /api/v1/admin/intake` — CSV intake (admin-only, preview/review/approve).
- `POST /api/v1/admin/ebay/preview` — eBay preview (admin-only; owner-gated live).
- `POST /api/v1/prices/refresh` — CRON_SECRET-only refresh chain (no
  admin-session fallback; `/admin/refresh-runs` is read-only, no trigger button).
- `POST /api/v1/data/refresh` — admin-only, but only enqueues a `product.fetch`
  job that does nothing real without a provider.
- Full reference: `API_DOCUMENTATION.md` + `docs/openapi.json` (187/253, verified).

## Known limitations (honest list)

1. No authorized merchant price feed is live. The only fetch path that could
   ever mark a price verified is eBay Browse, and it is doubly blocked.
2. No images, GTINs, specs, variants, reviews, or model numbers exist for any
   product — and no source in the tree can supply them.
3. `price_history` has no source column, no UNIQUE live, no suspicious-change
   flag; seed re-runs duplicate rows.
4. Refresh hardcodes `currency: 'USD'` on every `price_history` insert
   regardless of `merchant_products.currency_id`; eBay upsert stores the
   listing price as-is with no FX conversion (`fx-rates.ts` is traced into no
   ingestion path).
5. `'stale'` price-verification value is dead — nothing ever writes it.
6. Image URLs are stored with zero validation and rendered raw in `<img>` to
   all visitors (`data:` URLs, tracking pixels, mixed-content hosts are all
   storable by any admin CSV upload).
7. No admin product list/edit UI; no review queues (duplicates, missing specs,
   image status, price history); no ingestion-failure view; no manual refresh
   trigger.
8. `admin_audit_logs` is almost certainly still tamperable live (amended 017
   never re-ran; 010/011 policies likely survive) — owner-gated verification.
9. RLS execution suite is always skipped (4 skipped tests = the whole baseline
   skip count; no Postgres in sandbox/CI, `pg` not a dependency).
10. Methodology-page hardcoded figures ("last recorded 2 November 2026",
    "MacBook Air $999 vs $1,099") go stale when the catalogue changes; no code
    regenerates them.

## Pending owner approvals (not code work)

- Apply migrations 026–054 in order (035 only after separate explicit review);
  045 activates verification/published status + the `price_history` UNIQUE;
  040 activates refresh-run recording; 032 activates prediction-outcome storage.
- eBay keys + EPN/Growth Check + `merchants` row `slug='ebay'` (SQL insert).
- Verify cron-job.org 6 h refresh job exists/fires; verify `pg_policies` for 017.
- Amazon Associates approval check for `smartbuy-20`; Skimlinks application
  (do NOT apply without explicit go-ahead — rejection blocks reapplying 90 days).
- Image-host / hotlink policy decision (hotlinking is current practice; no
  merchant ToS/licence check exists).
