# Owner checklist — migrations 045–058

**Created:** 13 November 2026 (Sections 21–25, Stage L)
**Scope:** the migrations the S17 checklist (`migration-checklist.md`, 001–044)
does NOT cover. Nothing here is applied by code — every step below is an
owner step in the Supabase dashboard SQL Editor, one migration at a time,
only with the owner's explicit approval for that migration.
**Standing rules:** never apply a migration without explicit approval for
that migration; **never apply 035** without a separate explicit review;
never apply the unnumbered
`supabase/migrations/20260718060823_fix_anonymous_access_policies.sql`
as-is (it would restrict public catalogue reads to authenticated users);
never re-run the full seed.

> Applied status of every migration is UNKNOWN from the repo — only the
> owner can check `supabase_migrations.schema_migrations` in Supabase
> before applying anything. Verify first, then apply in filename order.
> If a check below fails, stop at that migration and do not skip ahead:
> later migrations depend on earlier ones.

## 0. Verify before you start

- [ ] In Supabase SQL Editor, list what is already applied:
  ```sql
  SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
  ```
- [ ] Confirm 044's status while you are there. **Contradiction pending
  (13 Nov 2026):** `project-summary.md` and `docs/DEPLOYMENT.md` still
  say 044 is NOT applied, but the live recheck on 13 Nov 2026 ~10:17 PKT
  found `/creators/unknown-slug-xyz` → 404 (twice) — the behaviour the
  044 `creator_slugs` view produces. If `schema_migrations` shows 044
  applied, tell the coordinator so the two docs can be corrected.
- [ ] Confirm 033 is still NOT applied (live `live_shopping_sessions`
  table missing, proven by a PGRST205). 033 stays pending until the
  owner applies it; nothing in 045–058 depends on it.
- [ ] Take a manual `pg_dump` export first (free tier has no automated
  backups — see `docs/DEPLOYMENT.md` Backup & restore guide).

## 1. Apply order (§9 runbook order — do not reorder)

044 is done (subject to the §0 confirmation above). Then, in order:

| Step | Migration | What it does | Pre-check (run first — apply only if it passes) |
| --- | --- | --- | --- |
| 1 | **045** `catalog_verification_and_published_status` | `products.status` (pending/published/rejected, default published) + price-verification rollup columns; per-listing verification columns on `merchant_products`; price-history UNIQUE index | **Duplicate check (required — see §2).** Until 045 applies, products publish 10/10 by fail-open default and the stale-flip + verified stamp are inert. |
| 2 | **047** `profiles_role_id_change_guard` | Guards `role_id` changes — closes the self-promotion hole (any signed-in user can currently set their own `role_id` to admin) | None in the file header beyond the apply itself. Note: the file was fixed in place to `auth.uid()` (Section 18); apply the file as it stands. |
| 3 | **048** `error_log` | `error_log` table — activates the admin error-log surface and `logApiError` storage | None. Until applied, error logging has nowhere to write. |
| 4 | **049** `webhook_events_status` | Webhook event status tracking | None. |
| 5 | **050** `digest_failures` | Digest-failure recording | None. |
| 6 | **051** `user_table_auth_user_fks` | 12 FKs from user-owned tables to `auth.users` | **Orphan check (required):** for each of the 12 tables, e.g. `SELECT count(*) FROM public.agent_memory m WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id);` — apply only when every count is 0. Never delete rows silently to clear orphans; the owner reviews them first. |
| 7 | **052** `refresh_runs_one_running` | Atomic one-run-at-a-time guard (unique partial index: at most one `running` row) | **Running-count check (required):** `SELECT count(*) FROM public.price_refresh_runs WHERE status = 'running';` — apply only when the count is 0 or 1. If it is 2, first mark all but the newest `running` row `failed`. |
| 8 | **054** `deals_duplicate_unique` | UNIQUE index on deals identity (product + merchant + discount + window, live rows only) | **Duplicate check (required):** `SELECT product_id, merchant_id, discount_type, discount_value, start_at, end_at, count(*) FROM public.deals GROUP BY 1,2,3,4,5,6 HAVING count(*) > 1;` — the CREATE fails outright if duplicates exist (safe failure, changes nothing). Resolve duplicates first. |
| 9 | **056** `gtin_unique_partial_index` | Partial UNIQUE index: one live product per GTIN (+ variant GTIN column + index) | **Duplicate check (required):** check for the same GTIN on two different live products before applying (per the file header's pre-condition) — the CREATE fails outright if duplicates exist. All 10 live products have NULL GTIN today, so this is expected to pass. |
| 10 | **057** `price_history_source_flags` | `price_history.source` + `observed_at` + `suspicious_change` (provenance) | **File fix first (code step, not an owner apply):** 057 has two file defects — an unguarded `ADD CONSTRAINT price_history_source_check` (a re-run fails) and a backfill that mislabels post-seed rows as `'seed'`. Do NOT apply 057 until the build fixes the file (DO-block guard + seed-instant-scoped backfill). |
| 11 | **058** `product_attribute_attribution` | Per-spec attribution columns | None. Note: attribution has no production write path yet (no code inserts `product_attributes` rows), so applying 058 enables storage, not behaviour. |

**After 045–058:** new migrations 059–062 (data-quality persistence,
`price_history.currency_code`, `merchant_reliability` table, log-table
FKs) are proposed as files only — they do not exist yet and are applied
only after the 035–058 backlog clears, in numeric order.

## 2. The 045 duplicate check (I-P2-6 — do not skip this)

045's price-history UNIQUE index lives inside a duplicate-guarded DO
block (`supabase/migrations/20261112180000_045_catalog_verification_and_published_status.sql`,
section C). Unlike 054/056, it does **not** fail when duplicates exist:
it raises a NOTICE and creates nothing — so the migration "succeeds"
while the index is silently missing, and the double-run race it was
meant to stop stays open. Run this **before** applying 045:

```sql
SELECT product_id, retailer_id, recorded_at, count(*)
FROM public.price_history
GROUP BY product_id, retailer_id, recorded_at
HAVING count(*) > 1;
```

- **0 rows →** apply 045, then confirm the index exists:
  ```sql
  SELECT indexname FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'price_history'
    AND indexname = 'price_history_product_retailer_recorded_uidx';
  ```
  If that returns nothing after a "successful" apply, duplicates were
  present and the guard skipped the index — go back to the check above.
- **≥1 row →** do NOT apply 045 yet. Resolve the duplicate
  `(product_id, retailer_id, recorded_at)` rows first (keep one row per
  key, owner-reviewed), re-run the check until it returns 0 rows, then
  apply.

## 3. NEVER apply (decisions, not backlog)

- [ ] **035 `api_key_quotas` — NEVER apply by the build.** It moves the
  API quota ledger from per-instance in-memory to a shared durable
  ledger (cross-instance 429 consequences). Only if the owner
  explicitly lifts the durable-quota ban, after a separate review.
  053 is dead without 035 — do not apply 053 either unless 035 is
  lifted first.
- [ ] **Unnumbered `20260718060823_fix_anonymous_access_policies.sql` —
  never apply as-is.** It would restrict public catalogue reads to
  authenticated users and break the public site.
- [ ] **018 / 031 guard note:** 018 fails outright if
  `add-smartpools.sql` was never run; 031 fails outright if
  `add-community-deals.sql` was never run. If either is still pending,
  run the matching `add-*.sql` file first (see `docs/DEPLOYMENT.md`).

## 4. What each apply unlocks (so the owner can verify it worked)

| Migration | Live proof after applying |
| --- | --- |
| 045 | Products stop publishing by fail-open default; the stale-flip runs; `/admin/products` shows real verification status instead of the 42703 fallback. |
| 047 | A signed-in non-admin can no longer set their own `role_id` to admin. |
| 048 | `/admin` error log shows rows; `logApiError` stops discarding server errors. |
| 040 (earlier backlog, not 045–058) | `/admin/refresh-runs` stops saying "no run recorded". Listed here because 045's verification work is only visible once refresh runs are recorded. |
| 057 (after file fix) | `price_history` rows carry `source` / `observed_at` / `suspicious_change`. |
| 055–056, 058 | `model_number` + GTIN uniqueness + per-spec attribution become storable; admin quality score ceiling rises 25 → 35. |

## 5. Owner decisions (grounded only in code/docs — audit §11)

Tick each one only when it is actually done, in the owner's own
dashboards. Nothing here is a code task.

- [ ] **eBay keys** — `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` in Vercel
  env; eBay developer app approved; **EPN + Growth Check** passed;
  **one SQL insert**: an `ebay` row in the live `merchants` table
  (`slug='ebay'` — no seed/migration/route/UI ever creates it; the
  `retailers` table seed does not count). Without all three, eBay
  intake/refresh stays inert.
- [ ] **Stripe live** — live keys + `STRIPE_LIVE_LAUNCHED=true` +
  **price decision: $1 vs $4.99 vs $9.99** (planned price $9.99/month,
  not a live charge). A live key alone never enables charges.
- [ ] **Amazon Associates** — confirm `smartbuy-20` is an approved tag
  vs a placeholder (only the Associates dashboard can confirm).
- [ ] **Skimlinks** — do NOT apply without explicit go-ahead (rejection
  blocks reapplying for 90 days). Even configured, it is not a
  product-data API.
- [ ] **Resend** — `RESEND_API_KEY` + **verified sender domain**
  (`noreply@smartbuy.ai` is a placeholder; a key alone is insufficient).
- [ ] **VAPID** — key pair generated, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` +
  `VAPID_PRIVATE_KEY` set (push stays dormant without them).
- [ ] **Secrets in Vercel** — `CRON_SECRET` (≥32 chars),
  `SMART_HOME_WEBHOOK_SECRET` (≥16 chars),
  `SUPABASE_SERVICE_ROLE_KEY`, Upstash Redis vars
  (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — without
  them rate limiting is the weak per-instance in-memory bucket).
- [ ] **cron-job.org** — verify the 6h price-refresh job + the 5-min
  uptime job exist and fire; decide the fate of the 4 unscheduled
  endpoints (`alerts/check`, `notifications/process`,
  `notifications/digest`, `predictions/outcomes`).
- [ ] **Other keys/approvals** — LLM provider decision (+ key);
  SerpAPI, Hugging Face, Sentry DSN, PostHog/GA4/Meta, WhatsApp,
  Telegram, Cloudflare R2 keys; Search Console / Bing verification;
  Supabase 2FA redo; add `shahjahanaibuy-mobile` to the Muse GitHub
  App installation.
- [ ] **Apify — REJECTED / blocked.** Standing no-scraping rule;
  `APIFY_API_TOKEN` / `APIFY_ACTOR_ID` must stay unset.
- [ ] **CI enforcement** — `check-a11y.yml` + `check-press-counts.yml`
  are untracked and were never pushed (the GitHub App gets 403 on
  workflow files); upload them via the GitHub website if CI is wanted.
- [ ] **RLS execution tests** — need CI Postgres + `pg` dependency +
  `S18_RLS_DATABASE_URL` (4 tests skip without them).
- [ ] **50 verified products** — real merchant data only, never fake.
  Even after the eBay unblock, eBay yields thin listings only (no
  GTIN/specs/variants/history); 50 FULLY-verified is not reachable by
  any path in the tree today.

## 6. Record table (fill in as steps complete)

| Migration / decision | Applied / done (date) | Verified by |
| --- | --- | --- |
| 044 (confirm status) | _pending_ | |
| 045 | _pending_ | |
| 047 | _pending_ | |
| 048 | _pending_ | |
| 049 | _pending_ | |
| 050 | _pending_ | |
| 051 | _pending_ | |
| 052 | _pending_ | |
| 054 | _pending_ | |
| 056 | _pending_ | |
| 057 (after file fix) | _pending_ | |
| 058 | _pending_ | |
| eBay unblock | _pending_ | |
| Stripe live + price | _pending_ | |
| Resend verified domain | _pending_ | |
| VAPID | _pending_ | |
