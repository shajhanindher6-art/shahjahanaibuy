# Matching & Merchant Reliability — FINAL 100%

How SmartBuy decides two things are the same product, and how it scores
a merchant. The rule behind everything here: **never invent a match**.
A missing match is an honest empty state; a wrong match is a wrong price
shown to a customer.

## Confidence bands (services/matching-review.ts)

| Confidence | Meaning | Action |
|---|---|---|
| 1.00 | Exact slug / exact name+brand, or GTIN corroborated by a second leg in a scored matcher | Auto-merge / auto-match |
| 0.90 | GTIN alone (capped — a GTIN match is strong but never certain, F-P1-03) | Auto-merge, subject to the model-conflict veto |
| 0.75–0.89 | Fuzzy (name/brand similarity, model-only) | **Held for review — never auto-merged** |
| < 0.75 | No match | Treated as a different product |

`calibrateMatchConfidence` clamps any raw score into these bands and
records which legs corroborated it. `gtinMatchConfidence` returns 0.9
when the GTIN is valid, 1.0 only when a second leg (name/brand or
model) agrees.

## Model normalization (lib/model-normalization.ts)

`normalizeModel` uppercases and strips every non-alphanumeric
character, so `SM-S928B`, `sm s928b`, `SM_S928B` and `SMS928B` all
normalize to `SMS928B` and match each other. `modelsMatch` compares
normalized values; `modelsConflict` is true only when BOTH sides have
a model and they differ — a missing model on either side is neither a
match nor a conflict (absence of evidence is not evidence against).

`normalizeBrand` + `BRAND_ALIASES` do the same for brands
(`"Apple Inc"` → `"apple"`, `"Hewlett Packard"` → `"hp"`).

## Match legs, in order

### Pipeline dedupe (services/pipeline/deduplication.ts)

`findDuplicate` checks, in order: GTIN → slug → exact name+brand →
**model** (same normalized model + same normalized brand, F-P1-45) →
name/brand fuzzy (token-Jaccard ≥ 0.75, F-P1-42). The model leg and the
fuzzy leg are **review-only** (`requiresReview: true`): ingestion holds
the ingest as a rejection + audit-log entry and never overwrites the
existing product's GTIN or image. Exact legs auto-merge at confidence
0.90 — **unless the models conflict**, which vetoes even an exact leg
(never merge two different models by similar names). A name/brand or
model lookup failure fails closed: ingestion holds the ingest instead
of proceeding as "no match" (F-P2-42 / audit H-09).

The review queue today IS the rejection + audit trail: no dedicated
review-queue table exists yet (a migration owns 068–071). The intake
review page (`app/admin/products/review`) is read-only — a merge action
is still open work.

### Catalog intake (services/catalog-intake.ts)

`reviewIntakeRows` applies the same legs to CSV rows: a row whose
normalized model + brand matches an existing product is held as a
near-duplicate, and a fuzzy row whose model conflicts with an existing
product is held too.

### Brand resolution (services/pipeline/brand-detection.ts)

Exact brand match and new-brand creation are unchanged. A fuzzy
similarity ≥ 0.75 (F-P1-44) now returns `reviewRequired: true` with
the similarity — the brand is not auto-created from a fuzzy match
without review.

## eBay scored matching (services/ebay-matching.ts, F-P1-43)

The old keyword-containment matcher is gone. `scoreEbayListingMatch`
scores each priced listing over the legs that are actually available
(a missing GTIN/model is not evidence against):

- name coverage 50, brand 20, GTIN 20, model 10
- auto threshold **0.85**, name-coverage minimum **0.80**
- hard vetoes: GTIN mismatch, two-sided model mismatch, a year token
  in the title that is not in the product name, an accessory word
  (`case`, `charger`, `cable`, …), a missing brand token

Decision is `auto` / `review` / `no-match`. `refreshEbayPrices`
(services/ebay-refresh.ts) scores every priced listing, takes the
best-scoring one, and only an `auto` decision matches. A best score
below the threshold is recorded on the per-product result
(`matchReviewRequired: true`) instead of being silently skipped.
The legacy boolean `ebayListingMatchesProduct` still exists for its
callers/tests — it now returns true exactly when the scored decision
is `auto`.

## Variant matching (services/pipeline/variants.ts, F-P1-47)

`matchVariant` order: SKU → GTIN → **model** (normalized, new leg) →
attribute set. `matchListingToVariant` matches a listing to one of a
product's stored variants with confidence 0.9 (SKU/GTIN), 0.85
(model), 0.8 (attributes). When a product has no variants the result
is honest-empty (`no-variants` reason, confidence null) — the listing
attaches to the product, not to a variant. The variant catalog is
still 0 rows live, so today every listing-match is honest-empty on
the variant leg.

## Match-confidence persistence (F-P1-12)

`writeListingMatchConfidence` / `writeListingMatchConfidenceByProduct`
(services/merchant-listing-match.ts) write `match_confidence` and
`matched_by` on a `merchant_products` row; `readListingMatchConfidence`
reads them back. The columns do not exist until a future migration
lands — the writer tries them first and retries without them on
Postgres 42703, so it never fails a refresh; the reader returns nulls,
never a guessed number, when the columns are missing. The eBay
refresh writes the winning score after every successful upsert.

## Manual listing match (F-P1-21)

`POST /api/v1/admin/merchant-listings` (admin only, rate-limited,
CSRF-checked): an admin attaches a REAL listing URL + SKU to a
product + merchant. `validateManualListingMatch` rejects search URLs
(Amazon `/s`, eBay `/sch/`, Best Buy `searchpage`) and accepts real
listing patterns (Amazon `/dp/` or `/gp/product/`, eBay `/itm/`,
Best Buy `/site/.../*.p` with `skuId`). The write is confidence 1.0 /
`matched_by: 'manual'` and is recorded in the admin audit log.
`GET /api/v1/admin/merchant-listings` returns `getRealListingCoverage`:
`realListings / totalListings / searchUrlListings` — today 0/20 real,
and the payload says so.

## Merchant ↔ retailer reconciliation (F-P1-11, F-P2-06)

`lib/merchant-slugs.ts` is the SINGLE mapping place:

- `canonicalMerchantSlug` — `bestbuy` / `best_buy` / `Best-Buy` →
  `best-buy` (the `merchants` slug); `amazon`, `ebay` pass through.
- `providerKeyForMerchantSlug` — `best-buy` → `bestbuy`
  (the provider key / override spelling).
- `merchantSlugForProviderKey` — the reverse.
- `reconcileMerchantRetailer` — one entry per merchant: which
  table it is seeded in (`merchants`, `retailers`, or both) and
  whether the two tables agree. eBay is seeded in `retailers`
  only (migration 002); its `merchants` row is owner-gated and
  missing — the reconciliation says so.

`services/providers/registry.ts` canonicalizes in
`setRetailerOverride` / `getForRetailer` and registers the Best Buy
override under both spellings, so `getForRetailer('best-buy')` and
`getForRetailer('bestbuy')` agree.

## Merchant reliability — ONE canonical scorer (F-P1-50, F-P1-48)

Three things were called "merchant reliability", plus a fourth
string-key use. The canonical scorer is the **policy scorer**
(services/merchant-reliability.ts): directory + website + Verified
Merchant badge + trust grade + listing depth. It is the only scorer
whose inputs exist today for every merchant and the one already wired
into both merchant surfaces (compare page, /admin/ai panel). The
single entry point is **services/canonical-merchant-reliability.ts**:

- `getCanonicalMerchantReliability` — the policy scorer.
- `getDashboardMerchantReliability` — the dashboard data layer: one
  row per merchant, canonical score first, supporting dimensions
  labelled. `services/admin-data-quality.ts` exposes it as
  `AdminDataQualitySummary.merchantReliability`; the dashboard page
  (another worker's) renders `canonical` as "Merchant reliability"
  and the other two under their own labels.
- `writeMerchantReliabilitySnapshot` / `readMerchantReliabilitySnapshot`
  — the writer/reader for migration 061's `merchant_reliability`
  table. Writes when the table exists; honest
  "061 not applied" otherwise (the sync score rides in `signals`
  as a labelled dimension, never as a second score column).

The other two are supporting dimensions, **not deleted** — both have
live callers:

- **Sync scorer** (services/merchant-reliability-score.ts) —
  refresh-run health + fresh-listing share. Live in deal ranking
  (services/ai-deals.ts). Score is null until migration 040 is
  applied and a refresh has run.
- **History-based `computeSourceReliability`**
  (services/price-history-quality.ts) — share of non-suspicious
  price_history points per source. A per-source price-history
  reliability, NOT a merchant score. Computed by the admin
  data-quality service as `sourceReliability`.
- `lib/fact-check.ts` `'merchant_reliability'` is a string key for
  a Caution-flag check, not a score at all.

Do NOT add a third scorer.

## Quality-score "merchants" dimension (F-P1-49)

`services/product-quality-score.ts` labelled the dimension
"Merchant reliability" while measuring only listing count + in-stock
presence. It is now labelled **"Merchant listings (count only — not
measured reliability)"**, and rewired when the caller passes a
measured canonical reliability score
(`QualityScoreContext.merchantReliabilityScore`): then the dimension
uses that score under the label "Merchant reliability (measured)".
Per-product rewiring from the admin data-quality service is still
open — it needs `merchant_id` in that service's merchant query.

## Provider health (F-P2-04)

`services/provider-health.ts`:

- `recordProviderHealthAttempt` writes BOTH trails for every
  attempt: `provider_health` (only real attempts — config states
  `not-configured` / `merchant-missing` are not provider failures)
  and `data_sources.last_sync_*` (success AND failure both stamp a
  timestamp; a failed sync has a timestamp too). The
  `data_sources` row is ensured first via
  `ensureProviderDataSource` (services/data-sources.ts) — the old
  `recordDataSourceSync` updated zero rows when no row existed.
- `getProviderLastSync` returns explicit `neverSynced: true` when
  no writer has ever run — the honest "never synced" state.

The eBay refresh wrapper calls it for every outcome, including the
unexpected-failure catch.

## eBay "configured" copy (F-P2-07)

`services/platform-status.ts`: `describeEbayPlatformStatus` returns
`configured` ONLY when keys + merchants row + EPN/Growth Check
approval are all present (approval is owner-confirmed — no code can
check it). `describeEbayPlatformStatusLive(supabase)` checks the
two code-checkable gates. The sync `describePlatformStatus` eBay
entry now says keys are set but the merchants row + approval are
still unverified, instead of promising live listings.

## Seed fix (F-P2-05)

Migration 003's legacy `providers` seed rows said `EBAY_API_KEY` /
`AMAZON_API_KEY` — var names no code reads. They now say
`EBAY_CLIENT_ID` / `AMAZON_ASSOC_TAG` (the names live code reads).
File-only fix, never re-run the seed; both rows stay `active=false`.

## Honest states (what is still NOT live)

- Match-confidence columns: writer ready, columns need a future
  migration — reads return null until then.
- Migration 061 (`merchant_reliability` table): writer ready,
  table not applied — snapshots report "061 not applied".
- Migration 040 (`price_refresh_runs`): sync score null until
  applied + a refresh runs.
- Migration 055 (`model_number`): the model leg reads best-effort;
  without the column there is no model leg.
- Real listings: 0/20 — the manual-match workflow exists, but no
  admin has attached a real listing yet.
- Review queue: rejections + audit log today; no dedicated
  review-queue table or merge action yet.
