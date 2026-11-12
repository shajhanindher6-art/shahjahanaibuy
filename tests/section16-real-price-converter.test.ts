import { describe, expect, it } from 'vitest';
import { computeCategoryInflation, type CategoryPricePoint } from '@/services/category-inflation';
import {
  convertRealPrice,
  describeRealPriceConversion,
  parseRealPriceParams,
} from '@/lib/real-price-converter';

/**
 * Real recorded history, rebuilt from the seed
 * (supabase/seed-demo-data.sql:131-148): every product's 4 Amazon
 * points are base × {1.05 (30d), 1.02 (14d), 1.00 (7d), 1.00 (now)}.
 * Base prices from the same seed: MacBook 999, Galaxy 1199, Sony
 * 399, Dell 1099, Lenovo 1399, Bose 429, Canon 979, GoPro 399,
 * Garmin 449, Logitech 99.
 */
const BASES: Array<{ productId: string; category: string; base: number }> = [
  { productId: 'macbook-air-13', category: 'Laptops', base: 999 },
  { productId: 'dell-xps-13', category: 'Laptops', base: 1099 },
  { productId: 'lenovo-thinkpad-x1', category: 'Laptops', base: 1399 },
  { productId: 'galaxy-s24-ultra', category: 'Smartphones', base: 1199 },
  { productId: 'sony-wh-1000xm5', category: 'Headphones', base: 399 },
  { productId: 'bose-quietcomfort-ultra', category: 'Headphones', base: 429 },
  { productId: 'canon-eos-r10', category: 'Cameras', base: 979 },
  { productId: 'gopro-hero12', category: 'Cameras', base: 399 },
  { productId: 'garmin-venu-3', category: 'Smartwatches', base: 449 },
  { productId: 'logitech-mx-master-3s', category: 'Accessories', base: 99 },
];

const NOW = new Date('2026-11-02T12:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

function seedPoints(): CategoryPricePoint[] {
  const points: CategoryPricePoint[] = [];
  for (const b of BASES) {
    for (const [agoDays, factor] of [
      [30, 1.05],
      [14, 1.02],
      [7, 1.0],
      [0, 1.0],
    ] as Array<[number, number]>) {
      points.push({
        productId: b.productId,
        category: b.category,
        price: Math.round(b.base * factor * 100) / 100,
        recordedAt: new Date(NOW - agoDays * DAY).toISOString(),
      });
    }
  }
  return points;
}

describe('real-price converter on the real recorded index', () => {
  it('Laptops fell 4.8% over the trailing 90 days (3 products, all −4.76%)', () => {
    const index = computeCategoryInflation(seedPoints(), 90, NOW);
    const laptops = index.entries.find((e) => e.category === 'Laptops');
    expect(laptops?.status).toBe('ok');
    expect(laptops?.avgChangePct).toBe(-4.8);
    expect(laptops?.direction).toBe('down');
    expect(laptops?.productsUsed).toBe(3);
    expect(laptops?.pointsUsed).toBe(12);
  });

  it('converts $100 from 90 days ago to $95.20 in today’s Laptops prices', () => {
    const index = computeCategoryInflation(seedPoints(), 90, NOW);
    const laptops = index.entries.find((e) => e.category === 'Laptops')!;
    const c = convertRealPrice(100, laptops, index.windowDays);
    expect(c?.adjustedUsd).toBe(95.2);
    expect(c?.differenceUsd).toBe(-4.8);
    expect(describeRealPriceConversion(c!)).toContain('fell 4.8%');
  });

  it('Headphones and Cameras (2 products each) also convert; single-product categories do not', () => {
    const index = computeCategoryInflation(seedPoints(), 90, NOW);
    for (const cat of ['Headphones', 'Cameras']) {
      const entry = index.entries.find((e) => e.category === cat)!;
      expect(entry.status).toBe('ok');
      expect(convertRealPrice(1000, entry, 90)?.adjustedUsd).toBe(952);
    }
    for (const cat of ['Smartphones', 'Smartwatches', 'Accessories']) {
      const entry = index.entries.find((e) => e.category === cat)!;
      expect(entry.status).toBe('insufficient');
      expect(entry.avgChangePct).toBeNull();
      expect(convertRealPrice(1000, entry, 90)).toBeNull();
    }
  });

  it('a flat index converts an amount unchanged', () => {
    const c = convertRealPrice(250, {
      category: 'Laptops',
      avgChangePct: 0,
      direction: 'flat',
      productsUsed: 3,
      pointsUsed: 12,
      status: 'ok',
    }, 90);
    expect(c?.adjustedUsd).toBe(250);
    expect(c?.differenceUsd).toBe(0);
  });

  it('rejects invalid amounts', () => {
    const index = computeCategoryInflation(seedPoints(), 90, NOW);
    const laptops = index.entries.find((e) => e.category === 'Laptops')!;
    expect(convertRealPrice(0, laptops, 90)).toBeNull();
    expect(convertRealPrice(-50, laptops, 90)).toBeNull();
    expect(convertRealPrice(NaN, laptops, 90)).toBeNull();
  });
});

describe('parseRealPriceParams', () => {
  it('parses amount + category', () => {
    expect(parseRealPriceParams({ amount: '100', category: 'Laptops' })).toEqual({
      amount: 100,
      category: 'Laptops',
      errors: [],
      hasQuery: true,
    });
  });

  it('reports a bad amount and a missing category', () => {
    const p = parseRealPriceParams({ amount: 'abc' });
    expect(p.amount).toBeNull();
    expect(p.errors.length).toBeGreaterThanOrEqual(2);
  });
});
