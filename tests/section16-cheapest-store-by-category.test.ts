import { describe, expect, it } from 'vitest';
import { buildCheapestStoreTable } from '@/lib/cheapest-store-by-category';

/**
 * Recorded merchant prices from the seed
 * (supabase/seed-part2-merchants-deals.sql + seed-demo-data.sql):
 * Amazon $999 / Best Buy $1099 for the MacBook Air 13, and the
 * same two-merchant shape across the catalog.
 */
const LISTINGS = [
  { category: 'Laptops', merchantName: 'Amazon', price: 999, inStock: true, productName: 'MacBook Air 13', productSlug: 'macbook-air-13' },
  { category: 'Laptops', merchantName: 'Best Buy', price: 1099, inStock: true, productName: 'MacBook Air 13', productSlug: 'macbook-air-13' },
  { category: 'Laptops', merchantName: 'Amazon', price: 1099, inStock: true, productName: 'Dell XPS 13', productSlug: 'dell-xps-13' },
  { category: 'Smartphones', merchantName: 'Amazon', price: 1199, inStock: true, productName: 'Galaxy S24 Ultra', productSlug: 'galaxy-s24-ultra' },
  { category: 'Headphones', merchantName: 'Amazon', price: 399, inStock: true, productName: 'Sony WH-1000XM5', productSlug: 'sony-wh-1000xm5' },
  { category: 'Headphones', merchantName: 'Best Buy', price: 429, inStock: true, productName: 'Bose QuietComfort Ultra', productSlug: 'bose-quietcomfort-ultra' },
];

describe('buildCheapestStoreTable', () => {
  it('names Amazon cheapest for Laptops at $999 (MacBook Air 13)', () => {
    const t = buildCheapestStoreTable(LISTINGS);
    const laptops = t.rows.find((r) => r.category === 'Laptops')!;
    expect(laptops.cheapest?.merchantName).toBe('Amazon');
    expect(laptops.cheapest?.price).toBe(999);
    expect(laptops.cheapest?.productSlug).toBe('macbook-air-13');
    expect(laptops.byMerchant).toHaveLength(2);
    expect(laptops.byMerchant.find((m) => m.merchantName === 'Best Buy')?.price).toBe(1099);
  });

  it('shows a single-merchant category honestly (Smartphones: Amazon only)', () => {
    const t = buildCheapestStoreTable(LISTINGS);
    const phones = t.rows.find((r) => r.category === 'Smartphones')!;
    expect(phones.byMerchant).toHaveLength(1);
    expect(phones.cheapest?.merchantName).toBe('Amazon');
    expect(t.merchants).toEqual(['Amazon', 'Best Buy']);
  });

  it('ignores out-of-stock and zero rows — never a $0 cheapest', () => {
    const t = buildCheapestStoreTable([
      ...LISTINGS,
      { category: 'Laptops', merchantName: 'Best Buy', price: 0, inStock: true, productName: 'Fake', productSlug: 'fake' },
      { category: 'Laptops', merchantName: 'Amazon', price: 1, inStock: false, productName: 'Fake', productSlug: 'fake' },
    ]);
    expect(t.rows.find((r) => r.category === 'Laptops')?.cheapest?.price).toBe(999);
  });

  it('lists categories with no priced products separately', () => {
    const t = buildCheapestStoreTable(LISTINGS, ['Laptops', 'Cameras', 'Smartphones']);
    expect(t.categoriesWithNoPrices).toEqual(['Cameras']);
    expect(t.rows.map((r) => r.category)).not.toContain('Cameras');
  });

  it('returns an empty table for no listings', () => {
    const t = buildCheapestStoreTable([], ['Laptops']);
    expect(t.rows).toEqual([]);
    expect(t.categoriesWithNoPrices).toEqual(['Laptops']);
  });
});
