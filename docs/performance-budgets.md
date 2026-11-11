# Performance budgets (Section 4, item 12)

Performance budgets guard the P0 bundle work: the product page was cut down
to ~340 kB First Load JS (P0 batch, 9 Nov 2026 — 50.1 kB page / 340 kB First
Load, measured on a clean production build). Without a gate, every new
feature grows it back. These budgets are enforced by CI
(`.github/workflows/lighthouse.yml`); the numbers below are the contract.

## Current baseline — UNVERIFIED LIVE (Section 14, Chunk 1, 11 Nov 2026)

No clean production build since Section 10 has printed a route
table: the sandbox builds for Sections 10–13 all failed at
`/sitemap.xml` (environmental — Node fetch to the placeholder
Supabase host hangs; see the Section 10/11/12 build reports),
so **no current First Load JS number exists for any route**.
The last clean-build number was Section 10, 11 Nov 2026
(product page 281 kB) — that predates Sections 11–14, so it is
**not** the current baseline and must not be quoted as one.
The current baseline is "unverified live": the ≤350 kB budget
below is still the hard gate, and the first clean build (CI or
Vercel) that prints a route table re-establishes the number —
update this section with that number and date when it lands.
Do not copy the 281 kB figure forward as if it were current.

Section 14, Chunk 1 changes with bundle implications (all
UNMEASURED — no build ran, so no size claim follows):
- Deleted dead `components/products/price-chart.tsx` (recharts
  chart, zero importers). Removing a dead component cannot grow a
  bundle, but recharts is still imported elsewhere
  (`price-history-graph.tsx`), so no dependency was dropped and
  no saving is claimed.
- Wired the self-fetching `DealHotspotsCalendar` into /deals. It
  adds its client code to the /deals bundle and one live API call
  (`/api/v1/deal-hotspots`) per visit; its size impact is
  unmeasured until a clean build prints the /deals row.
- Notifications list pagination/filters, the sidebar unread
  badge, and /compare merchant links add small client code only;
  likewise unmeasured.

## Budgets

| Route | First Load JS | Notes |
|---|---|---|
| `/products/[slug]` | **≤ 350 kB** | Hard gate — CI fails the build above this. Baseline: unverified live since Section 10 (last clean-build number 281 kB, 11 Nov 2026 — stale, do not quote as current). |
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
