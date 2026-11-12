# SmartBuy AI — Section 18 Summary

**Section 18 report — Production Readiness, Security Hardening & System Reliability. Dated 12 November 2026.**
**Gate (verified, coordinator run, 12 Nov 2026):** `npx tsc --noEmit` 0 errors · full vitest **254 files / 3,066 tests passed, 4 skipped (3,070 total), 0 failed** (baseline at audit: 216 files / 2,685 tests → +38 files, +381 tests) · `npm run test:a11y` **19/19 PASS** (10 axe checks, was 7/7) · `npm run check:press-counts` OK, `lib/generated/press-counts.json` re-locked to 3,066/254, dated 2026-11-12 · clean build (placeholder env) exit 0, first run, no sitemap failure — **800 static pages, 316 routes** · First Load: `/products/[slug]` **331 kB** (budget ≤350 kB ✓), homepage `/` 322 kB, `/scan` 315 kB · `npm run lint` exit 0, 0 errors, 16 warnings (lint now runs in the build — `eslint.ignoreDuringBuilds` removed from `next.config.js`).
**Dev smoke (placeholder env, port 3101):** homepage 200, `/methodology` 200, `/scan` 200 (complete bodies). Guarded pages `/owner`, `/admin/refresh-runs`, `/dashboard/saved-searches`: HTTP 200 with `NEXT_REDIRECT;replace;/sign-in?reason=session-expired` digest + meta refresh — the guard works (streaming redirect), no owner/admin content leaked.
**Source of every number here:** the Section 18 gate run above, or a count against this repo on 12 Nov 2026. Anything not verified this way is labelled owner-gated or unverified, never presented as done.

## 1. Scope

Section 18: "Production Readiness, Security Hardening & System Reliability". 10 areas (full audit → security hardening → API security/reliability → DB reliability → performance → error monitoring/logging → UX reliability → automated testing → deployment readiness → docs). Audit: `~/workspace/section18-audit.md` (12 Nov 2026, 565 lines, 13 sections) — **88 buildable, 23 owner-gated, 17 rejected, 1 already done (129 items)**. Baseline at audit re-verified: tsc 0, vitest 216/2,685 PASS.

Standing rules carried over: free tiers only; never invent data; no scraping; Stripe TEST; never apply 035 without separate explicit review; never apply production migrations without explicit approval; preserve Sections 1–17; minimal targeted changes; no rebuild; no deleting working functionality; no fake integrations; no secrets exposure; regression tests after significant changes.

## 2. What was built

**86 of the 88 buildable items were built** (2 blocked — see §4). Phases 0–2, in audit order:

- **Phase 0 (P0, 4 items):** #1 `/owner` layout role fix (`fetchProfileRoleName`, same pattern as `app/admin/layout.tsx`; repo-wide grep for `.select('role')` now 0 hits). #2 SSRF fix in visual search (DNS-resolve + reject RFC-1918/loopback/link-local incl. 169.254/16, `redirect: 'manual'` max 3 hops, 30 s timeout, 8 MB cap — plus a build fix: the `node:dns/promises` + `node:net` imports were split into a client-safe module `services/visual-search-client.ts` because `app/scan/page.tsx` is a client component; the guard itself is untouched). #3 backup doc correction (free tier has NO automated backups; manual `pg_dump` is the only recovery path; restore untested). #4 + #44 + #52 error-logging helper (`lib/api/error-logging.ts` `logApiError` + `lib/api/request-id.ts`, `x-request-id` on every response via middleware; 5 routes / 10 call sites wired so far, remaining ~172 routes adopt later per `docs/api-error-logging.md`).
- **Phase 1 (P1, 6 items):** #6 bnpl-line wired (renamed to `.test.ts`, `vitest.config.ts` gained `esbuild: { jsx: 'automatic' }` — any test importing a `.tsx` component was failing before). #7 Stripe webhook signature test (5 tests, real SDK, fake test keys). #8 `requireAdmin` deny test (7 tests, real middleware). #9 docs staleness rewrite (project-summary.md, DEPLOYMENT.md, API_DOCUMENTATION.md). #5 audit-log wiring (`recordAdminAction` into merchant verify, community-deal moderate, newsletter send, visual-search backfill; intake audit-insert failure now `logger.error`) + append-only (UPDATE/DELETE audit policies dropped from migration 017, file only). #10 error-log store (migration 048 `error_log`, file only) + owner surfacing + a writer wired into `logApiError` (best-effort, missing-table tolerant); webhook status (migration 049 + outcome update + reprocess-on-retry in `services/stripe.ts`); digest failure persistence (migration 050 + `recordDigestFailure`).
- **Phase 2 (P2, 86 items built of 88):** security hardening (CSRF Origin check on cookie-authed mutations; Zod on intake/alerts/checkout; auth resend cooldown + rate-limited reset proxy; 047 INSERT guard; sign-up enumeration closed; reset-link expiry UX; email-verification dashboard gate with 7-day skip cookie); API reliability (health honesty — degraded → 503; monitoring 503 on DB failure; PII log fix; dynamic error messages → generic envelope; refresh `loadError` sanitiser + call-site wiring; referral click dedupe; Stripe webhook limit 120 → 30/min/IP); database (soft-delete filters via `lib/public-products.ts`; alert-checker batch; FK migration 051 file only; refresh-guard atomic migration 052 file only; quota RPC migration 053 file only + code with fallback; webhook 23505 handling; pipeline dual-rep fix); performance (Section 17 First Load numbers recorded; bundle-size test; product double-fetch fix; review-summary DB aggregate; homepage N+1 fix; `/status` aggregate; `select('*')` column lists; refresh shared reads; cache-header correction; cache invalidation on intake approve; SerpAPI `fromCache` label; guard fail-open narrowed — see §5; `maxDuration = 60` on 5 cron routes; refresh chain parallelised in waves; per-step counts in `steps` JSONB; `image.process` `processed: 0`; `data/refresh` honest 200/202; DLQ surfacing on `/admin/refresh-runs`; `REDIS_URL` no longer logged); monitoring (refresh failure reasons into `error_log` + failed-products section; Sentry release/env single source; `global-error.tsx` Sentry reporting; JSON logs + logger tests); UX (auth-error mapping; session-expired banner; OAuth error mapping; 44 px touch targets; a11y 7/7 → 10 axe checks; Google button on sign-up; sidebar Vault + Saved Searches links; sign-out confirm; 40 `loading.tsx` added — 56 → 96 of 121; generic error copy); tests (RLS CI execution harness — skips gracefully without Postgres, CI setup documented in the test header; route 429 test; bad-input tests; signup→dashboard + checkout tests; alert route test; viewport-meta render test; account deletion test — the route returns 422, not 400, for wrong confirmation, by design; ESLint ignore removed; auth-cookie trade-off doc); deployment (rollback runbook; 4 missing env vars documented; `TELEGRAM_CHAT_ID` correction; homepage bundle gate); docs (frozen banners refreshed + 2 new banners; README stale lines; "61 base vars" corrected to 58 + 18 locale with the derivation documented; `enableGoogleAuth`/`enableEmailVerification` wording corrected).

**Extra finds fixed during the build (beyond the 88):** (a) the Section 17 047 UPDATE trigger could never fire — `SECURITY DEFINER` + `current_user` check always equals the function owner (`postgres`); fixed in the file to `auth.uid()` (file only, NOT applied). (b) 11 gate failures fixed after the first full run (5 extension-route 500s from a mock missing `.is()` — mock-only fix, helper was correct; 6 stale test premises updated to the intended implementation). (c) The press-counts pin test re-locked to the Section 18 baseline.

**Docs delivered in this section (item 87):** `docs/production-readiness-report.md`, `docs/security-audit-report.md`, `docs/system-health-report.md`, this file, plus the `project-summary.md` update and stale-count corrections (DEPLOYMENT.md migration counts, DO NOT APPLY count, `docs/rate-limits.md` webhook limit).

## 3. Gate results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| Full `npx vitest run` | 254 files / 3,066 tests passed, 4 skipped (3,070 total), 0 failed |
| `npm run test:a11y` | 19/19 PASS (10 axe checks) |
| `npm run check:press-counts` | OK — 3,066/254, 2026-11-12 |
| Clean build (placeholder env) | exit 0, first run, no sitemap failure; 800 pages, 316 routes |
| `npm run lint` | exit 0, 0 errors, 16 warnings |
| First Load `/products/[slug]` | 331 kB (≤350 kB ✓) |
| First Load `/` | 322 kB |
| First Load `/scan` | 315 kB |
| Dev smoke (port 3101) | `/`, `/methodology`, `/scan` → 200; guarded pages redirect correctly, no leak |

## 4. Blocked — NOT built

| Item | Reason |
|---|---|
| #22 middleware `status` filter | Blocked on migration 045 being applied (owner-gated, not in this section). |
| #39 image allowlist | Blocked until a real merchant image host is known — none known yet. |

## 5. Coordinator decision — item 35 (guard fail-open narrowed)

Narrowed to missing-table-only (PGRST205 / 42P01). Evidence: the Section 16/17 precedent (PGRST205 = missing table proves no session exists); failing open on ANY error risks duplicate concurrent runs writing conflicting price history, while failing closed on a guard error costs at most one 6 h refresh cycle. Tests prove missing-table still starts unguarded and other errors fail safe (`{started:false, reason:'guard-error'}`).

## 6. Migrations — verified counts

Counted 12 Nov 2026 by `ls supabase/migrations/ | wc -l` (= **51 files**) and a header grep for `DO NOT APPLY` (17 files carry the header: 035–043, 045, 047–053).

- **51 migration files** (001–053, gaps 024/025/046 — 023 exists — plus the unnumbered `20260718060823_fix_anonymous_access_policies.sql`).
- **17 files carry "DO NOT APPLY YET"** (035–043, 045, 047–053). Never apply 035 without a separate explicit review. Never apply the unnumbered file as-is.
- **044 is the one the owner SHOULD apply** — the single remaining step for Section 16 to be fully live (activates `/creators` 404s, no redeploy).
- New in Section 18 (file only, NOT applied): 048 `error_log`, 049 webhook status, 050 digest failures, 051 user-table FKs, 052 refresh-guard atomicity, 053 quota RPC.
- Applied status of every migration is unknown from the repo; two are proven NOT applied live: 033 and 044.

## 7. Known limits (honest)

- Sentry liveness unverified (DSN presence unknown — owner-gated).
- Live signed-in admin verification not done (owner-gated).
- Prices still stale (dataFreshness 2026-11-02 — refresh fetches nothing live yet, owner-gated keys).
- Deal Score still 100/100 for all products; `imageUrl`/`gtin` null on all 10 products.
- `loading.tsx` still missing on 25 of 121 segments.
- The remaining ~172 API routes have not yet adopted `logApiError` (5 routes / 10 call sites wired).
- RLS execution tests skip without a Postgres URL (harness ready; CI needs `postgres:16` + `S18_RLS_DATABASE_URL`).
- The `error_log` table stays empty until migration 048 is applied — the writer has landed (wired into `logApiError`), the table has not.

## 8. Owner-gated remainder (23 items, unchanged from audit §12)

Applying migrations 026–053 (035 only after separate explicit review; 044 is the single remaining step for Section 16; 017 re-apply check; 045 dupes check first; 036 only the fixed file); live checks; Supabase dashboard auth settings; Stripe live; eBay; Amazon Associates check; Skimlinks application (no go-ahead — 90-day block); Resend + VAPID; cron/service secrets; Upstash + 035; cron-job.org verification; keys (HF, Sentry DSN, PostHog/GA4/Meta, WhatsApp/Telegram, R2, SerpAPI); Sentry dashboard + UptimeRobot; backup decision (Pro $25/mo vs manual/CI `pg_dump`); workflows via GitHub website; 50 verified products; live verification round; RLS live probe; mobile repo GitHub App install; Search Console + Bing Webmaster; Supabase 2FA redo; Stripe webhook live test.

## 9. What Section 18 did NOT do

No migration was applied. No secret was created, read, or stored. No code was deleted. No live feature was rebuilt. No push to GitHub was made by this docs step (push is the coordinator's step). Sections 1–17 are preserved; Section 18 is additive hardening, observability, and documentation on top of them.
