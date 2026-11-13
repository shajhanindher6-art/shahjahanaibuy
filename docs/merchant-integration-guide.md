# Merchant Integration Guide — SmartBuy AI (Section 20)

**Date:** 13 November 2026 (Section 20 build; audit `~/workspace/section20-audit.md` §6–§7)
**Status:** honest statement of which merchant integrations exist, which are
code-built but owner-gated, and which do not exist at all. No integration is
claimed that the code cannot prove. Counts from the Section 20 audit
(13 Nov 2026 ~08:22 PKT); live recheck 2026-11-13 07:02 PKT, 25/25 PASS.

> **The plain truth first:** there is **no authorized merchant price feed live**.
> The catalogue's 10 products carry seeded prices from 2026-11-02, labelled
> "DEMO/placeholder launch prices, not live retailer prices" in the seed file.
> The only fetch path that could ever return a live price is eBay Browse, and
> it is blocked. Everything else on this page is either a link decorator, a
> code-built pipeline waiting on keys, or an explicit non-integration.

## Merchant-by-merchant status

| Merchant / integration | Adapter exists? | Credentials configured? | Ever verified working? |
|---|---|---|---|
| **Amazon** | **No.** Zero hits for PA-API / Product Advertising in `app`, `lib`, `services`. Only affiliate-tag stamping (`services/affiliate-geo.ts:66-69`). Tag decoration only — no price/stock fetch exists. | Tag env set live (`smartbuy-20`, US); approved vs placeholder **UNKNOWN** (Associates dashboard only) | **Never** — there is no API call to succeed or fail |
| **Best Buy** | **No.** No adapter, no env var, no API code — only name mentions. | None — no credential even defined | **Never** |
| **eBay** | **Yes** — `services/ebay-browse.ts` (Browse API, OAuth client-credentials, in-memory token cache, 10 s timeout, 429 → distinct `rate-limited` reason). Lives **outside** the provider registry. | **No** — `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` unset; EPN + Growth Check also owner-gated | **Never** — blocked twice over (keys + missing `merchants` row) |
| **Skimlinks** | **No integration** — only a `buildSkimlinksUrl` helper + env read; format "must be confirmed against the owner's Skimlinks dashboard before enabling". | No — `SKIMLINKS_PUBLISHER_ID` unset | **Never** |
| **Apify** | Yes — `services/providers/apify-provider.ts`, registered in `services/providers/registry.ts:165` | No by design — `isAvailable()` requires `APIFY_API_TOKEN` + `APIFY_ACTOR_ID`; vars must stay unset | N/A — **scraping is banned by standing rule. Apify is NOT an available path. Do not document it as one, do not set the vars, do not build on it.** |
| **CSV provider** | Yes — `services/providers/csv-provider.ts` (`key='csv'`), `isAvailable()` needs csvData/csvUrl | N/A — no source configured | **Never** — exported but **never registered** |
| **Mock provider** | Yes — `services/providers/mock-provider.ts` (hardcoded fake products incl. `amazon`/`bestbuy`/`target`/`aliexpress` slugs) | N/A | N/A (test data) — registered only when `NODE_ENV !== 'production'` |
| **AliExpress / Walmart / Target / Google Shopping / Daraz / PriceOye / Flipkart / Noon** | **No** | None | Never — rejected as integrations (search-links-only by design) |
| **Merchant feeds** | **No ingestion code.** The `price_source` enum includes `'merchant-feed'` but no code anywhere writes it — a dead enum value. No feed contract exists. | — | Never |

## What the `merchants` table actually holds

Exactly **2 rows** (Amazon, Best Buy — seeded rows only). Columns are
`status`/`active`/`commission_rate` only — no trust score, rating, uptime, or
fulfilment columns. **No `ebay` row exists, and no seed, migration, route, or
UI ever creates a `merchants` row.** The "84 stores" directory
(`/stores/[country]/[slug]`) is static search-links, not the `merchants` table.
`data_sources` and `product_sources` have **zero rows** — the data-source config
layer is schema-only.

## Amazon — affiliate tag only

- What exists: affiliate-tag stamping on outbound links
  (`services/affiliate-geo.ts`), base tag from `AMAZON_ASSOC_TAG` for US
  visitors; `AMAZON_ASSOC_TAG_US` is never read by code (silently ignored).
  Tag `smartbuy-20` is verified live via the merchants API; **approved vs
  placeholder is unknown** — only the Amazon Associates dashboard can confirm.
- What does **not** exist: any Amazon price/stock API. PA-API 5.0 is retired;
  the Creators API needs ≥10 qualifying sales in a trailing 30 days. There is
  no adapter to write and no credential to configure until that threshold is met.
- **Do not present Amazon as an integration.** The `/status` label
  `status: 'configured'` for Amazon means only that a tag env var is set
  (`services/platform-status.ts:74-80`). It is a known P0 finding (audit §1 #2)
  to relabel it `tag-only` or gate it on a verified call.

## Best Buy — no adapter, no credential

- What exists: seeded `merchant_products` rows from 2026-11-02 (Best Buy price
  is exactly +2% on every product — synthetic seed values, not observed prices).
- What does **not** exist: an adapter, an env var, an API key, or any verified
  call. The `/status` label `status: 'live'` for Best Buy
  (`services/platform-status.ts:74-80`) means only that seeded rows exist. It
  is a known P0 finding to relabel it `recorded-prices-only`.
- To add Best Buy for real: an adapter + a Best Buy API key (owner-gated) +
  a verified call before any `live` label is shown.

## eBay — code-built, owner-gated (the only real live source)

Components (all in the tree, all code-complete):

- `services/ebay-browse.ts` — Browse API client (OAuth client-credentials,
  in-memory token cache, 10 s timeout, 429 → `rate-limited`, daily cap 4,500
  of the free-tier 5,000).
- `services/ebay-intake.ts` + `app/api/v1/admin/ebay/preview/route.ts` —
  preview → review → approve, fail-closed, never auto-inserts (max 10
  listings/preview; admin must annotate brand + category + slug per listing).
- `services/ebay-refresh.ts` — refresh leg (max 10 due products/run, 5
  listings each, keyword match, upsert into `merchant_products` +
  `data_freshness`; 3 attempts per product, 500 ms/1 s backoff).

**Unblock checklist (all owner steps — no code workaround):**

1. eBay developer account + `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` in Vercel.
2. eBay Partner Network (EPN) + Growth Check.
3. `merchants` row `slug='ebay'` created via SQL (nothing in code creates it;
   without it step 0 returns `merchant-missing` and preview review errors
   "Unknown merchant 'ebay'").
4. Apply migration 045 so the `verified` stamp persists (otherwise an
   eBay-approved row persists no verification stamp, and the refresh upsert
   writes no `price_verification_status`/`price_source` — rows would read
   `unverified`/`manual-intake`).
5. Note: the eBay daily-budget guard fails open when neither Redis nor the DB
   counter (migration 041, unapplied) is available.

**Honest limits even after unblock:** each approved listing is a thin listing —
eBay title as name (keyword-stuffed, admin must rewrite), no GTIN, no specs,
no variants, one hotlinked image, one ephemeral asking price, no price
history, no Deal Score. eBay refresh re-verification is keyword-only and will
mismatch/skip often. "50 verified" is honest only with the label "Live eBay
asking price, checked <timestamp>".

## Skimlinks — not configured

No integration exists — only a URL-building helper and an env read. The
publisher ID is unset. Applying is **owner-gated and must NOT be done without
explicit go-ahead**: rejection blocks reapplying for 90 days. Even configured,
Skimlinks would yield affiliate links, not product records — it adds 0 products
to the "50 verified" count.

## Apify — banned, not a path

Scraping is banned by standing rule, including Apify. The provider code exists
(`services/providers/apify-provider.ts`) but is fail-closed:
`isAvailable()` requires `APIFY_API_TOKEN` + `APIFY_ACTOR_ID`, and those vars
**must stay unset**. Any plan that counts Apify listings as products is
rejected. (Secondary note: the Apify token is sent as a URL query param, which
appears in access logs — it should move to an `Authorization` header if the
provider is ever touched; it is not, because the provider is banned.)

## Merchant feeds — no ingestion code

The `price_source` enum value `'merchant-feed'` is dead: zero ingestion code,
no feed contract, no feed registered. Adding a feed means: a feed contract, an
ingestion implementation, a registered provider, and `product_sources` rows —
plus the merchant's approval. None of that exists today.

## The `/go` hub and affiliate links (what works without any merchant data)

`app/go/route.ts` + `services/affiliate-geo.ts` — affiliate URL transform and
geo stamping need no live merchant data; honest passthrough. `/find` (500
curated queries) and the 84-store directory are affiliate **search links**,
not catalog records — they must never be counted as products.

## How to add a merchant (for a future builder)

1. **Merchant row first.** Insert the `merchants` row (SQL, owner step) — no
   code path creates one. Record the slug exactly as the adapter will use it.
2. **Adapter.** A client in `services/` with timeout, retry/backoff, and a
   distinct rate-limit reason; credentials read server-side only, never in
   client code. Register it in `services/providers/registry.ts` (eBay
   deliberately lives outside the registry — follow the registry pattern for
   new providers, not the eBay exception).
3. **Intake path.** Preview → review → approve, never auto-insert; admin-only
   routes behind `requireAdmin`; audit via `recordAdminAction`.
4. **Verification stamp.** New prices must write `price_verification_status`
   + `price_source` + `price_verified_at` (requires migration 045 applied);
   manual/CSV prices stay `unverified` by definition.
5. **Health + errors.** Call `recordProviderHealth` on every fetch outcome and
   `logApiError` on failures — today exactly one call site exists in the whole
   refresh chain, and `provider_health` is never written live.
6. **Honest status label.** A merchant is `live` only after a verified call
   succeeds; until then the label is `recorded-prices-only` (seeded rows) or
   `tag-only` (affiliate tag, no API). Never label a merchant `live` or
   `configured` from the mere existence of rows or env vars.
7. **Validation.** Validate `imageUrl` (`http(s)` only, reject `data:` /
   `javascript:`, length cap), validate GTIN format/check digit, record
   `currency_id` explicitly (never hardcode USD), and never store a price
   without its currency.

## Pending owner approvals

- eBay keys + EPN/Growth Check + `merchants` row `slug='ebay'` + migration 045.
- Amazon Associates approval check for `smartbuy-20` (dashboard only).
- Skimlinks application — explicit go-ahead required (90-day reapply block).
- Best Buy API key (if a Best Buy adapter is ever built).
- Image-host / hotlink policy decision (hotlinking is current practice; no
  merchant ToS/licence check exists).
- cron-job.org: verify the 6 h refresh job exists/fires (owner dashboard check).
