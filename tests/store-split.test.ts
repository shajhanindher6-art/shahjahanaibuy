import { describe, expect, it } from 'vitest';
import { getStoresSplit } from '@/lib/stores';

// Section 8 — local-first + international split. Both buckets are
// always returned, local first; the international bucket never
// repeats a store already shown as local.

describe('getStoresSplit', () => {
  it('PK returns Daraz + PriceOye locally, all 4 global retailers internationally', () => {
    const { local, international, hasLocal } = getStoresSplit('PK');
    expect(hasLocal).toBe(true);
    expect(local.map((s) => s.name)).toEqual(['Daraz', 'PriceOye']);
    expect(international.map((s) => s.name)).toEqual([
      'Amazon',
      'eBay',
      'AliExpress',
      'Google Shopping',
    ]);
  });

  it('US local stores exclude eBay from the international bucket (no duplicates)', () => {
    const { local, international, hasLocal } = getStoresSplit('US');
    expect(hasLocal).toBe(true);
    expect(local.map((s) => s.name)).toEqual(['eBay', 'Walmart', 'Target']);
    expect(international.map((s) => s.name)).toEqual([
      'Amazon',
      'AliExpress',
      'Google Shopping',
    ]);
    const allSlugs = [...local, ...international].map((s) => s.slug);
    expect(new Set(allSlugs).size).toBe(allSlugs.length);
  });

  it('QA now has Noon as its first local store (Section 8)', () => {
    const { local, international, hasLocal } = getStoresSplit('QA');
    expect(hasLocal).toBe(true);
    expect(local.map((s) => s.name)).toEqual(['Noon']);
    expect(international.map((s) => s.name)).toEqual([
      'Amazon',
      'eBay',
      'AliExpress',
      'Google Shopping',
    ]);
  });

  it('UA returns Rozetka locally (Section 8 region + store)', () => {
    const { local, hasLocal } = getStoresSplit('UA');
    expect(hasLocal).toBe(true);
    expect(local.map((s) => s.name)).toEqual(['Rozetka']);
  });

  it('FR returns eBay + Cdiscount locally (Section 8)', () => {
    const { local, hasLocal } = getStoresSplit('FR');
    expect(hasLocal).toBe(true);
    expect(local.map((s) => s.name)).toEqual(['eBay', 'Cdiscount']);
  });

  it('ZA (no confirmed local store) has an empty local bucket and the full international fallback', () => {
    const { local, international, hasLocal } = getStoresSplit('ZA');
    expect(hasLocal).toBe(false);
    expect(local).toEqual([]);
    expect(international.map((s) => s.name)).toEqual([
      'Amazon',
      'eBay',
      'AliExpress',
      'Google Shopping',
    ]);
  });

  it('unknown codes and null never silently serve US local stores', () => {
    for (const code of ['XX', null, undefined]) {
      const { local, international, hasLocal } = getStoresSplit(code);
      expect(hasLocal).toBe(false);
      expect(local).toEqual([]);
      expect(international).toHaveLength(4);
    }
  });

  it('country codes are case-insensitive', () => {
    expect(getStoresSplit('pk').local.map((s) => s.name)).toEqual([
      'Daraz',
      'PriceOye',
    ]);
  });
});
