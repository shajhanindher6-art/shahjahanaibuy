/**
 * Tests for the sample-laptop exclusion in getProducts
 * (services/products.ts).
 *
 * The 'sample-laptop' row is a database health-check row, not a real
 * product. Recommendations, bundles, gifts and the sustainability
 * page already exclude it; getProducts was the one leak, surfacing it
 * in the public products API and the /brands/* + /categories/* pages.
 * No DB, no network: the Supabase client is faked with the same
 * .from().select().is().neq().order().range() chain getProducts uses,
 * and the fake applies the recorded .neq() filter the way PostgREST
 * would — so the test proves the exclusion happens in the query
 * (keeping the exact count honest), not by post-filtering rows.
 */
import { describe, it, expect } from 'vitest';
import { getProducts } from '@/services/products';
import type { AnySupabaseClient } from '@/lib/supabase/types';

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
  data_freshness: 'fresh',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

const sampleLaptop: Row = {
  ...macbook,
  id: '2',
  name: 'Sample Laptop',
  slug: 'sample-laptop',
  description: 'Demo product for initial database health check',
  brand: 'Sample',
};

function fakeClient(rows: Row[]) {
  const neqCalls: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  const applyNeq = (all: Row[]) =>
    neqCalls.reduce(
      (acc, [column, value]) => acc.filter((r) => r[column] !== value),
      all
    );
  chain.from = () => chain;
  chain.select = () => chain;
  chain.is = () => chain;
  chain.neq = (column: string, value: unknown) => {
    neqCalls.push([column, value]);
    return chain;
  };
  chain.or = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.range = () => chain;
  chain.then = (resolve: (v: unknown) => void) => {
    const filtered = applyNeq(rows);
    resolve({ data: filtered, error: null, count: filtered.length });
  };
  return {
    client: { from: () => chain } as unknown as AnySupabaseClient,
    neqCalls,
  };
}

describe('getProducts excludes the sample-laptop health-check row', () => {
  it('never returns sample-laptop, and the total counts only real products', async () => {
    const { client } = fakeClient([macbook, sampleLaptop]);
    const result = await getProducts(client, { pageSize: 100 });
    expect(result.products.map((p) => p.slug)).toEqual(['macbook-air-13']);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('excludes it in the query via .neq(), not by filtering afterwards', async () => {
    const { client, neqCalls } = fakeClient([macbook, sampleLaptop]);
    await getProducts(client, { pageSize: 100 });
    expect(neqCalls).toContainEqual(['slug', 'sample-laptop']);
  });

  it('still returns real products when the sample row is absent', async () => {
    const { client } = fakeClient([macbook]);
    const result = await getProducts(client, { pageSize: 100 });
    expect(result.products.map((p) => p.slug)).toEqual(['macbook-air-13']);
    expect(result.total).toBe(1);
  });
});
