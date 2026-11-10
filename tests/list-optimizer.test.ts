import { describe, expect, it } from 'vitest';
import {
  normalizeListItems,
  optimizeShoppingList,
  type MerchantListingInput,
} from '@/lib/list-optimizer';

const listings: MerchantListingInput[] = [
  { productSlug: 'macbook-air-m4', store: 'Amazon', price: 999 },
  { productSlug: 'macbook-air-m4', store: 'Best Buy', price: 1018.98 },
  { productSlug: 'airpods-pro', store: 'Amazon', price: 199 },
  { productSlug: 'airpods-pro', store: 'Best Buy', price: 189 },
  { productSlug: 'iphone-16', store: 'Amazon', price: 799 },
];

describe('normalizeListItems', () => {
  it('merges duplicate slugs by summing quantities', () => {
    expect(
      normalizeListItems([
        { productSlug: 'macbook-air-m4', quantity: 1 },
        { productSlug: 'macbook-air-m4', quantity: 2 },
      ])
    ).toEqual([{ productSlug: 'macbook-air-m4', quantity: 3 }]);
  });

  it('throws on empty, blank-slug, and bad-quantity lists — never optimizes a malformed list', () => {
    expect(() => normalizeListItems([])).toThrow();
    expect(() => normalizeListItems([{ productSlug: ' ', quantity: 1 }])).toThrow();
    expect(() => normalizeListItems([{ productSlug: 'x', quantity: 0 }])).toThrow();
    expect(() => normalizeListItems([{ productSlug: 'x', quantity: 1.5 }])).toThrow();
    expect(() => normalizeListItems([{ productSlug: 'x', quantity: 100 }])).toThrow();
    expect(() => normalizeListItems(null)).toThrow();
  });
});

describe('optimizeShoppingList', () => {
  it('splits each item to its cheapest store and reports the saving vs one store', () => {
    const result = optimizeShoppingList(
      [
        { productSlug: 'macbook-air-m4', quantity: 1 },
        { productSlug: 'airpods-pro', quantity: 2 },
      ],
      listings
    );
    // Split: 999 + 2×189 = 1377. Best single store carrying all: Best Buy
    // 1018.98 + 2×189 = 1396.98 (Amazon would be 999 + 2×199 = 1397).
    expect(result.splitTotal).toBe(1377);
    expect(result.bestSingleStore?.store).toBe('Best Buy');
    expect(result.bestSingleStore?.total).toBe(1396.98);
    expect(result.savingVsSingleStore).toBe(19.98);
    expect(result.items).toEqual([
      { productSlug: 'macbook-air-m4', quantity: 1, store: 'Amazon', unitPrice: 999, lineTotal: 999, url: null, hasListing: true },
      { productSlug: 'airpods-pro', quantity: 2, store: 'Best Buy', unitPrice: 189, lineTotal: 378, url: null, hasListing: true },
    ]);
    expect(result.noListingSlugs).toEqual([]);
  });

  it('excludes a product with no listing from totals and says so — never invents a price', () => {
    const result = optimizeShoppingList(
      [
        { productSlug: 'macbook-air-m4', quantity: 1 },
        { productSlug: 'unknown-product', quantity: 3 },
      ],
      listings
    );
    expect(result.splitTotal).toBe(999);
    expect(result.noListingSlugs).toEqual(['unknown-product']);
    expect(result.items[1].hasListing).toBe(false);
    expect(result.items[1].unitPrice).toBeNull();
    expect(result.notes.join(' ')).toMatch(/no recorded merchant listing/);
  });

  it('returns null totals when nothing has a listing', () => {
    const result = optimizeShoppingList([{ productSlug: 'unknown-product', quantity: 1 }], listings);
    expect(result.splitTotal).toBeNull();
    expect(result.bestSingleStore).toBeNull();
    expect(result.savingVsSingleStore).toBeNull();
  });

  it('reports no single-store comparison when no store carries every priced item', () => {
    const result = optimizeShoppingList(
      [
        { productSlug: 'macbook-air-m4', quantity: 1 },
        { productSlug: 'iphone-16', quantity: 1 },
      ],
      // iPhone only at Amazon, MacBook cheapest at Amazon too — force the
      // no-single-store case by removing the Amazon MacBook listing.
      listings.filter((l) => !(l.productSlug === 'macbook-air-m4' && l.store === 'Amazon'))
    );
    expect(result.splitTotal).toBe(1018.98 + 799);
    expect(result.bestSingleStore).toBeNull();
    expect(result.savingVsSingleStore).toBeNull();
    expect(result.notes.join(' ')).toMatch(/No single store carries/);
  });

  it('ignores invalid listings (zero, negative, non-finite prices)', () => {
    const result = optimizeShoppingList(
      [{ productSlug: 'airpods-pro', quantity: 1 }],
      [
        { productSlug: 'airpods-pro', store: 'Shady', price: 0 },
        { productSlug: 'airpods-pro', store: 'Broken', price: NaN },
        { productSlug: 'airpods-pro', store: 'Best Buy', price: 189 },
      ]
    );
    expect(result.splitTotal).toBe(189);
    expect(result.items[0].store).toBe('Best Buy');
  });

  it('reports zero saving when the split matches the best single store', () => {
    const result = optimizeShoppingList(
      [{ productSlug: 'iphone-16', quantity: 1 }],
      listings
    );
    expect(result.splitTotal).toBe(799);
    expect(result.savingVsSingleStore).toBe(0);
  });

  it('orders per-store totals cheapest first', () => {
    const result = optimizeShoppingList(
      [{ productSlug: 'macbook-air-m4', quantity: 1 }],
      listings
    );
    expect(result.storeTotals.map((s) => s.store)).toEqual(['Amazon', 'Best Buy']);
    expect(result.storeTotals[0].total).toBe(999);
  });
});
