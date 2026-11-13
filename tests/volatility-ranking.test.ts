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

  // FINAL 100% (W3, F-P1-36) — rows are gated on the unified
  // 5-point + freshness rule, so fixtures need 5 points with a
  // fresh latest point. `now` is passed explicitly: the old
  // fixtures' 2026-11-02 latest point is stale against the real
  // clock, and a row test must not depend on the run date.
  const NOW = new Date('2026-11-05T00:00:00.000Z');
  const FIVE_POINTS = [
    { price: 100, recordedAt: '2026-10-05T00:00:00.000Z' },
    { price: 102, recordedAt: '2026-10-15T00:00:00.000Z' },
    { price: 98, recordedAt: '2026-10-25T00:00:00.000Z' },
    { price: 100, recordedAt: '2026-11-02T00:00:00.000Z' },
    { price: 101, recordedAt: '2026-11-04T00:00:00.000Z' },
  ];
  const VOLATILE_POINTS = [
    { price: 100, recordedAt: '2026-10-05T00:00:00.000Z' },
    { price: 150, recordedAt: '2026-10-15T00:00:00.000Z' },
    { price: 90, recordedAt: '2026-10-25T00:00:00.000Z' },
    { price: 160, recordedAt: '2026-11-02T00:00:00.000Z' },
    { price: 80, recordedAt: '2026-11-04T00:00:00.000Z' },
  ];

  it('ranks the most stable product first and labels every row with its point count', () => {
    const rows = [
      buildVolatilityRow(product('b', 'Volatile'), VOLATILE_POINTS, NOW),
      buildVolatilityRow(product('a', 'Steady'), FIVE_POINTS, NOW),
      buildVolatilityRow(product('c', 'NoHistory'), [], NOW),
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
    expect(sorted[2].gateReason).toMatch(/5 recorded points/);
    expect(volatilityPointLabel(sorted[0].pointCount)).toBe('from 5 recorded points');
    expect(volatilityPointLabel(1)).toBe('from 1 recorded point');
  });

  it('most-volatile sort reverses the ranking', () => {
    const rows = [
      buildVolatilityRow(product('a', 'Steady'), FIVE_POINTS, NOW),
      buildVolatilityRow(product('b', 'Volatile'), VOLATILE_POINTS, NOW),
    ];
    const sorted = sortVolatilityRows(rows, 'most-volatile');
    expect(sorted[0].name).toBe('Volatile');
    expect(sorted[0].rank).toBe(1);
  });

  it('a 4-point series is gated even when fresh — the seed shape ranks nothing', () => {
    const row = buildVolatilityRow(product('a', 'Seed'), POINTS, NOW);
    expect(row.stats).toBeNull();
    expect(row.rank).toBeNull();
    expect(row.gateReason).toMatch(/4 of 5 recorded points/);
  });

  it('a 5-point stale series is gated, with the age in the reason', () => {
    const row = buildVolatilityRow(
      product('a', 'Stale'),
      FIVE_POINTS,
      new Date('2026-12-01T00:00:00.000Z')
    );
    expect(row.stats).toBeNull();
    expect(row.gateReason).toMatch(/stale/);
  });

  it('parseVolatilitySort defaults unknown values to most-stable', () => {
    expect(parseVolatilitySort({ sort: 'most-volatile' })).toBe('most-volatile');
    expect(parseVolatilitySort({ sort: 'bogus' })).toBe('most-stable');
    expect(parseVolatilitySort(undefined)).toBe('most-stable');
  });
});
