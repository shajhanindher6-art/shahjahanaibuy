/**
 * Tests for the recorded-rate override in the resale predictor
 * (Option 19). A valid recorded annual rate WINS over the derived
 * decline; with no recorded rate the engine behaves exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { predictResaleValue, type ResalePoint } from '@/services/resale-predictor';

function point(price: number, iso: string): ResalePoint {
  return { price, recordedAt: iso };
}

// MacBook-like derived history: $1,048.95 -> $999 over ~30 days,
// about 4.76%/month derived — straight-lines to 0% at 24 months.
const DECLINING_POINTS: ResalePoint[] = [
  point(1048.95, '2026-10-03T00:00:00Z'),
  point(999, '2026-11-02T00:00:00Z'),
];

// Hand-computed derived case from the existing suite: 1000 -> 980
// over 60 days = 1%/month, curve 94/88/82/76, projected 744.80.
const GENTLE_POINTS: ResalePoint[] = [
  point(1000, '2026-09-01T00:00:00Z'),
  point(980, '2026-10-31T00:00:00Z'),
];

describe('predictResaleValue with a recorded annual rate (Option 19)', () => {
  it('overrides a steep derived decline: 12%/year -> 1%/month, 76% at 24 mo', () => {
    const r = predictResaleValue(DECLINING_POINTS, 999, 0.12);
    expect(r.status).toBe('ok');
    expect(r.source).toBe('recorded');
    expect(r.recordedAnnualRatePct).toBe(12);
    expect(r.monthlyDeclinePct).toBe(1);
    expect(r.retentionPct24).toBe(76);
    expect(r.curve).toEqual([
      { month: 6, retentionPct: 94 },
      { month: 12, retentionPct: 88 },
      { month: 18, retentionPct: 82 },
      { month: 24, retentionPct: 76 },
    ]);
    expect(r.projectedValueUsd24).toBe(759.24);
    expect(r.reason).toMatch(/recorded annual depreciation rate of 12%/);
  });

  it('works with NO price history at all when a rate is recorded', () => {
    const r = predictResaleValue([], 999, 0.12);
    expect(r.status).toBe('ok');
    expect(r.source).toBe('recorded');
    expect(r.retentionPct24).toBe(76);
    expect(r.pointCount).toBe(0);
    expect(r.spanDays).toBe(0);
  });

  it('a recorded 0% rate projects 100% retention', () => {
    const r = predictResaleValue(DECLINING_POINTS, 999, 0);
    expect(r.status).toBe('ok');
    expect(r.source).toBe('recorded');
    expect(r.monthlyDeclinePct).toBe(0);
    expect(r.retentionPct24).toBe(100);
    expect(r.projectedValueUsd24).toBe(999);
  });

  it('an invalid recorded rate (>1) is ignored and the derived path runs', () => {
    const r = predictResaleValue(GENTLE_POINTS, 980, 1.5);
    expect(r.status).toBe('ok');
    expect(r.source).toBe('derived');
    expect(r.recordedAnnualRatePct).toBeNull();
    expect(r.monthlyDeclinePct).toBe(1);
    expect(r.retentionPct24).toBe(76);
    expect(r.projectedValueUsd24).toBe(744.8);
  });

  it('is insufficient when the current price is invalid, even with a rate', () => {
    const r = predictResaleValue(GENTLE_POINTS, null, 0.12);
    expect(r.status).toBe('insufficient');
    expect(r.retentionPct24).toBeNull();
  });

  it('without a recorded rate the derived engine is unchanged', () => {
    const r = predictResaleValue(GENTLE_POINTS, 980);
    expect(r.status).toBe('ok');
    expect(r.source).toBe('derived');
    expect(r.recordedAnnualRatePct).toBeNull();
    expect(r.monthlyDeclinePct).toBe(1);
    expect(r.retentionPct24).toBe(76);
  });

  it('without a rate and without enough history it stays insufficient', () => {
    const r = predictResaleValue([point(999, '2026-11-02T00:00:00Z')], 999);
    expect(r.status).toBe('insufficient');
    expect(r.source).toBe('derived');
  });
});
