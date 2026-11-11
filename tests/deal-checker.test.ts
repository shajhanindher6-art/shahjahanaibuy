import { describe, expect, it } from 'vitest';
import {
  DEAL_VERDICT_LABELS,
  checkDeal,
  parseDealCheckerParams,
} from '@/lib/deal-checker';

const POINTS = [
  { price: 999, recordedAt: '2026-10-12T00:00:00.000Z' },
  { price: 949, recordedAt: '2026-10-22T00:00:00.000Z' },
  { price: 979, recordedAt: '2026-11-01T00:00:00.000Z' },
  { price: 899, recordedAt: '2026-11-11T00:00:00.000Z' },
];

describe('checkDeal', () => {
  it('below the recorded low is a real deal', () => {
    const result = checkDeal(849, POINTS);
    expect(result?.verdict).toBe('real-deal');
    expect(result?.savingVsLowest).toBe(50);
    expect(result?.savingVsCurrent).toBe(50);
  });

  it('below current but above the recorded low is only below-current', () => {
    // Current is 899 (the low), so use a history whose current is above the low.
    const history = [
      { price: 999, recordedAt: '2026-10-12T00:00:00.000Z' },
      { price: 899, recordedAt: '2026-10-22T00:00:00.000Z' },
      { price: 949, recordedAt: '2026-11-01T00:00:00.000Z' },
    ];
    const result = checkDeal(920, history);
    expect(result?.verdict).toBe('below-current');
    expect(result?.savingVsCurrent).toBe(29);
    expect(result?.savingVsLowest).toBe(-21);
  });

  it('a found price equal to the current recorded price is not a deal', () => {
    const result = checkDeal(899, POINTS);
    expect(result?.verdict).toBe('not-a-deal');
    expect(result?.savingVsCurrent).toBe(0);
  });

  it('at or above current is not a deal', () => {
    expect(checkDeal(899, POINTS)?.verdict).toBe('not-a-deal');
    expect(checkDeal(1099, POINTS)?.verdict).toBe('not-a-deal');
    expect(checkDeal(1099, POINTS)?.savingVsCurrent).toBe(-200);
  });

  it('no recorded history cannot be verified', () => {
    const result = checkDeal(100, []);
    expect(result?.verdict).toBe('cannot-verify');
    expect(result?.pointCount).toBe(0);
  });

  it('reports the recorded range, never a score', () => {
    const result = checkDeal(849, POINTS);
    expect(result?.current).toBe(899);
    expect(result?.lowest).toBe(899);
    expect(result?.highest).toBe(999);
    expect(result?.pointCount).toBe(4);
  });

  it('rejects non-positive prices', () => {
    expect(checkDeal(0, POINTS)).toBeNull();
    expect(checkDeal(-5, POINTS)).toBeNull();
  });

  it('labels never claim a forecast or a score', () => {
    for (const label of Object.values(DEAL_VERDICT_LABELS)) {
      expect(label).not.toMatch(/score|forecast|likely|hot deal/i);
    }
  });
});

describe('parseDealCheckerParams', () => {
  it('parses product and price', () => {
    expect(parseDealCheckerParams({ product: 'p1', price: '849' })).toEqual({
      productId: 'p1',
      price: 849,
      priceError: null,
    });
  });

  it('rejects a bad price with an error', () => {
    const parsed = parseDealCheckerParams({ product: 'p1', price: 'free' });
    expect(parsed.price).toBeNull();
    expect(parsed.priceError).toMatch(/not a valid price/);
  });

  it('empty params give nulls and no error', () => {
    expect(parseDealCheckerParams({})).toEqual({
      productId: null,
      price: null,
      priceError: null,
    });
  });
});
