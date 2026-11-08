import { describe, expect, it } from 'vitest';
import {
  computeCategoryInflation,
  CATEGORY_INFLATION_WINDOW_DAYS,
  type CategoryPricePoint,
} from '@/services/category-inflation';

const NOW = new Date('2026-11-08T12:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

function point(
  productId: string,
  category: string | null,
  price: number,
  daysAgo: number
): CategoryPricePoint {
  return {
    productId,
    category,
    price,
    recordedAt: new Date(NOW - daysAgo * DAY).toISOString(),
  };
}

describe('computeCategoryInflation', () => {
  it('averages per-product % changes (hand-computed)', () => {
    // A: 100 -> 110 = +10%. B: 200 -> 190 = -5%. Mean = +2.5%.
    const { entries, windowDays, historyDays } = computeCategoryInflation(
      [
        point('a', 'Laptops', 100, 30),
        point('a', 'Laptops', 110, 0),
        point('b', 'Laptops', 200, 30),
        point('b', 'Laptops', 190, 0),
      ],
      CATEGORY_INFLATION_WINDOW_DAYS,
      NOW
    );
    expect(windowDays).toBe(90);
    expect(historyDays).toBe(30);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: 'Laptops',
      avgChangePct: 2.5,
      direction: 'up',
      productsUsed: 2,
      pointsUsed: 4,
      status: 'ok',
    });
  });

  it('reports down and flat directions', () => {
    const down = computeCategoryInflation(
      [
        point('e', 'Phones', 100, 30),
        point('e', 'Phones', 90, 0),
        point('f', 'Phones', 200, 30),
        point('f', 'Phones', 180, 0),
      ],
      CATEGORY_INFLATION_WINDOW_DAYS,
      NOW
    );
    expect(down.entries[0]).toMatchObject({
      avgChangePct: -10,
      direction: 'down',
      status: 'ok',
    });

    // +0.04% and +0.02% both round to 0.0 — below the 0.1% noise guard.
    const flat = computeCategoryInflation(
      [
        point('c', 'Audio', 100, 30),
        point('c', 'Audio', 100.04, 0),
        point('d', 'Audio', 200, 30),
        point('d', 'Audio', 200.04, 0),
      ],
      CATEGORY_INFLATION_WINDOW_DAYS,
      NOW
    );
    expect(flat.entries[0]).toMatchObject({
      avgChangePct: 0,
      direction: 'flat',
      status: 'ok',
    });
  });

  it('returns insufficient data for a single-product category', () => {
    const { entries } = computeCategoryInflation(
      [point('a', 'Laptops', 100, 30), point('a', 'Laptops', 110, 0)],
      CATEGORY_INFLATION_WINDOW_DAYS,
      NOW
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: 'Laptops',
      avgChangePct: null,
      direction: 'unknown',
      productsUsed: 1,
      status: 'insufficient',
    });
  });

  it('needs at least 2 points per product', () => {
    const { entries } = computeCategoryInflation(
      [point('a', 'Laptops', 100, 0), point('b', 'Laptops', 200, 0)],
      CATEGORY_INFLATION_WINDOW_DAYS,
      NOW
    );
    expect(entries[0].status).toBe('insufficient');
    expect(entries[0].avgChangePct).toBeNull();
    expect(entries[0].productsUsed).toBe(0);
  });

  it('ignores points outside the 90-day window', () => {
    const { entries } = computeCategoryInflation(
      [
        point('a', 'Laptops', 1000, 100), // outside window — ignored
        point('a', 'Laptops', 100, 10),
        point('a', 'Laptops', 110, 0), // +10% from the in-window first point
        point('b', 'Laptops', 200, 95), // only old point — no change
        point('b', 'Laptops', 200, 10),
        point('b', 'Laptops', 200, 0), // flat
      ],
      CATEGORY_INFLATION_WINDOW_DAYS,
      NOW
    );
    // A +10%, B 0% -> mean +5%.
    expect(entries[0]).toMatchObject({
      avgChangePct: 5,
      direction: 'up',
      productsUsed: 2,
    });
  });

  it('drops invalid prices and uncategorized rows', () => {
    const { entries } = computeCategoryInflation(
      [
        point('a', 'Laptops', 0, 30), // invalid — dropped, never zero
        point('a', 'Laptops', NaN, 20), // invalid — dropped
        point('a', 'Laptops', 100, 10),
        point('a', 'Laptops', 110, 0),
        point('b', 'Laptops', 200, 10),
        point('b', 'Laptops', 200, 0),
        point('x', null, 50, 10), // no category — ignored entirely
        point('x', null, 999, 0),
        point('y', '   ', 50, 10), // blank category — ignored
      ],
      CATEGORY_INFLATION_WINDOW_DAYS,
      NOW
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: 'Laptops',
      avgChangePct: 5,
      productsUsed: 2,
      // Only the 4 usable points count: the 0 and NaN rows were
      // dropped before counting, and the uncategorized rows ignored.
      pointsUsed: 4,
    });
  });

  it('returns no entries for empty input', () => {
    const result = computeCategoryInflation([], CATEGORY_INFLATION_WINDOW_DAYS, NOW);
    expect(result.entries).toEqual([]);
    expect(result.historyDays).toBe(0);
  });
});
