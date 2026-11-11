import { describe, expect, it } from 'vitest';
import {
  PROTECTION_VERDICT_LABELS,
  checkPriceProtection,
  parseProtectionParams,
} from '@/lib/price-protection-check';

const NOW = new Date('2026-11-11T12:00:00.000Z').getTime();

const POINTS = [
  { price: 999, recordedAt: '2026-10-12T00:00:00.000Z' },
  { price: 949, recordedAt: '2026-10-22T00:00:00.000Z' },
  { price: 979, recordedAt: '2026-11-01T00:00:00.000Z' },
  { price: 899, recordedAt: '2026-11-11T00:00:00.000Z' },
];

describe('checkPriceProtection', () => {
  it('finds a lower recorded price inside the window', () => {
    const result = checkPriceProtection(999, '2026-10-20', POINTS, 30, NOW);
    expect(result?.verdict).toBe('lower-price-found');
    expect(result?.lowestAfterPurchase).toBe(899);
    expect(result?.difference).toBe(100);
    expect(result?.pointsInWindow).toHaveLength(3);
  });

  it('finds no lower price when every later point is higher', () => {
    const result = checkPriceProtection(850, '2026-10-20', POINTS, 30, NOW);
    expect(result?.verdict).toBe('no-lower-price');
    expect(result?.lowestAfterPurchase).toBe(899);
    expect(result?.difference).toBe(0);
  });

  it('cannot verify when no point falls inside the window', () => {
    // Bought 2026-11-01, 7-day window ends 2026-11-08: the
    // 2026-11-01 point is on the purchase date (excluded) and the
    // 2026-11-11 point is past the window end.
    const result = checkPriceProtection(999, '2026-11-01', POINTS, 7, NOW);
    expect(result?.verdict).toBe('cannot-verify');
    expect(result?.pointsInWindow).toHaveLength(0);
    expect(result?.reason).toMatch(/No price was recorded/);
  });

  it('cannot verify with no recorded history at all', () => {
    const result = checkPriceProtection(999, '2026-10-20', [], 30, NOW);
    expect(result?.verdict).toBe('cannot-verify');
  });

  it('cannot verify a future purchase date', () => {
    const result = checkPriceProtection(999, '2026-12-01', POINTS, 30, NOW);
    expect(result?.verdict).toBe('cannot-verify');
    expect(result?.reason).toMatch(/future/);
  });

  it('a point on the purchase date itself is not inside the window', () => {
    const result = checkPriceProtection(999, '2026-10-22', POINTS, 30, NOW);
    expect(result?.pointsInWindow).toHaveLength(2);
    expect(result?.verdict).toBe('lower-price-found');
  });

  it('a point past the window end is excluded', () => {
    const result = checkPriceProtection(999, '2026-10-20', POINTS, 7, NOW);
    expect(result?.pointsInWindow).toHaveLength(1);
    expect(result?.lowestAfterPurchase).toBe(949);
    expect(result?.verdict).toBe('lower-price-found');
  });

  it('rejects an invalid price or date', () => {
    expect(checkPriceProtection(0, '2026-10-20', POINTS, 30, NOW)).toBeNull();
    expect(checkPriceProtection(999, 'not-a-date', POINTS, 30, NOW)).toBeNull();
  });

  it('labels never promise a refund', () => {
    for (const label of Object.values(PROTECTION_VERDICT_LABELS)) {
      expect(label).not.toMatch(/refund guaranteed|you will be refunded|claim approved/i);
    }
  });
});

describe('parseProtectionParams', () => {
  it('parses a full query, window default 30', () => {
    const parsed = parseProtectionParams({
      product: 'p1',
      price: '999',
      date: '2026-10-20',
    });
    expect(parsed).toEqual({
      productId: 'p1',
      price: 999,
      date: '2026-10-20',
      windowDays: 30,
      errors: [],
      hasQuery: true,
    });
  });

  it('accepts an explicit window', () => {
    expect(
      parseProtectionParams({ price: '999', date: '2026-10-20', window: '14' }).windowDays
    ).toBe(14);
  });

  it('an unknown window falls back to 30', () => {
    expect(
      parseProtectionParams({ price: '999', date: '2026-10-20', window: '45' }).windowDays
    ).toBe(30);
  });

  it('a bad date errors', () => {
    const parsed = parseProtectionParams({ price: '999', date: '20-10-2026' });
    expect(parsed.date).toBeNull();
    expect(parsed.errors.join(' ')).toMatch(/valid purchase date/);
  });

  it('empty params give no errors', () => {
    const parsed = parseProtectionParams({});
    expect(parsed.hasQuery).toBe(false);
    expect(parsed.errors).toEqual([]);
  });
});
