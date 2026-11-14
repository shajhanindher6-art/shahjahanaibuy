# Remaining Blockers — SmartBuy AI Master Tool Integration

**Date:** 2026-11-14 · **Status:** Stages 0–6 live (HEAD `6838d30a`); Stage 7 NOT scheduled
**Source:** `MASTER_INTEGRATION_AUDIT.md` §4.2 (O-01..O-25) + `BUILD_MANIFEST.md` (open build items).

> Every item here is a real blocker with an exact next step. Nothing here has a workaround — where the code cannot proceed without an owner step, it waits. Do not simulate an unlock with fake data.

## 1. Owner-gated items (OWNER — only the owner can clear these)

| # | Item | Exact owner step |
|---|---|---|
| O-01 | eBay live prices | `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` (+ `EBAY_MARKETPLACE_ID=EBAY_US`) in Vercel Production → Redeploy; EPN + Growth Check approval (only the owner can check). Merchants row done. |
| O-02 | Best Buy live calls | Free key at developer.bestbuy.com (~10 min, email signup) → Vercel `BESTBUY_API_KEY` → Redeploy. Client built + live. |
| O-03 | Migrations 055–058 | Apply in order 055 → 056 (pre-check: duplicate-GTIN SELECTs, expect 0 rows) → 057 → 058; manual version INSERT after each (files do not self-record). Code delivered, paused by the user. |
| O-04 | Migrations 019–023 | Apply 019 first (T7 activation) then 020–023; then record repairability/watts/depreciation values per product (owner/CSV). |
| O-05 | Migrations 026–034 | Apply in timestamp order (guest alerts, agent memory, trust QA, commerce data, forecast, creator rewards, ops API, next-gen, AI tools). 031 needs `add-community-deals.sql` first; 033/034 fail-safe until applied. |
| O-06 | Migrations 036–043 | Apply in order (newsletter, subscriptions CHECK, referral attribution, saved searches, refresh runs, eBay usage, match notifications, saved calculations). |
| O-07 | Migrations 048–054, 059–063, 065–067, 068–071 | Apply per runbook order: 040 BEFORE 052; 048+050 BEFORE 062; 060 after 057; 068 after 056; 071 exact-match backfill. 054 deals-unique, 059/066 data-quality persistence, 061 merchant-reliability table, 070 cleanup-audit (precondition for ANY production deletion). |
| O-08 | Migration 044 version | Effect live (`/creators` 404), version unrecorded — owner decision: record the version or leave it documented unknown. SKIP re-apply. |
| O-09 | Resend | `RESEND_API_KEY` + verify sender domain (sender defaults `noreply@smartbuy.ai`, unverified placeholder). Newsletter subscribe 503s until then. |
| O-10 | VAPID keys | VAPID pair in Vercel (push dormant until then). |
| O-11 | Stripe live | Live keys + `STRIPE_LIVE_LAUNCHED=true`; Premium price decision ($4.99 vs $9.99; $1 Starter off by default). Revenue $0 (test mode). |
| O-12 | Skimlinks | Owner decision only to apply (rejection blocks reapplying 90 days). Do NOT apply without explicit go-ahead. |
| O-13 | Amazon approval | Check Associates dashboard: is `smartbuy-20` approved or placeholder? Only the dashboard can confirm. |
| O-14 | Real catalog data | 50 genuine products + specs/images/GTINs via Best Buy API (after O-02), eBay (after O-01), or owner CSV (slug, model_number, gtin, specs_json, image_url + source note per value). |
| O-15 | cron-job.org | Verify 6h refresh + 5-min jobs exist and fire; decide schedules for `alerts/check` + `predictions/outcomes` (currently unscheduled, no decision recorded). |
| O-16 | RLS test env + CI Postgres | `S18_RLS_DATABASE_URL` + `pg` dep for the 4 skipped RLS execution tests; CI Postgres decision. |
| O-17 | GitHub workflows (web UI) | Upload 4 workflow files (`.github/workflows/check-a11y.yml`, `check-press-counts.yml`, `check-main-suite.yml`, `lighthouse.yml`) + delete `tests/bnpl-line.test.tsx` via the GitHub website (push tool gets 403). |
| O-18 | Image hosts | Merchant image hosts for `next.config.js` allowlist (currently only unsplash/pexels). No host known yet. |
| O-19 | Hugging Face | HF token + budget decision (50 live calls/day/instance); `ai.analyze` trigger deliberately NOT wired until then. |
| O-20 | SerpAPI key | Key for visual search / Lens leg (falls back without it). |
| O-21 | Upstash Redis vars | Verify `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in Vercel — rate limiting is fail-open per-instance without them; eBay budget counter unavailable. |
| O-22 | Supabase service-role key | Verify `SUPABASE_SERVICE_ROLE_KEY` in Vercel — service-dependent admin routes 503 without it. |
| O-23 | Sentry | Verify DSN / liveness (plugin skips upload when unset; event flow live-unverified). |
| O-24 | WhatsApp / Telegram / PostHog / GA4 / Meta | Keys/tokens owner-gated (not verified in the audit). |
| O-25 | Backup decision | Manual `pg_dump` routine (free tier, no automated backups) before any migration — vs Pro $25/mo (conflicts with free-tier-only rule). Runbook REQUIRES a manual pg_dump before migrations. |

Migration safety (standing): no migration without backup + dependency verification; one file at a time; M-0 re-query after each; **035 NEVER**; 053 excluded; fix-public-catalog-rls LAST; never re-run the unnumbered file after it.

## 2. Stage 7 unlocks (each waits on its owner item — none scheduled)

| Unlock | Needs | What happens when it lands |
|---|---|---|
| U-01 | O-01 eBay keys + EPN | First live eBay preview → refresh records `livePricesFetched > 0` + `completed` → products gain `priceVerifiedAt`. Verify via /status + admin preview. |
| U-02 | O-02 Best Buy key | First live SKU fetch → /status check → spec/image/UPC ingestion proof. |
| U-03 | O-03 055–058 | Wire model_number / GTIN uniqueness / price-history provenance / spec attribution into T1/T2/T4/T6/T8 labels; re-run affected tests. |
| U-04 | O-04 019 | T7 activates with zero code change (verify live: scores appear, empty state gone); record repairability values per product (owner/CSV). |
| U-05 | O-05/O-06/O-07 migrations | Admin surfaces light up (ingestion-failures, refresh-runs, error_log, prediction outcomes); verify each surface live. |
| U-06 | O-14 real catalog data | Phase 1 worksheet verification (10 products × 9 checks) → 40 more by category → live tests with evidence. |

**Gate per unlock:** live verification (curl + owner confirmation), never a code-only claim.

## 3. Open build items (OPEN — code work, no owner step needed, but not built in Stages 0–6)

| # | Item | Why it is open / what would close it |
|---|---|---|
| B-15 | S4-2 AIEngine/ProviderRegistry extension | Not built — no concrete routing need demonstrated by Stages 1–3 (zero AIEngine references in `app/tools/` or Stage 1–3 services; single implementations, so engine fallback has nothing to fall back to). Recorded in `docs/DECISION_SERVICE.md` with revisit conditions. Closes if a Stage 1–3 service ever needs engine routing. |
| B-18 | Search-page entry links | Not built — `/search` renders via `components/search/product-search-results.tsx` (restructuring needed, out of bounds); `/find` is a term directory with no product to link from. Closes with a small restructuring task. |
| B-06 | Persona preselect from `user_preferences` | Not built — `user_preferences` has no persona field (budget_min/max, favorite_brands/categories, preferred_retailers only). Budget prefill done. Closes if a persona field is added (needs a migration — owner-gated). |
| B-25 | Guest-alert stale gate | Not built — 7-day stale gate for guest alerts (like signed-in alerts). Carried from Sections 21–25, unverified. |
| B-26 | CSV-review fuzzy leg | Not built — pipeline dedups at fuzzy ≥0.75; CSV review does not. |
| B-27 | Circuit-breaker read-before-call + provider-health writers + `data_sources` sync writers | Not built — audit BUILDABLE item assigned to no stage. |
| B-28 | DLQ durability design | Not built — in-memory max 1,000, lost on restart; the durable form needs migration 048 (owner-gated, O-07). |
| S2-2 | `services/currency.ts:formatRecordedPrice` not migrated to canonical `formatPrice` | Circular import with `lib/region.ts`; output unchanged. Closes with an import restructure. |
| S2-4 | `validateGtin` does NOT hard-gate the GTIN leg | An invalid GTIN still matches on digits-only equality; strict gating would break an existing test (GTIN `4548736130383`, wrong check digit). Needs a behaviour decision + test-data fix. |

## 4. Watch items (OPEN — not blockers, but check before the next push)

- **Parallel-run flake (Stage 6):** one parallel `check:press-counts` run exited 1 with 1 failure, name lost (output piped to `tail -3`); did NOT reproduce in 3 full runs since (serial ×2 + generate parallel + check re-run, all green). Assessed as a parallel-run flake; flaky test identity unknown — a flake hunt before the next push is advisable. The serial gate (the authority) never failed.
- **`/compare` client-bundle chain:** `/compare` now imports `tool-integration → lib/cache → @upstash` into a client bundle; build passed, worth a glance in the next build output.
- **T3 Amazon source:** fetch fresh at next re-verification (last fetch was a 2025-12-07 cached copy).
- **T8 → coupons-cashback drops the product** (pre-existing link, not fixed in Stage 3).
- **Audit's open checks (§6):** no live DB queries were run in the audit (migration applied states beyond prior-audit claims, row counts, `pg_policies`, 045's conditional index); cron-job.org job existence; Vercel env vars; Sentry liveness; npm audit; mobile QA; React `cache()` dedup grep; T3 source-URL reachability; resale-predictor's own test coverage; hub `isNew` flag semantics (resolved in Stage 0 — 33 vs 10); per-policy tracing of 010's remaining `WITH CHECK (true)` hits.

## 5. What is NOT a blocker (do not re-raise)

- **Migration 035** — NEVER apply. 053 is dead without it.
- **Full-seed re-run; deleting the `sample-laptop` health-check row** — standing rules; the row stays.
- **LLM runtime deps** — design is deterministic-only; no LLM provider/key decision exists.
- **Review Summarizer / Sentiment build-out** — 0 reviews, owner-blocked; engine + route + component exist but stay disconnected by rule.
- **Rebuilding from scratch / replacing working features** — brief + standing rule: integrate, don't rebuild.
- **Second scheduler (Vercel Cron / BullMQ)** — exactly ONE scheduler (cron-job.org).
- **Next.js 13.5.9 → 15 upgrade** — separate project decision, not part of any section.
- **Silent orphan-row deletion** — never; migration 070 cleanup-audit is the precondition for any production deletion.
- **The 46 vs 47 wanted-connection count** — open discrepancy, see `TOOL_CONNECTION_MATRIX.md` §4; it changes no per-tool number.
