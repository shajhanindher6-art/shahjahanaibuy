# Phase 4 — Content Integration and Scaling / Production Affiliates Setup

> Naming note: this is the **affiliate track's Phase 4**, defined by the
> owner 2026-11-05. It is NOT Option 11's roadmap Phase 4 (AI Copilot),
> which stays pending under its own name — as does SmartPools 2.0
> (Option 11's Phase 3). Nothing here renames or cancels those.

## Where Phase 3 left off (verified live 2026-11-05)

- Geo affiliate engine live on commit `fabed9ba`: locale-scoped Amazon
  tags, Skimlinks fallback, geo-click beacon, `affiliate_geo_clicks`.
- Final live proof: POST with the page's exact payload →
  `{"success":true,"data":{"tracked":true}}`.
- **No real affiliate tags exist yet.** Env is blank, so links are
  plain search links and no disclosure note renders. Nothing earns
  anything until Workstream A below is done.
- Privacy: no IP, user agent, or user id stored in `affiliate_geo_clicks`.
- Docs: `docs/affiliate-engine.md` (architecture + schema + env).

## Workstream A — Production affiliates setup (OWNER)

Real accounts first; code already supports them. Never paste a real
tag value into chat, git, or a doc — env vars only.

1. **Amazon Associates** — one account per locale the owner wants to
   earn in (US, GB, DE, JP, CA, AU, IN, ...). Each locale yields its
   own tracking ID.
2. **eBay Partner Network** — campaign ID per locale (direct-tag
   support for eBay does not exist in code yet; see B.4 — until then
   eBay links use the Skimlinks fallback when it is configured).
3. **Skimlinks** — publisher ID; confirm the redirect format in the
   Skimlinks dashboard before enabling (the engine uses the
   `go.skimresources.com/?id=...&url=...` pattern).
4. Set the Vercel env vars (exact names in `.env.example`):
   `AMAZON_ASSOC_TAG` (US), `AMAZON_ASSOC_TAG_<CC>` per locale,
   `SKIMLINKS_PUBLISHER_ID`. Redeploy after setting them.
5. Verify with the go-live gate in §E before announcing anything.

## Workstream B — Content integration (AGENT, one surface at a time)

Rule for every surface: same server-side transform, same beacon, same
disclosure treatment as the product page. Directory links stay plain.

| Surface | State today | Phase 4 step |
|---|---|---|
| Product page Where to Buy | Done (Phase 3) | None — reference implementation |
| `/gifts` results | Store search URLs built in `app/api/v1/gifts/route.ts` via `buildStoreSearchUrl` | Apply the same geo transform server-side in the gifts route |
| Region arbitrage table | Store links built client-side (`components/products/region-arbitrage-table.tsx`) | Needs a server-side transform point first — audit before touching; do not ship tag values to the client as config |
| `/compare` | Buy-link behaviour not yet audited | Audit first: if it renders merchant URLs, wire the same transform + beacon |
| `/deals` cards | No outbound retailer links today | Decision needed: add Where-to-Buy-style links, or keep deals as discovery-only |
| `/blog` | Single listing page, no posts, no retailer links | Content must exist first — no fake posts, no placeholder articles |
| AI assistant answers | Link behaviour not yet audited | Audit first: recommendations must never gain tags without the disclosure treatment |

Not in scope: eBay/Best Buy direct-tag schemes (need owner-provided
locale IDs first, same env pattern as Amazon); local-store directory
links (stay plain by rule).

## Workstream C — Reporting and scaling (AGENT)

1. **Geo-clicks reporting (not built yet):** a read-only admin
   view/API over `affiliate_geo_clicks` — clicks by country,
   retailer, product, and day. Same service-role read pattern as the
   beacon; no new PII, no new table.
2. **Daily rollups: NOT built.** (An earlier browser report once
   mentioned "daily rollups" — that was a misread, not a feature.
   If wanted, it is a Phase 4 build, not existing behaviour.)
3. **Beacon abuse guards (open decision):** the beacon is
   unauthenticated by design (logged-out clicks must track) and
   stores no IP. That is a spam vector. Options that preserve
   privacy: keep payload validation + length caps (already in
   place); add edge rate limiting that counts per IP in memory
   only, without storing IPs. Decide before real tags go live —
   do not silently start logging IPs to "fix" spam.

## Workstream D — Legal and disclosure (OWNER)

- `/privacy`, `/terms`, `/cookies` currently contain **zero**
  affiliate mentions. Before the first real tag goes live, add an
  affiliate disclosure section (earnings disclaimer) to the legal
  pages. The on-page disclosure note already renders automatically
  whenever a tag is configured; the legal pages are the owner's
  review call, as before.
- Keep the rule: a tag is never presented as a partnership claim —
  the note says SmartBuy *may earn a commission*, nothing more.

## E — Go-live gate (run after A + D, before announcing)

1. Env vars set in Vercel + redeployed (deployment Ready/Current).
2. `GET /api/v1/products/macbook-air-13/merchants` shows the tag
   inside the listing URL and `meta.affiliateEnabled: true`.
3. Product page shows the affiliate disclosure note.
4. A Buy-button click (or equivalent test POST) returns
   `tracked:true` and the stored `target_url` carries the tag.
5. Vercel Runtime Logs show no `[affiliate-geo-click]` errors.
6. Revert plan (no code change): unset the env vars → links revert
   to plain search links and the note disappears on next deploy.

## Order of work

A (owner accounts) → D (legal) → B (integration, one surface per
approval) → C (reporting, then abuse-guard decision) → E (go-live
gate). Each B surface and the C.3 decision need their own approval;
nothing here authorises a push or a live tag by itself.
