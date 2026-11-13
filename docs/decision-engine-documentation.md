# Decision Engine Documentation — SmartBuy AI (Section 19)

**Last updated:** 2026-11-13 (Section 19, Phase 3 — describes the finished built state)
**Code:** `services/buy-wait-prediction.ts` (the engine),
`components/products/best-time-to-buy.tsx` (product-page surface),
`services/personal-assistant.ts` (conversational caller),
`app/api/v1/predictions/[productId]/route.ts` (API surface),
`lib/forecast.ts` (the OLS forecast the verdicts sit alongside — see
`docs/price-prediction-documentation.md`).

> The decision engine answers one question — **buy now, or wait?** — from the
> product's own recorded price history and nothing else. It is deterministic:
> the same recorded points always give the same verdict. There is no LLM, no
> model, and no outside data in the decision. Every verdict carries its reason
> in plain language, tied to the actual points, so a visitor can check the
> reasoning instead of trusting a badge.

## Live data reality

The catalogue has **10 products** with **4 recorded price points each** (Amazon
only), last recorded **2026-11-02** (stale). Four points is thin history by this
engine's own rule, so every live verdict is low-confidence (≤ 25%) and the
freshness qualification applies (see "Stale prices qualify the verdict"). The
engine says that out loud rather than sounding sure about 4 points.

## Verdicts

`predictBuyVsWait(points, options)` returns one of five recommendations
(`BuyWaitRecommendation`):

| Verdict | Meaning | When it fires |
|---|---|---|
| `buy_now` | Buy Now — the price is at/near its recorded low, or below its recorded average | Current price ≤ lowest × 1.02 (at the low), or current < average × 0.95 (below average) |
| `wait` | Wait — no strong buy signal; the price has room to fall, has dropped before, is above budget, or is rising | Above budget (see below); above average × 1.05 with ≥ 1 past drop; rising trend (slope > +2%); or the default when nothing else fires |
| `track_price` | Track Price — near the low, but the history is too thin for a strong signal | Thin history (≤ 4 points, low confidence) **and** current ≤ lowest × 1.05 but **not** at the low (at the low is `buy_now`) |
| `compare_alternatives` | Compare Alternatives — a cheaper alternative exists; check it before buying | A cheaper alternative price was supplied and the current price is ≥ 5% above it (current > alternative × 1.05) |
| `not_enough_data` | No verdict — not enough history to decide | Fewer than 2 recorded points (0 points: "no recorded prices yet"; 1 point: "only one recorded price so far") |

Precedence is deliberate and stated in the code (§12 #32/#33):

1. **Over budget → `wait`**, with the gap stated (never `buy_now` above budget).
2. **Cheaper alternative (≥ 5% cheaper) → `compare_alternatives`.**
3. **At/near low or below average → `buy_now`.**
4. **Thin history + near low (within 5% above the low, not at it) → `track_price`.**
5. **Otherwise `wait`** — above average with past drops, rising trend, or no
   strong buy signal.

With no budget and no alternative supplied, rules 1–2 never fire and the engine
behaves exactly as before (buy_now / wait / not_enough_data only). Both new
verdicts were added in Section 19, Phase 3 (§12 #32); both need their stated
inputs, and without them nothing changes.

## Budget input (§12 #33)

`BuyWaitOptions.budgetUsd` is the visitor's stated maximum budget in USD
(optional). Rules:

- When the current price exceeds the budget, the verdict **never** says
  `buy_now` — it says `wait` and states the gap: "above your budget by $X
  (your budget: $Y)". The response exposes `budgetGapUsd` (current − budget,
  2 decimals) so the UI can show the number.
- Even at the recorded low, an over-budget price is still `wait` — the reason
  says so explicitly ("even though the price is at its recorded low").
- An invalid budget (not a finite positive number) is ignored, never invented
  or guessed. No budget supplied → unchanged behaviour.

## Cheaper-alternative input (§12 #32)

`BuyWaitOptions.cheaperAlternativePrice` is the price of a cheaper alternative
product in USD (optional). When the current price is at least 5% above it, the
verdict is `compare_alternatives` and the reason states the saving in dollars
and percent ("$X (Y%) less than the current price"). A smaller gap is noise,
not a reason to switch products. `null` when no alternative is known — the
engine never invents one.

## Confidence

Confidence is 0–100, **never above 85** — an estimate, not a guarantee
(`CONFIDENCE_CAP = 85`). The stated formula:

- Base by point count: 2–4 points → 25; 5–11 → 45; 12–29 → 60; 30+ → 75.
- Minus 10 when prices are highly volatile (stddev / mean > 0.20).
- Clamped to 10–85, then capped at **25 when history is thin (≤ 4 points)**
  (`THIN_HISTORY_MAX_POINTS = 4`, `THIN_HISTORY_CONFIDENCE_CAP = 25`) — the
  same 25% cap the OLS forecast applies, one rule for both engines.
- `lowConfidence` is true exactly when history is thin; the UI must show the
  low-confidence label. `not_enough_data` is the only verdict with confidence 0.

## Explanations and transparency

Every verdict returns a one-line `reason`, always tied to the actual points —
current price, lowest, average, drop count, point count, budget gap, or
alternative saving, as applicable. Examples from the code (values are the
product's own recorded numbers, filled in at runtime):

- Buy: "Buy Now — the current price ($999.00) is at or near the lowest recorded
  price ($999.00), based on 4 recorded points."
- Track: "Track the price — the current price ($X) is near the lowest recorded
  price ($Y) but the history is thin (4 recorded points, low confidence), so
  there is no strong buy or wait signal yet. Set a price alert and decide once
  more prices are recorded."
- Compare: "Compare alternatives — a cheaper alternative is available at $X,
  $Y (Z%) less than the current price ($W). Check it before buying, based on 4
  recorded points."
- Wait (budget): "Wait — the current price ($X) is above your budget by $Y
  (your budget: $Z). Buying now would exceed your budget …"

The response also exposes the inputs behind the verdict so callers can show
them: `pointCount`, `spanDays`, `currentPrice`, `lowestPrice`, `averagePrice`,
`slopePct` (whole-percent least-squares slope over the span, null below 2
points), `dropCount` (consecutive point-to-point decreases — real drops only),
`daysSinceLastDrop`, `seasonalSupported`, `priceStale`, `daysSinceLastPrice`,
`budgetGapUsd`. The shared transparency block
(`components/ai/transparency-block.tsx`) renders data used, last-updated
timestamp, confidence, assumptions and missing info on the AI surfaces — see
`docs/ai-product-analysis.md`.

## Stale prices qualify the verdict (§12 #20 note)

The verdict is only as current as the latest recorded price. When the latest
recorded price is older than `STALE_PRICE_DAYS` (7 days), the reason carries the
staleness ("Note: the latest recorded price is N days old, so this verdict is
based on stale data — treat it as a rough guide, not a current price") instead
of presenting the verdict as if the price were checked today. `priceStale` and
`daysSinceLastPrice` expose it to callers. With live prices last recorded
2026-11-02, every live verdict carries this qualification.

## Seasonality

Claimed only when the history supports it: **≥ 12 points spanning ≥ 90 days**
(`SEASONAL_MIN_POINTS = 12`, `SEASONAL_MIN_SPAN_DAYS = 90`). Otherwise
`seasonalSupported` is false and the UI must say "not enough history for
seasonal analysis". The live catalogue (4 points) never supports a seasonal claim.

## What the engine never does

- **Never outputs an exact future price or an exact future date.** Older
  prediction displays that did so are retired, not reused. The OLS forecast
  beside it outputs ranges, never points — see
  `docs/price-prediction-documentation.md`.
- **Never decides from one point.** Fewer than 2 points → `not_enough_data`,
  confidence 0, no verdict, no percentage.
- **Never buys above budget, never invents an alternative, never fills a gap
  with a guess.** Missing inputs produce a weaker verdict, not a fabricated one.
- **Never presents a thin-history verdict as confident.** ≤ 4 points caps
  confidence at 25% and sets `lowConfidence`; the reason names the thin history.
