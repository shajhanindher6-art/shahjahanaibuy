/**
 * Section 19, Phase 2 — AI summary freshness stamp + freshness
 * gate on interpretive verdicts (§12 #16/#20; task items 3 + 4).
 *
 * The summary already had real rows; it just never said when.
 * getAISummary now stamps every summary (fresh or cached) with
 * the product's real dataFreshness (priceAsOf — never a
 * fabricated timestamp) and a freshnessNote that qualifies the
 * verdict when the price is stale or its age is unknown. Fresh
 * generations also rewrite the verdict sentences themselves
 * ("was near its historical low at the last recorded check"
 * instead of "good time to buy" as a current claim).
 *
 * Stub Supabase client copied from
 * tests/section19-ai-summary-honesty.test.ts; product ids are
 * unique per test because getAISummary caches through swrGet.
 */

import { describe, expect, it } from 'vitest';
import { getAISummary } from '@/services/ai-summary';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import type { Product } from '@/types';

type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

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
    id: 'p19-summary-fresh',
    name: 'Test Widget',
    slug: 'test-widget',
    description: 'A test product.',
    brand: null,
    category: 'Gadgets',
    imageUrl: null,
    gtin: null,
    confidenceScore: 50,
    dataFreshness: daysAgo(2),
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as Product;
}

// Near-low price history: current $999 is the recorded low.
function nearLowHistory(productId: string): Row[] {
  return [
    { product_id: productId, price: 999, recorded_at: daysAgo(2) },
    { product_id: productId, price: 1099, recorded_at: daysAgo(20) },
  ];
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

describe('getAISummary — freshness stamp (§12 #16)', () => {
  it('stamps the real price-as-of date and no freshness note while the price is fresh', async () => {
    const freshDate = daysAgo(2);
    const summary = await getAISummary(
      stub({ price_history: nearLowHistory('p19-summary-stamp-fresh') }),
      product({ id: 'p19-summary-stamp-fresh', dataFreshness: freshDate })
    );
    expect(summary).not.toBeNull();
    expect(summary!.priceAsOf).toBe(freshDate);
    expect(summary!.freshnessNote).toBeNull();
    expect(summary!.createdAt).toBeTruthy();
    // Fresh price: the unqualified verdict is fine.
    expect(summary!.summary).toContain('good time to buy');
  });

  it('stamps a null price-as-of (never a fabricated date) when the product records none', async () => {
    const summary = await getAISummary(
      stub({ price_history: nearLowHistory('p19-summary-stamp-unknown') }),
      product({
        id: 'p19-summary-stamp-unknown',
        dataFreshness: null as unknown as string,
      })
    );
    expect(summary).not.toBeNull();
    expect(summary!.priceAsOf).toBeNull();
    expect(summary!.freshnessNote).toContain('Price age unknown');
  });
});

describe('getAISummary — freshness gate on interpretive verdicts (§12 #20)', () => {
  it('stale price: the verdict is past-tense + qualified, never "good time to buy" as a current claim', async () => {
    const staleDate = daysAgo(10);
    const summary = await getAISummary(
      stub({ price_history: nearLowHistory('p19-summary-gate-stale') }),
      product({ id: 'p19-summary-gate-stale', dataFreshness: staleDate })
    );
    expect(summary).not.toBeNull();
    expect(summary!.summary).toContain('was near its historical low at the last recorded check');
    expect(summary!.summary).toContain('10 days ago');
    expect(summary!.summary).not.toContain('making it a good time to buy');
    expect(summary!.freshnessNote).toContain('10 days ago');
    expect(summary!.freshnessNote).toContain('may be out of date');
    expect(summary!.priceAsOf).toBe(staleDate);
    // The near-low pro carries the staleness with it.
    expect(
      summary!.pros.some((p) => p.includes('price last checked 10 days ago'))
    ).toBe(true);
  });

  it('unknown age: the verdict is qualified, not stated as current', async () => {
    const summary = await getAISummary(
      stub({ price_history: nearLowHistory('p19-summary-gate-unknown') }),
      product({
        id: 'p19-summary-gate-unknown',
        dataFreshness: null as unknown as string,
      })
    );
    expect(summary).not.toBeNull();
    expect(summary!.summary).toContain('was near its historical low at the last recorded check');
    expect(summary!.summary).toContain('Price age unknown');
    expect(summary!.summary).not.toContain('making it a good time to buy');
    expect(
      summary!.pros.some((p) => p.includes('price age unknown'))
    ).toBe(true);
  });

  it('cached row: stored verdict text is qualified at read time once the price has gone stale', async () => {
    const staleDate = daysAgo(10);
    const summary = await getAISummary(
      stub({
        ai_summaries: [
          {
            id: 's-cached',
            product_id: 'p19-summary-gate-cached',
            summary: 'The Test Widget is a Gadgets. The current price is near its historical low, making it a good time to buy.',
            pros: ['Currently near its lowest recorded price'],
            cons: ['No drawbacks identified in the available data — no reviews recorded for this product'],
            alternatives: [],
            created_at: daysAgo(9),
            expires_at: daysAgo(-5),
          },
        ],
      }),
      product({ id: 'p19-summary-gate-cached', dataFreshness: staleDate })
    );
    expect(summary).not.toBeNull();
    // The stored text is served as written (it is a cached row),
    // but the stamp + note reconcile it with the stale price.
    expect(summary!.priceAsOf).toBe(staleDate);
    expect(summary!.freshnessNote).toContain('10 days ago');
    expect(summary!.freshnessNote).toContain('may be out of date');
  });
});
