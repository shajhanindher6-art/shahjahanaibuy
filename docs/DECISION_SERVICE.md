# Decision Service — Master Tool Integration, Stage 4

**Date:** 2026-11-14 · **Status:** built + gated, uncommitted, NOT pushed.
**Files:** `services/shopping-decision.ts` (new), `tests/shopping-decision.test.ts` (new).

## S4-1 — ShoppingDecisionService (thin orchestrator)

`buildShoppingDecision(supabase, { productSlugs, budgetUsd? })` composes
the three existing decision services in order and returns ONE combined,
typed result:

```ts
{
  products,            // resolved products, in requested slug order
  matrix,              // decision-matrix rows
  prediction,          // primary product's buy/wait prediction
  predictionsBySlug,   // per-product predictions, keyed by slug
  comparison?,          // absent when < 2 products resolved; null when the delegate returned none
  verdict,             // { bestChoiceProductId, withheld, reason }
  dataQuality,         // { verified, fresh, missing[] }
  sources,             // every number attributed to its origin
}
```

It adds NO new scoring math, NO new prediction math, and NO invented
verdicts. The only numbers it computes itself are honest rollups: the
lowest listing price per product (a min over recorded rows), the
cheaper-alternative price handed to the buy-wait delegate (the lowest
listing price among the OTHER resolved products, so the delegate's own
`compare_alternatives` trigger can fire), and the data-quality flags.

### Delegation table

| Orchestrator step | Delegates to (exact function) |
|---|---|
| (a) Resolve product(s) | `services/tool-integration.ts#getToolProduct` (Stage-1 cached fetch) |
| (a) Price history per product | `services/tool-integration.ts#getToolPriceHistory` |
| (a) Merchant listings per product | `services/tool-integration.ts#getToolMerchantProducts` |
| (a) Specs presence per product | `services/products.ts#getProductAttributes` |
| (a) Coupons (once, shared) + merchant-name map | `services/commerce.ts#getCoupons` / `#getMerchants` |
| (b) Decision-matrix rows | `services/decision-matrix.ts#buildMatrixRows` |
| (c) Buy/wait prediction (per product) | `services/buy-wait-prediction.ts#predictBuyVsWait` |
| (d) Comparison (2+ products only) | `services/ai-comparison.ts#compareProducts` |

Matrix retailer rating/review counts are `null`: `merchant_products`
rows carry no rating source (the comparison delegate reads reviews
itself); the matrix renders those cells as "—" by the delegate's design.

### Honesty rules

- `dataQuality.missing[]` lists every required input that was
  unavailable, in product order: unresolved slug, no merchant listings,
  no / insufficient price history, stale latest price, no specs, no
  GTIN, no product image, no model number. Ratings and coupons are
  OPTIONAL matrix cells (rendered "—" when absent) and are not listed.
- `dataQuality.verified` is true only when EVERY resolved product
  carries `priceVerificationStatus === 'verified'` (false on the live
  catalog — all 10 products unverified). `dataQuality.fresh` is true
  only when EVERY resolved product's latest recorded price is fresh.
- The comparison verdict is WITHHELD (no best-choice id) unless every
  compared product has at least `BUY_WAIT_MIN_POINTS` (5) recorded
  price points AND a fresh latest price — the same withholding pattern
  as `lib/deal-score.ts#dealScoreForDisplay` (withheld below its
  data-points minimum) and the same bar the buy-wait delegate applies
  itself (`not_enough_data` below 5 points; verdict withheld on a stale
  latest price). The comparison result itself is still attached when
  present — only the VERDICT is withheld. Verification status does NOT
  withhold the ranking (it ranks recorded prices); the delegate's own
  `sourceLabel` already downgrades an unverified/stale comparison to
  the recorded-data range label, and `dataQuality.verified` reports the
  stamp separately.
- No page or tool is wired to this service in this stage (wiring is a
  later stage's job). No existing service's behaviour was changed.

## S4-2 — AIEngine / ProviderRegistry extension: NOT NEEDED

**Decision: do NOT build it.** No concrete routing need was
demonstrated by Stages 1–3. Evidence, checked in-tree 2026-11-14:

1. **No Stage 1–3 consumer routes through the engine.** Grep over
   `app/tools/`, `services/tool-integration.ts`, `services/decision-matrix.ts`,
   `services/buy-wait-prediction.ts`, `services/ai-comparison.ts` finds
   zero references to `AIEngine` / `engine.invoke` /
   `getProviderRegistry`. Stage 1–3 consumers call the Stage-1 service
   (`getToolProduct` / cached fetch) and the link builders directly.
   The engine's callers are the AI surfaces (`app/api/v1/ai-search`,
   `/chat`, `/recommendations`, `/scan`, `/smart-deals`,
   `/visual-search`, admin AI) — none of them is a shopping tool.
2. **The engine routes capabilities to providers with fallback; the
   orchestrator has nothing to fall back to.** `services/ai-engine/engine.ts`
   tries each registered provider's `invoke()` in order, with circuit
   breaking, quota and usage-ledger writes. Each of the orchestrator's
   three delegates has exactly ONE implementation — there is no
   alternate matrix builder, buy-wait predictor or comparer to fall
   back to, and no LLM capability involved (the whole decision layer
   is deterministic). Routing a deterministic composition through the
   engine would add latency/usage bookkeeping and a second entry point
   for zero routing benefit.
3. **The pieces the engine already routes do not cover this
   composition.** The engine's `compare` capability routes to the
   `ai-comparison` provider (`services/ai-engine/providers.ts`), which
   calls `compareProducts` — one leg only. Its `buy-wait` capability
   routes to the `personal-assistant` provider, which calls
   `buyWaitAssistant` (a chat-intent wrapper), NOT `predictBuyVsWait`
   — so even routing through the engine would NOT reach the delegate
   the orchestrator uses. No capability exists for "decision matrix",
   and none exists for "compose matrix + prediction + comparison into
   one decision". Inventing a new capability + provider that just calls
   the orchestrator would be a duplicate entry point — exactly the
   third parallel engine the audit rejects (audit R-02).
4. **ProviderRegistry is the wrong layer.** `services/providers/registry.ts`
   registers MERCHANT data providers (eBay, Best Buy, Amazon, …) for
   fetching listings — not tool routing. Shopping-tool routing needs no
   merchant-provider lookup.

**Revisit if:** a future stage adds a second implementation of any
delegate (e.g. a live-price predictor alongside the recorded-history
one) that a caller must choose between at runtime, or a tool needs
engine features (quota, circuit breaking, usage ledger) around a
decision call. Until then the direct call is the canonical path.
