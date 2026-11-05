# Dynamic Geo-Targeted Affiliate Engine — Phase 3 Prep

> Note on naming: this is **not** Option 11's roadmap Phase 3
> (SmartPools 2.0, still pending). "Phase 3 Prep" here means the
> affiliate-engine groundwork requested 2026-11-05.

## What it is

A geo-targeted affiliate link engine for the product page's
Where-to-Buy merchant links:

1. **Geo detection (server-side, no new code needed):** the merchants
   route reads `x-vercel-ip-country` (Vercel geo header), falls back
   to the visitor's saved `sb-country` cookie (their own Country
   Switcher choice), then to the US fallback. The middleware already
   seeds `sb-country` from the same header on first visit, and the
   client region provider keeps the same precedence.
2. **Link transformation (server-side, env-gated):**
   `services/affiliate-geo.ts:buildGeoAffiliateUrl` runs in the
   merchants route before links reach the page:
   - Amazon host + a configured locale tag → set/replace `tag`.
   - Any other host + a configured Skimlinks id → wrapped URL.
   - Nothing configured → the input URL byte-for-byte (today's plain
     search links, unchanged).
   The client's `localizeAmazonUrl` then rewrites the Amazon domain
   to the visitor region's domain (query, including the tag, kept).
3. **Universal fallback:** no regional tag → the plain US/global link,
   unchanged. No local store is ever invented to fill a gap.
4. **Click tracking:** Buy buttons fire a `navigator.sendBeacon` to
   `POST /api/v1/affiliate/geo-click`, which inserts one row into
   `affiliate_geo_clicks` via the service-role client. The beacon
   never blocks navigation and always answers success.
5. **Disclosure:** when the merchants endpoint reports
   `meta.affiliateEnabled === true`, the page shows an affiliate
   disclosure note under Where to Buy. With nothing configured there
   is no note, because there is nothing to disclose.

## What already existed (audit, 2026-11-05)

- `services/affiliate.ts` + `POST /api/v1/affiliate/click` +
  `GET /api/v1/affiliate/links` (Oct 31, original half-built app).
  **They are NOT wired into any page or route** — the old
  `buildAffiliateUrl` is re-exported only, never called — so today's
  live links carry no affiliate tags.
- ⚠️ The old module **used to hardcode** retailer tag values
  (Amazon / eBay / Walmart / AliExpress / Best Buy). The owner
  confirmed (2026-11-05) they were **placeholder / dummy test IDs**,
  and the whole hardcoded config plus `buildAffiliateUrl` was
  removed the same day (no literal values remain in the codebase).
  The new engine never reused them. Real tags belong in env vars only.
- The old `affiliate_clicks` table (migration 009) requires
  `affiliate_link_id NOT NULL` and migration 015 restricts its INSERT
  to authenticated users, so it **cannot log anonymous clicks**.
  The old click route therefore cannot track logged-out visitors.
  That is why the geo engine uses its own table (below) instead of
  weakening the old policy (which would open a spam vector).

## Database schema

Owner step — run `supabase/add-affiliate-geo-clicks.sql` once:

```sql
CREATE TABLE IF NOT EXISTS affiliate_geo_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  product_slug text,
  retailer_name text,
  target_url text NOT NULL,
  country_code char(2),
  clicked_at timestamptz NOT NULL DEFAULT now()
);
-- + indexes on clicked_at, product_slug, country_code
```

No anon INSERT policy is created on purpose: inserts go through the
service-role client in the beacon route. Until the SQL runs, the
beacon answers success but stores nothing (fail-open, logged).

Privacy by design: **no IP address, no user agent, no user id** is
stored (the old table's `ip_address` column is intentionally not
mirrored). Country comes from the server's geo signal, never from
the client. `country_code` is NULL when no signal resolves — never a
guessed country.

## Environment (placeholders only — see `.env.example`)

| Variable | Meaning |
|---|---|
| `AMAZON_ASSOC_TAG` | Associates tag for US visitors only |
| `AMAZON_ASSOC_TAG_<CC>` | Per-country override, e.g. `_GB`, `_DE` |
| `SKIMLINKS_PUBLISHER_ID` | Skimlinks fallback for non-Amazon links |

Rules: US visitors use the base tag; every other country needs its
own override (a US tag is never stamped on a link that will be
rewritten to amazon.co.uk/.de). eBay/Best Buy have **no direct-tag
scheme in this batch** — they use the Skimlinks fallback when it is
configured, else passthrough. Confirm the Skimlinks redirect format
in the Skimlinks dashboard before enabling.

## Files

- `services/affiliate-geo.ts` — pure transform + geo resolution
  (server-only; env-gated; no hardcoded tags).
- `app/api/v1/affiliate/geo-click/route.ts` — beacon (service-role
  insert, fail-open, server-side error logging).
- `app/api/v1/products/[slug]/merchants/route.ts` — applies the
  transform + returns `meta.affiliateEnabled`.
- `app/products/[slug]/page.tsx` — Buy-button beacon + disclosure
  note (only when enabled).
- `supabase/add-affiliate-geo-clicks.sql` — owner-run table.
- `.env.example` — placeholder vars (blank = feature off).

## Deliberately NOT in this batch

- Local-store directory links are **not** transformed or tracked:
  they are directory + search links by rule, and the beacon only
  covers priced merchant Buy buttons.
- No eBay/Best Buy direct-tag scheme (needs owner-provided locale
  campids/IDs, same env pattern as Amazon).
- No commission/conversion reporting: the old analytics functions
  read `affiliate_links`, which this engine does not populate.
  Reporting on `affiliate_geo_clicks` is a follow-up once real
  clicks exist.
- The old affiliate module/routes stay dormant (link/click infra
  only); their placeholder tag config was removed 2026-11-05 after
  the owner confirmed the IDs were dummies.
