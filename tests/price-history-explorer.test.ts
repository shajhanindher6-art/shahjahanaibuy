import { describe, expect, it } from 'vitest';
import {
  buildProductHistorySummary,
  explorerPointLabel,
  parseExplorerSort,
  sortHistorySummaries,
  type ProductHistorySummary,
} from '@/lib/price-history-explorer';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 10, 2);

function day(n: number): string {
  return new Date(BASE + n * DAY_MS).toISOString();
}

const product = {
  id: 'p1',
  name: 'MacBook Air 13',
  slug: 'macbook-air-13',
  brand: 'Apple',
  category: 'laptops',
};

describe('buildProductHistorySummary', () => {
  // FINAL 100% (W3, F-P1-36) — summaries are gated on the unified
  // 5-point + freshness rule, so fixtures need 5 points with a
  // fresh latest point. `now` is passed explicitly: the fixtures'
  // December dates must not depend on the run date.
  const NOW = new Date(day(31));

  it('computes stats from the 5 recorded points only — never smoothed', () => {
    const summary = buildProductHistorySummary(
      product,
      [
        { price: 999, recordedAt: day(0) },
        { price: 949, recordedAt: day(10) },
        { price: 888, recordedAt: day(20) },
        { price: 888, recordedAt: day(30) },
        { price: 888, recordedAt: day(32) },
      ],
      NOW
    );
    expect(summary.pointCount).toBe(5);
    expect(summary.stats).not.toBeNull();
    expect(summary.stats?.current).toBe(888);
    expect(summary.stats?.lowest).toBe(888);
    expect(summary.stats?.highest).toBe(999);
    expect(summary.stats?.average).toBeCloseTo(922.4, 2);
    // The last two points are identical: no drop between them.
    expect(summary.drops).toHaveLength(2);
    expect(summary.biggestDrop?.dropPercent).toBeCloseTo(6.43, 2);
    expect(summary.biggestDrop?.oldPrice).toBe(949);
    expect(summary.biggestDrop?.newPrice).toBe(888);
    expect(summary.gateReason).toBeNull();
  });

  it('empty history → null stats, null biggest drop', () => {
    const summary = buildProductHistorySummary(product, [], NOW);
    expect(summary.pointCount).toBe(0);
    expect(summary.stats).toBeNull();
    expect(summary.drops).toEqual([]);
    expect(summary.biggestDrop).toBeNull();
    expect(summary.gateReason).toMatch(/0 of 5 recorded points/);
  });

  it('a 4-point series is gated — the live seed shape draws no verdict', () => {
    const summary = buildProductHistorySummary(
      product,
      [
        { price: 999, recordedAt: day(0) },
        { price: 949, recordedAt: day(10) },
        { price: 888, recordedAt: day(20) },
        { price: 888, recordedAt: day(30) },
      ],
      NOW
    );
    expect(summary.pointCount).toBe(4);
    expect(summary.stats).toBeNull();
    expect(summary.biggestDrop).toBeNull();
    expect(summary.gateReason).toMatch(/4 of 5 recorded points/);
    // The recorded points themselves are still returned.
    expect(summary.points).toHaveLength(4);
  });

  it('flat series → no drops at all', () => {
    const summary = buildProductHistorySummary(
      product,
      [
        { price: 100, recordedAt: day(0) },
        { price: 100, recordedAt: day(10) },
        { price: 100, recordedAt: day(20) },
        { price: 100, recordedAt: day(25) },
        { price: 100, recordedAt: day(30) },
      ],
      NOW
    );
    expect(summary.drops).toEqual([]);
    expect(summary.biggestDrop).toBeNull();
    expect(summary.stats?.changePercent).toBe(0);
  });

  it('sorts points oldest-first regardless of input order', () => {
    const summary = buildProductHistorySummary(
      product,
      [
        { price: 888, recordedAt: day(30) },
        { price: 999, recordedAt: day(0) },
      ],
      NOW
    );
    expect(summary.points[0].price).toBe(999);
    expect(summary.points[1].price).toBe(888);
  });
});

describe('sortHistorySummaries', () => {
  const summaries: ProductHistorySummary[] = [
    buildProductHistorySummary(
      { ...product, id: 'a', name: 'Alpha', slug: 'alpha' },
      [
        { price: 100, recordedAt: day(0) },
        { price: 100, recordedAt: day(10) },
        { price: 100, recordedAt: day(20) },
        { price: 100, recordedAt: day(25) },
        { price: 90, recordedAt: day(30) },
      ],
      new Date(day(31))
    ),
    buildProductHistorySummary(
      { ...product, id: 'b', name: 'Beta', slug: 'beta' },
      [
        { price: 200, recordedAt: day(0) },
        { price: 200, recordedAt: day(10) },
        { price: 200, recordedAt: day(20) },
        { price: 200, recordedAt: day(25) },
        { price: 150, recordedAt: day(30) },
      ],
      new Date(day(31))
    ),
    buildProductHistorySummary(
      { ...product, id: 'c', name: 'Gamma', slug: 'gamma' },
      [],
      new Date(day(31))
    ),
  ];

  it('biggest-drop first, no-history last', () => {
    const sorted = sortHistorySummaries(summaries, 'biggest-drop');
    expect(sorted.map((s) => s.name)).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('lowest recorded price first, no-history last', () => {
    const sorted = sortHistorySummaries(summaries, 'lowest-price');
    expect(sorted.map((s) => s.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('name A–Z', () => {
    expect(sortHistorySummaries(summaries, 'name').map((s) => s.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });
});

describe('parseExplorerSort + labels', () => {
  it('unknown sort falls back to biggest-drop', () => {
    expect(parseExplorerSort({ sort: 'bogus' })).toBe('biggest-drop');
    expect(parseExplorerSort({})).toBe('biggest-drop');
    expect(parseExplorerSort({ sort: 'name' })).toBe('name');
  });

  it('point label is honest about thin history', () => {
    expect(explorerPointLabel(4)).toBe('4 recorded points');
    expect(explorerPointLabel(1)).toBe('1 recorded point');
    expect(explorerPointLabel(0)).toBe('0 recorded points');
  });
});
