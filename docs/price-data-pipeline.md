# Price Data Pipeline — SmartBuy AI (Section 20)

**Date:** 13 November 2026 (Section 20 build; audit `~/workspace/section20-audit.md` §7)
**Status:** documentation of the price pipeline as built in Sections 1–19.
The net truth, stated first: **a refresh run today re-records stale DB prices
(last freshness 2026-11-02) and runs the alert/notification machinery on
them. No new price data enters the system through any leg.**

## Price data as it actually is

- **10 products, 40 `price_history` rows, Amazon only** — 4 points per product,
  all relative to 2026-11-02. The 7-day view is already empty (honest empty
  state); the 30-day view has 3 of 4 points. Nothing re-bases them.
- **All 10 prices stale** (11 days; `STALE_PRICE_DAYS = 7`,
  `lib/price-freshness.ts:59`). `data_freshness` = `created_at` =
  `updated_at` = 2026-11-02T07:13:52Z on all 10 rows — a single seed instant,
  never updated since.
- **All 10 prices unverified** (`priceVerificationStatus: unverified`, live API
  2026-11-13 07:02 PKT).
- **Seed honesty:** `seed-demo-data.sql:15-17` labels the prices
  "DEMO/placeholder launch prices, not live retailer prices". Best Buy is
  exactly +2% on every product — synthetic, not observed.
- **`price_history` has no `source` column** — a row cannot be told apart as
  seed/demo vs live vs re-recorded. No suspicious-change flag, no per-row
  verification flag, no UNIQUE constraint live (migration 045 §C, NOT applied).
  The seed itself warns re-running it duplicates rows, and 045's UNIQUE guard
  will refuse if the seed was ever run twice.
- **Currency defect:** refresh hardcodes `currency: 'USD'` on every
  `price_history` insert regardless of `merchant_products.currency_id`; eBay
  upsert stores the listing price as-is with `currency_id` and no FX
  conversion — a non-USD eBay listing amount would later be recorded as "USD".
  `fx-rates.ts` exists but is traced into no ingestion path. `currency_id` is
  NULL on all 20 merchant rows.
- **`'stale'` verification value is dead** — nothing ever writes it; the refresh
  chain only touches the separate `refresh_status` column.

## The refresh chain (what each step actually does)

Route: `POST /api/v1/prices/refresh` (`app/api/v1/prices/refresh/route.ts`),
CRON_SECRET-only (timing-safe, `lib/api/cron-auth.ts:32-57`, fail-closed when
unset), no admin-session fallback. **Exactly one scheduler:** cron-job.org,
every 6 h. Whether the job exists or fires is **maloom nahi** from the repo —
owner-verified only. No `vercel.json` cron, no in-repo scheduler;
`startWorkers()` / `startScheduledJobs()` have zero callers. There is no
12-hour refresh interval anywhere in code and no 6h/12h setting — cadence lives
only in the cron-job.org dashboard + docs. Per-product intervals *are*
code-configured (`services/freshness.ts:28-32`: 15 min / 1 h / 6 h / 24 h / 7 d
by priority). `maxDuration = 60` on 5 of 6 cron routes;
`monitoring/uptime/check` has none (inconsistency, Section 20 item).

Wave structure (`route.ts:1070-1086`):

| Step (wave) | What it actually does today | What it records | What it cannot do |
|---|---|---|---|
| **0. eBay** (Wave A, sequential) | Blocked: `merchant-missing` first, then `not-configured` without keys. Max 10 due products/run, 5 listings each, keyword match, upsert `merchant_products` + `data_freshness` | `ebay` result counts; per-product `refresh_status` / `next_refresh_at` | Fetch anything live without keys **and** the `merchants` row; write `price_history`; score deals; alert on eBay rows |
| **Pipeline** (Wave A) | Always `available: false, reason: 'no-available-provider'` in production (registry empty) — honest skip, never a failure | `pipeline` result (`checked/refreshed/failed/errors`) | Re-fetch any price; it needs a registered provider **and** `product_sources` rows (both zero) |
| **refresh** (Wave B, parallel) | **DB re-read only**: lowest in-stock `merchant_products` row → `price_history` insert **only on change** | `tracked/inserted/unchanged/skippedNoRetailer/skippedNoPrice/failed`, `loadFailed` on source-load error | Introduce any new price — it records the DB back to itself |
| **stock** (Wave B) | Re-reads same rows → `availability_history` snapshots, back-in-stock detection | `tracked/recorded/unchanged/failed/backInStock[]` | Same — no live stock source |
| **alerts / hunts / digest / savedSearches** (Wave C, parallel) | Compare alerts/hunts/digests/saved searches against the just-written (stale) history | Per-step counts; digest only weekly, only if none stored in 7 days | Fire on a real price move that never entered the DB |
| **notifications / guestAlerts** (Wave D, parallel) | Drain queues (Resend/push/webhook; unconfigured providers stay `pending`, never claimed delivered) | `processed/sent/failed` | Deliver via unconfigured providers |
| **guestEmail** (Wave E) | Drain guest queue; **only** `logApiError` call site in the chain (`route.ts:780`) | `pendingNoProvider` counts | Same as above |
| **outcomes** | Resolve due prediction outcomes vs lowest recorded price | `stillPending` counts | Resolve against live prices |
| **Run record** | `tryStartRefreshRun` / `finishRefreshRun` (`services/refresh-run.ts`) | **Nothing live** — migration 040 **NOT applied**, so runs proceed unguarded and unrecorded; `/status` shows "No price refresh run has been recorded yet"; `/admin/refresh-runs` shows the missing-table notice | Prove any run happened, dedupe triggers, or show Last Updated |

**Guard + dedupe:** one-run-at-a-time guard, `REFRESH_RUN_STALE_MS` = 30 min;
in-progress → 200 + `skipped: true, reason: 'run-in-progress'`; stale `running`
row marked `failed`. **Not atomic** (SELECT-then-INSERT race; same-instant
duplicate possible). Migration 052 (unique partial index) **NOT applied**.
Guard fail-open is narrowed to missing-table-only (`42P01` / `PGRST205`); any
other guard read/insert error fails safe — run NOT started, `skipped: true,
reason: 'guard-error'`, still HTTP 200. Live caveat: with 040 unapplied, every
run fails open (unguarded, unrecorded).
**Retry:** none at chain level — a failed step is recorded `failed` and the
chain continues; next chance is the next 6 h run. Only eBay retries per product
(3 attempts, 500 ms/1 s backoff). Per-product re-queue exists:
`markProductRefreshFailed` sets `next_refresh_at` +15 min.
**Stale-product tracking:** `getProductsDueForRefresh` (limit 50,
`refresh_status IN ('idle','failed')`, most overdue first); eBay leg caps at 10
products/run, pipeline at 100/run. Tracked sets capped at 500/1,000 rows per read.

**The freshness-stamp problem:** the `refresh` step moves `data_freshness` /
`next_refresh_at` forward even though it performed no live check. The stamps
say "recorded price re-checked", not "live-checked". Section 20 item: stamp
freshness **only on a live check**, and distinguish re-read vs live-checked in
`data_freshness`. (Related: the refresh route header claims eBay is "the first
LIVE fetch leg" — false live.)

## Data providers (registry truth)

`services/providers/registry.ts:141-167` — in production the registry holds
only Apify (fail-closed, **banned by standing rule** — vars must stay unset)
+ non-prod Mock. Zero `official_api` / `affiliate_feed` providers exist;
`getAvailable()` is empty and `getPreferred()` returns `undefined` in prod.
`CsvProvider` exists but is **never registered**. `data_sources` and
`product_sources` have zero rows. Amazon has no adapter; Best Buy has no
adapter. eBay Browse lives **outside** the registry and is the only fetch path
that could ever mark a price verified — doubly blocked (keys + `merchants` row).

Provider health: `recordProviderHealth` exists with a circuit breaker, but
exactly one live caller can never fire in production (needs an available
provider); the eBay adapter never reports health; `provider_health` is never
written live.

## Alert and downstream behaviour on stale data (known defects)

- **Price alerts fire on stale prices with "is now $Y!" wording.**
  `getCurrentPrices` selects `recorded_at` then drops it; `price_drop` /
  `price_below` / `back_in_stock` triggers never check freshness
  (`services/alert-checker.ts`). All 10 live prices are 11 days stale, so a
  "price drop" alert today announces an 11-day-old seed price as current.
- **Discounts from unobserved list prices:** `discountPercent` =
  `compare_at_price` vs price (`lib/deal-math.ts:45-51`); `compare_at_price`
  is a seeded list price identical across merchants. `/deals` self-documents:
  "Ranking does not check the claimed discount against recorded price history."
- **Abnormal-change detection is display-only, never ingestion:**
  trust-signals / fake-sale / inflation-check are pure functions called only
  from product-page components and the `/deals` Featured gate;
  `refreshTrackedPrices` inserts any changed price with no spike/fake-sale
  check, and there is no column to store a flag anyway.
- **Forecast has no stale/fresh concept at all** — ranges fitted to 11-day-old
  points are served as current; buy-wait qualifies stale prices in its reason,
  forecast does not.

## Error logging and observability gaps

- `logApiError` is wired in the merchants routes, but in the entire refresh
  chain there is exactly **one** call site (per-alert catch in
  `checkGuestEmailAlerts`, `route.ts:780`). `ebay-browse.ts`,
  `ebay-refresh.ts`, `pipeline-refresh.ts`, `price-refresh.ts`,
  `refresh-run.ts` use `logger.warn` only.
- `error_log` storage needs migration 048 (NOT applied).
- Integration failures therefore never reach `error_log`; refresh-run rows do
  not exist live (040 unapplied); `/admin/refresh-runs` is read-only and shows
  the missing-table notice.
- **No manual refresh trigger exists in the UI.** `POST /api/v1/data/refresh`
  is admin-only but only enqueues a `product.fetch` job that does nothing real
  without a provider.

## Related endpoints

- `POST /api/v1/prices/refresh` — the chain above (CRON_SECRET).
- `POST /api/v1/data/refresh` — admin-only job enqueue (no real effect without
  a provider).
- `POST /api/v1/alerts/check`, `POST /api/v1/notifications/digest`,
  `POST /api/v1/notifications/process`, `POST /api/v1/predictions/outcomes`,
  `POST /api/v1/monitoring/uptime/check` — the other five CRON_SECRET cron
  routes (all timing-safe; `uptime/check` and `predictions/outcomes`
  additionally accept an admin session as fallback, by design).
- `GET /api/v1/products` — 10 products, all unverified, stale since 2026-11-02.
- `/tools/catalog-freshness` — stale-price surfacing tool (3-state freshness).

## eBay live checks and price history — deliberate design decision (Final 100%, F-P2-19)

The eBay refresh leg (`services/ebay-refresh.ts`) writes **no `price_history` row** for a live check, by deliberate design: a single snapshot of an ephemeral asking price is not a history. The live check upserts the `merchant_products` row and moves `data_freshness` + the verified stamp — but trend, forecast, and deal validation read `price_history` only, so they never see the live eBay price directly.

Consequence: a live eBay price reaches history-based features **one refresh later**, when `refreshTrackedPrices` re-reads the recorded `merchant_products` row and inserts a history row on change. Until then the live price is visible on the product page ("Live eBay asking price, checked \<timestamp\>") and nowhere else.

**Open owner/design decision (not decided here, and the write behaviour must not change silently):** record each eBay snapshot as a history point (`source: 'ebay-browse-api'`) so history-based features see live checks immediately, or accept the one-refresh delay. The decision is surfaced in code (`EBAY_PRICE_HISTORY_NOTE`, on every `EbayRefreshResult` and therefore every refresh-run response) and here — not hidden.

## Pending owner approvals

- eBay keys + EPN/Growth Check + `merchants` row `slug='ebay'` + migration 045
  (the only path to a live price entering the system).
- Apply migrations 040 (refresh runs recorded/guarded), 052 (atomic guard),
  048 (`error_log` storage), 032 (prediction-outcome storage).
- cron-job.org: verify the 6 h refresh job + 5-min uptime job exist/fire.
- Decide the fate of the unscheduled cron endpoints (`alerts/check`,
  `predictions/outcomes` — no decision recorded).
