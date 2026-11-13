/**
 * Section 19, Phase 0 (§12 #15) — ai-summary honest fallbacks.
 *
 * With 0 reviews + 0 specs live, the old fallbacks invented
 * quality claims: "from a reputable brand", "Product meets
 * quality standards", "No significant drawbacks identified from
 * available data". These tests pin the honest replacements and
 * assert the invented claims never appear.
 *
 * The Supabase client is a small chainable stub (thenable
 * builder with eq / neq / in / is / gt / order / limit /
 * maybeSingle / insert), seeded per test. Product ids are unique
 * per test because getAISummary caches through swrGet (in-memory,
 * keyed by product id).
 */

import { describe, expect, it } from 'vitest';
import { getAISummary } from '@/services/ai-summary';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import type { Product } from '@/types';

type Row = Record<string, unknown>;

function createStubSupabase(tables: Record<string, Row[]>): AnySupabaseClient {
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      neq(col: string, val: unknown) {
        rows = rows.filter((r) => r[col] !== val);
        return builder;
      },
      gt(col: string, val: unknown) {
        rows = rows.filter((r) => String(r[col]) > String(val));
        return builder;
      },
      in(col: string, vals: unknown[]) {
        rows = rows.filter((r) => vals.includes(r[col]));
        return builder;
      },
      is(col: string, val: unknown) {
        rows = rows.filter((r) =>
          val === null ? r[col] === null || r[col] === undefined : r[col] === val
        );
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        const asc = opts?.ascending !== false;
        rows = [...rows].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          if (typeof av === 'number' && typeof bv === 'number') {
            return asc ? av - bv : bv - av;
          }
          return asc
            ? String(av).localeCompare(String(bv))
            : String(bv).localeCompare(String(av));
        });
        return builder;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      insert() {
        return Promise.resolve({ data: null, error: null });
      },
      delete() {
        return builder;
      },
      then(
        onFulfilled?: (value: { data: Row[]; error: null; count: number }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(
          onFulfilled,
          onRejected
        );
      },
    };
    return builder;
  };
  return { from: (table: string) => query(table) } as unknown as AnySupabaseClient;
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-no-data',
    name: 'Test Widget',
    slug: 'test-widget',
    description: 'A test product.',
    brand: null,
    category: 'Gadgets',
    imageUrl: null,
    gtin: null,
    confidenceScore: 50,
    dataFreshness: '2026-11-02T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as Product;
}

function stub(overrides: Record<string, Row[]> = {}): AnySupabaseClient {
  return createStubSupabase({
    ai_summaries: [],
    reviews: [],
    product_attributes: [],
    product_variants: [],
    price_history: [],
    products: [],
    ...overrides,
  });
}

describe('getAISummary — honest fallbacks with no data', () => {
  it('never claims a reputable brand, quality standards, or a clean bill of health', async () => {
    const summary = await getAISummary(
      stub(),
      // Description present on purpose: a missing description adds
      // its own honest con ("Limited product description
      // available"), which would mask the empty-cons fallback this
      // test pins.
      product({ id: 'p19-summary-empty', brand: null })
    );
    expect(summary).not.toBeNull();
    expect(summary!.summary).not.toContain('reputable brand');
    expect(summary!.summary).toContain('Test Widget is a Gadgets.');
    expect(summary!.pros).toContain(
      'Not enough data to assess quality — no reviews or specifications recorded for this product'
    );
    expect(summary!.pros).not.toContain('Product meets quality standards');
    expect(summary!.cons).toContain(
      'No drawbacks identified in the available data — no reviews recorded for this product'
    );
    expect(summary!.cons).not.toContain('No significant drawbacks identified from available data');
  });

  it('uses the real brand when one is recorded, and real review evidence when it exists', async () => {
    const summary = await getAISummary(
      stub({
        reviews: [
          { product_id: 'p19-summary-real', rating: 5 },
          { product_id: 'p19-summary-real', rating: 4 },
        ],
      }),
      product({ id: 'p19-summary-real', brand: 'Acme' })
    );
    expect(summary).not.toBeNull();
    expect(summary!.summary).toContain('from Acme');
    expect(summary!.summary).toContain('average rating of 4.5 stars from 2 reviews');
    expect(summary!.pros).toContain('From established brand: Acme');
    expect(summary!.pros).toContain('High customer satisfaction (4.5 stars)');
    expect(summary!.pros).not.toContain('Not enough data to assess quality');
    expect(summary!.summary).not.toContain('reputable brand');
  });

  it('says "no drawbacks identified" without claiming "no reviews" when reviews do exist', async () => {
    const reviews = Array.from({ length: 12 }, (_, i) => ({
      product_id: 'p19-summary-reviewed',
      rating: i % 2 === 0 ? 5 : 4,
    }));
    const summary = await getAISummary(
      stub({
        reviews,
        price_history: [
          { product_id: 'p19-summary-reviewed', price: 1099, recorded_at: '2026-10-20T00:00:00.000Z' },
          { product_id: 'p19-summary-reviewed', price: 999, recorded_at: '2026-11-02T00:00:00.000Z' },
        ],
      }),
      product({ id: 'p19-summary-reviewed', brand: 'Acme' })
    );
    expect(summary).not.toBeNull();
    expect(summary!.cons).toContain('No drawbacks identified in the available data');
    expect(summary!.cons).not.toContain('no reviews recorded');
    expect(summary!.cons).not.toContain('No significant drawbacks identified');
  });
});
