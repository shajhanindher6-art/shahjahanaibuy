# SmartBuy AI — System Health Report (Section 18)

**Section 18 report — Production Readiness, Security Hardening & System Reliability. Dated 12 November 2026.**
**Gate (verified, coordinator run, 12 Nov 2026):** `npx tsc --noEmit` 0 errors · full vitest **254 files / 3,066 tests passed, 4 skipped (3,070 total), 0 failed** (baseline at audit: 216 files / 2,685 tests → +38 files, +381 tests) · `npm run test:a11y` **19/19 PASS** (10 axe checks, was 7/7) · `npm run check:press-counts` OK, `lib/generated/press-counts.json` re-locked to 3,066/254, dated 2026-11-12 · clean build (placeholder env) exit 0, first run, no sitemap failure — **800 static pages, 316 routes** · First Load: `/products/[slug]` **331 kB** (budget ≤350 kB ✓), homepage `/` 322 kB, `/scan` 315 kB · `npm run lint` exit 0, 0 errors, 16 warnings (lint now runs in the build — `eslint.ignoreDuringBuilds` removed from `next.config.js`).
**Dev smoke (placeholder env, port 3101):** homepage 200, `/methodology` 200, `/scan` 200 (complete bodies). Guarded pages `/owner`, `/admin/refresh-runs`, `/dashboard/saved-searches`: HTTP 200 with `NEXT_REDIRECT;replace;/sign-in?reason=session-expired` digest + meta refresh — the guard works (streaming redirect), no owner/admin content leaked.
**Source of every number here:** the Section 18 gate run above, or a count against this repo on 12 Nov 2026. Anything not verified this way is labelled owner-gated or unverified, never presented as done.

> Scope: Section 18 audit (`~/workspace/section18-audit.md`, 12 Nov 2026). This report is the health of the running system as far as the repo can prove it: build, tests, endpoints, refresh pipeline, monitoring, performance, and UX reliability. Live health (real traffic, real cron firing, real Sentry events) is owner-gated — see §7.

## 1. Build & test health

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| Full `npx vitest run` | 254 files / 3,066 tests passed, 4 skipped (3,070 total), 0 failed |
| `npm run test:a11y` | 19/19 PASS (10 axe checks; was 7/7) |
| `npm run check:press-counts` | OK — re-locked to 3,066/254, 2026-11-12 |
| Clean build (placeholder env) | exit 0, first run, no sitemap failure; 800 static pages, 316 routes |
| `npm run lint` | exit 0, 0 errors, 16 warnings; lint now runs in the build |
| First Load `/products/[slug]` | 331 kB (budget ≤350 kB ✓) |
| First Load `/` (homepage) | 322 kB (over its ≤250 kB *warning* budget — warning only) |
| First Load `/scan` | 315 kB |

Gate failures fixed during the build: 11 after the first full run — 5 extension-route 500s from a mock missing `.is()` (mock-only fix, helper was correct) and 6 stale test premises updated to the intended implementation. The press-counts pin test (`tests/press-counts-json.test.ts`) was re-locked to the Section 18 baseline.

## 2. Endpoint health (dev smoke, placeholder env, port 3101)

| Route | Result |
|---|---|
| `/` | 200, complete body |
| `/methodology` | 200, complete body |
| `/scan` | 200, complete body |
| `/owner` | HTTP 200 with `NEXT_REDIRECT` digest + meta refresh to `/sign-in?reason=session-expired` — guard works, no content leaked |
| `/admin/refresh-runs` | Same redirect behaviour — guard works |
| `/dashboard/saved-searches` | Same redirect behaviour — guard works |

Note on reading guarded pages: a bare HTTP 200 on a guarded page is a streaming redirect shell, not a render. Future rechecks must look for the `NEXT_REDIRECT` digest / meta refresh in the body, not the status alone (Section 17 recheck lesson).

## 3. Health & monitoring honesty (built in Section 18)

- **Health endpoint:** degraded → **503** (was reporting healthy while degraded).
- **Monitoring endpoint:** 503 on DB failure.
- **Refresh endpoint:** `data/refresh` now returns honest **200/202**; `image.process` reports `processed: 0` honestly instead of implying work.
- **Per-step counts** now recorded in the `steps` JSONB of refresh runs.
- **Failure reasons** from refresh runs now land in `error_log` + a failed-products section; DLQ items surface on `/admin/refresh-runs`.
- **Error logging:** `logApiError` (`lib/api/error-logging.ts`) + `x-request-id` on every response via middleware. **5 routes / 10 call sites wired so far; the remaining ~172 routes have not yet adopted it.**
- **Error-log store:** migration 048 `error_log` (file only, NOT applied) + owner surfacing + a writer wired into `logApiError` (best-effort, missing-table tolerant). Until 048 is applied, the owner dashboard's error-log view stays honestly empty.
- **Sentry:** release/env now from a single source; `global-error.tsx` reports to Sentry. **Sentry liveness is unverified** — DSN presence unknown (owner-gated). Sentry dashboard + UptimeRobot setup is owner-gated.
- **Logs:** JSON logs + logger tests added.
- **PII:** log PII fix applied; dynamic error messages replaced with a generic envelope; refresh `loadError` sanitiser + call-site wiring.

## 4. Refresh pipeline & data freshness

- **Prices are still stale.** Last recorded freshness: **2026-11-02** — the price-refresh endpoint re-reads the database only; it fetches nothing live except the eBay leg, which is blocked (owner-gated keys). `data_freshness` stamps say "recorded price re-checked", not "live-checked".
- Refresh chain parallelised in waves; refresh shared reads; `maxDuration = 60` on 5 cron routes.
- **Guard fail-open narrowed (coordinator decision, item 35):** missing-table-only (PGRST205 / 42P01). Failing open on ANY error risked duplicate concurrent runs writing conflicting price history; failing closed on a guard error costs at most one 6 h refresh cycle. Tests prove missing-table still starts unguarded and other errors fail safe (`{started:false, reason:'guard-error'}`). Atomic guard migration 052 written, file only.
- Digest endpoint now persists failures (migration 050 + `recordDigestFailure`, file only) — it used to report `generated:N` while storing nothing.
- Webhook status persistence — migration 049 + outcome update + reprocess-on-retry in `services/stripe.ts` (file only).
- Quota: atomic increment RPC migration 053 written (file only); code falls back until applied. Quotas remain per-instance in-memory until migration 035 is applied (035 needs separate explicit review).
- Cron: exactly one scheduler (cron-job.org, 6 endpoints). Whether the jobs exist or fire is **unknown from the repo** — owner verification needed (owner-gated).

## 5. Performance

- Section 17 First Load numbers recorded; bundle-size test added; homepage bundle gate added.
- Product double-fetch fix; review-summary DB aggregate; homepage N+1 fix; `/status` aggregate; `select('*')` replaced with column lists; cache-header correction; cache invalidation on intake approve; SerpAPI `fromCache` label.
- `REDIS_URL` is no longer logged.
- 800 static pages / 316 routes at build; product page 331 kB ≤ 350 kB budget.

## 6. UX reliability

- `loading.tsx` added on 40 segments — **56 → 96 of 121**; still missing on 25 segments.
- a11y: 7/7 → **10 axe checks, 19/19 PASS**.
- 44 px touch targets; auth-error mapping; session-expired banner; OAuth error mapping; Google button on sign-up; sidebar Vault + Saved Searches links; sign-out confirm; generic error copy.
- Account deletion: route returns **422, not 400**, for wrong confirmation — by design.
- Deal Score still 100/100 for all products (data problem: 4 points, 0 discount probability; badge hidden below 5 points). `imageUrl` / `gtin` null on all 10 products. 10 products live; 50 verified products is a data task, not a code task.

## 7. What this report cannot prove (owner-gated)

- Whether cron-job.org jobs exist or fire.
- Sentry event flow live; UptimeRobot status.
- Live signed-in admin behaviour; guest→signed-in merge live.
- Stripe test checkout / webhook live; email/push delivery live.
- Applied status of any migration (only the owner can check `supabase_migrations.schema_migrations`).
- Backup restore (untested; free tier has no automated backups — manual `pg_dump` only; Pro $25/mo decision owner-gated).

## 8. Migrations — verified counts

Counted 12 Nov 2026 by `ls supabase/migrations/ | wc -l` (= **51 files**) and a header grep for `DO NOT APPLY` (17 files carry the header).

- **51 migration files** (001–053, gaps 024/025/046 — 023 exists — plus the unnumbered `20260718060823_fix_anonymous_access_policies.sql`).
- **17 files carry "DO NOT APPLY YET"** (035–043, 045, 047–053). Never apply 035 without a separate explicit review. Never apply the unnumbered file as-is.
- **044 is the one the owner SHOULD apply** — the single remaining step for Section 16 to be fully live.
- New in Section 18 (file only, NOT applied): 048 `error_log`, 049 webhook status, 050 digest failures, 051 user-table FKs, 052 refresh-guard atomicity, 053 quota RPC.
