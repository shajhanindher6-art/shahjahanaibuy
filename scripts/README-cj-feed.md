# CJ Affiliate feed — importer & SFTP fetcher

Streaming import of the CJ Affiliate (DHGate) product feed into
`public.merchant_offers` (migration
`supabase/migrations/20261121_cj_affiliate_offers.sql`).

## Status (2026-11-21)

- DHGate (CJ 3992613) is APPROVED; Product Export subscription
  Id 325295 exists (Shopping Google Format CSV, Daily, CJ SFTP,
  ~1,118,904 records). The first daily export has NOT run yet.
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
3. Fetch the feed (needs the CJ SFTP password reset by the
   owner in CJ → Subscriptions, stored in Vercel only):
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
  and the filter rules (in stock + price > 0 + valid image).
- `scripts/fetch-cj-sftp.ts` connects with ssh2-sftp-client
  using env vars only (never hardcoded).
- `lib/offers/comparePrices.ts` compares live offers for one
  GTIN (or MPN + brand), cheapest first, with exact savings.

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
