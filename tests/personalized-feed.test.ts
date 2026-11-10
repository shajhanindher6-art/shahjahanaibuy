import { describe, expect, it } from 'vitest';
import {
  buildPersonalizedQuery,
  rankProductsBySignals,
  type PersonalizedSignal,
} from '@/lib/personalized-feed';

// S3#18 — personalized deals feed: picks come only from the
// visitor's own wishlist/alert signals. No cross-user tracking,
// no invented budget — the budget comes only from the visitor's
// own alert targets.

const laptopAlert: PersonalizedSignal = {
  kind: 'alert',
  productId: 'p1',
  slug: 'macbook-air-13',
  name: 'MacBook Air 13',
  category: 'Laptops',
  brand: 'Apple',
  targetPrice: 900,
};

const headphonesSaved: PersonalizedSignal = {
  kind: 'wishlist',
  productId: 'p2',
  slug: 'sony-headphones',
  name: 'Sony Headphones',
  category: 'Headphones',
  brand: 'Sony',
};

describe('buildPersonalizedQuery', () => {
  it('returns empty when there are no signals', () => {
    const result = buildPersonalizedQuery([]);
    expect(result.empty).toBe(true);
    expect(result.query).toBe('');
    expect(result.reasons).toEqual([]);
    expect(result.maxBudget).toBeNull();
  });

  it('builds a category + budget query from the visitor’s own targets', () => {
    const result = buildPersonalizedQuery([laptopAlert, headphonesSaved]);
    expect(result.empty).toBe(false);
    expect(result.query).toBe('best Headphones and Laptops deals under $900');
    expect(result.maxBudget).toBe(900);
    expect(result.categories).toEqual(['Headphones', 'Laptops']);
    expect(result.reasons).toContain('Because you saved Sony Headphones');
    expect(result.reasons).toContain('Because you set a $900 alert on MacBook Air 13');
  });

  it('uses the lowest alert target as the budget', () => {
    const result = buildPersonalizedQuery([
      laptopAlert,
      { ...laptopAlert, productId: 'p3', name: 'Dell XPS', targetPrice: 700 },
    ]);
    expect(result.maxBudget).toBe(700);
    expect(result.query).toContain('under $700');
  });

  it('omits the budget when the visitor set no price target', () => {
    const result = buildPersonalizedQuery([headphonesSaved]);
    expect(result.maxBudget).toBeNull();
    expect(result.query).toBe('best Headphones deals');
  });

  it('ignores signals without a product id or name', () => {
    const result = buildPersonalizedQuery([
      { kind: 'wishlist', productId: '', name: '' },
    ]);
    expect(result.empty).toBe(true);
  });
});

describe('rankProductsBySignals', () => {
  const products = [
    { id: 'a', category: 'Phones', brand: 'Samsung' },
    { id: 'b', category: 'Laptops', brand: 'Apple' },
    { id: 'c', category: 'Headphones', brand: 'Sony' },
    { id: 'd', category: 'Laptops', brand: 'Dell' },
  ];

  it('ranks same-category then same-brand matches first, stably', () => {
    const ranked = rankProductsBySignals(products, [laptopAlert, headphonesSaved]);
    expect(ranked.map((p) => p.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('keeps original order when nothing matches', () => {
    const ranked = rankProductsBySignals(products, []);
    expect(ranked.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never drops products', () => {
    expect(rankProductsBySignals(products, [laptopAlert])).toHaveLength(4);
  });
});
