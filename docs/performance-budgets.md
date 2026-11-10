# Performance budgets (Section 4, item 12)

Performance budgets guard the P0 bundle work: the product page was cut down
to ~340 kB First Load JS (P0 batch, 9 Nov 2026 — 50.1 kB page / 340 kB First
Load, measured on a clean production build). Without a gate, every new
feature grows it back. These budgets are enforced by CI
(`.github/workflows/lighthouse.yml`); the numbers below are the contract.

## Budgets

| Route | First Load JS | Notes |
|---|---|---|
| `/products/[slug]` | **≤ 350 kB** | Hard gate — CI fails the build above this. Baseline 340 kB (9 Nov 2026). |
| `/` (homepage) | ≤ 250 kB | Warning — reported in the CI log, not a hard fail yet. |
| `/compare` | ≤ 400 kB | Warning — matrix + charts are heavy; code-split before raising. |

Lighthouse (mobile, throttled 4G — LHCI `lighthouse:recommended` preset):

| Check | Threshold |
|---|---|
| Performance category | warn below 0.80, error below 0.60 |
| Accessibility category | warn below 0.90 |
| Best practices / SEO | warn below 0.90 |

## How CI enforces it

1. `npm ci` + `npm run build` on every pull request and every push to `main`.
   The build runs with placeholder Supabase env vars (see below) so it
   never needs real credentials.
2. A budget step parses the build output (`next build` prints each route's
   First Load JS) and fails if `/products/[slug]` exceeds 350 kB.
3. Lighthouse CI (`@lhci/cli`, free, no account) starts the production
   build (`npm run start`), checks `/` and `/products/macbook-air-13`,
   and uploads results to temporary public storage (links expire; nothing
   is stored long-term). No paid service is involved.

## Placeholder env vars in CI

The production build imports `lib/config/env.ts`, which requires
`NEXT_PUBLIC_SUPABASE_URL` at build time. CI sets placeholders:

```
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key
```

Lighthouse therefore measures the app rendering with honest empty states
(no real catalog data) — the numbers measure the shell/bundle, which is
what the budget is about. A live-data Lighthouse run is a manual,
owner-side step on the deployed site, not a CI gate.

## If a budget fails

- Do **not** raise the budget to make CI green. First code-split
  (`next/dynamic`, lazy charts/widgets), then re-measure.
- If a genuine feature needs more JS, update this file with the new
  number, the reason, and the date — and say so in the PR. A silent
  budget bump is a regression.
- Re-measure locally with `npm run build` and read the First Load JS
  column for `/products/[slug]`; Lighthouse locally with
  `npx @lhci/cli autorun` using the same commands as the workflow.
