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
 *   the mean recorded price so a 2-point exact fit (residual 0)
 *   never produces a dishonest zero-width range. The floor also
 *   widens ranges for very short histories.
 * - Direction: the fitted 30-day drift vs the current price;
 *   |drift| < 1% counts as 'flat' (noise guard).
 * - Confidence % (never above 90, never below 5) combines fit
 *   quality (R²), point count, and horizon: longer horizons and
 *   thinner histories score lower. It is a statement about the fit
 *   to recorded history, not a promise about the future.
 *
 * THRESHOLDS (same as Buy vs Wait): fewer than 2 usable points →
 * status 'not-enough-history'. A backtest trial needs a recorded
 * point at/after the horizon date; with ~30 days of history a
 * 30-day backtest has zero trials, and says so honestly.
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

/** Horizons offered, in days. */
export const FORECAST_HORIZONS = [7, 30, 90] as const;
export type ForecastHorizonDays = (typeof FORECAST_HORIZONS)[number];

/** Smallest history that can support any forecast (Buy vs Wait rule). */
export const FORECAST_MIN_POINTS = 2;

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
  // (ssTot > 0 whenever prices differ).
  const rSquared = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : clamp(1 - ssRes / ssTot, 0, 1);
  const sigma = n > 2 ? Math.sqrt(ssRes / (n - 2)) : null;
  return {
    slopePerDay,
    intercept,
    sigma,
    rSquared,
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
  // 2-point exact fit never yields a zero-width range.
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
  const confidencePct = Math.round(
    clamp(
      15 +
        55 * fit.rSquared +
        Math.min(15, Math.max(0, n - FORECAST_MIN_POINTS) * 3) -
        horizonPenalty(horizonDays),
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
 * Probabilistic forecast for 7 / 30 / 90 days from recorded price
 * history only. Fewer than 2 usable points → 'not-enough-history'
 * with empty forecasts (same threshold as Buy vs Wait).
 */
export function computeForecast(
  points: ForecastPoint[],
  nowMs: number = Date.now()
): ProductForecast {
  const usable = usablePoints(points).filter((p) => p.ms <= nowMs);
  const method =
    'Least-squares trend fitted to recorded price history only; range = fitted value ± 1.96 × residual spread.';
  if (usable.length < FORECAST_MIN_POINTS) {
    return {
      status: 'not-enough-history',
      currentPrice: usable.length === 1 ? usable[0].price : null,
      forecasts: [],
      pointsUsed: usable.length,
      historyDays: 0,
      method,
      note: 'Not enough price history yet — at least 2 recorded prices are needed before any forecast can be made.',
    };
  }
  const fit = fitLine(usable);
  const currentPrice = usable[usable.length - 1].price;
  const historyDays = Math.max(0, Math.round((fit.lastMs - fit.firstMs) / DAY_MS));
  return {
    status: 'ok',
    currentPrice,
    forecasts: FORECAST_HORIZONS.map((h) =>
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
 * For each split point i (≥ 2 points to fit, and a later recorded
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
