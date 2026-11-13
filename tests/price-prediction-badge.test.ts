import { describe, expect, it } from 'vitest';
import {
  getPredictionBadge,
  latestMovingAverage,
  GREAT_VALUE_LOWEST_TOLERANCE,
  GREAT_VALUE_MA_FACTOR,
  type PredictionBadgeInput,
} from '@/services/price-prediction-badge';
import type { TrendPoint } from '@/lib/price-trend';

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

function input(overrides: Partial<PredictionBadgeInput>): PredictionBadgeInput {
  return {
    currentPrice: 999,
    ma30: 1000,
    lowest30: 950,
    // Section 19, Phase 3 (§12 #30): the verdict minimum is 5
    // points (unified with the Deal Score gate) — the default
    // fixture uses 6 so the verdict tests exercise verdicts.
    pointCount: 6,
    ...overrides,
  };
}

describe('getPredictionBadge', () => {
  it('great_value when current equals the 30-day lowest', () => {
    const result = getPredictionBadge(
      input({ currentPrice: 950, ma30: 1000, lowest30: 950 })
    );
    expect(result.label).toBe('great_value');
    expect(result.reason).toContain('$950.00');
    expect(result.reason).toContain('$1000.00');
    expect(result.reason).toContain('30 days');
  });

  it('great_value when current is exactly 10% below the 30-day average', () => {
    // 900 = 1000 * GREAT_VALUE_MA_FACTOR (0.9) — boundary is inclusive.
    const result = getPredictionBadge(
      input({ currentPrice: 1000 * GREAT_VALUE_MA_FACTOR, ma30: 1000, lowest30: 950 })
    );
    expect(result.label).toBe('great_value');
    expect(result.reason).toContain('$900.00');
  });

  it('great_value via the lowest rule even when above the 30-day average', () => {
    // 910 <= 900 * 1.02 = 918 (lowest rule wins), though 910 > MA 800.
    const result = getPredictionBadge(
      input({ currentPrice: 910, ma30: 800, lowest30: 900 })
    );
    expect(result.label).toBe('great_value');
  });

  it('great_value at the exact lowest * 1.02 boundary', () => {
    // 950 * 1.02 = 969 — boundary is inclusive.
    const result = getPredictionBadge(
      input({ currentPrice: 950 * GREAT_VALUE_LOWEST_TOLERANCE, ma30: 1000, lowest30: 950 })
    );
    expect(result.label).toBe('great_value');
  });

  it('buy_now just above the lowest boundary and below the average', () => {
    // 969.01 > 969 (not great value) and 969.01 < 1000 (below MA).
    const result = getPredictionBadge(
      input({ currentPrice: 969.01, ma30: 1000, lowest30: 950 })
    );
    expect(result.label).toBe('buy_now');
  });

  it('buy_now when current equals the 30-day average', () => {
    const result = getPredictionBadge(
      input({ currentPrice: 1000, ma30: 1000, lowest30: 950 })
    );
    expect(result.label).toBe('buy_now');
    expect(result.reason).toContain('$1000.00');
    expect(result.reason).toContain('$950.00');
  });

  it('wait when current is above the 30-day average', () => {
    const result = getPredictionBadge(
      input({ currentPrice: 1100, ma30: 1000, lowest30: 950 })
    );
    expect(result.label).toBe('wait');
    expect(result.reason).toContain('$1100.00');
    expect(result.reason).toContain('$1000.00');
    expect(result.reason).toContain('$950.00');
  });

  it('not_enough_data with 0 points', () => {
    const result = getPredictionBadge(input({ pointCount: 0 }));
    expect(result.label).toBe('not_enough_data');
    expect(result.reason).toBe('Not enough price history to predict.');
  });

  it('not_enough_data with 1 point', () => {
    const result = getPredictionBadge(input({ pointCount: 1 }));
    expect(result.label).toBe('not_enough_data');
  });

  it('not_enough_data with 2–4 points — thin history is not a verdict (Section 19, §12 #30)', () => {
    // The minimum is 5, unified with the Deal Score gate: a 2–4
    // point series used to earn a verdict; now it withholds one.
    for (const pointCount of [2, 3, 4]) {
      const result = getPredictionBadge(input({ pointCount }));
      expect(result.label).toBe('not_enough_data');
      expect(result.reason).toBe('Not enough price history to predict.');
    }
  });

  it('verdict returns at exactly 5 points (the unified minimum)', () => {
    const result = getPredictionBadge(input({ pointCount: 5 }));
    expect(result.label).toBe('buy_now');
  });

  it('not_enough_data for invalid / missing inputs', () => {
    expect(getPredictionBadge(input({ currentPrice: NaN })).label).toBe(
      'not_enough_data'
    );
    expect(getPredictionBadge(input({ currentPrice: null })).label).toBe(
      'not_enough_data'
    );
    expect(getPredictionBadge(input({ currentPrice: 0 })).label).toBe(
      'not_enough_data'
    );
    expect(getPredictionBadge(input({ ma30: null })).label).toBe(
      'not_enough_data'
    );
    expect(getPredictionBadge(input({ lowest30: Number.POSITIVE_INFINITY })).label).toBe(
      'not_enough_data'
    );
  });

  it('never promises an exact future price or date', () => {
    const labels = ['great_value', 'buy_now', 'wait'] as const;
    const results = [
      getPredictionBadge(input({ currentPrice: 950 })),
      getPredictionBadge(input({ currentPrice: 1000 })),
      getPredictionBadge(input({ currentPrice: 1100 })),
    ];
    results.forEach((r, i) => {
      expect(r.label).toBe(labels[i]);
      expect(r.reason).not.toMatch(/will (drop|rise|reach)|tomorrow|next week/i);
    });
  });
});

describe('latestMovingAverage', () => {
  it('handles unsorted points and returns the latest 30-day average', () => {
    // Sorted: Oct 19 $1018.98, Oct 26 $1000, Nov 2 $999.
    // Oct 19 window has 1 point (skipped); Oct 26 avg = 1009.49;
    // Nov 2 avg = (1018.98 + 1000 + 999) / 3 = 1005.9933...
    const points = [
      point(999, 32),
      point(1018.98, 18),
      point(1000, 25),
    ];
    expect(latestMovingAverage(points)).toBeCloseTo(1005.99, 2);
  });

  it('returns null when fewer than 2 chart days carry an average', () => {
    // Two points inside 30 days: only the Nov 2 anchor has a 2-point
    // window, so movingAverage yields a single entry → null.
    expect(
      latestMovingAverage([point(1000, 25), point(999, 32)])
    ).toBeNull();
  });

  it('returns null for a single point', () => {
    expect(latestMovingAverage([point(999, 32)])).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(latestMovingAverage([])).toBeNull();
  });
});
