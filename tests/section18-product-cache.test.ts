/**
 * Section 18, Phase 2 — product-page fetch + review/homepage query
 * tests (audit §1 #20/#66/#67, §12 items 26, 27, 28).
 *
 * - Item 26: `getProductSeo` ran the merchant + review queries 2×
 *   per request (generateMetadata + page body). The cached wrappers
 *   (`getCachedMerchantProducts`, `getCachedReviewSummary`) must
 *   hit the DB once for two calls in one request.
 * - Item 27: `getReviewSummary` pulled up to 10,000 rows and
 *   aggregated in JS. It must now aggregate in Postgres (five
 *   `head: true` COUNT queries, zero rows transferred) with
 *   identical numbers.
 * - Item 28: the homepage strip did 1 + 6 `price_history` queries.
 *   `getLatestPrices` must do exactly one `.in()` query for the
 *   whole strip.
 *
 * The fake client is a small query engine (select/eq/is/in/order/
 * limit/maybeSingle/single + head-counts), recording every query so
 * the tests can count DB round trips per table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCachedMerchantProducts } from '@/services/commerce';
import {
  getReviewSummary,
  getCachedReviewSummary,
} from '@/services/reviews';
import { getLatestPrices } from '@/services/price-history';

type Row = Record<string, unknown>;

interface FakeTable {
  rows: Row[];
  selectError?: { code?: string; message: string };
}

const fakeDb = {
  tables: {} as Record<string, FakeTable>,
  queries: [] as Array<{ table: string; cols?: string; head?: boolean }>,
  fromCalls: {} as Record<string, number>,
};

function seedTable(name: string, rows: Row[] = [], opts: Partial<FakeTable> = {}): void {
  fakeDb.tables[name] = { rows: rows.map((r) => ({ ...r })), ...opts };
}

function resetFakeDb(): void {
  fakeDb.tables = {};
  fakeDb.queries = [];
  fakeDb.fromCalls = {};
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;
  private selectCols?: string;
  private selectOpts?: { count?: string; head?: boolean };

  constructor(private readonly table: string) {}

  select(cols?: string, opts?: { count?: string; head?: boolean }): this {
    this.selectCols = cols;
    this.selectOpts = opts;
    fakeDb.queries.push({ table: this.table, cols, head: opts?.head });
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  in(col: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  is(col: string, value: unknown): this {
    this.filters.push((r) => (value === null ? r[col] == null : r[col] === value));
    return this;
  }
  order(col: string, opts: { ascending: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts.ascending;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  single(): this {
    this.wantSingle = true;
    return this;
  }
  maybeSingle(): this {
    this.wantMaybeSingle = true;
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: unknown; count?: number }> {
    const table = fakeDb.tables[this.table];
    if (!table) {
      return { data: null, error: { code: 'PGRST205', message: `Could not find the table '${this.table}'` } };
    }
    if (table.selectError) return { data: null, error: table.selectError };
    let rows = table.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.selectOpts?.head) {
      // COUNT query: Postgres returns the count, zero rows.
      return { data: [], error: null, count: rows.length };
    }
    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      rows = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        // Numeric compare for numbers (Postgres sorts numerically;
        // a string compare would order 100 before 90).
        if (typeof av === 'number' && typeof bv === 'number') {
          return asc ? av - bv : bv - av;
        }
        const as = String(av ?? '');
        const bs = String(bv ?? '');
        return asc ? (as < bs ? -1 : as > bs ? 1 : 0) : as > bs ? -1 : as < bs ? 1 : 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantMaybeSingle) return { data: rows[0] ?? null, error: null };
    if (this.wantSingle) {
      return rows.length === 0
        ? { data: null, error: { code: 'PGRST116', message: '0 rows' } }
        : { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }
}

const fakeClient = {
  from: (table: string) => {
    fakeDb.fromCalls[table] = (fakeDb.fromCalls[table] ?? 0) + 1;
    return new FakeQuery(table);
  },
} as unknown as Parameters<typeof getReviewSummary>[0];

function merchantRow(overrides: Row = {}): Row {
  return {
    id: 'mp-1',
    product_id: 'prod-1',
    merchant_id: 'm-1',
    merchant_sku: null,
    price: 999,
    compare_at_price: null,
    currency_id: null,
    availability: 'in_stock',
    url: 'https://example.com/p1',
    shipping_cost: null,
    shipping_days: null,
    in_stock: true,
    stock_quantity: null,
    last_synced_at: null,
    price_verification_status: 'unverified',
    price_source: 'manual',
    price_verified_at: null,
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetFakeDb();
});

// ---------------------------------------------------------------------------
// Item 27 — review summary aggregates in Postgres
// ---------------------------------------------------------------------------

describe('getReviewSummary DB aggregate (item 27)', () => {
  it('returns the same numbers as the old row-pull, from counts only', async () => {
    seedTable('reviews', [
      { product_id: 'p1', rating: 5, deleted_at: null },
      { product_id: 'p1', rating: 5, deleted_at: null },
      { product_id: 'p1', rating: 4, deleted_at: null },
      { product_id: 'p1', rating: 3, deleted_at: null },
      { product_id: 'p1', rating: 5, deleted_at: null },
      { product_id: 'p1', rating: 1, deleted_at: null },
      // Other product + soft-deleted rows must not count.
      { product_id: 'p2', rating: 5, deleted_at: null },
      { product_id: 'p1', rating: 5, deleted_at: '2026-11-01T00:00:00Z' },
    ]);
    const summary = await getReviewSummary(fakeClient, 'p1');
    expect(summary.totalReviews).toBe(6);
    expect(summary.ratingDistribution).toEqual({ 1: 1, 2: 0, 3: 1, 4: 1, 5: 3 });
    // (5+5+4+3+5+1)/6 = 23/6.
    expect(summary.averageRating).toBeCloseTo(23 / 6, 10);
  });

  it('transfers zero rows — five head:true COUNT queries, no row pull', async () => {
    seedTable('reviews', [
      { product_id: 'p1', rating: 5, deleted_at: null },
      { product_id: 'p1', rating: 4, deleted_at: null },
    ]);
    await getReviewSummary(fakeClient, 'p1');
    const reviewQueries = fakeDb.queries.filter((q) => q.table === 'reviews');
    expect(reviewQueries).toHaveLength(5);
    expect(reviewQueries.every((q) => q.head === true)).toBe(true);
    // No unbounded row pull: the old `.limit(10000)` select is gone.
    expect(fakeDb.queries.some((q) => q.cols === 'rating')).toBe(false);
  });

  it('returns the zeroed summary when a count query fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      seedTable('reviews', [], {
        selectError: { code: '42P01', message: 'relation does not exist' },
      });
      const summary = await getReviewSummary(fakeClient, 'p1');
      expect(summary).toEqual({
        averageRating: 0,
        totalReviews: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns zeroes for a product with no reviews', async () => {
    seedTable('reviews', []);
    const summary = await getReviewSummary(fakeClient, 'p-nope');
    expect(summary.totalReviews).toBe(0);
    expect(summary.averageRating).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Item 26 — one DB fetch per request, not two
// ---------------------------------------------------------------------------

describe('product-page cached fetches (item 26)', () => {
  it('getCachedMerchantProducts hits merchant_products once for two calls', async () => {
    seedTable('merchant_products', [
      merchantRow({ id: 'mp-a', product_id: 'prod-cache-a', price: 100 }),
      merchantRow({ id: 'mp-b', product_id: 'prod-cache-a', price: 90 }),
    ]);
    const first = await getCachedMerchantProducts(fakeClient, 'prod-cache-a');
    const second = await getCachedMerchantProducts(fakeClient, 'prod-cache-a');
    expect(first).toHaveLength(2);
    expect(first[0]?.price).toBe(90); // cheapest first, as before
    expect(second).toEqual(first);
    expect(fakeDb.fromCalls['merchant_products']).toBe(1);
  });

  it('getCachedReviewSummary hits reviews once for two calls', async () => {
    seedTable('reviews', [
      { product_id: 'prod-cache-b', rating: 5, deleted_at: null },
      { product_id: 'prod-cache-b', rating: 4, deleted_at: null },
    ]);
    const first = await getCachedReviewSummary(fakeClient, 'prod-cache-b');
    const second = await getCachedReviewSummary(fakeClient, 'prod-cache-b');
    expect(first.totalReviews).toBe(2);
    expect(second).toEqual(first);
    // Five COUNT queries on the first call, zero on the second.
    expect(fakeDb.queries.filter((q) => q.table === 'reviews')).toHaveLength(5);
  });

  it('a different product is a cache miss, not a stale hit', async () => {
    seedTable('merchant_products', [
      merchantRow({ id: 'mp-c', product_id: 'prod-cache-c1', price: 10 }),
      merchantRow({ id: 'mp-d', product_id: 'prod-cache-c2', price: 20 }),
    ]);
    await getCachedMerchantProducts(fakeClient, 'prod-cache-c1');
    const other = await getCachedMerchantProducts(fakeClient, 'prod-cache-c2');
    expect(other).toHaveLength(1);
    expect(other[0]?.price).toBe(20);
    expect(fakeDb.fromCalls['merchant_products']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Item 28 — homepage strip, one query
// ---------------------------------------------------------------------------

describe('getLatestPrices single query (item 28)', () => {
  it('fetches the whole strip in one price_history query', async () => {
    seedTable('price_history', [
      { product_id: 'h1', price: 10, recorded_at: '2026-11-10T00:00:00Z' },
      { product_id: 'h1', price: 12, recorded_at: '2026-11-11T00:00:00Z' },
      { product_id: 'h2', price: 20, recorded_at: '2026-11-10T00:00:00Z' },
      { product_id: 'h3', price: 30, recorded_at: '2026-11-09T00:00:00Z' },
      { product_id: 'other', price: 99, recorded_at: '2026-11-12T00:00:00Z' },
    ]);
    const prices = await getLatestPrices(fakeClient, ['h1', 'h2', 'h3', 'h-missing']);
    expect(fakeDb.fromCalls['price_history']).toBe(1);
    expect(fakeDb.queries.filter((q) => q.table === 'price_history')).toHaveLength(1);
    expect(prices.get('h1')).toBe(12); // newest wins
    expect(prices.get('h2')).toBe(20);
    expect(prices.get('h3')).toBe(30);
    expect(prices.has('h-missing')).toBe(false); // "Price not listed"
    expect(prices.has('other')).toBe(false); // not in the strip
  });

  it('returns an empty map when the query fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      seedTable('price_history', [], {
        selectError: { code: '42P01', message: 'relation does not exist' },
      });
      const prices = await getLatestPrices(fakeClient, ['h1']);
      expect(prices.size).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
