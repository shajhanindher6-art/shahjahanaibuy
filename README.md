# SmartBuy AI

AI shopping and price-tracking SaaS — find products, compare prices across merchants, track prices over time, get deal alerts, and use 36 AI tools to decide what to buy and when.

**Live site:** https://shahjahanaibuy-b1zp.vercel.app/
**Status:** Stripe is in TEST mode; revenue is $0 and no paid plan can be bought today. Catalogue: 10 products, prices last recorded 2026-11-02 (stale — see `project-summary.md` for the honest state).

## Stack

Next.js 13.5.9 (App Router) · TypeScript 5.2.2 · Supabase (PostgreSQL + Auth) · Tailwind CSS / shadcn-ui · Stripe (test) · Resend · Vercel (deploy on push to `main`)

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in real values; never commit .env files
npm run dev                  # http://localhost:3000
```

Only 2 variables are truly required to start: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Everything else is optional and fails closed (honest 503 / disabled feature) — see `.env.example` and `docs/DEPLOYMENT.md`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (must pass with zero errors) |
| `npm run start` | Start the production server |
| `npm run typecheck` | `tsc --noEmit` (must be 0 errors) |
| `npm test` | Full vitest suite (216 files / 2,685 tests, 100% pass — 12 Nov 2026) |
| `npm run test:a11y` | Runtime axe checks (7/7, local gate only) |
| `npm run lint` | `next lint` |
| `npm run generate:press-counts` | Regenerate `lib/generated/press-counts.json` from a real test run |
| `npm run check:press-counts` | Fail if the press-counts JSON is stale |

## Verification gate (before every push)

`npx tsc --noEmit` = 0 errors · full `npm test` = 100% pass · clean `npm run build` · headless smoke · live recheck after push. **Push only on the user's live approval.** Baseline 12 Nov 2026: tsc 0, vitest 216/2,685 PASS, clean build exit 0 (799 pages, `/products/[slug]` First Load 330 kB, budget ≤350 kB).

## Docs

- **`project-summary.md`** — start here: what SmartBuy is, architecture, features, catalogue (honest state), database, env vars, cron jobs, deployment, verification status, owner-gated work, blocked features.
- **`docs/DEPLOYMENT.md`** — deployment, environment variables, the 51 migrations, the 6 cron jobs, the Stripe live-money gate (`STRIPE_LIVE_LAUNCHED`).
- **`API_DOCUMENTATION.md`** — API reference, all 181 routes / 244 handlers, tiers & quotas. Machine-readable: **`docs/openapi.json`**.
- **`.env.example`** — every environment variable with placeholders (never put a real secret in it).
- **Topic docs in `docs/`** — `rate-limits.md`, `affiliate-engine.md`, `performance-budgets.md`, `pwa.md`, `alerts-delivery-setup.md`, `sentry-triage.md`, `uptime.md`, `seo.md`, `security-hardening.md`, `visual-search.md`, `responsive-qa.md`, `search-console.md`, `design-system.md`.

The root July 2026 docs (`DATABASE_SCHEMA.md`, `LAUNCH_CHECKLIST.md`, `PROJECT_ARCHITECTURE.md`, `QA_REPORT.md`, `SECURITY_AUDIT.md`, `FINAL_DEPLOYMENT_REPORT.md`) plus `DEPLOYMENT_PREP.md` and `phase5-summary.md` are **frozen historical snapshots** — each carries a banner saying what supersedes it. Do not use them for current numbers.

## Deployment

Vercel, deploy on push to `main`. No `vercel.json`. Background jobs run via cron-job.org (6 `CRON_SECRET`-protected endpoints, including the 6-hour price refresh). GitHub workflow files (`.github/workflows/*`) can only be changed via the GitHub website (the GitHub App gets 403 on push).

## Rules that govern this repo

- Free tiers only; never buy anything.
- Never invent data — missing data gets an honest empty state or a labelled estimate. No scraping (Apify stays unset). Never re-run the full seed.
- Secrets only in owner dashboards (Vercel env, Stripe, Supabase, etc.).
- Never apply a migration without the owner's explicit approval for that migration. Never apply 035 without a separate explicit review. Never apply the unnumbered `fix_anonymous_access_policies.sql` as-is.
- Stripe stays in TEST mode — live charges need a live key **and** `STRIPE_LIVE_LAUNCHED=true`.
