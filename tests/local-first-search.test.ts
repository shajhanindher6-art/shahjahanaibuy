import { describe, expect, it } from 'vitest';
import {
  buildLocalFirstResults,
  LOCAL_FIRST_FALLBACK_NOTICE,
  validateLocalFirstQuery,
  type CatalogProductForLocalFirst,
} from '@/services/local-first-search';

function product(
  partial: Partial<CatalogProductForLocalFirst> & { id: string }
): CatalogProductForLocalFirst {
  return {
    name: 'MacBook Air 13',
    slug: 'macbook-air-13',
    brand: 'Apple',
    category: 'Laptops',
    imageUrl: null,
    currentPrice: 999,
    score: 1,
    stores: ['Amazon', 'Best Buy'],
    ...partial,
  };
}

describe('buildLocalFirstResults', () => {
  it('PK returns Daraz + PriceOye, no fallback', () => {
    const { localResults, fallbackTriggered } = buildLocalFirstResults({
      query: 'laptop',
      country: 'PK',
      products: [],
    });
    expect(fallbackTriggered).toBe(false);
    expect(localResults.map((s) => s.storeName)).toEqual([
      'Daraz',
      'PriceOye',
    ]);
    // Search links only — never a price, stock, or discount.
    for (const link of localResults) {
      expect(link.searchUrl).toContain('laptop');
      expect('priceUsd' in link).toBe(false);
    }
  });

  it('US returns eBay, Walmart, Target', () => {
    const { localResults, fallbackTriggered } = buildLocalFirstResults({
      query: 'phone',
      country: 'US',
      products: [],
    });
    expect(fallbackTriggered).toBe(false);
    expect(localResults.map((s) => s.storeName)).toEqual([
      'eBay',
      'Walmart',
      'Target',
    ]);
  });

  it('ZA (no confirmed local store) triggers the fallback', () => {
    const { localResults, fallbackTriggered } = buildLocalFirstResults({
      query: 'laptop',
      country: 'ZA',
      products: [],
    });
    expect(localResults).toEqual([]);
    expect(fallbackTriggered).toBe(true);
    expect(LOCAL_FIRST_FALLBACK_NOTICE).toBe(
      'No local stock found — showing international import options.'
    );
  });

  it('puts priced products before store links, unpriced stays null', () => {
    const { globalResults } = buildLocalFirstResults({
      query: 'laptop',
      country: 'US',
      products: [
        product({ id: '1', currentPrice: 999 }),
        product({
          id: '2',
          name: 'Sample Laptop',
          slug: 'sample-laptop',
          currentPrice: null,
        }),
      ],
    });
    expect(globalResults[0]).toMatchObject({
      kind: 'product',
      priceUsd: 999,
    });
    expect(globalResults[1]).toMatchObject({
      kind: 'product',
      priceUsd: null,
    });
    // Every entry after the products is a store link.
    expect(globalResults.slice(2).every((e) => e.kind === 'store-link')).toBe(
      true
    );
  });
});

describe('validateLocalFirstQuery', () => {
  it('accepts a trimmed query up to 200 chars', () => {
    expect(validateLocalFirstQuery('  laptop  ')).toEqual({
      ok: true,
      query: 'laptop',
    });
    expect(validateLocalFirstQuery('a'.repeat(200)).ok).toBe(true);
  });

  it('rejects empty, whitespace-only, and over-long queries', () => {
    expect(validateLocalFirstQuery('').ok).toBe(false);
    expect(validateLocalFirstQuery('   ').ok).toBe(false);
    expect(validateLocalFirstQuery('a'.repeat(201)).ok).toBe(false);
    expect(validateLocalFirstQuery(42 as unknown as string).ok).toBe(false);
  });
});
