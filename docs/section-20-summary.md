# Section 20 Summary — Verified Product Data Intelligence & Automated Catalog Expansion

**Started:** 13 November 2026, 08:20 PKT
**Goal:** `smartbuy-section-20-verified-product-data-intelligence-automated-catalog-expansion`
**Status:** BUILD COMPLETE — gate passed (see Verification gate below).
**Pushed:** 13 November 2026 ~09:57 PKT — 3 commits, 134 files, HEAD
`81505fd8` (user approval "Push kardo (134 files)" 09:56 PKT).
**Live recheck:** 13 November 2026 ~10:17 PKT — 29/29 PASS, SECTION 20 FULLY
LIVE. Press counts below are the re-locked final numbers.
**Docs:** `docs/product-data-architecture.md`,
`docs/merchant-integration-guide.md`, `docs/product-verification-policy.md`,
`docs/catalog-quality-report.md`, `docs/price-data-pipeline.md`, this file.

> Section 20 is a data-intelligence section, not a page-building section. Its
> honest headline (audit §13): the code delta is large (54 buildable items)
> but the *data* delta is almost entirely owner-gated. No amount of code adds
> a verified product today; the only live source is eBay after owner unblocks,
> and even then only as thin listings. The build leads with the P0 honesty
> fixes — they are the only items that change what users see without an owner
> step.

## Scope (16 areas, per the brief)

1. Catalog audit — 2. Verified data pipeline — 3. Catalog expansion (10 → 50+
   verified products, a target, not permission for fake records) — 4. Spec
   engine — 5. Image management — 6. GTIN identity — 7. Price data foundation
   — 8. Price history & quality — 9. Merchant integration layer — 10.
   Automated refresh (6 h / 12 h) — 11. Data quality scoring — 12. Admin
   catalog management — 13. AI engine integration — 14. Security & compliance
   — 15. Testing — 16. Documentation.

Strict rules carried over: preserve Sections 1–19; audit first, build only the
delta; never fake data/prices/images/reviews/GTINs; never activate unapproved
merchant integrations; never bypass provider restrictions; no auto-apply
migrations; minimal targeted changes; gate before push. Standing rules: free
tiers only, no scraping (including Apify — banned), Stripe TEST, never apply
migration 035 without separate explicit review, never apply production
migrations without explicit approval.

## Audit totals

Audit (`~/workspace/section20-audit.md`, §12, 13 Nov 2026 ~08:31 PKT):
**111 items — 54 BUILDABLE, 21 OWNER-GATED, 8 REJECTED, 28 ALREADY DONE.**
Audit baseline (re-verified 13 Nov 2026 ~08:22 PKT): tsc 0; vitest **286 files /
3,425 tests passed, 4 skipped, 0 failed**; a11y 31/31; lint 0 errors, 0 warnings;
clean build 802 pages (Section 19 gate); press 3,425/286; i18n 167 keys, 20
languages; API routes 187 files / 253 handlers; migrations 52 files, 18 DO NOT
APPLY (035–043, 045, 047–054).

## The five P0 findings (all user-visible wrong claims — fix first)

1. Assistant calls prices "verified" while the API says all 10 are unverified.
2. `/status` labels Best Buy `'live'` and Amazon `'configured'` with no
   integration behind either.
3. Price alerts fire on stale prices with "is now $Y!" wording.
4. "X% off" badges computed from a list price that was never observed.
5. "Confidence Score 50%" shown as a measured score and fed into scoring —
   it is a field-presence count floored at 50.

## Catalogue truth the section starts from

10 products; images 0/10, GTINs 0/10, specs 0/10, reviews 0/10, variants 0/10,
fresh prices 0/10, verified prices 0/10; 40 price-history rows, Amazon only;
2 merchants, seeded rows only; prices stale since 2026-11-02. Full per-product
table and the honest 50-product assessment:
`docs/catalog-quality-report.md`.

## Honest 50-product assessment (audit §6)

- **Today, no owner action: 10 → 10 verified (0 added).** Nothing in code can
  add a verified product without keys.
- **After the eBay unblock only** (keys + EPN/Growth Check + `merchants` row
  `slug='ebay'` + migration 045): **10 → 50 reachable, but only as thin
  hand-annotated eBay listings** (no GTIN/specs/variants/history).
- **50 FULLY-verified** (specs + GTIN + images + history) is **NOT reachable in
  Section 20 by any path**.
- If eBay stays unavailable, the shortfall is the full 40.

## What was built

- **P0 honesty fixes (audit §12 #51, #82, #81, #40, #67, #46, #83, #84; #45 documented as deferred):** `/status` now says Best Buy `recorded-prices-only` and Amazon `tag-only`; AI inputs carry a typed `AIEngineInput` with `priceVerificationStatus` + `dataFreshness`, and `verifiedDataLabel` is appended only when every product is verified AND fresh; price alerts are gated on `STALE_PRICE_DAYS = 7` (stale prices never fire "is now $Y!"); discounts are labelled "vs list price" until an observed pre-rise price exists; the 50-floor on `confidence_score` is removed and the score is decoupled from Deal Score (×0.3 term now documented as prediction confidence), AI deal ranking (+10 removed) and recommendations — public label is now "Data completeness"; forecast and buy-wait minimums unified at 5 points; AI copy residuals fixed ("From established brand" pro removed, attributes are facts not pros, cold-user recs say so, "popular with other shoppers" only when `view_count > 0`, `dealsAssistant` validates `discount_value`, "full specs" → "recorded specifications"); forecast/buy-wait carry "last recorded N days ago" staleness labels; `track_price` redefined (near-low on a 5–11-point low-confidence history, confidence ≤ 45%, no rising trend) after the 5-point minimum made its old ≤ 4-point trigger unreachable. Deal Score formula untouched by design (rebase deferred until real varied history exists).
- **Pipeline gates + validation + schema (#26, #31, #32, #94, #28, #29, #39, #44, #41, #7, #43, #42):** minimum-confidence gate (30) + price-0 rejection + born-`pending` on pipeline ingest; GS1 GTIN check-digit validation (`lib/gtin.ts`) wired into intake + pipeline; image_url validation (`lib/image-url.ts`, http(s) only, `data:`/`javascript:` rejected) at intake + eBay intake; category spec templates (`lib/spec-templates.ts`, laptop/phone/tablet key lists as data); per-spec attribution columns (migration 058, writer 42703-safe — PARTIAL: no production spec-write path exists to wire attribution through, see below); `price_history.source` + `observed_at` + `suspicious_change` (migration 057, seed rows labelled `source='seed'`); history-coverage + per-source reliability wired into `getAdminDataQualitySummary`; currency recorded from each row's `currency_id` (explicit USD default, no silent FX); freshness stamped only on a live check (`markProductRefreshed` vs `markProductRechecked`); spike/fake-sale/inflation checks now run at ingestion and store the flag.
- **Quality score + admin UI (#66, #68, #69, #70, #71, #56, #85):** transparent 7-dimension Product Data Quality Score (`services/product-quality-score.ts`, no floor, with breakdown + missing fields); verified→stale transition in the refresh chain; `/admin/products` list/edit/delete (soft delete only) + review views (duplicates via `findDuplicateCandidates`, missing specs, image status, price history) + ingestion-failure view; manual refresh trigger with admin-session fallback; `/admin/ai` data-quality panel (freshness, coverage, verification distribution).
- **Merchant layer, code side (#25, #58, #57, #52, #53, #95, #96, #97, #98, #99, #38, #54, #55):** eBay refresh stamps `verified` / `ebay-browse-api` / `price_verified_at` (fail-safe when 045 is absent); CSV provider registered (env-gated, fail-closed); Amazon/Best Buy fail-closed adapter scaffolding (no PA-API client — retired; Creators-API-ready stub, `isAvailable()` false); `recordProviderHealth` wired (eBay + registry providers); `logApiError` wired into ebay-browse, ebay-refresh, pipeline-refresh, refresh-run AND price-refresh (6 sites, added at gate time); `/scan` Lens path + generic-webhook POST now reuse the Section 18 SSRF guard (send time AND registration time); QA PATCH + `data/refresh` + intake approve all audit via `recordAdminAction`; Apify token moved to `Authorization` header (still fail-closed/banned); refresh header no longer claims eBay is live; migration 052 header fixed; `uptime/check` has `maxDuration = 60`.
- **Catalog surfaces (#6, #8, #9, #10, #11, #21):** `model_number` field (migration 055, types + intake + API output; values 0/10 — field exists, never guessed); variants wired into the `[slug]` API + detail page (selector renders only when variants exist; 0 rows today); dedupe extended (GTIN → exact name+brand → fuzzy ≥ 0.75) + exported `findDuplicateCandidates` retroactive sweep; same-GTIN-different-slug no longer passes intake as valid; merchant reliability score derived from refresh-run/sync history ("insufficient data" when 040 is unapplied); seed inserts made idempotent (`NOT EXISTS` / `ON CONFLICT` — seed NOT re-run); CSV intake labelled unverified-only ("does not count toward the 50 verified").
- **Tests (#104, #105 + coverage):** pipeline-unit tests (57), CSV/Mock provider tests (30), GTIN/image/quality-score/freshness tests (45), stale-alert-gate tests (20, new), P0 honesty tests (25, new), admin-catalog tests (37), catalog-surfaces tests (46), merchant-layer tests (31), pipeline-validation tests (47). Gate-fix work: 51 old tests updated to the intended Section 20 behaviour (min-5 fixtures, new honest copy, scores −10 from the removed confidence term) + 2 genuine code fixes found while gating (personal-assistant 1–4-point copy; buy-wait alternative matching on bare token "13").
- **Documentation (audit §12 #103, #106):** the five Section 20 docs listed above, plus this summary draft; stale-number fixes in `project-summary.md` (Section 19 live recheck 2026-11-13 07:02 PKT, 25/25 PASS; table/policy counts re-locked to the statement-start method, 122 tables / 617 policies; DO NOT APPLY count corrected 17 → 22 with Section 20's 055–058) and `docs/section-19-summary.md` (correct baseline 254 files / 3,066 tests, S19 delta +32 files / +359 tests); `docs/openapi.json` + `API_DOCUMENTATION.md` re-locked to 190 routes / 258 handlers (3 new admin routes: data-quality, products, products/{id}).

## Accepted deviations / partial items

- **Gate fix — client-bundle boundary (build failure, not a deviation):** the first clean build failed with `UnhandledSchemeError: node:net` — the #99 CSV hardening (csv-provider → visual-search SSRF guard → `node:dns`/`node:net`) reached the browser bundle because `price-verification.ts` imported two string constants from the server-only intake modules and is itself imported by the client component `product-card.tsx`. Fixed by moving the constants into the zero-import leaf module `lib/intake-sources.ts` (intake modules re-export them; #99 hardening preserved). Pinned by `tests/section20-client-bundle-boundary.test.ts` (6 tests).
- **#29 PARTIAL — per-spec attribution:** migration 058 + the attributed writer (`buildProductAttributeRow` / `insertProductAttributes`, 42703-safe) exist, but no production spec-write path exists to wire attribution through: no code anywhere inserts `product_attributes` rows, the intake schema has no spec fields, and no admin spec UI exists. Wiring it would mean inventing a spec input path — out of scope. Needs spec input/UI work first.
- **#45 — Deal Score rebase deferred (documented):** the formula still yields 100/100 on the live 4-point flat series; re-basing is deferred until real varied history exists. Never manufacture spread from 4 flat points. The score stays withheld below 5 points everywhere.
- **#83 copy + "Data completeness" relabel have no direct unit tests:** the copy lives in unexported template functions and TSX; verified by direct read, with the surrounding pure helpers pinned in tests. Testing them would need DB-backed service calls — flagged, not faked.
- **Live verification owner-gated (not fails):** admin login, real rows in the new admin pages, manual refresh button firing, `/admin/ai` panel rendering, SSRF fix live behaviour, eBay stamp (needs keys + 045).

## Verification gate (Section 20)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| Full `npx vitest run` | **296 files / 3,773 tests passed, 4 skipped (3,777 total), 0 failed** (baseline 286 / 3,425 → +10 files, +348 tests) |
| `npm run test:a11y` | **31/31 (5 files)** |
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run check:press-counts` | **OK — 3,773 tests / 296 files, 2026-11-13** |
| Clean build | **exit 0 — 805 pages** (baseline 802 → +3 new admin pages); `/products/[slug]` First Load **338 kB** ≤ 350 kB ✓; `/methodology` 306 kB |
| API routes | **190 files / 258 handlers** (baseline 187 / 253 → +3 files, +5 handlers) |
| Migrations | **56 files, 22 DO NOT APPLY** (baseline 52, 18 → +4 files 055–058, all NOT applied) |
| i18n | **167 keys** (unchanged — no new DictKeys added) |

## What is still data-blocked (not a code gap)

- Verified products: 0 new without eBay unblock (keys + EPN/Growth Check +
  `merchants` row + 045).
- Images / GTINs / specs / reviews / variants: 0 for every product; no source
  in the tree can supply them.
- Prices still stale (2026-11-02) until a live feed exists; refresh re-reads
  the DB only.
- Prediction-outcome storage needs migration 032; `error_log` storage needs
  048; refresh-run recording needs 040; atomic guard needs 052.

## Owner-gated remainder (unchanged in kind)

- Applying migrations 026–054 in order (035 only after separate explicit
  review; 044 is the single remaining step for Section 16).
- eBay keys + EPN/Growth Check + `merchants` row `slug='ebay'`.
- Amazon Associates approval check for `smartbuy-20`; Skimlinks application
  (do NOT apply without explicit go-ahead — rejection blocks reapplying 90 days).
- `RESEND_API_KEY` + VAPID; `CRON_SECRET` verification (cron-job.org jobs
  exist/fire); live admin login; live `price_history` row-count verification.
- Image-host / hotlink policy decision; digest-switch scope decision.
- RLS execution against real Postgres (`S18_RLS_DATABASE_URL` + `pg` + CI).
