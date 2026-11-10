import { describe, expect, it } from 'vitest';
import {
  computePriceIndex,
  indexDepthLabel,
  PRICE_INDEX_MIN_PRODUCTS,
  type IndexPricePoint,
} from '@/lib/price-index';

function p(
  productId: string,
  category: string | null,
  region: string | null,
  price: number,
  recordedAt: string
): IndexPricePoint {
  return { productId, category, region, price, recordedAt };
}

// Two Laptops, US region: A Oct mean 100 → Nov 90 (ratio 0.9),
// B Oct mean 200 → Nov 220 (ratio 1.1). Index Nov = 100 × (0.9+1.1)/2 = 100.0.
const TWO_PRODUCT_POINTS: IndexPricePoint[] = [
  p('a', 'Laptops', 'US', 100, '2026-10-05T00:00:00.000Z'),
  p('a', 'Laptops', 'US', 100, '2026-10-20T00:00:00.000Z'),
  p('a', 'Laptops', 'US', 90, '2026-11-05T00:00:00.000Z'),
  p('b', 'Laptops', 'US', 200, '2026-10-06T00:00:00.000Z'),
  p('b', 'Laptops', 'US', 220, '2026-11-06T00:00:00.000Z'),
];

describe('computePriceIndex', () => {
  it('needs at least 2 products for a published value', () => {
    expect(PRICE_INDEX_MIN_PRODUCTS).toBe(2);
  });

  it('empty input → no entries, no base month, zero history', () => {
    const result = computePriceIndex([]);
    expect(result.entries).toEqual([]);
    expect(result.summaries).toEqual([]);
    expect(result.baseMonth).toBeNull();
    expect(result.historyDays).toBe(0);
    expect(result.pointsUsed).toBe(0);
    expect(result.categories).toEqual([]);
  });

  it('computes the monthly index by hand (mean of per-product ratios)', () => {
    const result = computePriceIndex(TWO_PRODUCT_POINTS);
    const global = result.entries.filter((e) => e.region === 'GLOBAL');
    expect(result.baseMonth).toBe('2026-10');
    expect(result.historyDays).toBe(32);
    expect(result.pointsUsed).toBe(5);

    const oct = global.find((e) => e.periodMonth === '2026-10')!;
    expect(oct.indexValue).toBe(100);
    expect(oct.status).toBe('ok');
    expect(oct.productsUsed).toBe(2);
    expect(oct.pointsUsed).toBe(3);

    const nov = global.find((e) => e.periodMonth === '2026-11')!;
    // (0.9 + 1.1) / 2 × 100 = 100.0 — the two moves cancel.
    expect(nov.indexValue).toBe(100);
    expect(nov.status).toBe('ok');
    expect(nov.productsUsed).toBe(2);
    expect(nov.pointsUsed).toBe(2);

    const summary = result.summaries.find(
      (s) => s.category === 'Laptops' && s.region === 'GLOBAL'
    )!;
    expect(summary.latestMonth).toBe('2026-11');
    expect(summary.latestValue).toBe(100);
    expect(summary.latestChangePct).toBe(0);
    expect(summary.direction).toBe('flat');
    expect(summary.status).toBe('ok');
  });

  it('a one-sided move shows in the index and the month-over-month change', () => {
    const points: IndexPricePoint[] = [
      p('a', 'Laptops', 'US', 100, '2026-10-05T00:00:00.000Z'),
      p('a', 'Laptops', 'US', 80, '2026-11-05T00:00:00.000Z'),
      p('b', 'Laptops', 'US', 200, '2026-10-06T00:00:00.000Z'),
      p('b', 'Laptops', 'US', 200, '2026-11-06T00:00:00.000Z'),
    ];
    const result = computePriceIndex(points);
    const nov = result.entries.find(
      (e) => e.region === 'GLOBAL' && e.periodMonth === '2026-11'
    )!;
    // (0.8 + 1.0) / 2 × 100 = 90.0.
    expect(nov.indexValue).toBe(90);
    const summary = result.summaries.find(
      (s) => s.category === 'Laptops' && s.region === 'GLOBAL'
    )!;
    expect(summary.latestChangePct).toBe(-10);
    expect(summary.direction).toBe('down');
  });

  it('one product → insufficient rows with null values, never a number', () => {
    const result = computePriceIndex([
      p('a', 'Laptops', 'US', 100, '2026-10-05T00:00:00.000Z'),
      p('a', 'Laptops', 'US', 90, '2026-11-05T00:00:00.000Z'),
    ]);
    expect(result.entries.length).toBeGreaterThan(0);
    for (const e of result.entries) {
      expect(e.status).toBe('insufficient');
      expect(e.indexValue).toBeNull();
      expect(e.productsUsed).toBe(1);
    }
    const summary = result.summaries.find((s) => s.region === 'GLOBAL')!;
    expect(summary.status).toBe('insufficient');
    expect(summary.latestValue).toBeNull();
    expect(summary.direction).toBe('unknown');
  });

  it('splits per region and pools GLOBAL, with per-region insufficiency', () => {
    const points: IndexPricePoint[] = [
      p('a', 'Laptops', 'US', 100, '2026-10-05T00:00:00.000Z'),
      p('a', 'Laptops', 'US', 90, '2026-11-05T00:00:00.000Z'),
      p('b', 'Laptops', 'PK', 200, '2026-10-06T00:00:00.000Z'),
      p('b', 'Laptops', 'PK', 220, '2026-11-06T00:00:00.000Z'),
    ];
    const result = computePriceIndex(points);
    expect(result.regions).toContain('GLOBAL');
    expect(result.regions).toContain('US');
    expect(result.regions).toContain('PK');
    // GLOBAL pools both products → published.
    const globalNov = result.entries.find(
      (e) => e.region === 'GLOBAL' && e.periodMonth === '2026-11'
    )!;
    expect(globalNov.indexValue).toBe(100);
    // Each single-region group has only 1 product → insufficient.
    const usNov = result.entries.find(
      (e) => e.region === 'US' && e.periodMonth === '2026-11'
    )!;
    expect(usNov.status).toBe('insufficient');
    expect(usNov.indexValue).toBeNull();
  });

  it('a product without base-month data does not enter later months', () => {
    const points: IndexPricePoint[] = [
      p('a', 'Laptops', 'US', 100, '2026-10-05T00:00:00.000Z'),
      p('a', 'Laptops', 'US', 90, '2026-11-05T00:00:00.000Z'),
      p('b', 'Laptops', 'US', 200, '2026-10-06T00:00:00.000Z'),
      p('b', 'Laptops', 'US', 220, '2026-11-06T00:00:00.000Z'),
      // Product c appears only in November — no base-month mean.
      p('c', 'Laptops', 'US', 50, '2026-11-07T00:00:00.000Z'),
    ];
    const result = computePriceIndex(points);
    const nov = result.entries.find(
      (e) => e.region === 'GLOBAL' && e.periodMonth === '2026-11'
    )!;
    expect(nov.indexValue).toBe(100);
    expect(nov.productsUsed).toBe(2);
  });

  it('category filter narrows to one category', () => {
    const points: IndexPricePoint[] = [
      ...TWO_PRODUCT_POINTS,
      p('c', 'Phones', 'US', 500, '2026-10-05T00:00:00.000Z'),
      p('d', 'Phones', 'US', 600, '2026-10-06T00:00:00.000Z'),
      p('c', 'Phones', 'US', 450, '2026-11-05T00:00:00.000Z'),
      p('d', 'Phones', 'US', 600, '2026-11-06T00:00:00.000Z'),
    ];
    const result = computePriceIndex(points, { category: 'Phones' });
    expect(result.categories).toEqual(['Phones']);
    expect(result.entries.every((e) => e.category === 'Phones')).toBe(true);
    const nov = result.entries.find((e) => e.periodMonth === '2026-11')!;
    // (0.9 + 1.0) / 2 × 100 = 95.0.
    expect(nov.indexValue).toBe(95);
  });

  it('drops invalid rows: zero/NaN price, bad date, missing category', () => {
    const points: IndexPricePoint[] = [
      ...TWO_PRODUCT_POINTS,
      p('a', 'Laptops', 'US', 0, '2026-10-07T00:00:00.000Z'),
      p('a', 'Laptops', 'US', Number.NaN, '2026-10-08T00:00:00.000Z'),
      p('a', 'Laptops', 'US', 999, 'not-a-date'),
      p('a', null, 'US', 999, '2026-10-09T00:00:00.000Z'),
      p('a', '   ', 'US', 999, '2026-10-09T00:00:00.000Z'),
    ];
    const result = computePriceIndex(points);
    // Same as the clean two-product case: 5 usable points.
    expect(result.pointsUsed).toBe(5);
    const nov = result.entries.find(
      (e) => e.region === 'GLOBAL' && e.periodMonth === '2026-11'
    )!;
    expect(nov.indexValue).toBe(100);
  });

  it('indexDepthLabel states the depth honestly', () => {
    expect(indexDepthLabel({ productsUsed: 2, pointsUsed: 5 })).toBe(
      'based on 5 recorded prices from 2 products'
    );
    expect(indexDepthLabel({ productsUsed: 1, pointsUsed: 1 })).toBe(
      'based on 1 recorded price from 1 product'
    );
  });
});
