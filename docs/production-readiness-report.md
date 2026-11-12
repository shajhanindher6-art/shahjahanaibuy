# SmartBuy AI — Production Readiness Report (Section 18)

**Section 18 report — Production Readiness, Security Hardening & System Reliability. Dated 12 November 2026.**
**Gate (verified, coordinator run, 12 Nov 2026):** `npx tsc --noEmit` 0 errors · full vitest **254 files / 3,066 tests passed, 4 skipped (3,070 total), 0 failed** (baseline at audit: 216 files / 2,685 tests → +38 files, +381 tests) · `npm run test:a11y` **19/19 PASS** (10 axe checks, was 7/7) · `npm run check:press-counts` OK, `lib/generated/press-counts.json` re-locked to 3,066/254, dated 2026-11-12 · clean build (placeholder env) exit 0, first run, no sitemap failure — **800 static pages, 316 routes** · First Load: `/products/[slug]` **331 kB** (budget ≤350 kB ✓), homepage `/` 322 kB, `/scan` 315 kB · `npm run lint` exit 0, 0 errors, 16 warnings (lint now runs in the build — `eslint.ignoreDuringBuilds` removed from `next.config.js`).
**Dev smoke (placeholder env, port 3101):** homepage 200, `/methodology` 200, `/scan` 200 (complete bodies). Guarded pages `/owner`, `/admin/refresh-runs`, `/dashboard/saved-searches`: HTTP 200 with `NEXT_REDIRECT;replace;/sign-in?reason=session-expired` digest + meta refresh — the guard works (streaming redirect), no owner/admin content leaked.
**Source of every number here:** the Section 18 gate run above, or a count against this repo on 12 Nov 2026. Anything not verified this way is labelled owner-gated or unverified, never presented as done.

> Scope: Section 18 audit (`~/workspace/section18-audit.md`, 12 Nov 2026) — 88 buildable items, 23 owner-gated, 17 rejected, 1 already done (129 items). 86 of the 88 buildable items were built; 2 are blocked (see §4). This report is the production-readiness verdict, not a marketing claim.

## 1. What "production ready" means here — and the honest verdict

**Verdict: code-ready, not fully production-ready.** The code, tests, build and guards pass the gate. What is *not* ready is everything that lives outside the repo: owner-applied migrations, live keys, live verification, and real catalogue data. That split is the whole story of this section.

| Area | Verdict |
|---|---|
| Type safety / tests / build | ✅ Ready — tsc 0, vitest 254/3,066 PASS, clean build 800 pages |
| Accessibility | ✅ Ready — a11y 19/19 (10 axe checks) |
| Lint | ✅ Ready — 0 errors, 16 warnings; lint runs in build |
| Bundle budgets | ✅ Ready — product page 331 kB ≤ 350 kB; homepage 322 kB (over its ≤250 kB *warning* budget — warning only, unchanged from Section 17) |
| Security hardening (code) | ✅ Ready — see `docs/security-audit-report.md` |
| Error observability (code) | ✅ Ready — `logApiError` + `x-request-id` + `error_log` writer wired (see §3) |
| Refresh / health honesty | ✅ Ready in code — degraded → 503, honest 200/202, DLQ surfacing |
| Live data / prices | ❌ Not ready — prices still stale (dataFreshness 2026-11-02); refresh fetches nothing live yet (owner-gated keys) |
| Migrations applied live | ❌ Not ready — 17 files DO NOT APPLY YET; applied status of every migration is unknown from the repo |
| Live verification | ❌ Not done — signed-in admin, Stripe live test, RLS live probe, Sentry liveness all owner-gated |

## 2. What was built (Phases 0–2)

**Phase 0 (P0, 4 items).** #1 `/owner` layout role fix — now uses `fetchProfileRoleName` (same pattern as `app/admin/layout.tsx`); repo-wide grep for `.select('role')` is now 0 hits. #2 SSRF fix in visual search — DNS-resolve + reject RFC-1918/loopback/link-local incl. 169.254/16, `redirect: 'manual'` max 3 hops, 30 s timeout, 8 MB cap. Build note: the `node:dns/promises` + `node:net` imports were split into a client-safe module `services/visual-search-client.ts` because `app/scan/page.tsx` is a client component; the guard itself is untouched. #3 Backup doc correction — the free tier has **no automated backups**; manual `pg_dump` is the only recovery path; restore is untested. #4 + #44 + #52 error-logging helper — `lib/api/error-logging.ts` (`logApiError`) + `lib/api/request-id.ts`, `x-request-id` on every response via middleware; 5 routes / 10 call sites wired so far.

**Phase 1 (P1, 6 items).** #6 bnpl-line test wired (renamed to `.test.ts`; `vitest.config.ts` gained `esbuild: { jsx: 'automatic' }` — any test importing a `.tsx` component was failing before). #7 Stripe webhook signature test (5 tests, real SDK, fake test keys). #8 `requireAdmin` deny test (7 tests, real middleware). #9 docs staleness rewrite (project-summary.md, DEPLOYMENT.md, API_DOCUMENTATION.md). #5 audit-log wiring — `recordAdminAction` into merchant verify, community-deal moderate, newsletter send, visual-search backfill; intake audit-insert failure now `logger.error` — plus append-only (UPDATE/DELETE audit policies dropped from migration 017, file only). #10 error-log store — migration 048 `error_log` (file only) + owner surfacing + a writer wired into `logApiError` (best-effort, missing-table tolerant). Webhook status — migration 049 + outcome update + reprocess-on-retry in `services/stripe.ts`. Digest failure persistence — migration 050 + `recordDigestFailure`.

**Phase 2 (P2, 86 items built of 88 — see §4).** Security hardening (CSRF Origin check on cookie-authed mutations; Zod on intake/alerts/checkout; auth resend cooldown + rate-limited reset proxy; 047 INSERT guard; sign-up enumeration closed; reset-link expiry UX; email-verification dashboard gate with 7-day skip cookie). API reliability (health honesty — degraded → 503; monitoring 503 on DB failure; PII log fix; dynamic error messages → generic envelope; refresh `loadError` sanitiser + call-site wiring; referral click dedupe; Stripe webhook limit 120 → 30/min/IP). Database (soft-delete filters via `lib/public-products.ts`; alert-checker batch; FK migration 051, refresh-guard atomic migration 052, quota RPC migration 053 — all file only, with code fallbacks). Performance (Section 17 First Load numbers recorded; bundle-size test; product double-fetch fix; review-summary DB aggregate; homepage N+1 fix; `/status` aggregate; `select('*')` column lists; refresh shared reads; cache-header correction; cache invalidation on intake approve; SerpAPI `fromCache` label; guard fail-open narrowed — see §5; `maxDuration = 60` on 5 cron routes; refresh chain parallelised in waves; per-step counts in `steps` JSONB; `image.process` `processed: 0`; `data/refresh` honest 200/202; DLQ surfacing on `/admin/refresh-runs`; `REDIS_URL` no longer logged). Monitoring (refresh failure reasons into `error_log` + failed-products section; Sentry release/env single source; `global-error.tsx` Sentry reporting; JSON logs + logger tests). UX (auth-error mapping; session-expired banner; OAuth error mapping; 44 px touch targets; a11y 7/7 → 10 axe checks; Google button on sign-up; sidebar Vault + Saved Searches links; sign-out confirm; 40 `loading.tsx` added — 56 → 96 of 121; generic error copy). Tests (RLS CI execution harness — skips gracefully without Postgres, CI setup documented in the test header; route 429 test; bad-input tests; signup→dashboard + checkout tests; alert route test; viewport-meta render test; account deletion test — the route returns 422, not 400, for wrong confirmation, by design; ESLint ignore removed; auth-cookie trade-off doc). Deployment (rollback runbook; 4 missing env vars documented; `TELEGRAM_CHAT_ID` correction; homepage bundle gate). Docs (frozen banners refreshed + 2 new banners; README stale lines; "61 base vars" corrected to 58 + 18 locale with the derivation documented; `enableGoogleAuth`/`enableEmailVerification` wording corrected).

**Extra finds fixed during the build (beyond the 88).** (a) The Section 17 047 UPDATE trigger could never fire — `SECURITY DEFINER` + `current_user` check always equals the function owner (`postgres`); fixed in the file to `auth.uid()` (file only, NOT applied). (b) 11 gate failures fixed after the first full run (5 extension-route 500s from a mock missing `.is()` — mock-only fix, helper was correct; 6 stale test premises updated to the intended implementation). (c) The press-counts pin test re-locked to the Section 18 baseline.

## 3. Observability — what changed

- Every API response now carries `x-request-id` (middleware, `lib/api/request-id.ts`).
- `logApiError` (`lib/api/error-logging.ts`) is the single error-logging helper; **5 routes / 10 call sites wired so far — the remaining ~172 routes have not yet adopted it.** That adoption is future work, not done.
- The `error_log` writer is wired into `logApiError` (best-effort, missing-table tolerant). The table itself is migration 048 — **file only, NOT applied** — so until the owner applies 048 the owner dashboard's error-log view stays honestly empty.
- Refresh failure reasons now land in `error_log` + a failed-products section; DLQ items surface on `/admin/refresh-runs`.
- `global-error.tsx` reports to Sentry; Sentry release/env now come from a single source. **Sentry liveness is unverified** — DSN presence is unknown (owner-gated).

## 4. Blocked — NOT built

| Item | Reason |
|---|---|
| #22 middleware `status` filter | Blocked on migration 045 being applied (owner-gated, not in this section). |
| #39 image allowlist | Blocked until a real merchant image host is known — none known yet. |

## 5. Coordinator decision — item 35 (guard fail-open narrowed)

Narrowed to missing-table-only (PGRST205 / 42P01). Evidence: the Section 16/17 precedent (PGRST205 = missing table proves no session exists); failing open on ANY error risks duplicate concurrent runs writing conflicting price history, while failing closed on a guard error costs at most one 6 h refresh cycle. Tests prove missing-table still starts unguarded and other errors fail safe (`{started:false, reason:'guard-error'}`).

## 6. Migrations — verified counts

Counted 12 Nov 2026 by `ls supabase/migrations/ | wc -l` (= **51 files**) and a header grep for `DO NOT APPLY` (17 files carry the header).

- **51 migration files** (001–053, gaps 024/025/046 — 023 exists — plus the unnumbered `20260718060823_fix_anonymous_access_policies.sql`).
- **17 files carry "DO NOT APPLY YET"** (035–043, 045, 047–053). Never apply 035 without a separate explicit review (standing rule). Never apply the unnumbered `fix_anonymous_access_policies.sql` as-is — it would restrict public catalogue reads to authenticated users and break the public site.
- **044 is the one the owner SHOULD apply** — it is the single remaining step for Section 16 to be fully live (activates `/creators` 404s, no redeploy).
- Applied status of every migration is **unknown from the repo** — only the owner can check `supabase_migrations.schema_migrations`. Two are proven NOT applied live: 033 and 044.
- New in Section 18 (file only, NOT applied): 048 `error_log`, 049 webhook status, 050 digest failures, 051 user-table FKs, 052 refresh-guard atomicity, 053 quota RPC.

## 7. Known limits (stated honestly)

- Prices still stale (dataFreshness 2026-11-02); refresh fetches nothing live yet — owner-gated keys.
- Deal Score still 100/100 for all products (data problem: 4 points, 0 discount probability; badge hidden below 5 points).
- `imageUrl` / `gtin` null on all 10 products.
- `loading.tsx` still missing on 25 of 121 segments (96 covered, was 56).
- Remaining ~172 API routes have not yet adopted `logApiError`.
- RLS execution tests skip without a Postgres URL (harness ready; CI needs `postgres:16` + `S18_RLS_DATABASE_URL`).
- Live signed-in admin verification not done (owner-gated); Sentry liveness unverified (owner-gated).

## 8. Owner-gated remainder (23 items, unchanged from audit §12)

Applying migrations 026–053 (035 only after separate explicit review; 044 is the single remaining step for Section 16; 017 re-apply check; 045 dupes check first; 036 only the fixed file); live checks; Supabase dashboard auth settings; Stripe live; eBay; Amazon Associates check; Skimlinks application (no go-ahead — 90-day block); Resend + VAPID; cron/service secrets; Upstash + 035; cron-job.org verification; keys (HF, Sentry DSN, PostHog/GA4/Meta, WhatsApp/Telegram, R2, SerpAPI); Sentry dashboard + UptimeRobot; backup decision (Pro $25/mo vs manual/CI `pg_dump`); workflows via GitHub website; 50 verified products; live verification round; RLS live probe; mobile repo GitHub App install; Search Console + Bing Webmaster; Supabase 2FA redo; Stripe webhook live test.

## 9. Readiness checklist (owner actions before calling the platform production-ready)

- [ ] Apply migration 044 (Section 16 completion), then 048–053 as reviewed — never 035 without separate explicit review.
- [ ] Verify `supabase_migrations.schema_migrations` live; re-apply check for 017.
- [ ] One signed-in admin login attempt (verifies `/owner` + `/admin` role fix live).
- [ ] Set Sentry DSN + verify an event lands in the Sentry dashboard; set up UptimeRobot.
- [ ] Decide backup: Pro $25/mo vs manual/CI `pg_dump` (restore untested either way until tested).
- [ ] Verify cron-job.org jobs exist and fire (6 h refresh, 5-min uptime).
- [ ] Stripe webhook live test; Stripe live keys only via the double gate (`STRIPE_LIVE_LAUNCHED=true`).
- [ ] 50 verified products with images/GTIN/specs from real merchant sources — data task, never invented.
