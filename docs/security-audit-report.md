# SmartBuy AI — Security Audit Report (Section 18)

**Section 18 report — Production Readiness, Security Hardening & System Reliability. Dated 12 November 2026.**
**Gate (verified, coordinator run, 12 Nov 2026):** `npx tsc --noEmit` 0 errors · full vitest **254 files / 3,066 tests passed, 4 skipped (3,070 total), 0 failed** (baseline at audit: 216 files / 2,685 tests → +38 files, +381 tests) · `npm run test:a11y` **19/19 PASS** (10 axe checks, was 7/7) · `npm run check:press-counts` OK, `lib/generated/press-counts.json` re-locked to 3,066/254, dated 2026-11-12 · clean build (placeholder env) exit 0, first run — **800 static pages, 316 routes** · First Load: `/products/[slug]` **331 kB** (budget ≤350 kB ✓), homepage `/` 322 kB, `/scan` 315 kB · `npm run lint` exit 0, 0 errors, 16 warnings (lint now runs in the build — `eslint.ignoreDuringBuilds` removed from `next.config.js`).
**Source of every number here:** the Section 18 gate run above, or a count against this repo on 12 Nov 2026. Anything not verified this way is labelled owner-gated or unverified, never presented as done.

> Scope: Section 18 audit (`~/workspace/section18-audit.md`, 12 Nov 2026) — 88 buildable items, 23 owner-gated, 17 rejected, 1 already done. This report covers the security findings: what was fixed in code, what the tests prove, and what still needs the owner. It does not claim a live security posture — live verification is owner-gated (see §5).

## 1. HIGH findings — fixed in code

### 1.1 `/owner` layout read a nonexistent `profiles.role` column (audit §1 #1 — HIGH)
Section 17's admin fix missed this surface. The `/owner` layout read `profiles.role`, a column that does not exist in the migration chain (only the `role_id` FK exists). **Fixed:** it now uses `fetchProfileRoleName` — the same `role_id → roles.name` pattern as `app/admin/layout.tsx`. Repo-wide grep for `.select('role')` now returns **0 hits**. Live impact before the fix: anonymous users got a streaming redirect to `/sign-in` (no leak — verified in the dev smoke: guarded pages return HTTP 200 with the `NEXT_REDIRECT;replace;/sign-in?reason=session-expired` digest + meta refresh, no owner/admin content). The risk was for signed-in admins only. **Live verification of the fix is still owner-gated** (one admin login attempt).

### 1.2 SSRF in visual search (audit §1 #2 — HIGH)
`fetch(imageUrl)` had only a protocol guard — any server-side URL could be fetched. **Fixed:** DNS-resolve the host first and reject RFC-1918 / loopback / link-local addresses including 169.254/16, `redirect: 'manual'` with max 3 hops, 30 s timeout, 8 MB cap. Build note: the `node:dns/promises` + `node:net` imports were split into a client-safe module `services/visual-search-client.ts` because `app/scan/page.tsx` is a client component; the guard itself is untouched.

### 1.3 No backup exists; backup claims in docs were false (audit §1 #3 — HIGH)
`DEPLOYMENT.md` implied automated backups. **Fixed in docs:** the free tier has **no automated backups**; manual `pg_dump` is the only recovery path; restore is **untested**. The owner decision (Pro $25/mo vs manual/CI `pg_dump`) is owner-gated.

### 1.4 API errors invisible (audit §1 #4 — HIGH)
137/181 API routes logged nothing; zero `captureException` calls in API routes. **Fixed (partially, honestly):** `lib/api/error-logging.ts` (`logApiError`) + `lib/api/request-id.ts` exist; `x-request-id` is on every response via middleware; **5 routes / 10 call sites wired so far — the remaining ~172 routes have not yet adopted `logApiError`.** The `error_log` writer is wired into `logApiError` (best-effort, missing-table tolerant); the table is migration 048, file only, NOT applied.

### 1.5 Audit logging incomplete + not append-only (audit §1 #5 — HIGH)
`recordAdminAction` had 0 callers, and migration 017 let admins UPDATE/DELETE audit rows. **Fixed:** `recordAdminAction` is now wired into merchant verify, community-deal moderate, newsletter send, and visual-search backfill; intake audit-insert failure now goes to `logger.error`. Append-only: the UPDATE/DELETE audit policies were dropped from migration 017 (file only — **re-apply check is owner-gated**; 017's live application was already unverified before Section 18).

## 2. Other hardening built in Section 18

- **CSRF:** Origin check on cookie-authed mutations.
- **Input validation:** Zod schemas on intake, alerts, and checkout routes.
- **Auth:** resend cooldown + rate-limited reset proxy; sign-up enumeration closed; reset-link expiry UX; email-verification dashboard gate with 7-day skip cookie; auth-error mapping; OAuth error mapping; session-expired banner.
- **Stripe webhook:** limit tightened 120 → 30/min/IP (Stripe retries 429s, so the lower limit only blunts floods of invalid-signature requests); signature test added (5 tests, real SDK, fake test keys); webhook status persistence — migration 049 + outcome update + reprocess-on-retry in `services/stripe.ts` (file only).
- **Admin enforcement:** `requireAdmin` deny test (7 tests, real middleware).
- **Refresh guard (coordinator decision, item 35):** fail-open narrowed to missing-table-only (PGRST205 / 42P01). Failing open on ANY error risked duplicate concurrent runs writing conflicting price history; failing closed on a guard error costs at most one 6 h refresh cycle. Tests prove missing-table still starts unguarded and other errors fail safe (`{started:false, reason:'guard-error'}`).
- **Secrets hygiene:** `REDIS_URL` is no longer logged. No hardcoded secrets found by grep (unchanged). No secret is in this report or in git.
- **PII:** log PII fix applied (API reliability pass).
- **Error messages:** dynamic error messages replaced with a generic envelope; refresh `loadError` sanitiser + call-site wiring.
- **Database:** soft-delete filters via `lib/public-products.ts`; FK migration 051, refresh-guard atomic migration 052, quota RPC migration 053 — all file only, code has fallbacks until applied; webhook 23505 handling; pipeline dual-rep fix.
- **Self-promotion guard (pre-existing, Section 17):** any signed-in user could set their own `role_id` to admin (`profiles_update_own` has no column restriction). Migration 047 guards UPDATE (written, NOT applied) but not INSERT — see audit §1 #53. **Extra find in Section 18:** the Section 17 047 UPDATE trigger could never fire — `SECURITY DEFINER` + `current_user` check always equals the function owner (`postgres`); fixed in the file to `auth.uid()` (file only, NOT applied). **This is not live protection until the owner applies the fixed 047.**
- **RLS:** migration 010's 66 wide-open write policies are fixed by 017 **in code**, but 017's live application is unverified (owner-gated). RLS CI execution harness added — skips gracefully without Postgres; CI setup documented in the test header (needs `postgres:16` + `S18_RLS_DATABASE_URL`).

## 3. What the tests prove

- Full suite: **254 files / 3,066 tests, 0 failed** (gate, 12 Nov 2026).
- Stripe webhook signature: 5 tests, real SDK, fake test keys.
- `requireAdmin` deny: 7 tests, real middleware.
- Account deletion: route returns **422, not 400**, for wrong confirmation — by design.
- Guard fail-open: missing-table starts unguarded; other guard errors fail safe.
- bnpl-line test wired (renamed to `.test.ts`; `vitest.config.ts` gained `esbuild: { jsx: 'automatic' }` — any test importing a `.tsx` component was failing before).
- Route 429 test, bad-input tests, signup→dashboard + checkout tests, alert route test, viewport-meta render test.

## 4. NOT built / still open

| Item | Status |
|---|---|
| #22 middleware `status` filter | Blocked on migration 045 being applied (owner-gated). |
| #39 image allowlist | Blocked until a real merchant image host is known — none known yet. |
| `logApiError` adoption | 5 routes / 10 call sites wired; ~172 routes remain. |
| 047 INSERT guard | Not built — 047 guards UPDATE only (and the trigger fix is file-only until applied). |
| RLS live probe | Owner-gated — needs the owner in Supabase. |
| Sentry liveness | Unverified — DSN presence unknown (owner-gated). |
| Live signed-in admin verification | Not done (owner-gated). |

## 5. Owner-gated security actions (from audit §12 — code prepares the switch)

Applying migrations 026–053 (035 only after separate explicit review; 044 is the single remaining step for Section 16; 017 re-apply check; 045 dupes check first; 036 only the fixed file); live checks (`profiles.role` column, `pg_policies` for 017, one admin login attempt); Supabase dashboard auth settings; Stripe live (keys + `STRIPE_LIVE_LAUNCHED=true` + webhook live test); Skimlinks application (no go-ahead — rejection blocks reapplying for 90 days); Resend + VAPID; cron/service secrets; Upstash + 035; keys (HF, Sentry DSN, PostHog/GA4/Meta, WhatsApp/Telegram, R2, SerpAPI); Sentry dashboard + UptimeRobot; backup decision (Pro $25/mo vs manual/CI `pg_dump`); Supabase 2FA redo; Search Console + Bing Webmaster; RLS live probe.

## 6. Standing rules re-confirmed

Free tiers only; never invent data; no scraping; secrets only in owner dashboards; never apply a migration without the owner's explicit approval for that migration; never apply 035 without a separate explicit review; never apply the unnumbered `fix_anonymous_access_policies.sql` as-is (it would restrict public catalogue reads to authenticated users and break the public site).
