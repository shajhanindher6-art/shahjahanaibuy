# Step C — Reporting & Scaling / Beacon Spam Protection

> Phase 4, Workstream C (see `docs/affiliate-phase4-plan.md`).
> Status 2026-11-05: Stage 1 IMPLEMENTED LOCALLY (see §5), NOT pushed
> yet — push needs its own approval. Stage 2 remains deferred on
> evidence, as planned.

## 1. Threat model — what we are actually defending

- The beacon (`POST /api/v1/affiliate/geo-click`) is an unauthenticated
  POST that writes via the service-role client and always answers
  success. Abuse = junk rows, table bloat, skewed analytics.
- The transform endpoint (`POST /api/v1/affiliate/transform`) only
  *returns* URLs; it writes nothing. Abuse = someone else wrapping
  their links with our tags — mild, and bounded by the host allowlist.
- Nothing personal is at risk: no IP, user agent, or user id is
  stored anywhere in this engine, no money moves, no account can be
  taken over through either endpoint.
- Hard constraints (non-negotiable, from the standing rules):
  - **No IP / user-agent / user-id logging, ever** — the privacy
    policy already promises this in writing.
  - **No CAPTCHA on a click** — the beacon is fire-and-forget and
    must never delay navigation.
  - **Free tiers only** — Vercel's custom Firewall / rate-limit
    rules are a Pro feature, so platform-level custom WAF is out.
    Vercel's automatic DDoS mitigation (free tier) stays as the
    platform baseline; no action, no config.

## 2. Spam protection architecture — staged, on evidence

### Stage 1 — Build with the Phase 4 go-live (recommended next)

No new dependencies, no new tables, no policy change.

1. **Host validation on the write path** (one edit, geo-click route):
   reject (do not store, still answer success) any click whose
   `target_url` host is not transformable — same `isTransformableHost`
   allowlist as the transform endpoint (stores directory +
   Amazon/Best Buy/eBay/AliExpress families), **plus
   `go.skimresources.com`** (a Skimlinks-wrapped link is a legitimate
   beacon target once Skimlinks is configured; without that host in
   the list, real clicks would be dropped). This stops garbage URLs
   from polluting analytics. A spammer can still copy real merchant
   URLs from the site — this is a garbage filter, not volume control,
   and it is documented as such.
2. **Aggregate anomaly flagging in the reporting layer** (see §3, not
   the write path): the analytics API computes burst buckets —
   any (country, retailer, product, hour) bucket over a threshold
   (starting value **100 clicks/hour**, a config value to tune once
   real traffic exists) is flagged. Flagged buckets are shown
   separately in the admin UI and excluded from headline totals, with
   the exclusion visible. No rows are deleted, no identities are
   involved. Flagging is detection, not blocking.
3. **Observability stays as is:** the existing `[affiliate-geo-click]`
   server-side error logging plus the admin surface's volume display
   *is* the abuse monitor. No new logging is added.

### Stage 2 — Only if Stage 1 flags show real abuse (deferred)

Build on evidence, not speculation. Do not build these now.

1. **Single-use signed beacon tokens** (node:crypto HMAC — no new
   dependency): the merchants / gifts / transform responses issue a
   token in `meta` (15-minute expiry); the beacon POST must present
   a valid, unused token. Used token IDs live in a new table
   `affiliate_beacon_tokens` (token id, used_at, expires_at) and are
   marked used atomically, so replay is impossible. Cost: +1 read
   and +1 write per click, a new secret env var
   (`AFFILIATE_BEACON_SECRET`), issuance plumbing on three surfaces.
   Honest limit: an attacker can still farm tokens (1 page load = 1
   token = 1 spam click), so this raises attacker cost to 1:1 with
   page loads — it does not end spam by itself. Pair it with Stage 1
   flagging, never instead of it.
2. **Edge rate limiting via Upstash Redis (free tier)** — only if
   tokens prove insufficient: hashed-IP counters with short TTLs,
   salted hash, raw IP never stored, never in our DB or logs. This
   needs a privacy-policy wording change ("we do not record IP
   addresses" → short-lived hashed counters) and an owner review
   first. Do **not** build this silently.
3. **Never build:** CAPTCHA on click, raw IP logging, Pro WAF rules
   (paid), proof-of-work that delays navigation.

## 3. Geo-Clicks Admin Surface — basic structure

Follows the existing admin patterns; no new auth, no new dependency
(Recharts is already installed).

- **Where it lives:** a new "Affiliate clicks" section in the existing
  admin dashboard (`app/admin/page.tsx`), reusing its
  `role === 'admin'` guard and fetch pattern. No separate admin app,
  no new role.
- **API:** `GET /api/v1/admin/affiliate-clicks` (admin-only,
  service-role read). Query: `days` (7/30/90, default 30),
  `groupBy` (country | retailer | product | day). Response:
  `totals` (clicks, clicks today, top country, top retailer, top
  product), `byCountry[]`, `byRetailer[]`, `byProduct[]`,
  `byDay[]`, `recent[]` (last 20: product_slug, retailer_name,
  target_url, country_code, clicked_at), `flags[]` (burst buckets
  from §2). Service function follows the existing pattern in
  `services/admin.ts` (`getAdminAnalytics` et al.) — extend that file
  with `getAffiliateClickAnalytics`, do not invent a new auth path.
- **UI:** four summary cards (total clicks, today, top country, top
  retailer), Recharts bar charts (by country, by retailer), a by-day
  area chart, tables for top products and recent clicks, a 7/30/90-day
  selector. Empty state is an honest "No clicks yet" — never fake
  rows. Flagged buckets render as warnings with their exclusion from
  headline totals stated on the page.
- **Privacy, by construction:** no per-user data anywhere in the
  surface; `target_url` values shown are merchant URLs, not user
  input. No CSV/raw export in v1 (export moves data out of the
  dashboard — separate decision if wanted).
- **What it must NOT do:** no IP display, no per-user drill-down, no
  row deletion from the UI (deletion stays an owner SQL decision).

## 4. Sequencing and approvals

1. Stage 1 host validation (geo-click route, one file).
2. Admin analytics API + service function.
3. Admin UI section (Recharts, existing dashboard).
4. Go-live gate re-run (§E of the Phase 4 plan) after 1–3 land.
5. Stage 2 only on evidence of abuse — flagged buckets in the admin
   surface are the trigger, and token design (2.1) comes before any
   Redis design (2.2).

Each build step needs its own approval; this document proposes the
order, it does not authorise the work.

## 5. Stage 1 — as built (2026-11-05, local, not pushed yet)

- `services/affiliate-geo.ts`: new `isTrackableClickHost(hostname,
  knownHosts)` — transformable host OR `go.skimresources.com`.
- `app/api/v1/affiliate/geo-click/route.ts`: host validation before
  the insert; a non-trackable host is dropped with `tracked:false`
  and a server-side warning (host only, never the full URL).
- `services/affiliate-analytics.ts` (new, pure): `analyzeAffiliateClicks`
  — burst buckets (hour, country, retailer, product) over
  `AFFILIATE_BURST_THRESHOLD` (100/hour) are flagged and excluded
  from headline totals; day series is filled so charts never imply
  a gap; recent list capped at 20, newest first.
- `services/admin.ts`: new `getAffiliateClickAnalytics(supabase,
  days)` — fetches at most 5,000 rows in range; on DB error returns
  an honest empty result. If real traffic ever approaches the cap,
  move the aggregation into a DB view/RPC instead of raising the
  cap silently.
- `app/api/v1/admin/affiliate-clicks/route.ts` (new): GET, `days`
  7/30/90 (default 30). Unlike the older admin endpoints (session
  only), this one verifies `role === 'admin'` on the caller's
  profiles row via the service-role client and fails closed with
  403. No `groupBy` param — one response carries every breakdown,
  which is simpler at this volume.
- `app/admin/page.tsx`: new "Affiliate Clicks" tab — 7/30/90-day
  selector, four summary cards, burst-flag warning card, Recharts
  bar charts (country, retailer) + by-day area chart, top-products
  and recent-clicks tables, honest "No clicks yet" empty state.
- Verified: tsc 0, production build pass (route registered), 9/9
  logic tests PASS (host validation incl. `amazon.evil.com` and
  `go.skimresources.com.evil.com` blocked; burst flagging, threshold
  edge at exactly 100, bucket splitting by country, recent cap).
