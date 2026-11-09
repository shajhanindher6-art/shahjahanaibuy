import { describe, it, expect } from 'vitest';
import {
  predictResaleValue,
  RESALE_MIN_POINTS,
  RESALE_MIN_SPAN_DAYS,
  RESALE_CURVE_MONTHS,
  type ResalePoint,
} from '@/services/resale-predictor';

const D0 = '2026-08-01T00:00:00.000Z'; // day 0
const D3 = '2026-08-04T00:00:00.000Z'; // day 3
const D30 = '2026-08-31T00:00:00.000Z'; // day 30
const D60 = '2026-09-30T00:00:00.000Z'; // day 60

function pt(price: number, recordedAt: string): ResalePoint {
  return { price, recordedAt };
}

describe('predictResaleValue', () => {
  it('declining history: hand-computed monthly decline + 24-month retention', () => {
    // 1000 -> 980 over 60 days: total decline 2%, 2 months -> 1%/month.
    // Curve: 6m -> 94, 12m -> 88, 18m -> 82, 24m -> 76.
    const r = predictResaleValue([pt(1000, D0), pt(980, D60)], 980);
    expect(r.status).toBe('ok');
    expect(r.pointCount).toBe(2);
    expect(r.spanDays).toBe(60);
    expect(r.monthlyDeclinePct).toBe(1);
    expect(r.curve).toEqual([
      { month: 6, retentionPct: 94 },
      { month: 12, retentionPct: 88 },
      { month: 18, retentionPct: 82 },
      { month: 24, retentionPct: 76 },
    ]);
    expect(r.retentionPct24).toBe(76);
    expect(r.projectedValueUsd24).toBe(744.8); // 980 * 0.76
    expect(r.reason).toContain('not a resale quote');
  });

  it('flat history: 100% retention, zero monthly decline', () => {
    const r = predictResaleValue([pt(1000, D0), pt(1000, D30), pt(1000, D60)], 1000);
    expect(r.status).toBe('ok');
    expect(r.monthlyDeclinePct).toBe(0);
    expect(r.retentionPct24).toBe(100);
    expect(r.curve?.every((c) => c.retentionPct === 100)).toBe(true);
    expect(r.projectedValueUsd24).toBe(1000);
    expect(r.reason).toContain('did not decline');
  });

  it('rising history: 100% retention, zero monthly decline', () => {
    const r = predictResaleValue([pt(900, D0), pt(1000, D30)], 1000);
    expect(r.status).toBe('ok');
    expect(r.monthlyDeclinePct).toBe(0);
    expect(r.retentionPct24).toBe(100);
    expect(r.projectedValueUsd24).toBe(1000);
  });

  it('insufficient with 0 points', () => {
    const r = predictResaleValue([], 1000);
    expect(r.status).toBe('insufficient');
    expect(r.retentionPct24).toBeNull();
    expect(r.monthlyDeclinePct).toBeNull();
    expect(r.curve).toBeNull();
    expect(r.projectedValueUsd24).toBeNull();
    expect(r.reason).toBe('Not enough recorded price history to project resale value.');
  });

  it('insufficient with 1 point', () => {
    const r = predictResaleValue([pt(1000, D0)], 1000);
    expect(r.status).toBe('insufficient');
    expect(r.pointCount).toBe(1);
  });

  it('insufficient when span is under 7 days', () => {
    const r = predictResaleValue([pt(1000, D0), pt(990, D3)], 990);
    expect(r.status).toBe('insufficient');
    expect(r.spanDays).toBe(3);
  });

  it('insufficient when current price is missing', () => {
    const r = predictResaleValue([pt(1000, D0), pt(980, D60)], null);
    expect(r.status).toBe('insufficient');
  });

  it('curve decreases monotonically for a declining product', () => {
    // 1000 -> 900 over 30 days: 10%/month. Curve: 40, 0, 0, 0.
    const r = predictResaleValue([pt(1000, D0), pt(900, D30)], 900);
    expect(r.status).toBe('ok');
    expect(r.curve).toEqual([
      { month: 6, retentionPct: 40 },
      { month: 12, retentionPct: 0 },
      { month: 18, retentionPct: 0 },
      { month: 24, retentionPct: 0 },
    ]);
    const values = (r.curve ?? []).map((c) => c.retentionPct);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
    expect(r.retentionPct24).toBe(0);
    expect(r.projectedValueUsd24).toBe(0);
  });

  it('invalid / NaN points are ignored', () => {
    const r = predictResaleValue(
      [
        { price: NaN, recordedAt: D0 },
        { price: -50, recordedAt: D0 },
        { price: 1000, recordedAt: 'not-a-date' },
        pt(1000, D0),
        pt(980, D60),
      ],
      980
    );
    expect(r.status).toBe('ok');
    expect(r.pointCount).toBe(2);
    expect(r.monthlyDeclinePct).toBe(1);
    expect(r.retentionPct24).toBe(76);
  });

  it('projected value equals current price times retention', () => {
    const r = predictResaleValue([pt(1000, D0), pt(980, D60)], 500);
    expect(r.status).toBe('ok');
    expect(r.retentionPct24).toBe(76);
    expect(r.projectedValueUsd24).toBe(380); // 500 * 0.76
  });

  it('unsorted points are handled (sorted internally)', () => {
    const r = predictResaleValue([pt(980, D60), pt(1000, D0)], 980);
    expect(r.status).toBe('ok');
    expect(r.spanDays).toBe(60);
    expect(r.monthlyDeclinePct).toBe(1);
    expect(r.retentionPct24).toBe(76);
  });

  it('exports the stated constants', () => {
    expect(RESALE_MIN_POINTS).toBe(2);
    expect(RESALE_MIN_SPAN_DAYS).toBe(7);
    expect([...RESALE_CURVE_MONTHS]).toEqual([6, 12, 18, 24]);
  });
});
