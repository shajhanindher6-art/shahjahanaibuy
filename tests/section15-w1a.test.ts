/**
 * Section 15 W1A tests — soft-404 loader paths, brand/category ×
 * store search links, and the stale-price threshold wiring.
 *
 * - P0-2: the three [slug] pages call notFound() exactly when their
 *   loader returns null. The loaders themselves need next/headers
 *   (lib/product-seo-server.ts, lib/brand-category-seo-server.ts)
 *   and cannot run in the node vitest env, so the tests cover the
 *   null-decision each loader delegates to: getProductBySlug (the
 *   product loader's single-product lookup, fake Supabase client,
 *   same pattern as tests/products-sample-exclusion.test.ts) and
 *   resolveTaxonomyPage (the pure brand/category decision). The
 *   HTTP status itself is verified in dev (unknown slug -> 404).
 * - A1/A2: buildStoreSearchLinks — one link per directory store
 *   (80 local + 4 global = 84) for a brand or category name, every
 *   URL the store's own verified search pattern.
 * - P1-11: the stale helpers live in tests/price-freshness.test.ts;
 *   this file only pins the 84-store count the A1/A2 arithmetic
 *   (10 brands x 84 = 840, 6 categories x 84 = 504) rests on.
 */
import { describe, it, expect } from 'vitest';
import { getProductBySlug } from '@/services/products';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import {
  resolveTaxonomyPage,
  type TaxonomyProduct,
} from '@/lib/brand-category-seo';
import {
  ALL_SEARCH_STORES,
  buildStoreSearchLinks,
} from '@/lib/store-search-links';
import { GLOBAL_STORES, LOCAL_STORES } from '@/lib/stores';

type Row = Record<string, unknown>;

const macbook: Row = {
  id: '1',
  name: 'MacBook Air 13',
  slug: 'macbook-air-13',
  description: 'Apple MacBook Air 13.',
  brand: 'Apple',
  category: 'Laptops',
  image_url: null,
  gtin: null,
  confidence_score: 100,
  data_freshness: '2026-11-02T07:13:52.000Z',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

/**
 * Fake Supabase client for getProductBySlug's chain:
 * .from().select().eq().neq().is().maybeSingle(). The .eq() calls
 * filter the way PostgREST would, so an unknown slug genuinely
 * finds no row.
 */
function fakeSlugClient(rows: Row[]) {
  const eqCalls: Array<[string, unknown]> = [];
  const neqCalls: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.select = () => chain;
  chain.eq = (column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return chain;
  };
  chain.neq = (column: string, value: unknown) => {
    neqCalls.push([column, value]);
    return chain;
  };
  chain.is = () => chain;
  chain.maybeSingle = async () => {
    const found = rows.filter((row) =>
      eqCalls.every(([column, value]) => row[column] === value),
    ).filter((row) =>
      neqCalls.every(([column, value]) => row[column] !== value),
    );
    return { data: found[0] ?? null, error: null };
  };
  return { from: () => chain } as unknown as AnySupabaseClient;
}

describe('P0-2 product loader: unknown slug returns null (page 404s)', () => {
  it('returns null for a slug with no product row', async () => {
    const client = fakeSlugClient([macbook]);
    await expect(getProductBySlug(client, 'does-not-exist-xyz')).resolves.toBeNull();
  });

  it('returns the product for a known slug, so the page stays 200', async () => {
    const client = fakeSlugClient([macbook]);
    const product = await getProductBySlug(client, 'macbook-air-13');
    expect(product?.slug).toBe('macbook-air-13');
    expect(product?.dataFreshness).toBe('2026-11-02T07:13:52.000Z');
  });
});

const macbookTaxonomy: TaxonomyProduct = {
  name: 'MacBook Air 13',
  slug: 'macbook-air-13',
  description: 'Apple MacBook Air 13.',
  brand: 'Apple',
  category: 'Laptops',
};

describe('P0-2 taxonomy loader: unknown slug returns null (page 404s)', () => {
  it('returns null for a brand slug matching no row and no product', () => {
    expect(
      resolveTaxonomyPage({
        kind: 'brand',
        slug: 'no-such-brand',
        record: null,
        products: [macbookTaxonomy],
      }),
    ).toBeNull();
  });

  it('returns null for a category slug matching no row and no product', () => {
    expect(
      resolveTaxonomyPage({
        kind: 'category',
        slug: 'no-such-cat',
        record: null,
        products: [macbookTaxonomy],
      }),
    ).toBeNull();
  });

  it('still resolves a known brand slug, so the page stays 200', () => {
    const page = resolveTaxonomyPage({
      kind: 'brand',
      slug: 'apple',
      record: { name: 'Apple', slug: 'apple', description: null },
      products: [macbookTaxonomy],
    });
    expect(page?.slug).toBe('apple');
    expect(page?.products).toHaveLength(1);
  });
});

describe('A1/A2 store search links', () => {
  it('builds one link per directory store: 80 local + 4 global = 84', () => {
    expect(LOCAL_STORES).toHaveLength(80);
    expect(GLOBAL_STORES).toHaveLength(4);
    expect(ALL_SEARCH_STORES).toHaveLength(84);
    expect(buildStoreSearchLinks('Apple')).toHaveLength(84);
    // The audit arithmetic: 10 brands x 84 = 840, 6 categories x 84 = 504.
    expect(10 * buildStoreSearchLinks('Apple').length).toBe(840);
    expect(6 * buildStoreSearchLinks('Laptops').length).toBe(504);
  });

  it('links to each store\'s own search for the query, never a SmartBuy URL', () => {
    const links = buildStoreSearchLinks('Apple');
    for (const { searchUrl } of links) {
      expect(searchUrl.startsWith('https://')).toBe(true);
      expect(searchUrl).not.toContain('shahjahanaibuy');
      expect(searchUrl).toContain('Apple');
    }
  });

  it('reuses the verified search patterns (spot checks)', () => {
    const byKey = new Map(
      buildStoreSearchLinks('Apple').map((link) => [
        `${link.store.countryCode}-${link.store.slug}`,
        link.searchUrl,
      ]),
    );
    expect(byKey.get('PK-daraz')).toBe(
      'https://www.daraz.pk/catalog/?q=Apple',
    );
    expect(byKey.get('US-ebay')).toBe(
      'https://www.ebay.com/sch/i.html?_nkw=Apple',
    );
    expect(byKey.get('GLOBAL-amazon')).toBe(
      'https://www.amazon.com/s?k=Apple',
    );
    expect(byKey.get('IN-myntra')).toBe(
      'https://www.myntra.com/apple?rawQuery=Apple',
    );
  });

  it('URL-encodes multi-word queries', () => {
    const links = buildStoreSearchLinks('Home & Garden');
    expect(links).toHaveLength(84);
    const daraz = links.find(
      (link) =>
        link.store.countryCode === 'PK' && link.store.slug === 'daraz',
    );
    expect(daraz?.searchUrl).toBe(
      'https://www.daraz.pk/catalog/?q=Home%20%26%20Garden',
    );
  });

  it('returns no links for a blank query', () => {
    expect(buildStoreSearchLinks('')).toEqual([]);
    expect(buildStoreSearchLinks('   ')).toEqual([]);
  });
});
