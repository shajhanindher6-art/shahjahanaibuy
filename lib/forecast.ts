/**
 * Probabilistic price forecasting — pure, computed ONLY from recorded
 * `price_history` points. No scraped prices, no invented points, no
 * exact future price or date (the Buy vs Wait rule: a forecast is a
 * RANGE for a horizon window, never "the price will be $X on date Y").
 *
 * METHOD (documented, deterministic — ordinary least squares):
 * - x = days since the first recorded point, y = recorded price.
 * - A least-squares line is fitted to the usable points (finite
 *   price > 0, valid date, oldest-first).
 * - central(h) = line value at (last point + h days).
 * - Range = central ± 1.96 × sigma_eff × sqrt(1 + h / 90), where
 *   sigma_eff is the residual standard deviation, floored at 2% of
 *   the mean recorded price so a short-history exact fit (residual 0)
 *   never produces a dishonest zero-width range. The floor also
 *   widens ranges for very short histories.
 * - Direction: the fitted 30-day drift vs the current price;
 *   |drift| < 1% counts as 'flat' (noise guard).
 * - Confidence % (never above 90, never below 5) combines fit
 *   quality (R²), point count, and horizon: longer horizons and
 *   thinner histories score lower. It is a statement about the fit
 *   to recorded history, not a promise about the future.
 *   Two honesty rules (Section 19, Phase 3):
 *   (a) a FLAT series carries no directional evidence — its R² is
 *       1 by construction (zero variance to explain), so the fit
 *       term counts as R² = 0, never 55 points for "perfect
 *       flatness";
 *   (b) THIN history (fewer than 5 points) caps confidence at 25%
 *       — the same cap the Buy vs Wait engine applies to ≤ 4
 *       points — before the horizon penalty is subtracted, so a
 *       longer horizon still scores lower than a shorter one.
 *   A flat 5-point series therefore scores 15% (7d) / 10% (30d) /
 *   5% (90d) — low band, not the 76/71/64% the old formula gave
 *   for 4 points. (Section 20, §12 #46: below 5 points there is
 *   no forecast at all, so the old 21/16/9% 4-point figures no
 *   longer occur.)
 *
 * THRESHOLDS (same as Buy vs Wait): fewer than 5 usable points →
 * status 'not-enough-history'. A backtest trial needs a recorded
 * point at/after the horizon date; with ~30 days of history a
 * 30-day backtest has zero trials, and says so honestly.
 *
 * Section 20, §12 #46 — the minimum is unified at 5 with Buy vs
 * Wait (FORECAST_MIN_POINTS was 2; the badge, discount probability,
 * expected-lowest-price and expected-sale-date already gated at
 * ≥ 5/≥ 10, so a 2–4-point forecast was the odd one out, issuing
 * ranges/verdicts from seed-thin history). Below 5 points there is
 * no forecast — only the honest "not enough history" state.
 *
 * Every number here is labelled by callers as a probabilistic
 * range — "Simulated — not a forecast or a guarantee" in spirit:
 * the range may miss, and the backtest report exists to show how
 * often it has missed on this product's own recorded history.
 */

export interface ForecastPoint {
  price: number;
  recordedAt: string;
}

export type ForecastDirection = 'down' | 'up' | 'flat';

/** Horizons offered by default, in days. */
export const FORECAST_HORIZONS = [7, 30, 90] as const;
export type ForecastHorizonDays = (typeof FORECAST_HORIZONS)[number];

/**
 * Horizons a caller may request (Section 19, Phase 3, §12 #35) —
 * the defaults above plus 14 and 60 days. Anything else is rejected
 * by the forecast API with a 400; computeForecast throws a
 * RangeError. The set is deliberately small: a horizon is only
 * meaningful when the product has recorded history spanning it.
 */
export const FORECAST_ALLOWED_HORIZONS = [7, 14, 30, 60, 90] as const;
export type AllowedForecastHorizon = (typeof FORECAST_ALLOWED_HORIZONS)[number];

export function isAllowedForecastHorizon(value: number): value is AllowedForecastHorizon {
  return (
    Number.isInteger(value) &&
    (FORECAST_ALLOWED_HORIZONS as readonly number[]).includes(value)
  );
}

/** Thin history (fewer than this many points) caps confidence — see below. */
export const FORECAST_THIN_HISTORY_MAX_POINTS = 4;
/**
 * Thin-history confidence cap, in percent (Section 19, Phase 3).
 * Deliberately the SAME number as the Buy vs Wait engine's
 * THIN_HISTORY_CONFIDENCE_CAP (25) — one rule for both engines:
 * with ≤ 4 recorded points no forecast may claim more than 25%
 * confidence, however good the fit looks. Not a new number.
 */
export const FORECAST_THIN_HISTORY_CONFIDENCE_CAP = 25;

/** Smallest history that can support any forecast (Buy vs Wait rule, Section 20 §12 #46: unified at 5). */
export const FORECAST_MIN_POINTS = 5;

/** Confidence is capped here — a fit to recorded history is never 100%. */
export const FORECAST_MAX_CONFIDENCE_PCT = 90;
export const FORECAST_MIN_CONFIDENCE_PCT = 5;

/** |30-day drift| below this counts as flat (noise guard). */
export const FORECAST_FLAT_THRESHOLD_PCT = 1;

export interface HorizonForecast {
  horizonDays: number;
  /** Centre of the range (the fitted line value), 2 decimals. */
  central: number;
  /** Lower bound of the range, 2 decimals, always > 0. */
  low: number;
  /** Upper bound of the range, 2 decimals. */
  high: number;
  /** 5–90. A statement about the fit, never a guarantee. */
  confidencePct: number;
  direction: ForecastDirection;
  /** Usable recorded points the fit used. */
  pointsUsed: number;
  /** Days spanned by the usable points. */
  historyDays: number;
}

export interface ProductForecast {
  status: 'ok' | 'not-enough-history';
  currentPrice: number | null;
  forecasts: HorizonForecast[];
  pointsUsed: number;
  historyDays: number;
  /** Fixed method description, for UI disclosure. */
  method: string;
  note: string;
}

export interface BacktestEntry {
  /** ISO date of the last recorded point the forecast was made from. */
  forecastDate: string;
  horizonDays: number;
  low: number;
  high: number;
  /** First recorded price at/after the horizon date. */
  actualPrice: number;
  actualDate: string;
  withinRange: boolean;
}

export interface BacktestReport {
  horizonDays: number;
  trials: number;
  hits: number;
  /** null when there are no trials — never a fabricated %. */
  accuracyPct: number | null;
  entries: BacktestEntry[];
  status: 'ok' | 'not-enough-history';
  note: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Confidence display band (Section 16, item 11) — wording only,
 * never a formula change: the confidence % itself is computed in
 * forecastForHorizon from fit quality (R²), point count and
 * horizon. Bands: < 40% low, 40–69% medium, ≥ 70% high. The live
 * catalog's 5-point forecasts land in "low", which is exactly what
 * the UI must now say instead of showing a bare percentage.
 */
export type ForecastConfidenceLabel = 'low' | 'medium' | 'high';

export function forecastConfidenceLabel(
  confidencePct: number
): ForecastConfidenceLabel {
  if (!Number.isFinite(confidencePct) || confidencePct < 40) return 'low';
  if (confidencePct < 70) return 'medium';
  return 'high';
}

/**
 * One-line basis label for a forecast, from its existing inputs:
 * "Based on 5 recorded price points · 15% confidence (low)".
 * Callers render this wherever a forecast range is shown (product
 * page forecast card, /tools/forecast-explainer) so the visitor can
 * see how thin the history behind the range is. The example number
 * is real, not illustrative: a flat 5-point series scores 15% at
 * 7 days — the flat fit carries no directional evidence (R²
 * counted as 0).
 */
export function formatForecastBasis(
  pointsUsed: number,
  confidencePct: number
): string {
  const points = Number.isFinite(pointsUsed) ? Math.max(0, Math.floor(pointsUsed)) : 0;
  return (
    `Based on ${points} recorded price point${points === 1 ? '' : 's'} · ` +
    `${confidencePct}% confidence (${forecastConfidenceLabel(confidencePct)})`
  );
}

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

interface UsablePoint {
  ms: number;
  price: number;
  recordedAt: string;
}

function usablePoints(points: ForecastPoint[]): UsablePoint[] {
  return points
    .filter(
      (p) =>
        Number.isFinite(p.price) &&
        p.price > 0 &&
        p.recordedAt &&
        Number.isFinite(toMs(p.recordedAt))
    )
    .map((p) => ({ ms: toMs(p.recordedAt), price: p.price, recordedAt: p.recordedAt }))
    .sort((a, b) => a.ms - b.ms);
}

interface LineFit {
  slopePerDay: number;
  intercept: number;
  /** Residual stddev; null when fewer than 3 points (no residual df). */
  sigma: number | null;
  /** R² of the fit; 1 for a perfectly flat series, 0 when undefined. */
  rSquared: number;
  /**
   * True when the series has zero variance (all recorded prices
   * equal). Section 19, Phase 3: a flat series is WEAK evidence,
   * not strong — its R² = 1 is an artefact of "nothing to
   * explain", so confidence counts its fit term as R² = 0.
   */
  isFlat: boolean;
  meanPrice: number;
  firstMs: number;
  lastMs: number;
}

/** Least-squares line over usable points, oldest-first. */
function fitLine(usable: UsablePoint[]): LineFit {
  const firstMs = usable[0].ms;
  const xs = usable.map((p) => (p.ms - firstMs) / DAY_MS);
  const ys = usable.map((p) => p.price);
  const n = usable.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - meanX) ** 2;
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
  }
  const slopePerDay = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slopePerDay * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const fitted = intercept + slopePerDay * xs[i];
    ssRes += (ys[i] - fitted) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  // Flat series: no variance to explain and no residual — the fit is
  // exact, so R² = 1. Otherwise a zero-variance edge cannot occur
  // (ssTot > 0 whenever prices differ). isFlat marks the series so
  // confidence can treat the fit as NO evidence (Section 19,
  // Phase 3) instead of rewarding perfect flatness with 55 points.
  const rSquared = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : clamp(1 - ssRes / ssTot, 0, 1);
  const sigma = n > 2 ? Math.sqrt(ssRes / (n - 2)) : null;
  return {
    slopePerDay,
    intercept,
    sigma,
    rSquared,
    isFlat: ssTot === 0,
    meanPrice: meanY,
    firstMs,
    lastMs: usable[usable.length - 1].ms,
  };
}

function horizonPenalty(horizonDays: number): number {
  if (horizonDays <= 7) return 0;
  if (horizonDays <= 30) return 5;
  return 12;
}

function forecastForHorizon(
  fit: LineFit,
  horizonDays: number,
  currentPrice: number,
  pointsUsed: number
): HorizonForecast {
  const lastX = (fit.lastMs - fit.firstMs) / DAY_MS;
  const centralRaw = fit.intercept + fit.slopePerDay * (lastX + horizonDays);
  const central = Math.max(0.01, round2(centralRaw));
  // Residual spread, floored at 2% of the mean recorded price so a
  // short-history exact fit never yields a zero-width range.
  const sigmaEff = Math.max(fit.sigma ?? 0, 0.02 * fit.meanPrice);
  const halfWidth = 1.96 * sigmaEff * Math.sqrt(1 + horizonDays / 90);
  const low = Math.max(0.01, round2(central - halfWidth));
  const high = round2(central + halfWidth);
  const driftPct =
    currentPrice !== 0 ? ((fit.slopePerDay * 30) / currentPrice) * 100 : 0;
  const direction: ForecastDirection =
    Math.abs(driftPct) < FORECAST_FLAT_THRESHOLD_PCT
      ? 'flat'
      : driftPct < 0
        ? 'down'
        : 'up';
  const n = pointsUsed;
  // Section 19, Phase 3 — confidence honesty (the OLS range math
  // above is untouched; only this number changes):
  // (a) a flat series has no variance to explain, so its R² = 1
  //     counts as ZERO fit evidence — the old formula rewarded
  //     perfect flatness with 55 points, so a flat 4-point series
  //     scored 76% (7d) / 71% (30d) / 64% (90d) — before Section 20
  //     §12 #46 raised the minimum to 5 points, so 4-point
  //     forecasts no longer exist;
  // (b) thin history (<= 4 points) caps the score at 25% — the
  //     same cap the Buy vs Wait engine applies — BEFORE the
  //     horizon penalty is subtracted, so a longer horizon still
  //     scores lower than a shorter one. Section 20, §12 #46: the
  //     cap is now subsumed by the 5-point minimum (computeForecast
  //     never calls this with fewer than 5 points), but it stays as
  //     a defence-in-depth floor for any direct caller.
  // Flat 5 points now: 15% (7d) / 10% (30d) / 5% (90d) — low band.
  const fitEvidence = fit.isFlat ? 0 : fit.rSquared;
  let confidenceBase =
    15 +
    55 * fitEvidence +
    Math.min(15, Math.max(0, n - FORECAST_MIN_POINTS) * 3);
  if (n <= FORECAST_THIN_HISTORY_MAX_POINTS) {
    confidenceBase = Math.min(
      confidenceBase,
      FORECAST_THIN_HISTORY_CONFIDENCE_CAP
    );
  }
  const confidencePct = Math.round(
    clamp(
      confidenceBase - horizonPenalty(horizonDays),
      FORECAST_MIN_CONFIDENCE_PCT,
      FORECAST_MAX_CONFIDENCE_PCT
    )
  );
  return {
    horizonDays,
    central,
    low,
    high,
    confidencePct,
    direction,
    pointsUsed: n,
    historyDays: Math.max(
      0,
      Math.round((fit.lastMs - fit.firstMs) / DAY_MS)
    ),
  };
}

// The fit does not carry n directly; callers pass the usable point
// count explicitly so the confidence term stays a pure function of
// its inputs.

/**
 * Probabilistic forecast for the requested horizons from recorded
 * price history only. Fewer than 5 usable points → 'not-enough-history'
 * with empty forecasts (same threshold as Buy vs Wait, Section 20
 * §12 #46).
 *
 * Section 19, Phase 3 (§12 #35): `horizons` is a configurable
 * period parameter — any subset of FORECAST_ALLOWED_HORIZONS
 * (7 / 14 / 30 / 60 / 90 days); the default is FORECAST_HORIZONS
 * ([7, 30, 90]). Anything outside the allowed set throws a
 * RangeError so the API can answer 400 instead of guessing.
 */
export function computeForecast(
  points: ForecastPoint[],
  nowMs: number = Date.now(),
  horizons: readonly number[] = FORECAST_HORIZONS
): ProductForecast {
  const usable = usablePoints(points).filter((p) => p.ms <= nowMs);
  const method =
    'Least-squares trend fitted to recorded price history only; range = fitted value ± 1.96 × residual spread.';
  for (const h of horizons) {
    if (!isAllowedForecastHorizon(h)) {
      throw new RangeError(
        `horizon must be one of ${FORECAST_ALLOWED_HORIZONS.join(', ')} days`
      );
    }
  }
  if (usable.length < FORECAST_MIN_POINTS) {
    return {
      status: 'not-enough-history',
      currentPrice: usable.length === 1 ? usable[0].price : null,
      forecasts: [],
      pointsUsed: usable.length,
      historyDays: 0,
      method,
      note: 'Not enough price history yet — at least 5 recorded prices are needed before any forecast can be made.',
    };
  }
  const fit = fitLine(usable);
  const currentPrice = usable[usable.length - 1].price;
  const historyDays = Math.max(0, Math.round((fit.lastMs - fit.firstMs) / DAY_MS));
  return {
    status: 'ok',
    currentPrice,
    forecasts: horizons.map((h) =>
      forecastForHorizon(fit, h, currentPrice, usable.length)
    ),
    pointsUsed: usable.length,
    historyDays,
    method,
    note: 'Probabilistic range from recorded price history only — not a guarantee of a future price.',
  };
}

/**
 * Walk-forward backtest for one horizon, computed ONLY from the
 * product's own recorded history — never fabricated.
 *
 * For each split point i (≥ 5 points to fit, and a later recorded
 * point at/after i + horizon), fit the line on points[0..i],
 * forecast the horizon range, and check the first recorded price
 * at/after the horizon date (within a 14-day tolerance) against
 * that range. A trial exists only when such an actual price was
 * recorded; otherwise the split is skipped, not counted as a hit
 * or a miss. Zero trials → accuracyPct null.
 */
export function backtestForecast(
  points: ForecastPoint[],
  horizonDays: number,
  nowMs: number = Date.now()
): BacktestReport {
  // Section 19, Phase 3 (§12 #35): the backtest accepts the same
  // configurable horizons as the forecast (7 / 14 / 30 / 60 / 90).
  if (!isAllowedForecastHorizon(horizonDays)) {
    throw new RangeError(
      `horizon must be one of ${FORECAST_ALLOWED_HORIZONS.join(', ')} days`
    );
  }
  const usable = usablePoints(points).filter((p) => p.ms <= nowMs);
  const baseNote =
    'Walk-forward backtest on this product’s own recorded price history: each past forecast is checked against the price actually recorded at the horizon date.';
  if (usable.length < FORECAST_MIN_POINTS + 1) {
    return {
      horizonDays,
      trials: 0,
      hits: 0,
      accuracyPct: null,
      entries: [],
      status: 'not-enough-history',
      note: 'Not enough price history yet to backtest — no past forecast has a recorded price at its horizon date.',
    };
  }
  const entries: BacktestEntry[] = [];
  for (let i = FORECAST_MIN_POINTS - 1; i < usable.length - 1; i++) {
    const train = usable.slice(0, i + 1);
    const fit = fitLine(train);
    const currentPrice = train[train.length - 1].price;
    const f = forecastForHorizon(fit, horizonDays, currentPrice, train.length);
    const targetMs = train[train.length - 1].ms + horizonDays * DAY_MS;
    const actual = usable.find(
      (p) => p.ms >= targetMs && p.ms <= targetMs + 14 * DAY_MS
    );
    if (!actual) continue;
    entries.push({
      forecastDate: train[train.length - 1].recordedAt,
      horizonDays,
      low: f.low,
      high: f.high,
      actualPrice: actual.price,
      actualDate: actual.recordedAt,
      withinRange: actual.price >= f.low && actual.price <= f.high,
    });
  }
  const hits = entries.filter((e) => e.withinRange).length;
  return {
    horizonDays,
    trials: entries.length,
    hits,
    accuracyPct:
      entries.length === 0
        ? null
        : Math.round((hits / entries.length) * 1000) / 10,
    entries,
    status: entries.length === 0 ? 'not-enough-history' : 'ok',
    note:
      entries.length === 0
        ? 'Not enough price history yet to backtest — no past forecast has a recorded price at its horizon date.'
        : baseNote,
  };
}
