# Section 19 Summary — AI Intelligence Engine & Smart Shopping Decision System

**Completed:** 2026-11-13 (audit 12 Nov 2026, build 12–13 Nov 2026)
**Goal:** `smartbuy-section-19-ai-intelligence-engine-smart-shopping-decision-system`
**Status:** built + gated + documented. Push and live recheck are the coordinator's
steps, not this document's.
**Docs:** `docs/ai-engine-architecture.md`, `docs/ai-product-analysis.md`,
`docs/price-prediction-documentation.md`,
`docs/decision-engine-documentation.md`, `docs/ai-security-report.md`,
`docs/ai-background-jobs.md`, this file.

> Section 19 adds the AI intelligence layer on top of Sections 1–18: a central
> engine with provider adapters and fallback, honest price predictions, buy-or-
> wait verdicts, and the quota/security guardrails that keep the free-tier
> providers from being burned. Nothing in this section rebuilds a live feature,
> invents product data, or presents a prediction as a guarantee. The catalogue
> is still 10 products with 4 recorded price points each, last recorded
> 2026-11-02 — so every live forecast and verdict is low-confidence by the
> engines' own rules, and the docs say so.

## Audit totals

Audit (`~/workspace/section19-audit.md`, §12): **98 buildable, 25 owner-gated,
22 rejected, 42 already done** (187 items). The build covered the 98 buildable
items plus the §14 broken-things inventory the user added on 12 Nov 2026
("fix EVERYTHING broken — zero errors anywhere"). Owner-gated items stay
owner-gated (see "Owner-gated remainder").

## What was built, per phase

### Phase 0 — Honesty fixes + deterministic-only scope

- **OpenAI flag removed (§12 #2).** `lib/config/providers.ts` claimed an AI
  provider was active whenever `OPENAI_API_KEY` was set, but no OpenAI client
  exists anywhere in the repo. The flag is now always `enabled: false` with the
  deterministic-only scope stated in the description. No LLM anywhere; every AI
  answer is a deterministic template over recorded data.
- **AI summary honesty (§12 #15).** Three invented claims removed: "from a
  reputable brand" with no brand recorded, "meets quality standards" with
  nothing known, "no significant drawbacks" when the available data was
  literally nothing. Pros now come only from evidence; the no-data pro says so.
- **Derived-%-or-null (§12 #24).** A fixed-amount deal no longer gets a
  fabricated percentage (`(discountValue/100)*10` made a $20-off deal show "2%").
  The percentage is derived from a real price / compare-at price, or `null`;
  `null` contributes 0 to `aiScore`, never a made-up number.
- **Deal Score withheld below 5 points (coordinator decision, §12 #28 / Section
  15 B1).** The live catalogue's 4 points per product all score a meaningless
  100/100, so the badge is hidden below 5 data points on every surface. The
  point count is plumbed through `ai_predictions.price_data_range` (existing
  jsonb, no migration) and exposed by the predictions API.

### Phase 1 — AI engine core (§12 #1, #5–#10, #13–#14)

- **Central engine** (`services/ai-engine/`): `AIProvider` adapter interface,
  `AIEngineRegistry` (registration order = fallback order), `AIEngine.invoke()`
  with `fallbackUsed` / `attemptedProviders` / `latencyMs`, singleton
  `getAiEngine()`. **13 adapters registered**: 9 deterministic (ai-search,
  ai-summary, ai-deals, ai-comparison, ai-predictions, ai-recommendations, chat,
  personal-assistant, guided-finder) and 4 live (SerpAPI, HF CLIP, HF MiniLM,
  HF caption). 14 capabilities. Only `visual-embed` has a real two-provider
  chain (CLIP → MiniLM); every other capability has one provider today.
- **Retry + circuit breaker (§12 #6):** retry only on retryable failures
  (429/502/503/504, network/timeout, explicit `retryable: true`) — never
  401/403/400/validation; 3 attempts, exponential backoff (200 ms base).
  Circuit opens after 5 consecutive failures, 60 s cooldown, half-open trial.
- **Usage, quota, budgets (§12 #5, #7, #9, #13):** per-user daily quota 300
  calls (429 + `resetAt` over quota); anonymous caps tightened (ai-search
  10/min, visual-search 5/min, scan 5/min); daily provider budgets SerpAPI 5
  and HF 50 per instance; spend-alert threshold 80% surfaced on the admin AI
  page; per-capability/per-provider latency tracking. All counters are
  per-instance in-memory — a live guardrail, not a ledger.
- **Provider health (§12 #8):** `recordProviderHealth` had zero callers, so
  `provider_health` was never written. `reportAiProviderHealth()` now wires it
  from external-search, the visual-search route and the refresh worker —
  best-effort, never throws, never blocks a response.
- **`maxDuration = 60`** on the 9 expensive AI routes (§12 #10).
- **Cache invalidation (§12 #14):** `invalidateProductCaches` now also clears
  `ai-summary:<id>`, `prediction:<id>` and `comparison:<sorted ids>` keys.
  ai-search and deals-ranked stay TTL-bounded by design (accepted deviation).

### Phase 2 — Product analysis honesty (§12 #16, #20–#21, #23, #59–#60, #66)

- **Freshness stamp + gate:** every summary carries the real `priceAsOf` and a
  freshness note, attached at read time; interpretive verdicts ("good time to
  buy", "near its historical high") are rewritten in the past tense and
  qualified on stale prices. Unknown freshness fails closed ("age unknown"),
  never renders as fresh.
- **Deal validation + featured gate:** `isFeatured` needs `aiScore >= 75` **and**
  `validation.status === 'validated'`; the suspicious-claim detectors
  (`checkDeal`, `detectFakeSale`, `checkPriceInflation`) are wired into ranking;
  stored `deal_rankings` rows are re-scored on every read, never trusted.
- **Value ranking + dedupe:** the score gained an actual-value term (gap between
  current and recorded lowest price); `getRankedDeals` dedupes identical deals.
  Migration **054** (UNIQUE on deals, DO NOT APPLY) is the durable version of
  the same guard — the code dedupe already works before it is applied.

### Phase 3 — Predictions + decision engine (§12 #28, #32–#35)

- **OLS forecast (`lib/forecast.ts`):** least-squares trend over recorded
  history only; range = central ± 1.96 × sigma_eff × sqrt(1 + h/90), sigma
  floored at 2% of the mean price; horizons 7/14/30/60/90 (defaults 7/30/90);
  direction from 30-day drift with a 1% flat guard; never an exact price or
  date. **Flat-series fix:** a flat series counts its R² = 1 as 0 fit evidence.
  **Thin-history 25% cap:** ≤ 4 points caps confidence at 25% before the
  horizon penalty. A flat 4-point series scores 21% / 16% / 9% (7d/30d/90d) —
  the old formula gave 76% / 71% / 64%. **Backtest:** walk-forward on the
  product's own history, zero trials → `accuracyPct: null`, never a fabricated
  %. Full detail: `docs/price-prediction-documentation.md`.
- **Discount-probability guards (§12 #28):** below 5 points the probability is
  the guarded 0 (not a measured fact), the expected lowest price is null, the
  expected sale date is null below 10 points, and cached thin-history rows are
  never served (treated as cache misses and recomputed).
- **Buy-or-wait verdicts (§12 #32/#33):** two new verdicts — `track_price`
  (near the low on thin history, no strong signal yet) and
  `compare_alternatives` (a cheaper alternative ≥ 5% cheaper exists) — plus an
  optional budget input: over budget never says `buy_now`, it says `wait` with
  the gap stated. Confidence capped at 85 overall, 25 on thin history.
  Stale prices (> 7 days) qualify the verdict in the reason. Full detail:
  `docs/decision-engine-documentation.md`.
- **Outcomes recorder (§12 #34):** every prediction is recorded as a `pending`
  outcome for its 30-day horizon — but storage activates only after the owner
  applies migration 032; until then it fails safe as `missing-table`.

### Phase 5 — Comparison + transparency (§12 #17, #48–#51, #55, #57)

- Warranty/shipping/seller read from recorded merchant data only (null → honest
  empty state, never a guess); merchant reliability from recorded data only.
- Suitability prose generated from the recorded comparison data; source
  labelling shared across assistant/comparison outputs (verified data vs general
  knowledge); "Best choice" weights disclosed; "Best Value for Money"
  relabelled honestly (lowest price, not quality per dollar).
- Transparency block (`components/ai/transparency-block.tsx`): data used,
  last-updated, confidence, assumptions, missing info — as plain strings, no
  invented numbers. Known limit: recommendations/comparison blocks show "Not
  recorded" for the timestamp — no `generatedAt` exists in those API responses
  yet (follow-up, not a Section 19 item).

### Phase 8 — Security hardening (§12 #11, #92)

- **SSRF cache-after-guard:** the visual-search cache is consulted only after
  the URL passes the SSRF guard — a cached entry can never bypass validation.
- **`logApiError` bulk adoption (§12 #92):** 187 route files total; 32 already
  wired before the work started, 141 newly wired (200 call sites); **173/187
  wired (92.5%), 244 call sites total** at the first pass; the resume pass
  finished it to **178/187 wired, 245 call sites**. 9 unwired, all deliberate
  skips with an in-code justification comment each (the 4 no-catch routes
  plus guest/unsubscribe were wired in the resume pass). Five call sites were reverted by the coordinator
  so `error_log` stays server-errors-only (see "Coordinator decisions").
  Full detail: `docs/ai-security-report.md`.

### Phase 9 — Docs

Six Section 19 docs: `ai-engine-architecture.md`, `ai-product-analysis.md`
(both written by the interrupted first worker, verified and corrected here),
`price-prediction-documentation.md`, `decision-engine-documentation.md`,
`ai-security-report.md`, and this summary. Plus `docs/ai-background-jobs.md`
(the queue decision — see below).

## Coordinator decisions (4)

1. **LLM flag removed; deterministic-only scope explicit.** The misleading
   OpenAI `enabled` flag is gone; the description states no LLM provider is
   configured. Adding a real LLM is owner-gated (decision + key).
2. **Deal Score withheld below 5 points everywhere.** The 100/100 on 4-point
   products is a data problem, not a formula problem; the badge is gated, not
   shown as a real score.
3. **Background jobs stay in-process/cron; no Upstash/BullMQ.** The existing
   Vercel-native in-process/cron pattern is kept; BullMQ is not installed.
   Bulk re-embedding genuinely needs Upstash Redis + BullMQ (owner-gated) —
   documented in `docs/ai-background-jobs.md` §6, not built.
4. **`error_log` stays server-errors-only.** The 5 reverted call sites (3 inner
   validation 422s + 2 webhook 400s) would have logged user typos as errors.
   The Stripe webhook signature 400 stays as a security event.

## Accepted deviations (3)

- **Provider validation is key-presence-only by design.** No network probe, so
  validation burns zero SerpAPI/HF quota. A present key is not proof the
  provider works; the label says `'available-unverified'`.
- **ai-search invalidation traded for a short TTL.** `invalidateProductCaches`
  clears ai-summary, prediction and comparison keys; ai-search and deals-ranked
  stay TTL-bounded by design.
- **`includeWeb` stays anonymous.** The web leg of ai-search remains available
  to anonymous users; the tightened per-minute caps and the 5/day SerpAPI
  budget cap the exposure instead of an auth wall.

## Verification gate (Section 19, 13 Nov 2026)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| Full `npx vitest run` | **286 files / 3,425 tests passed, 4 skipped (3,429 total), 0 failed** (baseline 216/2,685 → +70 files, +740 tests; 31 Section 19 test files) |
| `npm run test:a11y` | **31 tests / 5 files, all pass** (Section 18's "19/19" is superseded — the a11y config now runs 31 tests) |
| `npm run lint` | **0 errors, 0 warnings** (Section 18 had 16 warnings — the exhaustive-deps and no-img-element warnings are fixed/documented) |
| `npm run check:press-counts` | OK — committed JSON `lib/generated/press-counts.json` = 3,425 tests / 286 files, date 2026-11-12 |
| Clean build (placeholder env, `rm -rf .next`) | **exit 0, 802 static pages**, `/products/[slug]` First Load **338 kB** (budget ≤350 kB), homepage **323 kB** |
| API routes | **187 route files / 253 handlers** (verified by count) |
| `logApiError` | **178/187 route files wired, 245 call sites** |
| Migrations | **52 files** (001–054, gaps 024/025/046), **18 DO NOT APPLY** (035–043, 045, 047–054) |
| i18n | **167 keys**, 20 languages (DictKey union, verified by count) |

**Flaky-test truth (do not misquote):** the audit's flaky episode (2 tests
failed once, 0 on re-run) **never reproduced in 4 full runs**, and the
`waitFor` timeouts were hardened. The one deterministic failure found during
the gate was the stale press-counts pin test — fixed by re-locking the pin to
this baseline (286/3,425). The flaky test is **not** claimed "fixed"; it is
unreproduced, with hardened timeouts.

## What is still data-blocked (not a code gap)

- **Review-based analysis** — 0 reviews. The engine exists; the data does not.
  Seeding fake reviews is rejected (audit, rejected item 19).
- **Spec-based comparison / quality analysis** — 0 spec rows.
- **Per-merchant warranty / reliability / shipping data** — code paths exist;
  no verified source exists yet. Owner-gated.
- **Verified coupon liveness** — coupon validity is expiry date only.
- **Prediction outcomes storage** — needs migration 032 (owner-gated).
- **Prices still stale (2026-11-02)** — every live forecast and verdict is
  computed from stale history and says so.

## Owner-gated remainder (unchanged in kind, one file added)

- Applying migrations 026–054 (each, in order, with preconditions; 035 only
  after a separate explicit review; 044 is the single remaining step for
  Section 16; 032 activates prediction-outcome storage; 048 activates
  `error_log` storage; 054 adds the deals UNIQUE guard).
- Live keys: SerpAPI, Hugging Face token, OpenAI/LLM provider decision + key.
- Upstash Redis provisioning (shared cache + BullMQ for bulk re-embedding).
- Stripe live keys + `STRIPE_LIVE_LAUNCHED=true` + price decision ($1 vs $4.99
  vs $9.99); eBay keys; Skimlinks application; Resend + VAPID; image-host
  allowlist (blocked on knowing a real merchant image host).
- Live verification round: signed-in admin, Stripe test checkout, email/push
  delivery, cron firing, guest merge — none proven live yet.
