# Sections 21–25 Summary — MEGA IMPLEMENTATION | Production-Level Expansion

**Started:** 13 November 2026, 10:27 PKT
**Goal:** `smartbuy-sections-21-25-mega-implementation-production-level-expansion`
**Status:** STAGE A AUDIT COMPLETE — build in progress. Push NOT done — user
approval pending (standing rule: push only on the user's live approval).
Built counts below are marked **TO BE FILLED AT GATE TIME** — the
coordinator re-locks final test counts at gate time. Nothing in this file
is a live claim until the gate + live recheck say so.
**Docs:** `docs/section-21-25-summary.md`, this file.
**Audit:** `~/workspace/sections21-25-audit.md` (13 Nov 2026 ~10:46 PKT,
amended ~11:05 PKT).

> Sections 21–25 are a trust-and-correctness mega-implementation, not a
> page-building one. Its honest headline (audit §6): the code delta is
> large (109 buildable items) but the *data* delta is almost entirely
> owner-gated. No amount of code adds a verified product today; the only
> live source is eBay after owner unblocks, and even then only as thin
> listings. The build leads with the P0 honesty fixes — they are the only
> items that change what users see without an owner step. Two brief
> premises were wrong and are corrected before any building: there is NO
> Prisma in this project (Supabase-only) and NO BullMQ (the queue is
> in-process `SynchronousQueue`; the `BullMQQueue` adapter exists in code
> but the package is not installed).

## Scope (15 areas, 8 stages, per the brief)

1. Merchant integration architecture — 2. Product ingestion / catalog
   quality — 3. Automated price monitoring — 4. AI decision engine
   improvements — 5. Alerts / notifications — 6. Admin control center —
   7. Security / testing / deployment verification — 8. Documentation.
   Stages: A audit + baseline, B merchant integration architecture,
   C product ingestion / catalog quality, D automated price monitoring,
   E AI decision engine improvements, F alerts / notifications, G admin
   control center, H security / testing / deployment verification.

Strict rules carried over: preserve Sections 1–20; audit first, build
only the delta; never rebuild a working feature; never fake
data/prices/images/reviews/GTINs; never activate unapproved merchant
integrations; never bypass provider restrictions; no scraping (including
Apify — banned); no treating affiliate links as product-data APIs; never
apply migration 035; never apply any production migration without
explicit owner approval; no force-push; no secrets in git; minimal
targeted changes; gate before push.

## Audit totals

Audit (`~/workspace/sections21-25-audit.md`, §12, 13 Nov 2026): **197
items — 109 BUILDABLE / 23 OWNER-GATED / 9 REJECTED / 56 ALREADY DONE**
(P0 4, P1 48, P2 80; findings 132). By stage: A 8, B 21, C 18, D 15,
E 24, F 17, G 16, H 17, I 14, J 24, K 13, L 10.

Top 5 (audit §1):

1. **P0 — Comparison verdicts carry a "verified" label on unverified +
   stale prices** (`services/ai-comparison.ts:328`). BUILDABLE.
2. **P0 — Guest alerts have NO stale gate** ("is now $Y!" on 11-day-old
   prices once Resend is configured). BUILDABLE.
3. **P0 — Self-promotion hole is open live unless migration 047 is
   applied** (`profiles_update_own` restricts the row, not the columns).
   OWNER-GATED.
4. **P0 — Amended migration 017 runs OLD in the live DB; audit logs are
   tamperable.** OWNER-GATED (re-run amended 017 + 028 blocks, verify
   via `pg_policies`).
5. **eBay doubly blocked + 045/048/040/057 unapplied.** OWNER-GATED.

## Baseline (audit Stage A, re-measured 13 Nov 2026 ~10:29–10:36 PKT)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| Full `npx vitest run` | **296 files / 3,773 tests passed, 4 skipped (3,777 total), 0 failed** (identical to the Section 20 gate; clean serial run via `scripts/run-tests-with-log.mjs` — a parallel-load run flaked 4 tests in 3 files, so gate runs must be clean serial runs) |
| `npm run test:a11y` | **31/31 (5 files)** — honest label: 10 axe checks + 21 render tests |
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run check:press-counts` | **OK — 3,773 tests / 296 files** |
| Clean build | **exit 0 — 805 pages** (Section 20 gate; not re-run, tree unchanged); `/products/[slug]` First Load **338 kB** ≤ 350 kB ✓; homepage 323 kB; `/scan` 316 kB |
| API routes | **190 files / 258 handlers** (GET 137, POST 86, DELETE 18, PATCH 13, PUT 4); `docs/openapi.json` matches exactly |
| Migrations | **56 files, 22 DO NOT APPLY** (001–058, gaps 024/025/046) |
| i18n | **167 keys**, 20 languages |
| Pages / tools / stores | **126 pages**, 36 AI tools, 84 stores, 19 Amazon locales |
| Cron endpoints | **6** CRON_SECRET endpoints (only the 6h price refresh is scheduled; 4 are unscheduled, fate undecided) |

## Catalogue truth the section starts from

10 products; images 0/10, GTINs 0/10, specs 0/10, reviews 0/10, variants
0/10, fresh prices 0/10, verified prices 0/10; 40 price-history rows,
Amazon only; 2 merchants, seeded rows only; prices stale since
2026-11-02; honest 7-dimension quality score 25/100 (poor), ceiling 35
even after 045 applies. Full per-product table and the honest
50-product assessment: audit §2 + §6.

## Honest 50-product assessment (audit §6)

- **Today, no owner action: 10 → 10 verified (0 added).** Nothing in
  code can add a verified product without keys.
- **After the eBay unblock only** (keys + EPN/Growth Check + `merchants`
  row `slug='ebay'` + migration 045): **10 → 50 reachable, but only as
  thin hand-annotated eBay listings** (no GTIN/specs/variants/history).
- **50 FULLY-verified** (specs + GTIN + images + history) is **NOT
  reachable in Sections 21–25 by any path**.
- If eBay stays unavailable, the shortfall is the full 40.

## What was built

**TO BE FILLED AT GATE TIME.** The build covers the 109 BUILDABLE
items in audit §12, in the §13 order: (0) git hygiene — verify the
tree against remote HEAD in a full clone and resolve the staged
`bnpl-line` rename before any push; (1) P0 honesty fixes — comparison
"verified" label + guest-alert stale gate; (2) provider truthfulness —
loud failures, `getNotConfiguredReason()` wiring, circuit-breaker reads,
real provider-health writes, no silent `getForRetailer` fallback,
timeout/retry/size caps, per-merchant rate limits; (3) AI honesty —
forecast freshness, claimed-discount validation before ranking,
merchant-reliability wiring, recommendation audit history,
`AIEngineInput` consumption, P2 copy/label fixes, durable AI usage
ledger file; (4) catalog pipeline — spec-write path + templates for the
6 uncovered categories + admin spec verify/correct path, GTIN gate on
admin PATCH, CSV fuzzy leg + persisted rejections, image
upload/allowlist code, variant support design; (5) refresh integrity —
close R1–R3 re-stamp paths, "last successful update" timestamp,
chain-level retry, eBay budget only on success, currency end-to-end;
(6) transparency — 5-state taxonomy, honest quality score to the
public surface, bare "% off" on digest/RSS/smart-deals, ai-search "%
match" + similar `matchScore`, `/status` static-dir labels; (7) admin
hardening — 4 unaudited mutations, uniform CSRF or documented cookie
verdict, defense-in-depth role re-checks, Zod for mutating routes,
newsletter clamp, audit-log viewer, alert-delivery + background-job
monitoring, sign-in/sign-up proxy + limit, `logApiError` wiring,
ai-comparison N+1, dead `createAuditLog`, `price_refresh_runs.error`
scrub; (8) tests + docs — route-guard tests, Lens guard test,
ingestion-failures coverage, refresh-fetches-nothing tests, coverage
measurement, fake-timer discipline, project-summary + DEPLOYMENT
re-lock, owner checklist 045–058, section-20-summary header fix, env
count reconcile, TELEGRAM doc fix; (9) migrations as files — fix 057
in place, write 059–062, guard-wrap 018/031 (only if not yet applied
live), migration note for the unnumbered-file conflict.

**Docs built in Stage L (audit §12, already done — not pending):**
project-summary.md re-lock (11 stale places + new Section 20 section),
`docs/DEPLOYMENT.md` re-lock (6 stale places + 045 duplicate-check
runbook step), `docs/section-20-summary.md` header fix (pushed 09:57
PKT, 29/29 live recheck), `docs/owner-checklist-045-058.md` (new),
env count re-lock with stated method + provider-key split documented
(59 literal + 5 dynamic; `.env.example` 36 assignment lines),
TELEGRAM_CHAT_ID doc fix, README.md re-lock (296/3,773, 805 pages,
190/258), frozen phase3/4/5-summary.md banner lines re-locked,
`docs/rate-limits.md` regenerated from the live tree (258 handlers,
+98), stale "BullMQ-ready" claims in `PROJECT_ARCHITECTURE.md`
corrected (BullMQ NOT installed; queue is in-process
`SynchronousQueue`).

## Accepted deviations / partial items

- **J-P1-4 / G-P2-1 (schema validation) — PARTIAL, accepted.** Helper + ~700-line schemas exist (`lib/api/validation.ts`); adoption is **16/105 mutation route files** (admin slice complete: 10/10 admin mutation files). The other 89 non-admin routes still hand-roll `typeof` checks (or none) — a full sweep was not attempted: each route needs its schema wired plus per-route test updates for the changed 400 shape, a large risky sweep after the gate-critical fixes. The header claim in `lib/api/validation.ts` now states the true counted numbers.
- **K10(b) (refresh run status) — KNOWN GAP, pinned in test, accepted.** The refresh route records a no-provider run as `'completed'` (deliberate documented design: 'completed' means the chain executed without a step failing; fetch-nothing is visible in `steps.pipeline.result`, `available: false, reason: 'no-available-provider'`). The service-level guarantee is real and tested: no provider → processor never called, zero writes, no success stamp, no `last_successful_update`. Changing the run-level status would break the documented contract and the `/admin/refresh-runs` UI; left for a deliberate follow-up, not hidden — pinned as KNOWN GAP in `tests/section21-refresh-fetches-nothing.test.ts`.
- **E-P2-4 — comments only.** User-facing "AI-powered" copy is fixed; two code comments (`services/chat.ts:3`, `services/ai-search.ts:2`) still say "AI-powered" — comments, not user-facing copy; left alone.
- **K9 (CI for the main suite) — file only, upload owner-gated.** `.github/workflows/check-main-suite.yml` created (runs `npm run test:ci-log` on PR + push to main) but workflow files cannot be pushed by the GitHub App (403) — the owner must upload it via the GitHub website, same as `check-a11y.yml` + `check-press-counts.yml`. Excluded from push-paths.
- **Severity dissent (audit §12):** Worker J rated the in-process DLQ job-loss P1; coordinator keeps P2 — bounded impact: 10-product catalog, 6h cron re-runs recover.
- **Migration 057** fixed in file (DO-block guard) before it is applied; **018/031** guard-wrap applies only if not yet applied live.
- **`npm audit` unverifiable in sandbox** (403 `policy_denied`) — dependency vulnerabilities are UNVERIFIED, not "0 vulnerabilities"; run on a dev machine / CI.
- **044 doc-vs-live contradiction:** project-summary.md says 044 NOT applied, live recheck says 404 (applied) — the line is left EXACTLY as written until the owner re-confirms 044 in `supabase_migrations.schema_migrations`.
- **Closed in the finish slice (not deviations):** A10 (scorer is live — the audit's "dead code" claim was false; reconciliation note added), B10 (boot-time validation via `instrumentation.ts`), E-P2-1 (engine attaches `inputFreshness`), G-P1-1 (read-only `/admin/users` page), flaky markers (`vi.waitFor` 0, 60s timeout → 10s proven by timing), K10 service-level pins, J-P1-4 admin slice.

## Verification gate (Sections 21–25)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors** (measured by the resume coordinator after the finish slice, and re-measured after every worker batch) |
| Full `npx vitest run` | **308 files / 3,981 tests passed, 4 skipped (3,985 total), 0 failed** — clean serial run via `scripts/run-tests-with-log.mjs` (baseline: 296 files / 3,773 tests; +12 files, +208 tests) |
| `npm run test:a11y` | **31/31 (5 files)** — honest label: 10 axe checks + 21 render tests |
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run check:press-counts` | **OK — 3,981 tests / 308 files** (committed JSON matches the fresh run; the pin test in `tests/press-counts-json.test.ts` was re-locked from the interim 305/3,916 baseline to the final 308/3,981 — the two earlier FAILs were that stale pin, not a suite failure) |
| Clean build | **exit 0 — 809 pages** (baseline 805; +4: `/admin/users`, `/admin/products/[id]/specs` + 2 route-group pages); `/products/[slug]` First Load **350 kB** — at the 350 kB budget boundary (was 338 kB; watch item, see below); homepage 325 kB; `/scan` 318 kB; `/sitemap.xml` generated, no sitemap failure; 1 pre-existing third-party warning (`@google/model-viewer` critical-dependency expression — not S21–25 code, 0 model-viewer files in the push) |
| API routes | **197 files / 266 handlers** (GET 142, POST 88, DELETE 18, PATCH 14, PUT 4); `docs/openapi.json` matches exactly (197 paths / 266 ops); `API_DOCUMENTATION.md` route table verified row-for-row against the tree (197 rows, 0 missing / 0 extra / 0 method mismatches) |
| Migrations | **64 files, 30 DO NOT APPLY** (035–043, 045, 047–063, 065–067; no 064 exists); new files 059–063, 065–067 written, NOT applied (059 data-quality persistence, 060 price_history currency_code, 061 merchant_reliability, 062 log-table FKs, 063 alert expiry + alert_type CHECK, 065 AI recommendation audit, 066 products last_successful_update, 067 AI usage ledger) |
| i18n | **167 keys** (DictKey union counted — unchanged) |

## What is still data-blocked (not a code gap)

- Verified products: 0 new without eBay unblock (keys + EPN/Growth
  Check + `merchants` row + 045).
- Images / GTINs / specs / reviews / variants: 0 for every product; no
  source in the tree can supply them at scale.
- Prices still stale (2026-11-02) until a live feed exists; refresh
  re-reads the DB only (R1–R3 re-stamp residue is a build item, the
  empty live feed is not).
- Prediction-outcome storage needs migration 032; `error_log` storage
  needs 048; refresh-run recording needs 040; atomic guard needs 052.

## Owner-gated remainder

- Applying migrations in the §9 runbook order: `add-community-deals` +
  `add-smartpools` first → 026–034 → 036–043 → 044 (see the 044
  contradiction note — owner re-confirmation pending) → 045 (duplicate
  check first) → 047 → 048–050 → 051 (orphan check) → 052
  (running-count check) → 054 + 056 (duplicate checks) → 057 (after
  file fix) → 058 → then new 059–062. **035 and 053: never apply by
  the build; 035 only if the owner explicitly lifts the durable-quota
  ban, 053 only after 035.** Full checklist:
  `docs/owner-checklist-045-058.md`.
- Re-run amended 017 + 028 blocks and verify via `pg_policies`
  (audit-log tamperability, P0 #4).
- eBay keys + EPN + Growth Check + `merchants` row `slug='ebay'`.
- Amazon Associates approval check for `smartbuy-20`; Skimlinks
  application (do NOT apply without explicit go-ahead — rejection
  blocks reapplying 90 days).
- `RESEND_API_KEY` + verified sender domain; VAPID keys;
  `CRON_SECRET` + Upstash Redis vars (rate limiting is fail-open to
  the per-instance bucket without them); `SMART_HOME_WEBHOOK_SECRET`.
- cron-job.org: verify the 6h refresh job + 5-min uptime job exist/fire;
  decide the fate of the 4 unscheduled cron endpoints.
- RLS execution test setup (CI Postgres + `pg` + `S18_RLS_DATABASE_URL`).
- CI workflow files via web UI (`check-a11y.yml` +
  `check-press-counts.yml` untracked, never pushed).
- `npm audit` on a machine with registry access (blocked in the
  sandbox, 403 `policy_denied` — vulnerabilities unverified, not "0").
- Supabase dashboard: verify sign-in/sign-up brute-force protection
  settings (no server-side rate limit or captcha in code).
- Image-host / hotlink allowlist decision; digest-switch scope
  decision; LLM provider decision.
- 50 verified products with images/GTIN/specs — real merchant data,
  never fake.

## Known limitations

- Sections 21–25 cannot move the substance number by code alone:
  overall ~51% (platform/code ~84%, substance ~15%) at audit time.
  What the build CAN move is the trust number — every false label in
  audit §1 is a buildable fix.
- Live `/api/v1/health` reports degraded by design (db up, auth down,
  Stripe not_configured) — a watch item, not a failure.
- The full vitest suite is flaky under parallel load (4 tests in 3
  files failed on one loaded run; clean serial re-run green) — gate
  runs must be clean serial runs via `scripts/run-tests-with-log.mjs`,
  never alongside other load.
- The local clone is shallow (remote HEAD object absent locally) and
  carries 1 unexpected staged rename (`tests/bnpl-line.test.tsx` →
  `tests/bnpl-line.test.ts`) in the index — resolve before any push;
  never use `git status` vs the shallow HEAD as a section delta.
