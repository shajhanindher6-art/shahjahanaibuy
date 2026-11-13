# Price Prediction Documentation — SmartBuy AI (Section 19)

**Last updated:** 2026-11-13 (Section 19, Phase 3 — describes the finished built state)
**Code:** `lib/forecast.ts` (OLS forecast + backtest), `services/ai-predictions.ts`
(discount-probability prediction), `services/prediction-outcomes.ts` (outcomes
recorder), `app/api/v1/forecast/[productId]/route.ts`,
`app/api/v1/forecast/[productId]/backtest/route.ts`,
`app/api/v1/predictions/[productId]/route.ts`,
`app/api/v1/predictions/accuracy/route.ts`,
`app/api/v1/predictions/outcomes/route.ts`,
`app/api/v1/tools/forecast-explainer/route.ts`.

> Two different predictions live side by side in this codebase, and they must not
> be confused. The **OLS forecast** (`lib/forecast.ts`) fits a least-squares trend
> to recorded price history and returns a **range** for a horizon window. The
> **discount-probability prediction** (`services/ai-predictions.ts`) is an older
> rule-based score (points for "above average", "above lowest", "dropped before")
> that returns a probability, an expected sale date and an expected lowest price.
> Both are deterministic, both read only recorded `price_history` rows, and
> neither is a guarantee. This document covers both, starting with the OLS
> forecast, which is the Section 19 system of record for "what will the price
> do".

## Live data reality

The catalogue has **10 products** with **4 recorded price points each** (Amazon
only), last recorded **2026-11-02** (stale). Every number below is computed from
those 4 points per product. A 4-point history is thin history by every threshold
in this document, so every live forecast lands in the **low-confidence** band and
every live discount-probability prediction is the guarded "not enough history"
output. That is the honest state, not a bug: the engines refuse to sound sure
about 4 points.

## The OLS forecast (`lib/forecast.ts`)

### Method

Ordinary least squares, documented in the `lib/forecast.ts` header and verified by
reading the code on 13 Nov 2026:

- `x` = days since the first recorded point, `y` = recorded price. A
  least-squares line is fitted to the usable points only (finite price > 0,
  valid date, oldest-first, recorded at or before now).
- `central(h)` = the fitted line value at (last point + h days).
- **Range** = central ± 1.96 × sigma_eff × sqrt(1 + h / 90), where sigma_eff is
  the residual standard deviation, **floored at 2% of the mean recorded price**
  so a 2-point exact fit (residual 0) never produces a dishonest zero-width
  range. The floor also widens ranges for very short histories.
- **Direction:** the fitted 30-day drift vs the current price; |drift| < 1%
  counts as `flat` (noise guard). Otherwise `down` (drift < 0) or `up`.
- **Horizons:** defaults 7 / 30 / 90 days (`FORECAST_HORIZONS`). Callers may
  request any subset of 7 / 14 / 30 / 60 / 90 (`FORECAST_ALLOWED_HORIZONS`);
  anything else is rejected by the forecast API with a 400 and
  `computeForecast` throws a `RangeError`. The set is deliberately small: a
  horizon is only meaningful when the product has recorded history spanning it.
- **Never an exact price or date.** A forecast is a **range for a horizon
  window** — never "the price will be $X on date Y". The note on every forecast
  says: "Probabilistic range from recorded price history only — not a guarantee
  of a future price."

### Confidence formula (Section 19, Phase 3)

Confidence is a percentage, **never above 90, never below 5**. It combines fit
quality (R²), point count, and horizon — longer horizons and thinner histories
score lower. It is a statement about the fit to recorded history, not a promise
about the future:

```
confidenceBase = 15 + 55 × fitEvidence + min(15, max(0, n − 2) × 3)
confidencePct  = clamp(confidenceBase − horizonPenalty(h), 5, 90)
horizonPenalty: h ≤ 7 → 0; h ≤ 30 → 5; otherwise → 12
```

Bands (wording only, Section 16 item 11): < 40% **low**, 40–69% **medium**,
≥ 70% **high**. The live catalogue's 4-point forecasts land in "low", and the UI
must say so instead of showing a bare percentage. The basis label rendered
wherever a forecast range is shown reads, for example:
"Based on 4 recorded price points · 21% confidence (low)".

Two honesty rules, both added in Section 19, Phase 3 (§12 #28 — the old formula
violated both):

- **(a) Flat-series fix.** A flat series (all recorded prices equal) has zero
  variance to explain, so its R² is 1 by construction. The old formula counted
  that as 55 points of fit evidence — "perfect flatness" scored as strong
  evidence. Now a flat series counts its fit term as **R² = 0**: flatness carries
  no directional evidence. (`isFlat` is set when the total sum of squares is 0;
  `fitEvidence = fit.isFlat ? 0 : fit.rSquared`.)
- **(b) Thin-history 25% cap.** With **≤ 4 points** (`FORECAST_THIN_HISTORY_MAX_POINTS`),
  confidence is capped at **25%** (`FORECAST_THIN_HISTORY_CONFIDENCE_CAP`) —
  deliberately the same number as the Buy vs Wait engine's
  `THIN_HISTORY_CONFIDENCE_CAP`, one rule for both engines. The cap is applied
  **before** the horizon penalty is subtracted, so a longer horizon still scores
  lower than a shorter one.

Worked result, verified in the code comments and the test suite: a flat 4-point
series scores **21% (7d) / 16% (30d) / 9% (90d)** — low band. The old formula
gave the same series 76% / 71% / 64%.

### Thin-history thresholds

| Points | Forecast (`lib/forecast.ts`) | Discount probability (`services/ai-predictions.ts`) |
|---|---|---|
| 0–1 usable points | status `not-enough-history`, no forecasts, `currentPrice` = the single point's price when 1 exists, else null | `predictPriceDrop` returns `null` (no history at all); callers show the insufficient-data path |
| 2–4 points | Forecast computed, confidence capped at 25% (see above) | Discount probability **0** (guarded, not measured); expected lowest price **null**; explanation states the history is too thin instead of "0% probability of a price drop" |
| < 5 points | — | Cached `ai_predictions` rows from thin history are never served: `getCachedPrediction` returns null (cache miss) so the prediction is recomputed with the guard |
| < 10 points | — | Expected sale date **null** (`predictSaleDate` needs ≥ 10 points) |
| ≥ 5 points | Confidence uncapped (still ≤ 90) | Probability computed from the rule score; expected lowest price = round((lowest + (lowest + average) / 2) / 2) |

The discount-probability rule score (only when ≥ 5 points): +30 if the current
price is above the historical average, +20 if above the lowest, +20 if the drop
from the peak exceeds 10%, +15 if the recent-10 average is above the overall
average, +15 if more than 30 points exist; clamped to 0–95. The confidence score
for that prediction is banded by point count: < 10 → 20, < 30 → 40, < 90 → 60,
< 200 → 75, ≥ 200 → 70–90 by coefficient of variation (< 0.1 → 90, < 0.2 → 80,
else 70).

### Insufficient-data path

- OLS forecast: `computeForecast` returns `{ status: 'not-enough-history',
  forecasts: [], note: 'Not enough price history yet — at least 2 recorded
  prices are needed before any forecast can be made.' }`. The API surfaces the
  status; the UI renders an honest empty state, never a range.
- Discount probability: `predictPriceDrop` returns `null` on no history, and the
  explanation for 2–4 points says: "Not enough price history to predict a
  discount — only N recorded price(s) so far; at least 5 are needed before a
  discount prediction can be made."
- Seasonality is claimed only when the history supports it: ≥ 12 points spanning
  ≥ 90 days (Buy vs Wait rule, `SEASONAL_MIN_POINTS` / `SEASONAL_MIN_SPAN_DAYS`).
  Otherwise the UI says "not enough history for seasonal analysis".

## Backtest (`backtestForecast`, `lib/forecast.ts`)

A walk-forward backtest on the product's **own** recorded history — never
fabricated:

- For each split point i (≥ 2 points to fit, and a later recorded point at/after
  i + horizon), fit the line on points[0..i], forecast the horizon range, and
  check the **first recorded price at/after the horizon date** (within a 14-day
  tolerance) against that range.
- A trial exists **only** when such an actual price was recorded; a split with no
  later price is skipped — counted as neither a hit nor a miss.
- Zero trials → `accuracyPct: null`, never a fabricated percentage, and the note
  says: "Not enough price history yet to backtest — no past forecast has a
  recorded price at its horizon date."
- With ~30 days of history a 30-day backtest has **zero trials**, and says so
  honestly. The live catalogue (4 points over ~30 days) backtests to zero trials
  on every horizon.

The backtest accepts the same configurable horizons as the forecast (7 / 14 / 30 /
60 / 90). It exists so a visitor can see how often the range has missed on this
product's own history — the range may miss, and the report shows it.

## Outcomes recorder + owner-gated 032 storage

`services/prediction-outcomes.ts` (`recordPredictionOutcome`) closes the
prediction loop: every discount-probability prediction is recorded as a
`pending` outcome (30-day horizon) so a refresh run can resolve it once its
horizon passes. The recorder is fire-and-forget and fail-safe — it never throws
and never breaks a prediction response.

**Storage activates only after the owner applies migration 032.** Until then the
`prediction_outcomes` table does not exist and every call fails safe: a
missing-table error (PGRST205) is reported as `missing-table` / a clean skip, and
the recorder logs once that storage activates only after migration 032. Writes go
through the service-role client only. Applying 032 is an **owner step** — it is
not applied by any build, and no build may claim outcomes are being stored until
it is.

Predictions themselves are cached in the existing `ai_predictions` table
(`price_data_range` jsonb carries `dataPoints`; no migration — the column already
exists from migration 008). A cached row written before the point count existed,
or from thin history (< 5 points), is treated as a cache miss and recomputed.

## What a forecast is not

- **Not a guarantee.** No forecast, probability, sale date or expected price is
  ever presented as a certain outcome. Confidence is a statement about the fit,
  capped at 90%.
- **Not an exact-date forecast.** The discount-probability prediction's expected
  sale date is a rough "around" date from the lowest-price cycle (6 months after
  the last lowest when the lowest was < 3 months ago, else 1 month from now) and
  is null below 10 points; the OLS forecast never outputs a date at all.
- **Not live data.** Every input is a recorded `price_history` row. With prices
  last recorded 2026-11-02, every live forecast is computed from stale history
  and the freshness stamp says so — see `docs/ai-product-analysis.md` for the
  freshness gate.
