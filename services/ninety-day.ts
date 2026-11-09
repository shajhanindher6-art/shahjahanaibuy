/**
 * 90-day lowest price — Option 18 (Autonomous Decision & Anti-Trap AI Suite).
 *
 * PURE function: same recorded points in → same result out. No network,
 * no scraping, no stored column. The lowest 90-day price is DERIVED
 * from the append-only `price_history` table every time it is needed —
 * a stored `lowest_90d_price` column would go stale on day one with
 * no maintainer job, so it is deliberately NOT stored (see the
 * Option 18 audit, 2026-11-09).
 *
 * RULES (approved trimmed design):
 * - Window: the 90 days before the LATEST recorded price. A price
 *   recorded earlier does not count, however low it was.
 * - Ready only when the recorded history actually covers 90 days:
 *   at least 2 points inside the window AND the span from the
 *   earliest to the latest recorded point is >= 90 days. Anything
 *   less is "History data pending", never a partial lowest dressed
 *   up as a 90-day figure.
 * - Today the catalog's recorded history is only ~7 days (latest
 *   Nov 2, 2026), so every product is pending until 90 days of
 *   history accumulate. That is the honest answer, not a bug.
 */

import type { FakeSalePoint } from '@/services/fake-sale';

/** 90-day window, in days. */
export const NINETY_DAY_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Lowest90dResult {
  /** 'ready' only when the recorded history covers a full 90 days. */
  status: 'ready' | 'pending';
  /** Lowest price inside the 90-day window, or null when pending. */
  lowest: number | null;
  /** Recorded points inside the 90-day window. */
  pointsInWindow: number;
  /** Days from the earliest to the latest recorded point (all history). */
  spanDays: number;
  /** ISO timestamp of the earliest recorded point, or null. */
  earliestAt: string | null;
  /** ISO timestamp of the latest recorded point, or null. */
  latestAt: string | null;
  /** Human reason when pending, otherwise null. */
  reason: string | null;
}

/**
 * Derive the lowest price of the last 90 days from recorded points.
 * Invalid prices/dates are dropped, never treated as zero (a zero
 * would fabricate a lowest).
 */
export function deriveLowest90d(points: FakeSalePoint[]): Lowest90dResult {
  const base: Lowest90dResult = {
    status: 'pending',
    lowest: null,
    pointsInWindow: 0,
    spanDays: 0,
    earliestAt: null,
    latestAt: null,
    reason: null,
  };

  const usable = points
    .map((p) => ({ price: p.price, time: new Date(p.recordedAt).getTime() }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  if (usable.length === 0) {
    return { ...base, reason: 'No recorded prices yet — history data pending.' };
  }

  const earliest = usable[0];
  const latest = usable[usable.length - 1];
  base.earliestAt = new Date(earliest.time).toISOString();
  base.latestAt = new Date(latest.time).toISOString();
  base.spanDays = Math.floor((latest.time - earliest.time) / DAY_MS);

  const windowStart = latest.time - NINETY_DAY_WINDOW_DAYS * DAY_MS;
  const windowPoints = usable.filter((p) => p.time >= windowStart);
  base.pointsInWindow = windowPoints.length;

  if (windowPoints.length < 2) {
    return {
      ...base,
      reason: `Not enough recorded prices in the last ${NINETY_DAY_WINDOW_DAYS} days (${windowPoints.length} point${windowPoints.length === 1 ? '' : 's'}) — history data pending.`,
    };
  }

  if (base.spanDays < NINETY_DAY_WINDOW_DAYS) {
    return {
      ...base,
      reason: `History data pending — only ${base.spanDays} day${base.spanDays === 1 ? '' : 's'} of recorded history so far (${NINETY_DAY_WINDOW_DAYS} days needed for a 90-day lowest).`,
    };
  }

  const lowest = Math.min(...windowPoints.map((p) => p.price));
  return {
    ...base,
    status: 'ready',
    lowest: Math.round(lowest * 100) / 100,
    reason: null,
  };
}
