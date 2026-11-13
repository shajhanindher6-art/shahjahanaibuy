# SmartBuy AI — Project Summary

**Last updated:** 2026-11-13 (Section 20; gate numbers verified 13 Nov 2026)
**Repo:** https://github.com/shajhanindher6-art/shahjahanaibuy (public, branch `main`)
**Live site:** https://shahjahanaibuy-b1zp.vercel.app/
**Supabase project:** https://inejitcvexpghejhuuko.supabase.co

> Every number in this file has a source: the Section 17 audit (`~/workspace/section17-audit.md`, 12 Nov 2026), a count run against this repo on 2026-11-12, or a live check. Where the repo cannot prove something, this file says **maloom nahi** (unknown) instead of guessing. Older documents in this repo that contradict the numbers here are frozen historical files — see the banner at the top of each one.

## What SmartBuy is

SmartBuy AI is an AI shopping / price-tracking SaaS: users find products, compare prices across merchants, track prices over time, get deal alerts, and use AI tools (search, forecasts, deal scoring) to decide what to buy and when. Revenue is **$0** — Stripe is built but in test mode, and no paid plan can be bought today.

The honest overall state (full project report, 13 Nov 2026): **~51%** towards the goal of a world-leading platform. Platform/code is ~84%; substance (real catalogue data, live prices, verified integrations) is ~15%. The gap is data and owner-gated configuration, not missing pages.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 13.5.9 (App Router), React 18 |
| Language | TypeScript 5.2.2 |
| Database / Auth | Supabase (PostgreSQL + Supabase Auth, `@supabase/ssr`) |
| Styling / UI | Tailwind CSS, shadcn/ui, Radix UI |
| Charts | Recharts |
| Hosting | Vercel (deploy on every push to `main`; no `vercel.json`) |
| Email | Resend (fail-closed without a key) |
| Push | Web Push API (VAPID) |
| Payments | Stripe (TEST mode) |
| Background jobs | cron-job.org POSTs to `CRON_SECRET`-protected endpoints — there is **no** BullMQ/Redis worker (see below) |
| PWA | Service worker `smartbuy-v4`, manifest, `/offline` page |

Next.js 13.5.9 is ~2 years old (current is 15.x). Upgrading is a project decision, not part of Section 17 — the soft-404 behaviour was proven against 13.5.9.

## Architecture

- **App Router pages** — 129 `page.tsx` files under `app/` (counted 2026-11-13). Dynamic routes use middleware slug-existence checks that rewrite unknown slugs to `/__smartbuy_not_found__` (a path with no route), so Next returns a real HTTP 404 with the app's not-found UI. 9 dynamic routes covered: products, brands, categories, find, stores, events, blog, live, creators. (`/creators` 404s activate only after the owner applies migration 044 — until then unknown creator slugs return 200 by design.)
- **API** — 197 route files / 266 exported handlers under `app/api/` (GET 142, POST 88, DELETE 18, PATCH 14, PUT 4 — counted 2026-11-13). Full reference: `API_DOCUMENTATION.md`; machine-readable paths+methods: `docs/openapi.json`.
- **Auth** — email/password + Google OAuth only; no magic link; email confirmation on; password reset via `/auth/callback?type=recovery`; 8-character client minimum. Server-side session validation uses `getUser()`, never `getSession()`. Delete-account exists (`DELETE /api/v1/account`, requires `{confirmation:"DELETE"}`, 1/hour).
- **Admin** — `/admin` + sub-pages (analytics, affiliate clicks, users, audit logs, feature flags, intake, merchants, fact-check, community-deals), server-guarded. Admin stats are real DB counts. The server-side admin check resolves the role via `role_id → roles.name` (`lib/admin-role.ts`, `fetchProfileRoleName`) — it no longer reads a `profiles.role` column, which does not exist in the migration chain. The `/owner` layout had the same stale read and was fixed the same way in Section 18 Phase 0 (audit §1 #1). Live verification of both is still owner-gated (one admin login attempt). There **is** an owner dashboard (`app/owner/`, admin-only, server-guarded): revenue, subscription/plan counts, API usage, price-source health, failed jobs and error logs in aggregate — with honest empty states where the underlying table is not yet applied live (e.g. the error log until migration 048 is applied).
- **Rate limiting** — all 197 API route files call `rateLimitResponse` (enforced by test). Upstash Redis first when configured, otherwise per-instance in-memory (fail-open by design).
- **Security** — nonce-based CSP, `requireAuth`/`requireAdmin` fail-closed, service-role client returns `null` when the key is unset (callers 503, never silently run as anon), no hardcoded secrets found by grep, Stripe webhook signature-verified with idempotency, smart-home webhook HMAC-SHA256 + `timingSafeEqual`.
- **Background work** — there is no BullMQ/Redis worker. `bullmq`/`ioredis` are not in `package.json`; `lib/workers/queue.ts` loads BullMQ only via `eval('require')`, which always throws and falls back to an in-process `SynchronousQueue`. The only scheduler is cron-job.org (see "Cron jobs" below). The standing rule is exactly **one** scheduler — never two.
- **i18n** — 167 keys, 20 languages. No localized routes exist (hreflang points at the same URL; disclosed as a limit in code).
- **SEO** — programmatic pages: `/brands/[slug]` (10 brands), `/categories/[slug]` (6 categories, product-derived — the `categories` table is empty live), `/find/[query]` (500 curated queries; uncurated queries 404 by design), `/stores/[country]/[slug]` (84 stores). JSON-LD throughout. Sitemap (`app/sitemap.ts`): 93 hand-listed static paths + dynamic sections; live total claimed 724, not re-verified.
- **PWA** — `public/sw.js` `CACHE_VERSION = 'smartbuy-v4'`, 15-URL precache, network-first navigation → `/offline`.

## Features

### The 36 AI tools (0 stubs)

36 tool directories under `app/tools/`; the hub (`app/tools/page.tsx`) lists all 36. All render logged-out; 10 gate only their save/persist function, not viewing.

Public (26): help-me-choose, budget-finder, store-finder, price-history, gift-splitter, forecast-explainer, currency-converter, price-alert-simulator, deal-checker, landed-cost, price-protection, emi-calculator, volatility-ranking, catalog-freshness, api-quota-calculator, deal-score-breakdown, store-trust-checker, real-price-converter, emi-vs-saving, target-price-picker, gift-occasions, cheapest-store-by-category, coupons-cashback (explicitly labelled demo/seed data), product-qa, best-time-calendar, trade-in-finder (directory starts empty; predictor labelled "Simulated").

Auth-gated function (10): list-optimizer, expense-tracker, subscription-manager, monthly-planner, savings-dashboard, warranty-claim-helper, price-drop-digest (guest mode exists), eco-coach, smart-home-agent, future-you-planner.

Per-tool metadata exists on all 36 tools: 21 define their own `page.tsx` metadata and 15 inherit generic metadata from their own `layout.tsx` (36/36 covered).

### Core surfaces

- **Catalogue & search** — `/products` index, `/products/[slug]`, `/brands`, `/categories`, `/stores`, `/find` (500 curated queries), `/search`, AI search (tokenized matching, Levenshtein typo tolerance, curated synonyms, zero-coverage filter), `/compare`, `/deals`, `/scan`, `/gifts`, `/bundles`.
- **Tracking** — price alerts (Free cap: 5), wishlists (+ public share pages), saved searches (API complete; dedicated page `/dashboard/saved-searches` built in Section 17), price history (ranges 7d/30d/90d/1y/all; "No interpolation, no synthesized points"), Deal Score (formula in `lib/deal-score.ts`; badge hidden below 5 data points — so 100/100 on the 10 seed products is gated, not shown as a real score).
- **Dashboard** — `/dashboard` + 11 sub-pages (api-keys, billing, chat, notifications, profile, recommendations, saved-searches, settings, tracking, vault, wishlists). Guest → signed-in merge exists in code (wishlists, alerts, recently viewed, recent searches; signed-in wins on dedupe) but has never been live-verified with a real sign-in.
- **Community & creators** — `/creators` (0 creators live), `/live` (live-shopping sessions; table missing live until migration 033 is applied), `/events`, `/blog`, `/community-deals`, pools, referrals (attribution coded; needs migration 038).
- **Admin intake** — CSV intake (≤2 MB / ≤1,000 rows, admin review; prices labelled manual, not live; preview inserts nothing; merchant must already exist) and eBay intake (preview → review → approve, never auto-insert; blocked without eBay keys + a live `merchants` row).
- **Public API paywall** — keys `sbk_live_` + 32 chars, SHA-256 hash only stored, `x-api-key` header only. Tiers: anon 100/IP/day, Free 1,000, Premium/Family 10,000, Team 100,000. The `[slug]` quota gap is closed: `GET /api/v1/public/products/[slug]` now counts quota via `enforceApiQuota` (Section 17, Stage D).
- **Stripe** — checkout + portal wired, webhook signature-verified, events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` (handler `handleInvoicePaymentFailed` in `services/stripe.ts` — marks the subscription past-due, logs the retry context, records a zero-amount history row; Stripe's automatic retries keep running, nothing is cancelled there); `syncSubscriptionFromStripe` re-fetches from Stripe (never trusts the event payload). Self-grant bypass closed: `POST /api/v1/subscriptions` accepts only `plan: 'free'` (anything else → 400); paid plans only via the Stripe webhook. **Live-launch double gate:** a live secret key alone never enables charges — `STRIPE_LIVE_LAUNCHED=true` is also required (`lib/stripe.ts`). Checkout/portal refuse with 503 otherwise.
- **Email / push** — Resend templates in-file (welcome, subscription active/canceled, price-drop alert, weekly digest, invoice); fail-closed without `RESEND_API_KEY`; newsletter batch cap 100 (max 500). Web Push wired (save/remove/send, 10s timeout, 410/404 endpoints pruned), dormant without VAPID keys.
- **eBay** — code-complete (Browse API, OAuth client-credentials, 10s timeout, keyword-only match, daily cap 4,500 of the free-tier 5,000). Blocked: keys unverifiable + no `ebay` row in the live `merchants` table.
- **Coupons & cashback** — `/tools/coupons-cashback` is explicitly labelled demo/seed data, not live merchant offers.

## Catalogue (honest state)

- **10 products** live (verified via `/api/v1/products` on 12 Nov 2026: MacBook Air, Galaxy S24 Ultra, Sony WH-1000XM5, and 7 more). No `sample-laptop` health-check row in the live API.
- **Prices are stale.** Last recorded freshness: **2026-11-02** (last verified 12 Nov 2026; no refresh has run since). The price-refresh endpoint re-reads the database only; it fetches nothing live except the eBay leg, which is blocked. `data_freshness` stamps say "recorded price re-checked", not "live-checked".
- **No images, no GTINs, no specs, no variants, no reviews, no non-USD prices.** `imageUrl` NULL + `gtin` NULL on all 10 products; 0 variants/attributes rows seeded; USD-only; Amazon/Best Buy only (seeded rows — there is no live Amazon/Best Buy price adapter; Amazon is affiliate search-links + tag only).
- **Price history is decaying.** The 4 seed points are relative to 2026-11-02, so the 7-day view is already empty (honest empty state) and the 30-day view has 3 of 4 points. Nothing re-bases them.
- **Deal Score 100/100 on all products is a data problem, not a formula problem** — 4 points, 0 discount probability. The gate hides the badge below 5 points on main surfaces.
- 50 verified products with images/GTIN/specs is a **data task, not a code task** — it needs real merchant sources/keys, never invented data.

## Database

- **68 migration files** in `supabase/migrations/` (001–071 with gaps 024, 025, 046, 064 — plus the unnumbered `20260718060823_fix_anonymous_access_policies.sql`). 122 `CREATE TABLE` statements, 122 distinct tables, every table RLS-enabled. 617 `CREATE POLICY` statements, 273 distinct policy names (many are DROP+CREATE recreations) — re-counted at the Section 20 audit (13 Nov 2026) by the statement-start method; raw-substring counts are 123 tables / 618 policies (method-sensitive — a `CREATE` inside a comment/string changes the total).
- **Applied status of every migration is UNKNOWN from the repo** — only the owner can check `supabase_migrations.schema_migrations` in Supabase. Two are proven NOT applied live: 033 (`live_shopping_sessions` table missing — proven by a PGRST205) and 044 (`creator_slugs` view — owner step; applying it activates `/creators` 404s with no redeploy).

> **Contradiction — owner re-confirmation pending (13 Nov 2026, Sections 21–25 audit §1A A-3):** the live recheck on 13 Nov 2026 ~10:17 PKT found `/creators/unknown-slug-xyz` → **404** (confirmed twice), which is the behaviour the 044 view produces — suggesting 044 **is** applied live, the opposite of the line above. The repo cannot prove either state, so the line above is left EXACTLY as written until the owner re-confirms 044 in `supabase_migrations.schema_migrations`. Do not "fix" it from code alone.
- **34 files carry "DO NOT APPLY YET"** (035–043, 045, 047–063, 065–067, 068–071 — Sections 21–25 added 059–063, 065–067; Final 100% added 068–071; no 064 exists). In particular: **never apply 035 without a separate explicit review** (standing rule), and never apply the unnumbered `supabase/migrations/20260718060823_fix_anonymous_access_policies.sql` as-is — it would restrict public catalogue reads to authenticated users and break the public site.
- **10 owner-run SQL files** in `supabase/` (`add-*.sql`): affiliate-geo-clicks, alert-webhooks, clip-embeddings, community-deals, country-stores-directory, external-wishlist-items, public-wishlist-sharing-rls, receipt-vault, smartpools, visual-embeddings. Only run the ones the feature you are enabling needs — **not all of them**. Preconditions: 018 needs `add-smartpools.sql` first; 031 needs `add-community-deals.sql` first.
- **Known schema bugs** (Section 17 audit §4): (1) FIXED IN CODE — the admin check used to read a `profiles.role` column that does not exist in the migration chain; it now resolves the role via `role_id → roles.name` (`lib/admin-role.ts`; `/owner` layout fixed the same way in Section 18 Phase 0). Live verification is owner-gated. (2) HIGH — any signed-in user can set their own `role_id` to admin (`profiles_update_own` has no column restriction); migration 047 guards UPDATE (written, NOT applied) but not INSERT — see Section 18 audit §1 #53. (3) HIGH conditional — migration 010's 66 wide-open write policies are fixed by 017 in code, but 017's live application is unverified. Fixes are Stage H code work; live verification is owner-gated.
- **Other schema facts:** code now defines a `model_number` column on products (migration 055) and approval/published/status + price-verification-status columns (migration 045) — but both migrations are written NOT applied, so none of these columns exist live: intake approve still inserts directly → publicly visible immediately. 6 tables are RLS-enabled with zero policies (deny-all, service-client only): `api_key_usage`, `app_waitlist`, `availability_history`, `creator_reward_events`, `ebay_daily_usage`, `guest_notification_queue`.

## API tiers & quotas

See "Public API paywall" above and `API_DOCUMENTATION.md`. Anonymous 100/IP/day · Free 1,000 · Premium/Family 10,000 · Team 100,000. Quotas are per-instance in-memory until migration 035 is applied.

## Environment variables

59 literal distinct `process.env.X` names + 5 dynamic names read via `envNonEmpty()` (`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_MARKETPLACE_ID`, `AMAZON_ASSOC_TAG`, `SKIMLINKS_PUBLISHER_ID`). Counted 13 Nov 2026 by grep over `app/`, `lib/`, `services/`, `components/`, `middleware.ts` and `next.config.js` (59 literal; 56 excluding `NODE_ENV`, `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA`, which the runtime provides). `.env.example` has 36 uncommented assignment lines (68 `VAR=` occurrences including commented reference lines). The old "58 base + 18 locale" count is superseded: the locale tags are not a fixed code count — they are built dynamically as `AMAZON_ASSOC_TAG_<CC>` via `envNonEmpty()` in `services/affiliate-geo.ts`, and `.env.example` exemplifies only GB + DE. Only **2 are truly required** (the app throws at import without them): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Everything else is optional/nullable and degrades to an honest 503 or a disabled feature. Full list with placeholders: `.env.example`. Full reference: `docs/DEPLOYMENT.md`.

**Provider-key split (documented, not centralised — Sections 21–25, Stage L):** `AMAZON_CREATORS_API_KEY`, `BESTBUY_API_KEY` and `CSV_SOURCE_URL` are read directly in the providers (`services/providers/amazon-provider.ts:39`, `services/providers/bestbuy-provider.ts:32`, `services/providers/registry.ts:187`; `CSV_SOURCE_URL` also in `app/api/v1/data/refresh/route.ts:104`) and have **no entry in `lib/config/env.ts`**. That split is intentional for now — the keys stay where their providers read them; do not centralise them without a code change that wires `env.ts` through the providers.

Key facts:

- `SUPABASE_SERVICE_ROLE_KEY` is **optional / fail-closed** — without it, service-role-dependent routes return 503; the app still starts.
- `STRIPE_LIVE_LAUNCHED` is the **sole live-money gate** and is documented in `docs/DEPLOYMENT.md` and `.env.example` (it was documented nowhere before Section 17).
- `NEXT_PUBLIC_APP_URL` defaults to `https://shahjahanaibuy-b1zp.vercel.app` when unset (`lib/config/app.ts`).
- `AMAZON_ASSOC_TAG_US` is never read by code (silently ignored); the base `AMAZON_ASSOC_TAG` is used for US visitors. Tag `smartbuy-20` is verified live via the merchants API; approved vs placeholder is unknown — only the Amazon Associates dashboard can confirm.
- Dead/phantom references (docs mention, code never reads): `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, bare `VAPID_PUBLIC_KEY`, `AFFILIATE_BEACON_SECRET` (proposed, never implemented). `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH` / `NEXT_PUBLIC_ENABLE_EMAIL_VERIFICATION` in `lib/config/env.ts` ARE read — into flag defaults by `services/feature-flags.ts:15-16,49-50` (`isFeatureEnabled` / `getAllFeatureFlags`) — but no caller in `app/` / `features/` / `components/` consults the resulting flags, and Google sign-in is always offered, so the flags gate nothing in practice; email confirmation is governed by the Supabase dashboard, not code.
- **Never put a real secret in `.env.example` or in git.** Real values go only in the hosting dashboard (Vercel env) or the owner's dashboards.

## Cron jobs (6)

Exactly one scheduler: cron-job.org. All six endpoints are `CRON_SECRET`-protected (`Authorization: Bearer <CRON_SECRET>`; secret ≥32 chars):

| Endpoint | Schedule |
|---|---|
| `POST /api/v1/prices/refresh` | Every 6 hours |
| `POST /api/v1/notifications/process` | Every 5 minutes |
| `POST /api/v1/notifications/digest` | Weekly (Monday 09:00) |
| `POST /api/v1/monitoring/uptime/check` | Every 5 minutes |
| `POST /api/v1/alerts/check` | Unscheduled — no decision recorded |
| `POST /api/v1/predictions/outcomes` | Unscheduled — no decision recorded |

Whether the cron-job.org jobs exist or fire is **maloom nahi** from the repo — only the owner can verify it. There is no `vercel.json` (no Vercel Cron) and no in-repo scheduler.

## Deployment

- **Vercel, deploy on push to `main`.** No build overrides, no custom headers, no Vercel Cron.
- **Verification gate before every push:** `npx tsc --noEmit` = 0 errors, full `npx vitest run` = 100% pass, clean `next build`, headless smoke, live recheck after push. Push only on the user's live approval.
- **GitHub workflow files** (`.github/workflows/*`) cannot be pushed by the GitHub App (403) — workflow changes go via the GitHub website. `check-press-counts.yml` is still pending via web UI.
- **Press counts** are generated from real test runs (`lib/generated/press-counts.json` + `scripts/generate-press-counts.mjs`); the check fails if the JSON is stale. Note: the JSON currently says 3,981/308, matching the verified Sections 21–25 suite (308 files / 3,981 tests).

## Section 18 — Production Readiness, Security Hardening & System Reliability (12 Nov 2026)

Audit (`~/workspace/section18-audit.md`): 88 buildable, 23 owner-gated, 17 rejected, 1 already done (129 items). **86 of 88 buildable items built; 2 blocked** — #22 middleware `status` filter (blocked on migration 045 being applied) and #39 image allowlist (no real merchant image host known yet). Gate: tsc 0 errors; vitest **254 files / 3,066 tests passed, 4 skipped, 0 failed** (was 216/2,685 at audit → +38 files, +381 tests); a11y 19/19 (10 axe checks, was 7/7); clean build exit 0, 800 pages, 316 routes, product First Load 331 kB (≤350 kB ✓); lint exit 0, 0 errors, 16 warnings (lint now runs in the build — `eslint.ignoreDuringBuilds` removed). Dev smoke: `/`, `/methodology`, `/scan` → 200; guarded pages `/owner`, `/admin/refresh-runs`, `/dashboard/saved-searches` redirect to sign-in correctly with no content leaked.

Built: `/owner` layout role fix (`fetchProfileRoleName`; `.select('role')` grep now 0 hits); SSRF fix in visual search (DNS-resolve + reject RFC-1918/loopback/link-local incl. 169.254/16, 3-hop max, 30 s timeout, 8 MB cap); backup doc correction (free tier: no automated backups, manual `pg_dump` only, restore untested); error logging (`lib/api/error-logging.ts` `logApiError` + `x-request-id` on every response — 5 routes / 10 call sites wired, ~172 routes remain); audit-log wiring + append-only (017 file only); error-log store (migration 048, file only) + writer wired into `logApiError`; webhook status (049) + digest failures (050); CSRF Origin check; Zod on intake/alerts/checkout; auth hardening (resend cooldown, rate-limited reset proxy, sign-up enumeration closed, email-verification dashboard gate); health honesty (degraded → 503); Stripe webhook limit 120 → 30/min/IP; migrations 051 (FKs), 052 (atomic refresh guard), 053 (quota RPC) — all file only; guard fail-open narrowed to missing-table-only (PGRST205/42P01, coordinator decision); 40 `loading.tsx` added (56 → 96 of 121); RLS CI harness (skips without Postgres). Extra finds: Section 17 047 UPDATE trigger could never fire (`SECURITY DEFINER` + `current_user` = `postgres`) — fixed in-file to `auth.uid()`, NOT applied; 11 gate failures fixed after the first full run. Docs: `docs/production-readiness-report.md`, `docs/security-audit-report.md`, `docs/system-health-report.md`, `docs/section-18-summary.md`. Owner-gated remainder unchanged (23 items): applying migrations 026–053 (035 only after separate explicit review; 044 is the single remaining step for Section 16), live checks, Stripe live, eBay, Skimlinks, Resend + VAPID, keys, Sentry dashboard + UptimeRobot, backup decision, 50 verified products, live verification round. Known limits: prices still stale (2026-11-02); Deal Score still 100/100; imageUrl/gtin null on all 10 products; Sentry liveness unverified; live signed-in admin verification not done.

## Section 19 — AI Intelligence Engine & Smart Shopping Decision System (12–13 Nov 2026)

Audit (`~/workspace/section19-audit.md`, §12): 98 buildable, 25 owner-gated, 22 rejected, 42 already done (187 items). Gate: tsc 0 errors; vitest **286 files / 3,425 tests passed, 4 skipped, 0 failed** (was 254/3,066 at audit → +32 files, +359 tests; 31 Section 19 test files); a11y 31 tests / 5 files, all pass (was 19/19); lint 0 errors, 0 warnings (was 16 warnings); clean build exit 0, 802 pages, 338 routes, product First Load 338 kB (≤350 kB ✓), homepage 323 kB, `/scan` 316 kB; `logApiError` 178/187 route files wired, 245 call sites.

Built: central AI engine (`services/ai-engine/`, 13 adapters, 9 deterministic + 4 live, 14 capabilities, fallback with `fallbackUsed`); per-user daily quota 300 + tightened anon caps (ai-search 10/min, visual-search 5/min, scan 5/min) + daily provider budgets (SerpAPI 5, HF 50) + 80% spend-alert surface; retry (3 attempts, retryable-only) + circuit breaker (5 failures, 60 s cooldown); `maxDuration = 60` on 9 AI routes; provider-health wiring (`reportAiProviderHealth`); OLS forecast (`lib/forecast.ts` — ranges, flat-series R² fix, 25% thin-history cap, walk-forward backtest with null accuracy on zero trials); discount-probability guards (< 5 points → guarded 0, null expected price/date); buy-or-wait verdicts `track_price` + `compare_alternatives` + budget input (never `buy_now` above budget); prediction-outcomes recorder (storage owner-gated on migration 032); summary/deal/comparison honesty fixes (no invented brand/quality claims, derived-%-or-null, featured gate, value ranking, dedupe); Deal Score badge hidden below 5 points; transparency block; SSRF cache-after-guard; OpenAI `enabled` flag removed (deterministic-only scope explicit). Migration 054 (deals UNIQUE, DO NOT APPLY) written, not applied. Docs: `docs/ai-engine-architecture.md`, `docs/ai-product-analysis.md`, `docs/price-prediction-documentation.md`, `docs/decision-engine-documentation.md`, `docs/ai-security-report.md`, `docs/section-19-summary.md`. Coordinator decisions: LLM flag removed, Deal Score withheld < 5 points, jobs stay in-process/cron (no Upstash/BullMQ), `error_log` server-errors-only (5 typo call sites reverted). Flaky-test truth: the audit's flaky episode never reproduced in 4 full runs; the one deterministic gate failure was the stale press-counts pin, fixed by re-locking. Known limits: prices still stale (2026-11-02); 0 reviews / 0 specs; prediction-outcome storage needs 032; `error_log` storage needs 048; no image-host allowlist yet.

## Section 20 — Verified Product Data Intelligence & Automated Catalog Expansion (13 Nov 2026)

Audit (`~/workspace/section20-audit.md`, §12, 13 Nov 2026 ~08:31 PKT): 54 buildable, 21 owner-gated, 8 rejected, 28 already done (111 items). Gate: tsc 0 errors; vitest **296 files / 3,773 tests passed, 4 skipped, 0 failed** (was 286/3,425 at audit → +10 files, +348 tests; 10 Section 20 test files); a11y 31/31 (5 files); lint 0 errors, 0 warnings; clean build exit 0, 805 pages, `/products/[slug]` First Load 338 kB (≤350 kB ✓), homepage 323 kB, `/scan` 316 kB; API routes 190/258 (+3 files, +5 handlers); migrations 56 files, 22 DO NOT APPLY (055–058 added, all NOT applied). Pushed 13 Nov 2026 ~09:57 PKT (3 commits, 134 files, HEAD `81505fd8`); live recheck 10:17 PKT **29/29 PASS — SECTION 20 FULLY LIVE**.

Built: 5 P0 honesty fixes — `/status` now says Best Buy `recorded-prices-only` and Amazon `tag-only`; AI inputs carry a typed `AIEngineInput` (`priceVerificationStatus` + `dataFreshness`) and `verifiedDataLabel` is appended only when every product is verified AND fresh; price alerts gated on `STALE_PRICE_DAYS = 7`; discounts labelled "vs list price"; the 50-floor on `confidence_score` removed and the score decoupled from Deal Score, AI deal ranking and recommendations (public label now "Data completeness"). New: GS1 GTIN validation (`lib/gtin.ts`), image-URL validation (`lib/image-url.ts`), spec templates (`lib/spec-templates.ts`), 7-dimension product quality score (`services/product-quality-score.ts`), merchant-reliability score, admin product/data-quality services; `/admin/products` + `/admin/ingestion-failures` + `/admin/ai` data-quality panel; 3 new API routes (`/api/v1/admin/data-quality`, `/api/v1/admin/products`, `/api/v1/admin/products/{id}`); migrations 055–058 written NOT applied (model number, GTIN partial UNIQUE, price-history source flags, per-spec attribution); `track_price` redefined (near-low ≤5% above low + confidence ≤45% + no rising trend). Gate fixes: 51 old tests updated to the intended behaviour + 2 genuine code fixes (personal-assistant 1–4-point copy; buy-wait "13" token match); client-bundle boundary fix (CSV hardening pulled `node:dns`/`node:net` into the browser bundle — constants moved to `lib/intake-sources.ts`, pinned by test). Docs: `docs/product-data-architecture.md`, `docs/merchant-integration-guide.md`, `docs/product-verification-policy.md`, `docs/catalog-quality-report.md`, `docs/price-data-pipeline.md`, `docs/section-20-summary.md`. Deviations (documented): per-spec attribution PARTIAL (migration 058 + writer exist, no production spec-write path); Deal Score rebase deferred (still 100/100 on the live 4-point series, withheld <5 points). Known limits: **products 10 → 10 (0 added) — honest shortfall, no verified source**; images/GTINs/specs/reviews/variants/fresh prices/verified prices all still 0/10; prices still stale (2026-11-02). The same recheck also proved Section 16 FULLY LIVE: `/creators/unknown-slug-xyz` → 404, suggesting migration 044 is applied live — see the contradiction note in Database above; owner re-confirmation is pending.

## Verification status (baseline, 13 Nov 2026)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| Full `npx vitest run` | 296 files / 3,773 tests — 100% PASS (4 skipped, 3,777 total) |
| Clean build (13 Nov gate, Section 20) | exit 0, first run, no sitemap failure, 805 pages, `/products/[slug]` First Load 338 kB (budget ≤350 kB), homepage 323 kB, `/scan` 316 kB |
| a11y | 31 tests / 5 files, all pass (10 axe checks + 21 render tests — honest label; runtime axe checks; local gate only, not CI) |
| lint | 0 errors, 0 warnings |
| i18n | 167 keys, 20 languages |
| Live recheck (12 Nov 20:20 PKT, Section 17) | 22/22 PASS — SECTION 17 FULLY LIVE; `/creators` unknown slug → 200 EXPECTED until migration 044 is applied (earlier recheck 12 Nov 18:25 PKT: `/live` unknown slug → 404 PASS; regressions PASS) |
| Live recheck (Section 19) | 2026-11-13 07:02 PKT, 25/25 PASS — SECTION 19 FULLY LIVE, goal completed |
| Live recheck (Section 20) | 2026-11-13 10:17 PKT, 29/29 PASS — SECTION 20 FULLY LIVE, goal completed; `/creators` unknown slug → 404 (see the 044 contradiction note in Database — owner re-confirmation pending) |

Known live gaps (13 Nov 2026 gate): newsletter subscribe 503 (036 unapplied); `/live` has no data (033 unapplied); uptime monitoring shows 0 (032 unapplied); homepage First Load 323 kB vs its ≤250 kB warning budget (over, warning only); no test asserts any bundle size; mobile/responsive is unproven (no viewport export, no mobile test, `docs/responsive-qa.md` is code-inspection only); Sentry event flow unproven live; guest merge, admin login, Stripe test checkout, email/push delivery and cron firing never proven live.

## What is owner-gated (not code work)

- Applying migrations 026–058 (each, in order, with preconditions) and verifying 001–025 in `supabase_migrations.schema_migrations`. Owner checklist for 045–058: `docs/owner-checklist-045-058.md`.
- Live checks: `profiles.role` column, `pg_policies` for 017, one admin login attempt.
- Stripe live keys + `STRIPE_LIVE_LAUNCHED=true` + price decision ($1 vs $4.99 vs $9.99) + live launch checklist. Premium $9.99/month is the **planned** price, not a live charge.
- eBay keys + EPN + Growth Check + `ebay` row in the live `merchants` table.
- Amazon Associates approval check for `smartbuy-20`; Skimlinks application (do NOT apply without explicit go-ahead — rejection blocks reapplying for 90 days).
- `RESEND_API_KEY` + verified sender domain; VAPID key pair; `CRON_SECRET` + `SMART_HOME_WEBHOOK_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` in Vercel; Upstash Redis vars; HF token, Sentry DSN, PostHog/GA4/Meta keys, WhatsApp/Telegram tokens, R2 keys, SerpAPI key.
- cron-job.org: verify the 6h refresh job + 5-min uptime job exist/fire; decide the fate of the 4 unscheduled cron endpoints.
- Search Console / Bing Webmaster verification; Supabase 2FA redo; adding `shahjahanaibuy-mobile` to the Muse GitHub App installation.
- 50 verified products with images/GTIN/specs — real merchant data, never fake.

## What is blocked (do NOT build)

Agentic checkout, voice skills, native app (mobile repo is README-only; `/mobile-app` is waitlist-only), Recall Alerts, Review Summarizer (0 reviews — engine exists), Size & Fit, Photo Authenticity, Video Summaries, Family Shopper, scraping including Apify (`APIFY_API_TOKEN`/`APIFY_ACTOR_ID` must stay unset), inventing products/prices/reviews/statistics, Next.js major upgrade (13.5.9 → 15.x) as part of Section 17, applying migration 035 without a separate explicit review, applying the unnumbered `fix_anonymous_access_policies.sql` as-is.

## Docs map

- This file — project overview (start here).
- `README.md` — entry point: setup, scripts, deployment, links.
- `docs/DEPLOYMENT.md` — deployment, env vars, migrations, cron, Stripe live gate.
- `API_DOCUMENTATION.md` + `docs/openapi.json` — API reference (197 routes).
- `docs/rate-limits.md` — per-route rate limits. `docs/production-readiness-report.md`, `docs/security-audit-report.md`, `docs/system-health-report.md`, `docs/section-18-summary.md` — Section 18 reports (12 Nov 2026). `docs/ai-engine-architecture.md`, `docs/ai-product-analysis.md`, `docs/price-prediction-documentation.md`, `docs/decision-engine-documentation.md`, `docs/ai-security-report.md`, `docs/section-19-summary.md`, `docs/ai-background-jobs.md` — Section 19 reports (13 Nov 2026). `docs/product-data-architecture.md`, `docs/merchant-integration-guide.md`, `docs/product-verification-policy.md`, `docs/catalog-quality-report.md`, `docs/price-data-pipeline.md`, `docs/section-20-summary.md` — Section 20 reports (13 Nov 2026). `docs/owner-checklist-045-058.md` — owner checklist for migrations 045–058. `docs/section-21-25-summary.md` — Sections 21–25 summary (Stage A audit, 13 Nov 2026; build counts filled at gate time). `docs/affiliate-engine.md`, `docs/performance-budgets.md`, `docs/pwa.md`, `docs/alerts-delivery-setup.md`, `docs/sentry-triage.md`, `docs/uptime.md`, `docs/seo.md`, `docs/security-hardening.md`, `docs/visual-search.md`, `docs/responsive-qa.md`, `docs/search-console.md`, `docs/design-system.md` — current topic docs.
- Root July 2026 docs (`DATABASE_SCHEMA.md`, `LAUNCH_CHECKLIST.md`, `PROJECT_ARCHITECTURE.md`, `QA_REPORT.md`, `SECURITY_AUDIT.md`, `FINAL_DEPLOYMENT_REPORT.md`) + `DEPLOYMENT_PREP.md` + `phase5-summary.md` — **frozen historical snapshots, do not use for current numbers** (see the banner on each file).
- Section audits: `~/workspace/section17-audit.md` (not in this repo), `~/workspace/section16-audit.md`, `~/workspace/section15-audit.md`.
