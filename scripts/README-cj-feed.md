# CJ Affiliate feed — importer & SFTP fetcher

Streaming import of the CJ Affiliate (DHGate) product feed into
`public.merchant_offers` (migration
`supabase/migrations/20261121_cj_affiliate_offers.sql`).

## Status (2026-11-22)

- DHGate (CJ 3992613) is APPROVED; Product Export subscription
  Id 325295 exists (Shopping Google Format CSV, Daily, CJ SFTP,
  ~1,118,904 records). The first daily export HAS run — Last Export
  Date 21 Nov 2026, "Exported 1,118,904 Records"; the exact remote
  file is `DHGate-shopping-20261121.zip`.
- SFTP credentials were emailed by CJ (datatransfer@cj.com): host
  `transfer.cj.com`, username `8130731`, password in the email.
  CJ updated the password on 21 Nov 2026 17:04 PKT ("New CJ Affiliate
  CJ SFTP Server Credentials") — use the LATEST email, not the 16:01
  one. Do NOT reset the password in the CJ dashboard unless the
  emailed password is lost (resetting invalidates it).
- Outbound SSH is turned off in this sandbox runtime (the egress
  proxy resets the SSH handshake before auth), so the fetcher fails
  with "Connection lost before handshake" here until SSH is allowed
  in the runtime's network permissions. The download itself is
  otherwise ready: `~/workspace/cj-sftp-download-from-email.mjs`
  reads the password from Gmail at runtime (never prints it) and
  runs the fetcher in `--no-import` mode.
- The CJ Publisher Service Agreement (PSA) is still UNREAD, so
  `CJ_PSA_APPROVED` stays `false` and every imported row stays
  `is_public_live = false` (invisible to the public site).
- No live DHGate product has been seen yet. The only verified
  feed data is CJ's own sample Shopping CSV
  (`tests/fixtures/cj-sample-shopping.csv`).

## Test locally with the sample CSV first

The sample is CJ's own Shopping CSV (7 data rows, UPPERCASE
headers). The importer normalizes headers case-insensitively,
so the same code handles the lowercase DHGate feed.

```bash
# 1. Dry run — parse + filter only, no database writes.
#    Expect: processed=7 accepted=6 skipped=1 (1 out of stock).
npm run import:cj-feed -- --file tests/fixtures/cj-sample-shopping.csv --dry-run

# 2. Dry run, GTIN-only — expect accepted=4 (the 4 rows with a
#    GS1-valid GTIN), skipped=3.
npm run import:cj-feed -- --file tests/fixtures/cj-sample-shopping.csv --dry-run --only-with-gtin

# 3. Dry run with a limit — expect accepted=2.
npm run import:cj-feed -- --file tests/fixtures/cj-sample-shopping.csv --dry-run --limit 2

# 4. Live import (needs the migration applied + SUPABASE_SERVICE_ROLE_KEY set).
#    Do NOT run this against production until the migration is applied
#    by the owner and CJ_PSA_APPROVED is deliberately left false.
npm run import:cj-feed -- --file tests/fixtures/cj-sample-shopping.csv
```

The importer also accepts a `.zip` (the real feed format):

```bash
npm run import:cj-feed -- --file ./tmp/feeds/DHGate-shopping-20261121.zip
```

## Full feed (owner steps first)

1. Apply the migration in the Supabase dashboard SQL editor
   (owner step — one file, after the 035–058 backlog clears).
2. Set `SUPABASE_SERVICE_ROLE_KEY` in the environment.
3. Fetch the feed (password from CJ's latest SFTP email —
   21 Nov 2026 17:04 PKT — stored in Vercel only; do NOT reset it):
   `npm run fetch:cj-sftp` — downloads the latest
   `DHGate-shopping-*.zip` into `./tmp/feeds/` and runs the
   importer. Use `--no-import` to download only.
4. Keep `CJ_PSA_APPROVED=false` until the PSA display rules
   are read and verified. Only then may rows go public.

## How it works

- `scripts/import-cj-feed.ts` streams the file through
  unzipper + csv-parse; only one 500-row batch is held in
  memory (target < 256 MB for 1.1M+ rows).
- `lib/offers/cj-feed-transform.ts` holds the pure transform:
  header normalization, price/GTIN/availability normalization,
  and the filter rules, in this order (same order as the GraphQL
  mapper, so the two importers agree on what a storable offer
  is): id present → title present → in stock → price parses and
  is > 0 → valid image URL → (only-with-gtin) valid GTIN →
  valid affiliate URL. A row with no title or no working
  click-through link is skipped, never stored half-usable
  (added 2026-11-22; the analyzer's invalidAffiliateUrls metric
  uses the same validity bar).
- `scripts/fetch-cj-sftp.ts` connects with ssh2-sftp-client
  using env vars only (never hardcoded). Reliability (2026-11-22):
  30s connect timeout, up to 3 attempts for transient network
  errors only (auth/config errors are never retried), the
  downloaded file's size is verified against the SFTP listing,
  and a clear warning is printed before any live import runs.
  Pure helpers (`pickLatestFeedFile`, `verifyDownloadedSize`,
  `isTransientSftpError`) are unit-tested in
  `tests/fetch-cj-sftp.test.ts`.
- `lib/offers/comparePrices.ts` compares live offers for one
  GTIN (or MPN + brand), cheapest first, with exact savings.

## GraphQL Product Search (official API, 2026-11-22)

The second import path — CJ's official Product Search API
(`POST https://ads.api.cj.com/query`, Bearer Personal Access
Token). It is built, tested, and NOT yet run live: the PAT copy
is unconfirmed and the PSA gate is closed, so the first live
call is still blocked (see below).

- `lib/offers/cj-graphql.ts` — pure client (no DB, no CLI):
  query builder (arguments as GraphQL variables), transport
  (30s timeout, 401/403 → auth, 429 → rate_limited with
  Retry-After, 5xx → retry), pagination (offset mode ≤ 10,000,
  page-token mode above, repeated-ID stop, maxPages/maxTotal
  guards), conservative throttle (≥ 1s between calls — the
  query-side limit is UNKNOWN in CJ's docs), and the mapper
  `toMerchantOfferRow` reusing the CSV normalizers
  (`parseFeedPrice`, `normalizeAvailability`,
  `normalizeGtinValue`, `isValidImageUrl`) with the same skip
  order plus `missing-title` and `missing-url`. The two importers
  now enforce the same bar: since 2026-11-22 the CSV transform
  also skips `missing-title` and `invalid-affiliate-url`, and the
  GraphQL `missing-url` check covers a malformed URL, not just an
  empty one — a row with no title or no working click-through is
  skipped on either path.
- `scripts/import-cj-graphql.ts` — CLI entry
  (`npm run import:cj-graphql`): `--gtin`, `--advertiser-id`
  (default 3992613), `--limit`, `--only-with-gtin`, `--dry-run`,
  `--page-size`, `--probe`. `--probe` makes ONE call (limit 1)
  and prints the result — run it first to learn the real rate
  limit and confirm the response shape before any bulk run.
- `lib/offers/cj-upsert.ts` — shared 500-row batch upsert used
  by BOTH the CSV and GraphQL importers, so the two paths
  cannot drift apart.
- `scripts/analyze-cj-feed.ts` — READ-ONLY analysis
  (`npm run analyze:cj-feed`): streams a feed file and reports
  real metrics (total/accepted/rejected, GTIN + MPN coverage,
  duplicates, invalid prices, missing identifiers/images/
  descriptions, currency + category distribution, URL validity,
  feed freshness, parse errors). No database writes, ever.
  Category distribution prefers the human-readable
  `google_product_category_name` when present — note the
  importer stores the numeric `google_product_category` ID as
  `category` (pre-existing; the real DHGate values are unknown
  until the first real file arrives).
- Tests: `tests/cj-graphql.test.ts` (19 tests, mocked fetch)
  + fixtures `tests/fixtures/cj-graphql-shopping-page-*.json`.

Blockers for the first live call: (1) the PAT — created
21 Nov 2026, owner copy unconfirmed; if lost, delete + recreate
in the Developer Portal; (2) `CJ_PSA_APPROVED` stays false;
(3) the PID for `linkCode()` is unknown — without it,
`affiliate_url` falls back to the plain `link` field.

## API & endpoint surface (CJ-related)

| Surface | What it does | State |
| --- | --- | --- |
| `POST /api/retailers/sync` | Admin-only, on-demand retailer sync REPORT (no writes) | Live since Retailers Delta; CJ is registered as a provider key |
| `POST /api/v1/prices/refresh` | Price refresh (cron-job.org, every 6h, Bearer CRON_SECRET) — the ONE scheduler | Live; CJ rows are not refreshed by it (feed import is the CJ path) |
| `scripts/fetch-cj-sftp.ts` (`npm run fetch:cj-sftp`) | Downloads the daily DHGate ZIP from transfer.cj.com (30s timeout, 3 transient retries, size check) | Built; download BLOCKED on runtime SSH permission |
| `scripts/import-cj-feed.ts` (`npm run import:cj-feed`) | Streaming CSV → `merchant_offers` upsert (500-row batches) | Built; `--dry-run` only until the migration is applied + PSA approved |
| `scripts/import-cj-graphql.ts` (`npm run import:cj-graphql`) | GraphQL Product Search → same upsert path; `--probe` fails closed without a PAT | Built; live use BLOCKED on the PAT |
| `scripts/analyze-cj-feed.ts` (`npm run analyze:cj-feed`) | Read-only feed analysis (coverage, duplicates, invalid prices/URLs) | Built; no file to analyze yet |
| `lib/offers/comparePrices.ts` | Cheapest-first comparison over live, in-stock offers (one currency group) | Built + unit-tested; not yet called by any page/route |

There are no CJ webhooks (the Affiliate feed is pulled, not pushed)
and no CJ order/shipping/tracking API in this integration — CJ
Affiliate is an affiliate program, not a fulfillment provider, and
agentic checkout is out of scope for SmartBuy.

## Known limitations (documented, not live bugs)

- **Fixed 2026-11-22 — comma-decimal prices.** `parseAmountText`
  (lib/offers/cj-feed-transform.ts) now disambiguates the decimal
  separator: "29,99 EUR" → 29.99, "1,299.00" → 1299, "1.299,00"
  → 1299; malformed figures return null. Covered by
  `parseAmountText` + `parseFeedPrice` tests.
- **Fixed 2026-11-22 — sale-price currency.** A sale price with
  an EXPLICITLY different currency than the list price is now
  stored null in both importers (CSV transform + GraphQL mapper);
  a bare sale figure inherits the row currency. Covered by
  transform + mapper tests.
- **Fixed 2026-11-22 — `comparePrices` currency grouping.** The
  comparison now covers only the largest currency group (ties:
  lowest effective price), so savings are never computed across
  currencies. Single-currency input is unaffected. Covered by
  mixed-currency tests. Note: `comparePrices` is built and
  unit-tested but is not yet called by any page or API route —
  wiring it into product display is a follow-on once CJ data is
  live and approved.
- **No stale-offer expiry.** A product that disappears from the
  feed keeps its last imported row live until handled manually;
  the migration has no soft-delete column (deliberate — see the
  migration header). The feed file itself is the restorable
  source.
- **Feed download is blocked on the runtime SSH permission.**
  The download helper (`~/workspace/cj-sftp-download-from-email.mjs`,
  outside the repo) reads the SFTP password from CJ's 17:04 email
  at runtime and never prints it. Its extractor takes the
  LONGEST `Password:` capture (≥ 6 chars, fail-closed) because
  CJ's email body is an HTML table — a naive first match grabs
  table markup ("|"). Fixed 2026-11-22; extraction verified
  (length 8, value never printed). The download itself still
  fails at the SSH handshake: outbound SSH is off in this
  runtime (Muse settings → Permissions → Direct network
  protocols → ssh Deny → Ask).

## Flags

| Flag | Meaning |
| --- | --- |
| `--file <path>` | ZIP or CSV feed file (required) |
| `--network <name>` | default `cj` |
| `--advertiser-id <id>` | default `3992613` (DHGate) |
| `--advertiser-name <name>` | default `DHGate` |
| `--limit <n>` | stop after n ACCEPTED rows (0 = no limit) |
| `--only-with-gtin` | skip rows without a GS1-valid GTIN |
| `--dry-run` | parse + filter only, no database writes |
