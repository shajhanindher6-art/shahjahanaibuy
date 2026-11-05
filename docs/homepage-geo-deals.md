# Homepage Geo-Deals Logic

> Built 2026-11-05, local — push needs its own approval. No new
> dependencies, no SQL migration, no env vars.

## Why this shape

The homepage showed the same six ranked deals, in the same order,
to every visitor, every day. Real per-region offers cannot come
from the existing data, and that was verified by audit, not assumed:

- The `deals` table has **no country/region column**; all six seed
  deals are Amazon/US demo deals.
- `GET /api/v1/smart-deals` takes `limit` only (personalised by
  signed-in user activity, not by region).
- `community_deals` has no region column either.

Inventing per-region offers would violate the no-invented-data
rule, so the build localises what honestly can be localised.

## What was built

### (a) Deal rotation — `services/deal-rotation.ts`

`rotateDealsForRegion(items, regionCode, utcDay)` — a deterministic
cyclic rotation of the ranked list, keyed by (visitor region, UTC
day). The ranking is preserved: the list is only rotated, so a
different deal leads for each region and each day, and no deal is
added, removed, or re-ranked. Same region + same day always gives
the same order (stable within a day).

Applied in `app/api/v1/smart-deals/route.ts` AFTER the (cached)
ranking, so the ranking cache is unaffected. Region resolves from
the Vercel geo header first, then the saved `sb-country` cookie,
then US — the same precedence as the affiliate engine's resolver
(reused, not duplicated). The response meta carries `region`.
The widget footnote now says: "Deal order rotates daily by
region, so the same deal doesn't always lead."

### (b) Local stores section — `components/home/local-stores-section.tsx`

Mounted in `app/page.tsx` directly after the Smart Deals section.
Shows the visitor's own country's stores from the real 70-store
directory (`lib/stores.ts`), or the worldwide retailer fallback
when their country has no confirmed local store yet — the same
`getStoresForCountry` fallback as the product page.

Directory + links only: links go to the stores' own homepages.
No prices, stock, deals, or coupons are shown for these stores,
and no partnership or affiliate relationship is claimed (stated
on the section itself).

## Deliberately NOT built

- Real per-region deals: needs a `country_code` column on `deals`
  (owner SQL), plus real per-region deal data. Rotation + the
  stores directory are the honest interim; a column without data
  would change nothing visible.
- No affiliate transform on the stores directory links: directory
  + search links by rule, same as the product page.

## Verification

- tsc 0 errors, production build pass (smart-deals route registered).
- 7/7 rotation logic tests PASS: determinism, preservation (every
  deal exactly once), cyclic-shift property, distinct leaders
  across regions and across days, empty/single edge cases,
  case-insensitive region code.
