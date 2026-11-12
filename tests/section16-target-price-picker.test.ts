import { describe, expect, it } from 'vitest';
import {
  parseTargetPickerParams,
  suggestTargetPrices,
} from '@/lib/target-price-picker';

/** Real recorded MacBook Air 13 points (seed factors on base $999). */
const MACBOOK_POINTS = [
  { price: 1048.95, recordedAt: '2026-10-03T12:00:00Z' },
  { price: 1018.98, recordedAt: '2026-10-19T12:00:00Z' },
  { price: 999, recordedAt: '2026-10-26T12:00:00Z' },
  { price: 999, recordedAt: '2026-11-02T12:00:00Z' },
];

describe('suggestTargetPrices', () => {
  it('suggests the recorded low $999 for the MacBook, seen in 2 of 4 points', () => {
    const s = suggestTargetPrices('macbook-air-13', MACBOOK_POINTS);
    expect(s?.pointCount).toBe(4);
    const low = s?.suggestions.find((x) => x.label === 'Recorded low');
    expect(low?.targetUsd).toBe(999);
    expect(low?.pointsAtOrBelow).toBe(2);
    expect(low?.note).toContain('from 4 recorded points');
  });

  it('shows the actual recorded points, oldest first', () => {
    const s = suggestTargetPrices('macbook-air-13', MACBOOK_POINTS);
    expect(s?.points.map((p) => p.price)).toEqual([1048.95, 1018.98, 999, 999]);
  });

  it('suggests three distinct targets when the history has distinct values', () => {
    const s = suggestTargetPrices('p1', [
      { price: 1099, recordedAt: '2026-10-03T12:00:00Z' },
      { price: 999, recordedAt: '2026-10-19T12:00:00Z' },
      { price: 1029, recordedAt: '2026-10-26T12:00:00Z' },
      { price: 1059, recordedAt: '2026-11-02T12:00:00Z' },
    ]);
    const labels = s?.suggestions.map((x) => x.label);
    expect(labels).toContain('Recorded low');
    expect(labels).toContain('Low recorded point');
    expect(labels).toContain('Last recorded price');
    const lowPoint = s?.suggestions.find((x) => x.label === 'Low recorded point');
    expect(lowPoint?.targetUsd).toBe(1029);
    expect(lowPoint?.pointsAtOrBelow).toBe(2);
    const last = s?.suggestions.find((x) => x.label === 'Last recorded price');
    expect(last?.targetUsd).toBe(1059);
    expect(last?.pointsAtOrBelow).toBe(3);
  });

  it('returns null with no usable points — no invented suggestion', () => {
    expect(suggestTargetPrices('p1', [])).toBeNull();
    expect(suggestTargetPrices('p1', [{ price: 0, recordedAt: '2026-11-02T12:00:00Z' }])).toBeNull();
  });

  it('a single point suggests only that point', () => {
    const s = suggestTargetPrices('p1', [{ price: 499, recordedAt: '2026-11-02T12:00:00Z' }]);
    expect(s?.suggestions).toHaveLength(1);
    expect(s?.suggestions[0].targetUsd).toBe(499);
  });
});

describe('parseTargetPickerParams', () => {
  it('parses ?product=', () => {
    expect(parseTargetPickerParams({ product: 'macbook-air-13' })).toEqual({
      productSlug: 'macbook-air-13',
      hasQuery: true,
    });
    expect(parseTargetPickerParams({})).toEqual({ productSlug: null, hasQuery: false });
  });
});
