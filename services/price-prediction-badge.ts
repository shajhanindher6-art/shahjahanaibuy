/**
 * Deterministic "BUY NOW / WAIT / GREAT VALUE" price prediction badge.
 *
 * Pure math over REAL recorded price_history points only — no LLM, no
 * fetch, no scraping, no scheduler. The verdict compares the current
 * price against the 30-day moving average and the 30-day lowest:
 *
 *   - GREAT VALUE: at (within 2% of) the 30-day lowest, OR 10%+ below
 *     the 30-day average — the price is at/near its recent best.
 *   - BUY NOW: at or below the 30-day average, but not a great value.
 *   - WAIT: above the 30-day average (and above the 30-day lowest).
 *
 * This is a trend snapshot, never a forecast: no exact future price
 * and no exact future date is ever produced. With fewer than 2
 * recorded points (or any missing/invalid input) the result is
 * 'not_enough_data' — callers render nothing rather than a fake
 * verdict (the detailed BuyVsWait section already covers that state).
 */

import {
  movingAverage,
  MOVING_AVERAGE_WINDOW_DAYS,
  type TrendPoint,
} from '@/lib/price-trend';

export type PredictionBadgeLabel =
  | 'great_value'
  | 'buy_now'
  | 'wait'
  | 'not_enough_data';

/** Minimum recorded points needed before any verdict is offered. */
export const PREDICTION_BADGE_MIN_POINTS = 2;
/** GREAT VALUE when the current price is within 2% of the 30-day lowest. */
export const GREAT_VALUE_LOWEST_TOLERANCE = 1.02;
/** GREAT VALUE when the current price is 10% or more below the 30-day average. */
export const GREAT_VALUE_MA_FACTOR = 0.9;

export interface PredictionBadgeInput {
  currentPrice: number | null;
  ma30: number | null;
  lowest30: number | null;
  pointCount: number;
}

export interface PredictionBadgeResult {
  label: PredictionBadgeLabel;
  reason: string;
}

function isValidPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * The badge verdict from current price vs 30-day average vs 30-day
 * lowest. Every reason states the real numbers used (current, 30-day
 * average, 30-day lowest) and the 30-day basis — never an exact
 * future price or date.
 */
export function getPredictionBadge(
  input: PredictionBadgeInput
): PredictionBadgeResult {
  const { currentPrice, ma30, lowest30, pointCount } = input;
  if (
    !Number.isFinite(pointCount) ||
    pointCount < PREDICTION_BADGE_MIN_POINTS ||
    !isValidPrice(currentPrice) ||
    !isValidPrice(ma30) ||
    !isValidPrice(lowest30)
  ) {
    return {
      label: 'not_enough_data',
      reason: 'Not enough price history to predict.',
    };
  }

  const basis = `Based on the last ${MOVING_AVERAGE_WINDOW_DAYS} days of recorded prices.`;
  const numbers = `Current ${fmtUsd(currentPrice)}, 30-day average ${fmtUsd(ma30)}, 30-day lowest ${fmtUsd(lowest30)}.`;

  if (currentPrice <= lowest30 * GREAT_VALUE_LOWEST_TOLERANCE) {
    return {
      label: 'great_value',
      reason: `Great value — the current price is within 2% of the 30-day lowest. ${numbers} ${basis}`,
    };
  }
  if (currentPrice <= ma30 * GREAT_VALUE_MA_FACTOR) {
    return {
      label: 'great_value',
      reason: `Great value — the current price is 10% or more below the 30-day average. ${numbers} ${basis}`,
    };
  }
  if (currentPrice <= ma30) {
    return {
      label: 'buy_now',
      reason: `Buy now — the current price is at or below the 30-day average. ${numbers} ${basis}`,
    };
  }
  return {
    label: 'wait',
    reason: `Wait — the current price is above the 30-day average and the 30-day lowest. ${numbers} ${basis}`,
  };
}

/**
 * Latest 30-day moving-average value from recorded points, reusing
 * lib/price-trend.ts `movingAverage` (never reimplemented here).
 * Returns null when fewer than 2 chart days carry an average — with
 * thin history the badge stays silent instead of guessing.
 */
export function latestMovingAverage(points: TrendPoint[]): number | null {
  const ma = movingAverage(points);
  if (ma.length < 2) return null;
  return ma[ma.length - 1].avg;
}
