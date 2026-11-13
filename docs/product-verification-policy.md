# Product Verification Policy — SmartBuy AI (Section 20)

**Date:** 13 November 2026 (Section 20 build; audit `~/workspace/section20-audit.md` §1, §2, §6)
**Status:** the policy as implemented in code (Sections 1–19) plus the gaps the
audit found. Where code and user-facing copy disagree, this document states
the code truth and names the copy as a known defect — it does not bless the copy.

## Definition: what "verified" means

"Verified" has a precise meaning in code: a price is only ever called verified
when a **real fetch checked it** (`services/price-verification.ts:12-16`).
A price that was typed in by a human, copied from a seed file, or re-read from
the database is **not** verified, however recent it looks.

**Current state (live API, 2026-11-13 07:02 PKT recheck): all 10 products are
`priceVerificationStatus: unverified`.** Zero products are verified. Zero
prices are fresh (all 11 days stale, threshold 7 days).

## The verification enum

`services/price-verification.ts:22-30` — `unverified` / `verified` / `stale`.

| Value | Meaning in code | Who writes it today |
|---|---|---|
| `unverified` | No live fetch has ever checked this price. The default for every product. | Everything (default; CSV intake; eBay refresh upsert by omission) |
| `verified` | A real fetch checked this price at `price_verified_at`. | **Nobody live.** Only the eBay Browse path is designed to write it, and eBay is doubly blocked (no keys, no `merchants` row). |
| `stale` | A previously verified price aged past the threshold. | **Nobody — the value is dead.** The refresh chain never flips verified → stale; it only touches the separate `refresh_status` column. A November-verified price would read "Verified" forever. Writing the transition is a Section 20 build item. |

The columns that persist this status (`price_verification_status`,
`price_verified_at`, published/status columns) exist only in migration 045 —
**written, NOT applied**. Live, the columns do not exist: all 10 products are
"published" by fail-open default (`services/price-verification.ts:50-54`,
`services/products.ts:115-130`), not by approval, and an eBay-approved row
currently persists no verification stamp.

## Source rules (what counts as verification)

| Source | Price status it may produce | Rule |
|---|---|---|
| **eBay Browse API** (live fetch) | `verified`, stamped with `price_source = 'ebay-browse-api'` + `price_verified_at` | The **only** fetch path that qualifies. Requires keys + `merchants` row `slug='ebay'` + migration 045. |
| **Manual CSV intake** (admin-typed) | `unverified` **by definition** | Data must be hand-typed from real retailer/manufacturer pages. No spec/variant/model fields exist in the intake schema. Unlimited unverified rows (max 1,000/batch) — they never count toward "verified". |
| **Seed / demo data** | `unverified` | The seed labels its prices "DEMO/placeholder launch prices, not live retailer prices". Never re-run the full seed (it duplicates `price_history`/`deals`/`cashback` rows). |
| **Amazon / Best Buy** | `unverified` | No adapter, no fetch, no verified call exists for either. Seeded rows only. |
| **Skimlinks / merchant feeds / Apify** | Nothing | No integration / no ingestion code / scraping banned. Apify vars must stay unset. |
| **Database re-read (refresh chain)** | Must **not** change status | The refresh chain re-reads `merchant_products` and re-stamps `data_freshness` forward with no live check. A re-read is not a verification and must never flip a price to `verified` or refresh its `price_verified_at`. |

## Published status (separate from verification)

- Code path (045): intake approve inserts born `pending`; the publish flip
  happens only after the listing exists; rollback-delete on publish failure;
  legacy fallback when 045 is unapplied.
- Live reality (045 unapplied): there is **no live row anywhere with `pending`
  or `rejected` status**, and no way to unpublish a product through the live DB
  today except deleting it. "Published 10/10" in the catalogue report means
  "visible by fail-open default", not "approved".
- Policy: a product must never be presented as "approved/published by review"
  while 045 is unapplied. The honest label is "listed (approval status not
  recorded)".

## What users must be told (and what is currently wrong)

These are P0 audit findings — the copy is wrong today and the fixes are
Section 20 build items, not wording preferences:

1. **Assistant calls prices "verified" while the API says all 10 are
   unverified.** `verifiedDataLabel` is appended to every non-apology chat
   answer, including stale-price and merchant-claim answers
   (`services/ai-summary.ts`, `services/personal-assistant.ts`).
   `priceVerificationStatus` has zero hits in any AI service, and AI
   `mapProductRow`s never populate it (`types/index.ts:121`). **Rule: no AI
   surface may print "verified price" unless the row's
   `priceVerificationStatus` is `verified` and fresh.**
2. **`/status` labels Best Buy `'live'` and Amazon `'configured'` with no
   integration behind either** (`services/platform-status.ts:74-80`).
   **Rule: `live` requires a verified call; `configured` requires a working
   integration, not an env var.** Until then: `recorded-prices-only` /
   `tag-only`.
3. **"X% off" badges are computed from a list price that was never observed.**
   `discountPercent` = `compare_at_price` vs price, and `compare_at_price` is
   a seeded list price identical across merchants. `/deals` self-documents:
   "Ranking does not check the claimed discount against recorded price
   history." **Rule: label discounts "vs list price" until an observed
   pre-rise price exists.**
4. **"Confidence Score 50%" is a field-presence count floored at 50, not a
   measurement** (`services/pipeline/normalization.ts:45-56`). It feeds the
   Deal Score (× 0.3), AI deal ranking, and recommendations. **Rule: never
   present it as a measured quality score; decouple it from scoring or relabel
   it as a completeness count.**
5. **Price alerts fire on stale prices with "is now $Y!" wording.**
   `getCurrentPrices` selects `recorded_at` then drops it; triggers never
   check freshness. **Rule: an alert must carry the recorded timestamp and
   must not announce an 11-day-old seed price as current.**

## Intake and approval rules

- CSV intake: preview → review → approve, never auto-insert; merchant must
  already exist; admin-only (`requireAdmin`); prices labelled manual, not live.
- eBay intake: preview → review → approve, never auto-insert; ≤10
  listings/preview; admin annotates brand + category + slug per listing.
- Pipeline ingest (code): only `externalId`, `retailerSlug`, `name`,
  `price ≥ 0`, 3-letter `currency`, `availability` are required; brand/category/
  GTIN/images/description/URL all optional; **no minimum-confidence gate** —
  a score-15 product (name only, price 0) passes and is inserted with no
  `status`/`price_verification_status` write. Inert today (no provider in
  production), but the gate is absent, not present. **Rule: no ingest path may
  insert a product as `verified` or `published` by default.**
- Deduplication: pipeline is GTIN → slug only (no name/brand or fuzzy check);
  intake is exact slug + exact normalized name+brand. Same GTIN + different
  slug passes intake as `valid`. There is no DB UNIQUE on GTIN and no
  uncertain-match review queue.
- GTIN: zod `.max(50)` only, intake passes it verbatim — no check-digit/format
  validation anywhere. **Rule: a GTIN must never be displayed as verified
  identity until a format/check-digit validator exists.**
- Images: `imageUrl` passes intake untouched and is rendered raw in `<img>`.
  **Rule: review-time validation is required** (`http(s)` only, reject `data:`/
  `javascript:`, length cap) before any image URL is treated as trusted.
- Audit: intake approve must go through `recordAdminAction` (uniform schema/IP
  capture). Today it bypasses the helper with a direct insert; QA PATCH and
  `data/refresh` have no audit row at all.

## Freshness rules

- `STALE_PRICE_DAYS = 7` (`lib/price-freshness.ts:59`). Freshness is 3-state
  (fresh / stale / unknown) and is surfaced on `/tools/catalog-freshness`, on
  detail pages, and as a verdict qualifier.
- A verified price that ages past the threshold must become `stale` — the
  transition does not exist yet (see enum table).
- Forecast and buy-wait verdicts must carry a staleness label; ranges fitted
  to 11-day-old points are served as current today (forecast has no
  stale/fresh concept at all).
- "Lowest recorded price" is true of the recorded rows, but those rows are
  demo seed values — the "lowest" ($999 MacBook) is the seed base price, not a
  market low. Never present it as a market low.

## Owner-gated items this policy depends on

- Apply migration 045 (verification + published columns, `price_history`
  UNIQUE). Until then no verification stamp can persist.
- Apply migration 032 (prediction-outcome storage — recorder + resolver are
  wired, storage is dead; resolved outcomes live = 0 by construction).
- eBay keys + EPN/Growth Check + `merchants` row `slug='ebay'`.
- Verify `pg_policies` for 017 (amended admin-audit-log policies) — the audit
  log is almost certainly still tamperable live.
- Live-verify the intake approve path against the live DB (wired in code,
  never proven live).
