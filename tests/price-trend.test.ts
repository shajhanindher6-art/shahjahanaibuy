import { describe, expect, it } from 'vitest';
import {
  movingAverage,
  MOVING_AVERAGE_WINDOW_DAYS,
  type TrendPoint,
} from '@/lib/price-trend';

// Fixed day offsets from 2026-10-01 (UTC), so every expected value
// below is hand-computable and the tests are fully deterministic.
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 9, 1);

function day(n: number): string {
  return new Date(BASE + n * DAY_MS).toISOString();
}

function point(price: number, dayOffset: number): TrendPoint {
  return { price, recordedAt: day(dayOffset) };
}

describe('movingAverage', () => {
  it('defaults to a 30-day window', () => {
    expect(MOVING_AVERAGE_WINDOW_DAYS).toBe(30);
  });

  it('flat series: the average equals the price', () => {
    // Every window with >= 2 points averages identical prices.
    // Day 0 has only itself in its window, so no average there.
    const result = movingAverage([
      point(100, 0),
      point(100, 10),
      point(100, 20),
    ]);
    expect(result).toEqual([
      { date: day(10), avg: 100 },
      { date: day(20), avg: 100 },
    ]);
  });

  it('computes the trailing mean by hand', () => {
    // Day 0:  window [day -30, day 0]  = {90}            -> 1 point, no average.
    // Day 10: window [day -20, day 10] = {90, 100}       -> (90 + 100) / 2 = 95.
    // Day 20: window [day -10, day 20] = {90, 100, 110}  -> (90 + 100 + 110) / 3 = 100.
    const result = movingAverage([
      point(90, 0),
      point(100, 10),
      point(110, 20),
    ]);
    expect(result).toEqual([
      { date: day(10), avg: 95 },
      { date: day(20), avg: 100 },
    ]);
  });

  it('returns an empty series with fewer than 2 points', () => {
    expect(movingAverage([])).toEqual([]);
    expect(movingAverage([point(999, 0)])).toEqual([]);
  });

  it('gaps in dates do not invent points', () => {
    // Day 0 and day 100 are 100 days apart: no trailing 30-day
    // window ever holds both, so neither anchor gets an average.
    expect(movingAverage([point(100, 0), point(200, 100)])).toEqual([]);

    // A point that fell out of the window never leaks back in:
    // Day 40: window [day 10, day 40] = {120}            -> 1 point, no average.
    // Day 50: window [day 20, day 50] = {120, 140}       -> (120 + 140) / 2 = 130.
    // The day-0 $100 point is in no later window, and no average
    // is emitted for the empty days in between.
    const result = movingAverage([
      point(100, 0),
      point(120, 40),
      point(140, 50),
    ]);
    expect(result).toEqual([{ date: day(50), avg: 130 }]);
  });

  it('handles unsorted input (sorts oldest-first internally)', () => {
    const sorted = movingAverage([
      point(90, 0),
      point(100, 10),
      point(110, 20),
    ]);
    const shuffled = movingAverage([
      point(110, 20),
      point(90, 0),
      point(100, 10),
    ]);
    expect(shuffled).toEqual(sorted);
    expect(shuffled).toEqual([
      { date: day(10), avg: 95 },
      { date: day(20), avg: 100 },
    ]);
  });

  it('drops invalid prices and dates, never treats them as zero', () => {
    // NaN price, $0 price, and an unparseable date are all dropped.
    // If $0 were counted, the day-10 average would be dragged down
    // to (100 + 0 + 100) / 3; if the bad date were counted as epoch
    // it would pollute the window. Only the two real $100 points
    // remain: day 10 -> (100 + 100) / 2 = 100.
    const result = movingAverage([
      point(100, 0),
      { price: NaN, recordedAt: day(5) },
      point(0, 6),
      { price: 100, recordedAt: 'not-a-date' },
      point(100, 10),
    ]);
    expect(result).toEqual([{ date: day(10), avg: 100 }]);
  });

  it('respects a custom windowDays', () => {
    // Window 7 days:
    // Day 5:  window [day -2, day 5]   = {100, 110} -> (100 + 110) / 2 = 105.
    // Day 20: window [day 13, day 20]  = {120}      -> 1 point, no average.
    expect(
      movingAverage([point(100, 0), point(110, 5), point(120, 20)], 7)
    ).toEqual([{ date: day(5), avg: 105 }]);

    // Same points, default 30-day window:
    // Day 20: window [day -10, day 20] = {100, 110, 120} -> 330 / 3 = 110.
    expect(movingAverage([point(100, 0), point(110, 5), point(120, 20)])).toEqual([
      { date: day(5), avg: 105 },
      { date: day(20), avg: 110 },
    ]);
  });

  it('a point exactly 30 days back is inside the default window', () => {
    // Day 30: window [day 0, day 30] = {100, 120} -> (100 + 120) / 2 = 110.
    // Day 40: window [day 10, day 40] = {120} (day 0 fell out) -> no average.
    // (Boundary is inclusive on both ends.)
    const result = movingAverage([point(100, 0), point(120, 30)]);
    expect(result).toEqual([{ date: day(30), avg: 110 }]);
  });
});
