import { describe, expect, it } from 'vitest';
import {
  buildVolatilityRow,
  computeVolatility,
  parseVolatilitySort,
  sortVolatilityRows,
  stabilityLabel,
  volatilityPointLabel,
} from '@/lib/volatility-ranking';

const POINTS = [
  { price: 100, recordedAt: '2026-10-03T00:00:00.000Z' },
  { price: 102, recordedAt: '2026-10-13T00:00:00.000Z' },
  { price: 98, recordedAt: '2026-10-23T00:00:00.000Z' },
  { price: 100, recordedAt: '2026-11-02T00:00:00.000Z' },
];

describe('computeVolatility', () => {
  it('computes mean, population std-dev, CV% and range% from recorded points', () => {
    // mean 100; variance (0+4+4+0)/4 = 2; std-dev √2 ≈ 1.4142.
    const stats = computeVolatility(POINTS);
    expect(stats).not.toBeNull();
    expect(stats!.mean).toBeCloseTo(100, 10);
    expect(stats!.stdDev).toBeCloseTo(Math.sqrt(2), 10);
    expect(stats!.coefficientOfVariationPercent).toBeCloseTo(1.4142, 3);
    expect(stats!.lowest).toBe(98);
    expect(stats!.highest).toBe(102);
    // (102 − 98) / 98 × 100 ≈ 4.0816%.
    expect(stats!.rangePercent).toBeCloseTo(4.0816, 3);
    expect(stats!.label).toBe('Stable');
  });

  it('returns null with fewer than 2 valid points — never a zero-filled row', () => {
    expect(computeVolatility([])).toBeNull();
    expect(computeVolatility([POINTS[0]])).toBeNull();
    expect(
      computeVolatility([{ price: Number.NaN, recordedAt: '2026-11-02T00:00:00.000Z' }])
    ).toBeNull();
  });

  it('a flat history is perfectly stable (CV 0)', () => {
    const stats = computeVolatility([
      { price: 999, recordedAt: '2026-10-03T00:00:00.000Z' },
      { price: 999, recordedAt: '2026-10-13T00:00:00.000Z' },
      { price: 999, recordedAt: '2026-10-23T00:00:00.000Z' },
      { price: 999, recordedAt: '2026-11-02T00:00:00.000Z' },
    ]);
    expect(stats!.coefficientOfVariationPercent).toBe(0);
    expect(stats!.rangePercent).toBe(0);
    expect(stats!.label).toBe('Very stable');
  });
});

describe('stabilityLabel', () => {
  it('labels CV bands', () => {
    expect(stabilityLabel(0)).toBe('Very stable');
    expect(stabilityLabel(0.99)).toBe('Very stable');
    expect(stabilityLabel(1)).toBe('Stable');
    expect(stabilityLabel(2.99)).toBe('Stable');
    expect(stabilityLabel(3)).toBe('Moderately volatile');
    expect(stabilityLabel(7.99)).toBe('Moderately volatile');
    expect(stabilityLabel(8)).toBe('Volatile');
  });
});

describe('buildVolatilityRow / sortVolatilityRows', () => {
  const product = (id: string, name: string) => ({
    id,
    name,
    slug: name.toLowerCase(),
    brand: 'Brand',
    category: 'Category',
  });

  it('ranks the most stable product first and labels every row with its point count', () => {
    const rows = [
      buildVolatilityRow(product('b', 'Volatile'), [
        { price: 100, recordedAt: '2026-10-03T00:00:00.000Z' },
        { price: 150, recordedAt: '2026-11-02T00:00:00.000Z' },
      ]),
      buildVolatilityRow(product('a', 'Steady'), POINTS),
      buildVolatilityRow(product('c', 'NoHistory'), []),
    ];
    const sorted = sortVolatilityRows(rows, 'most-stable');
    expect(sorted[0].name).toBe('Steady');
    expect(sorted[0].rank).toBe(1);
    expect(sorted[1].name).toBe('Volatile');
    expect(sorted[1].rank).toBe(2);
    // No-history rows sort last and stay unranked.
    expect(sorted[2].name).toBe('NoHistory');
    expect(sorted[2].rank).toBeNull();
    expect(sorted[2].stats).toBeNull();
    expect(volatilityPointLabel(sorted[0].pointCount)).toBe('from 4 recorded points');
    expect(volatilityPointLabel(1)).toBe('from 1 recorded point');
  });

  it('most-volatile sort reverses the ranking', () => {
    const rows = [
      buildVolatilityRow(product('a', 'Steady'), POINTS),
      buildVolatilityRow(product('b', 'Volatile'), [
        { price: 100, recordedAt: '2026-10-03T00:00:00.000Z' },
        { price: 150, recordedAt: '2026-11-02T00:00:00.000Z' },
      ]),
    ];
    const sorted = sortVolatilityRows(rows, 'most-volatile');
    expect(sorted[0].name).toBe('Volatile');
    expect(sorted[0].rank).toBe(1);
  });

  it('parseVolatilitySort defaults unknown values to most-stable', () => {
    expect(parseVolatilitySort({ sort: 'most-volatile' })).toBe('most-volatile');
    expect(parseVolatilitySort({ sort: 'bogus' })).toBe('most-stable');
    expect(parseVolatilitySort(undefined)).toBe('most-stable');
  });
});
