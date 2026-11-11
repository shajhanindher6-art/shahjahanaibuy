import { describe, expect, it } from 'vitest';
import {
  ALERT_VERDICT_LABELS,
  parseAlertSimulatorParams,
  simulatePriceAlert,
} from '@/lib/price-alert-simulator';

const POINTS = [
  { price: 999, recordedAt: '2026-10-12T00:00:00.000Z' },
  { price: 949, recordedAt: '2026-10-22T00:00:00.000Z' },
  { price: 979, recordedAt: '2026-11-01T00:00:00.000Z' },
  { price: 899, recordedAt: '2026-11-11T00:00:00.000Z' },
];

describe('simulatePriceAlert', () => {
  it('target at or above current is already met', () => {
    const result = simulatePriceAlert(899, POINTS);
    expect(result?.verdict).toBe('already-met');
    expect(result?.dropNeededAmount).toBe(0);
    expect(result?.dropNeededPercent).toBe(0);
    expect(simulatePriceAlert(1000, POINTS)?.verdict).toBe('already-met');
  });

  it('target at or above the recorded low was recorded before', () => {
    // Current is 899 (the low); target 949 is above current? No:
    // current 899 <= 949, so that is already-met. Use a history
    // whose current is above the low instead.
    const history = [
      { price: 999, recordedAt: '2026-10-12T00:00:00.000Z' },
      { price: 899, recordedAt: '2026-10-22T00:00:00.000Z' },
      { price: 949, recordedAt: '2026-11-01T00:00:00.000Z' },
    ];
    const result = simulatePriceAlert(899, history);
    expect(result?.verdict).toBe('recorded-before');
    expect(result?.current).toBe(949);
    expect(result?.lowest).toBe(899);
    expect(result?.dropNeededAmount).toBe(50);
    expect(result?.dropNeededPercent).toBeCloseTo(5.3, 1);
  });

  it('target below the recorded low was never recorded', () => {
    const result = simulatePriceAlert(850, POINTS);
    expect(result?.verdict).toBe('below-recorded-low');
    expect(result?.dropNeededAmount).toBe(49);
    expect(result?.lowest).toBe(899);
  });

  it('no recorded history cannot be verified', () => {
    const result = simulatePriceAlert(850, []);
    expect(result?.verdict).toBe('cannot-verify');
    expect(result?.pointCount).toBe(0);
  });

  it('reports point count and range from recorded points only', () => {
    const result = simulatePriceAlert(850, POINTS);
    expect(result?.pointCount).toBe(4);
    expect(result?.highest).toBe(999);
    expect(result?.current).toBe(899);
  });

  it('rejects non-positive targets', () => {
    expect(simulatePriceAlert(0, POINTS)).toBeNull();
    expect(simulatePriceAlert(-10, POINTS)).toBeNull();
    expect(simulatePriceAlert(NaN, POINTS)).toBeNull();
  });

  it('labels never promise a probability or a date', () => {
    for (const label of Object.values(ALERT_VERDICT_LABELS)) {
      expect(label).not.toMatch(/likely|probability|will drop|within \d+ days/i);
    }
  });
});

describe('parseAlertSimulatorParams', () => {
  it('parses product and target', () => {
    expect(parseAlertSimulatorParams({ product: 'p1', target: '899' })).toEqual({
      productId: 'p1',
      target: 899,
      targetError: null,
    });
  });

  it('rejects a bad target with an error, keeps the product', () => {
    const parsed = parseAlertSimulatorParams({ product: 'p1', target: 'abc' });
    expect(parsed.target).toBeNull();
    expect(parsed.targetError).toMatch(/not a valid target price/);
    expect(parsed.productId).toBe('p1');
  });

  it('empty params give nulls and no error', () => {
    expect(parseAlertSimulatorParams({})).toEqual({
      productId: null,
      target: null,
      targetError: null,
    });
  });
});
