import { describe, expect, it } from 'vitest';
import {
  allocateBundle,
  type BundleCandidate,
} from '@/services/bundle-allocator';

function product(
  partial: Partial<BundleCandidate> & { id: string }
): BundleCandidate {
  return {
    slug: 'product',
    name: 'Product',
    brand: null,
    category: 'Laptops',
    lowestPriceUsd: 100,
    ...partial,
  };
}

describe('allocateBundle', () => {
  it('covers every requested category on an exact-budget fit', () => {
    // 100 + 50 = 150, exactly the budget.
    const result = allocateBundle({
      budgetUsd: 150,
      categories: ['Laptops', 'Phones'],
      products: [
        product({ id: '1', slug: 'laptop-a', category: 'Laptops', lowestPriceUsd: 100 }),
        product({ id: '2', slug: 'phone-a', category: 'Phones', lowestPriceUsd: 50 }),
      ],
    });
    expect(result.picks).toHaveLength(2);
    expect(result.totalSpendUsd).toBe(150);
    expect(result.coveredCategories).toEqual(['Laptops', 'Phones']);
    expect(result.uncovered).toEqual([]);
    expect(result.withinBudget).toBe(true);
  });

  it('maximizes the count, then minimizes spend', () => {
    // Laptops cheapest is $100, Phones cheapest is $50, budget $100.
    // Either category alone fits, but Phones ($50) is the cheaper
    // cover, so the bundle is Phones-only at $50 — max count (1)
    // with minimum spend.
    const result = allocateBundle({
      budgetUsd: 100,
      categories: ['Laptops', 'Phones'],
      products: [
        product({ id: '1', slug: 'laptop-a', category: 'Laptops', lowestPriceUsd: 100 }),
        product({ id: '2', slug: 'phone-a', category: 'Phones', lowestPriceUsd: 50 }),
      ],
    });
    expect(result.picks.map((p) => p.slug)).toEqual(['phone-a']);
    expect(result.totalSpendUsd).toBe(50);
    expect(result.uncovered).toEqual([
      { category: 'Laptops', reason: 'over-budget' },
    ]);
  });

  it('never exceeds the budget', () => {
    const result = allocateBundle({
      budgetUsd: 120,
      categories: ['Laptops', 'Phones', 'Headphones'],
      products: [
        product({ id: '1', slug: 'laptop-a', category: 'Laptops', lowestPriceUsd: 100 }),
        product({ id: '2', slug: 'phone-a', category: 'Phones', lowestPriceUsd: 90 }),
        product({ id: '3', slug: 'buds-a', category: 'Headphones', lowestPriceUsd: 25 }),
      ],
    });
    // Cheapest first: Headphones $25, Phones $90 → $115; Laptops $100
    // would make $215, so it stays uncovered.
    expect(result.picks.map((p) => p.slug)).toEqual(['phone-a', 'buds-a']);
    expect(result.totalSpendUsd).toBe(115);
    expect(result.totalSpendUsd).toBeLessThanOrEqual(120);
  });

  it('picks the cheapest eligible product per category', () => {
    const result = allocateBundle({
      budgetUsd: 1000,
      categories: ['Laptops'],
      products: [
        product({ id: '1', slug: 'laptop-expensive', category: 'Laptops', lowestPriceUsd: 900 }),
        product({ id: '2', slug: 'laptop-cheap', category: 'Laptops', lowestPriceUsd: 400 }),
      ],
    });
    expect(result.picks.map((p) => p.slug)).toEqual(['laptop-cheap']);
    expect(result.totalSpendUsd).toBe(400);
  });

  it('never recommends Sample Laptop or unpriced products', () => {
    const result = allocateBundle({
      budgetUsd: 1000,
      categories: ['Laptops', 'Phones'],
      products: [
        product({ id: '1', slug: 'sample-laptop', name: 'Sample Laptop', category: 'Laptops', lowestPriceUsd: 1 }),
        product({ id: '2', slug: 'laptop-a', category: 'Laptops', lowestPriceUsd: 500 }),
        product({ id: '3', slug: 'phone-a', category: 'Phones', lowestPriceUsd: null }),
        product({ id: '4', slug: 'phone-b', category: 'Phones', lowestPriceUsd: 200 }),
      ],
    });
    expect(result.picks.map((p) => p.slug)).toEqual(['laptop-a', 'phone-b']);
  });

  it('reports no-priced-product vs over-budget honestly', () => {
    const result = allocateBundle({
      budgetUsd: 10,
      categories: ['Laptops', 'Cameras', 'Phones'],
      products: [
        product({ id: '1', slug: 'laptop-a', category: 'Laptops', lowestPriceUsd: 500 }),
        product({ id: '2', slug: 'phone-a', category: 'Phones', lowestPriceUsd: null }),
      ],
    });
    // Nothing fits $10: Laptops exists but is over budget, Cameras
    // has no product at all, Phones has only an unpriced product.
    expect(result.picks).toEqual([]);
    expect(result.uncovered).toEqual([
      { category: 'Laptops', reason: 'over-budget' },
      { category: 'Cameras', reason: 'no-priced-product' },
      { category: 'Phones', reason: 'no-priced-product' },
    ]);
  });

  it('handles invalid budgets, duplicates, and empty input', () => {
    const products = [
      product({ id: '1', slug: 'laptop-a', category: 'Laptops', lowestPriceUsd: 100 }),
    ];
    expect(
      allocateBundle({ budgetUsd: 0, categories: ['Laptops'], products }).picks
    ).toEqual([]);
    expect(
      allocateBundle({ budgetUsd: -50, categories: ['Laptops'], products }).picks
    ).toEqual([]);
    expect(
      allocateBundle({ budgetUsd: Number.NaN, categories: ['Laptops'], products }).picks
    ).toEqual([]);
    // Duplicate + blank categories collapse to one.
    const dup = allocateBundle({
      budgetUsd: 500,
      categories: ['Laptops', ' Laptops ', ''],
      products,
    });
    expect(dup.coveredCategories).toEqual(['Laptops']);
    expect(dup.picks).toHaveLength(1);
    expect(
      allocateBundle({ budgetUsd: 500, categories: [], products }).picks
    ).toEqual([]);
  });

  it('breaks price ties deterministically by slug', () => {
    const result = allocateBundle({
      budgetUsd: 500,
      categories: ['Laptops'],
      products: [
        product({ id: '1', slug: 'laptop-z', category: 'Laptops', lowestPriceUsd: 300 }),
        product({ id: '2', slug: 'laptop-a', category: 'Laptops', lowestPriceUsd: 300 }),
      ],
    });
    expect(result.picks.map((p) => p.slug)).toEqual(['laptop-a']);
  });
});
