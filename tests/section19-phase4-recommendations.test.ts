/**
 * Section 19, Phase 4 (§12 #40–#45, #48) — getRecommendations unit
 * tests + the recommendation-feedback / personalization-consent
 * services + the export/deletion coverage for the two signal
 * tables.
 *
 * All service tests run against a mocked Supabase client (an
 * in-memory set of tables, in the style of
 * tests/section15-saved-searches.test.ts); no DB, no network. The
 * fake implements the query-builder surface the services use:
 * select/eq/neq/in/is/not/or/order/limit/insert/upsert/delete,
 * maybeSingle/single, and awaiting the chain directly.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { getRecommendations } from '@/services/ai-recommendations';
import {
  dismissRecommendation,
  getDismissedProductIds,
  listSavedRecommendations,
  saveRecommendation,
  undismissRecommendation,
} from '@/services/recommendation-feedback';
import {
  getPersonalizationOptOut,
  setPersonalizationOptOut,
} from '@/services/personalization-consent';
import { USER_DATA_TABLES } from '@/lib/account-deletion';
import {
  buildExportDocument,
  buildExportSection,
  exportNonEmptySections,
  exportTotalRows,
} from '@/lib/data-export';

// ---------------------------------------------------------------------------
// In-memory fake Supabase client
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface FakeDb {
  tables: Record<string, Row[]>;
  queried: string[];
  idCounter: number;
}

function productRow(partial: Partial<Row> & { id: string }): Row {
  return {
    name: 'Product',
    slug: partial.id,
    description: null,
    brand: null,
    category: null,
    image_url: null,
    gtin: null,
    confidence_score: 50,
    data_freshness: '2026-11-02T00:00:00.000Z',
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    view_count: 0,
    deleted_at: null,
    ...partial,
  };
}

let db: FakeDb;

function seedDb() {
  db = {
    tables: {
      products: [
        productRow({
          id: 'p-laptop',
          name: 'MacBook Air',
          slug: 'macbook-air',
          brand: 'Apple',
          category: 'Laptops',
          confidence_score: 90,
          view_count: 100,
        }),
        productRow({
          id: 'p-sony',
          name: 'Sony WH-1000XM5',
          slug: 'sony-wh-1000xm5',
          brand: 'Sony',
          category: 'Headphones',
          confidence_score: 80,
          view_count: 50,
        }),
        productRow({
          id: 'p-sony2',
          name: 'Sony WH-1000XM4',
          slug: 'sony-wh-1000xm4',
          brand: 'Sony',
          category: 'Headphones',
          confidence_score: 60,
          view_count: 5,
        }),
        productRow({
          id: 'p-apple2',
          name: 'iPad Air',
          slug: 'ipad-air',
          brand: 'Apple',
          category: 'Tablets',
          confidence_score: 60,
          view_count: 5,
        }),
        productRow({
          id: 'p-mouse',
          name: 'Logitech MX Master',
          slug: 'logitech-mx-master-3s',
          brand: 'Logitech',
          category: 'Mouse',
          confidence_score: 70,
          view_count: 10,
        }),
        productRow({
          id: 'p-sample',
          name: 'Sample Laptop',
          slug: 'sample-laptop',
          brand: 'Demo',
          category: 'Laptops',
          confidence_score: 99,
          view_count: 999,
        }),
      ],
      merchant_products: [
        { product_id: 'p-laptop', price: 999, compare_at_price: 1099, in_stock: true, deleted_at: null },
        { product_id: 'p-sony', price: 399, compare_at_price: 449, in_stock: true, deleted_at: null },
        { product_id: 'p-mouse', price: 99, compare_at_price: null, in_stock: true, deleted_at: null },
        { product_id: 'p-sony2', price: 249, compare_at_price: 299, in_stock: true, deleted_at: null },
        { product_id: 'p-apple2', price: 599, compare_at_price: null, in_stock: true, deleted_at: null },
      ],
      search_history: [],
      wishlists: [],
      wishlist_items: [],
      product_views: [],
      user_preferences: [],
      agent_memory: [],
    },
    queried: [],
    idCounter: 0,
  };
}

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private limitN: number | null = null;
  private op: 'select' | 'insert' | 'delete' | 'upsert' = 'select';
  private writeRow: Row | null = null;
  private conflictCol: string | null = null;

  constructor(
    private fake: FakeDb,
    private table: string
  ) {
    fake.queried.push(table);
  }

  select(): this {
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] === value);
    return this;
  }

  neq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] !== value);
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

  not(col: string, op: string, value: unknown): this {
    if (op === 'in' && typeof value === 'string') {
      const ids = value.replace(/^\(|\)$/g, '').split(',').filter(Boolean);
      this.filters.push((r) => !ids.includes(String(r[col])));
    }
    return this;
  }

  or(condition: string): this {
    const parts = condition.split(',').map((c) => {
      const m = /^(\w+)\.ilike\.%(.*)%$/.exec(c);
      return m ? { field: m[1], needle: m[2].toLowerCase() } : null;
    });
    this.filters.push((r) =>
      parts.some(
        (p) =>
          p !== null &&
          String(r[p.field] ?? '').toLowerCase().includes(p.needle)
      )
    );
    return this;
  }

  order(col: string, opts: { ascending: boolean }): this {
    this.orders.push({ col, asc: opts.ascending });
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  insert(row: Row): this {
    this.op = 'insert';
    this.writeRow = row;
    return this;
  }

  upsert(row: Row, opts?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.writeRow = row;
    this.conflictCol = opts?.onConflict ?? null;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  private run(): { data: Row[] | null; error: null } {
    const rows = this.fake.tables[this.table] ?? [];
    if (this.op === 'insert' && this.writeRow) {
      this.fake.idCounter += 1;
      const row: Row = {
        id: `fake-${this.fake.idCounter}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.writeRow,
      };
      rows.push(row);
      return { data: [row], error: null };
    }
    if (this.op === 'upsert' && this.writeRow) {
      const conflict = this.conflictCol;
      const existing =
        conflict !== null
          ? rows.find((r) => r[conflict] === this.writeRow?.[conflict])
          : undefined;
      if (existing) {
        Object.assign(existing, this.writeRow, { updated_at: new Date().toISOString() });
        return { data: [existing], error: null };
      }
      this.fake.idCounter += 1;
      const row: Row = {
        id: `fake-${this.fake.idCounter}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.writeRow,
      };
      rows.push(row);
      return { data: [row], error: null };
    }
    if (this.op === 'delete') {
      const kept = rows.filter((r) => !this.filters.every((f) => f(r)));
      this.fake.tables[this.table] = kept;
      return { data: null, error: null };
    }
    let out = rows.filter((r) => this.filters.every((f) => f(r)));
    // Apply sorts last-listed first (stable sort): the first .order()
    // call is the primary key, like Supabase.
    for (const { col, asc } of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => {
        const av = a[col] as number | string;
        const bv = b[col] as number | string;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return { data: out, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const { data } = this.run();
    return { data: data?.[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: null }> {
    const { data } = this.run();
    return { data: data?.[0] ?? null, error: null };
  }

  then(
    resolve: (value: { data: Row[] | null; error: null }) => void,
    reject: (reason: unknown) => void
  ): void {
    try {
      resolve(this.run());
    } catch (err) {
      reject(err);
    }
  }
}

function makeFakeClient(): unknown {
  return {
    from: (table: string) => new FakeQuery(db, table),
  };
}

const USER = 'user-1';

beforeEach(() => {
  seedDb();
});

// ---------------------------------------------------------------------------
// §12 #48 — getRecommendations: the 4 signals
// ---------------------------------------------------------------------------

describe('§12 #48 — getRecommendations: the 4 real-data signals', () => {
  it('seeds categories from search history and scores the brand/category match', async () => {
    db.tables.search_history = [{ user_id: USER, query: 'best laptop deals', created_at: '2026-11-12' }];
    const { recommendations, context } = await getRecommendations(
      makeFakeClient() as never,
      USER,
      10
    );
    expect(context.basedOn).toBe('search_history');
    expect(recommendations.map((r) => r.productId)).toContain('p-laptop');
    const laptop = recommendations.find((r) => r.productId === 'p-laptop');
    expect(laptop?.score).toBeGreaterThan(50);
    expect(laptop?.reason).toMatch(/Laptops/);
  });

  it('seeds brands from the wishlist and excludes wishlist products themselves', async () => {
    db.tables.wishlists = [{ id: 'w1', user_id: USER, name: 'My list' }];
    db.tables.wishlist_items = [{ id: 'wi1', wishlist_id: 'w1', product_id: 'p-sony' }];
    const { recommendations, context } = await getRecommendations(
      makeFakeClient() as never,
      USER,
      10
    );
    expect(context.basedOn).toBe('wishlist');
    // The wishlisted product itself is never recommended back;
    // the other Sony product is the kept match.
    expect(recommendations.map((r) => r.productId)).not.toContain('p-sony');
    expect(recommendations.map((r) => r.productId)).toContain('p-sony2');
  });

  it('seeds brands/categories from viewed products', async () => {
    db.tables.product_views = [{ user_id: USER, product_id: 'p-laptop', viewed_at: '2026-11-12' }];
    const { recommendations, context } = await getRecommendations(
      makeFakeClient() as never,
      USER,
      10
    );
    expect(context.basedOn).toBe('views');
    // The viewed product itself is excluded; the same-brand iPad is the kept match.
    expect(recommendations.map((r) => r.productId)).not.toContain('p-laptop');
    expect(recommendations.map((r) => r.productId)).toContain('p-apple2');
  });

  it('uses favourite brands/categories from preferences', async () => {
    db.tables.user_preferences = [
      {
        user_id: USER,
        favorite_brands: ['Sony'],
        favorite_categories: [],
        budget_min: null,
        budget_max: null,
      },
    ];
    const { recommendations, context } = await getRecommendations(
      makeFakeClient() as never,
      USER,
      10
    );
    expect(context.basedOn).toBe('preferences');
    expect(recommendations.map((r) => r.productId)).toContain('p-sony');
  });

  it('falls back to trending with no signals, and never recommends the sample laptop', async () => {
    const { recommendations, context } = await getRecommendations(
      makeFakeClient() as never,
      USER,
      10
    );
    expect(context.basedOn).toBe('trending');
    expect(recommendations.map((r) => r.productId)).not.toContain('p-sample');
    expect(recommendations[0].productId).toBe('p-laptop'); // highest view_count
  });
});

// ---------------------------------------------------------------------------
// §12 #40 — budget signal
// ---------------------------------------------------------------------------

describe('§12 #40 — budget_min/budget_max feed the recommendation engine', () => {
  it('drops over-budget products when an in-budget alternative exists', async () => {
    db.tables.search_history = [{ user_id: USER, query: 'laptop headphones', created_at: '2026-11-12' }];
    db.tables.user_preferences = [
      {
        user_id: USER,
        favorite_brands: [],
        favorite_categories: [],
        budget_min: null,
        budget_max: 500,
      },
    ];
    const { recommendations } = await getRecommendations(makeFakeClient() as never, USER, 10);
    const ids = recommendations.map((r) => r.productId);
    expect(ids).toContain('p-sony'); // $399, in budget
    expect(ids).not.toContain('p-laptop'); // $999, over budget
    const sony = recommendations.find((r) => r.productId === 'p-sony');
    expect(sony?.priceUsd).toBe(399);
    expect(sony?.reason).toMatch(/within your \$500\.00 budget/);
  });

  it('when nothing fits the budget, the over-budget pick stays — with the difference explained', async () => {
    db.tables.search_history = [{ user_id: USER, query: 'laptop', created_at: '2026-11-12' }];
    db.tables.user_preferences = [
      {
        user_id: USER,
        favorite_brands: [],
        favorite_categories: [],
        budget_min: null,
        budget_max: 500,
      },
    ];
    const { recommendations } = await getRecommendations(makeFakeClient() as never, USER, 10);
    expect(recommendations.map((r) => r.productId)).toContain('p-laptop');
    const laptop = recommendations.find((r) => r.productId === 'p-laptop');
    expect(laptop?.overBudgetByUsd).toBe(499);
    expect(laptop?.reason).toMatch(/\$499\.00 over your \$500\.00 budget/);
  });

  it('a product with no recorded price carries no budget claim either way', async () => {
    db.tables.merchant_products = db.tables.merchant_products.filter(
      (r) => r.product_id !== 'p-mouse'
    );
    db.tables.user_preferences = [
      {
        user_id: USER,
        favorite_brands: [],
        favorite_categories: ['Mouse'],
        budget_min: null,
        budget_max: 50,
      },
    ];
    const { recommendations } = await getRecommendations(makeFakeClient() as never, USER, 10);
    const mouse = recommendations.find((r) => r.productId === 'p-mouse');
    expect(mouse?.priceUsd).toBeNull();
    expect(mouse?.overBudgetByUsd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §12 #42 — feedback loop: dismiss → not recommended again
// ---------------------------------------------------------------------------

describe('§12 #42 — dismiss feedback feeds back into getRecommendations', () => {
  it('dismiss → the product is not recommended again', async () => {
    db.tables.search_history = [{ user_id: USER, query: 'headphones', created_at: '2026-11-12' }];
    const before = await getRecommendations(makeFakeClient() as never, USER, 10);
    expect(before.recommendations.map((r) => r.productId)).toContain('p-sony');

    const dismissed = await dismissRecommendation(makeFakeClient() as never, USER, 'p-sony');
    expect(dismissed?.dismissed).toBe(true);
    expect(await getDismissedProductIds(makeFakeClient() as never, USER)).toEqual(['p-sony']);

    const after = await getRecommendations(makeFakeClient() as never, USER, 10);
    expect(after.recommendations.map((r) => r.productId)).not.toContain('p-sony');
  });

  it('dismiss is idempotent, and undismiss makes the product recommendable again', async () => {
    await dismissRecommendation(makeFakeClient() as never, USER, 'p-sony');
    const again = await dismissRecommendation(makeFakeClient() as never, USER, 'p-sony');
    expect(again?.alreadyDismissed).toBe(true);
    expect(await undismissRecommendation(makeFakeClient() as never, USER, 'p-sony')).toBe(true);
    expect(await getDismissedProductIds(makeFakeClient() as never, USER)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §12 #41 — save recommendation
// ---------------------------------------------------------------------------

describe('§12 #41 — save recommendation', () => {
  it('saves a recommendation and lists it back with its product row', async () => {
    const saved = await saveRecommendation(makeFakeClient() as never, USER, 'p-mouse');
    expect(saved?.saved).toBe(true);
    const listed = await listSavedRecommendations(makeFakeClient() as never, USER);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ productId: 'p-mouse', name: 'Logitech MX Master', slug: 'logitech-mx-master-3s' });
    // Saving twice is a no-op, not a duplicate row.
    const twice = await saveRecommendation(makeFakeClient() as never, USER, 'p-mouse');
    expect(twice?.alreadySaved).toBe(true);
    expect(await listSavedRecommendations(makeFakeClient() as never, USER)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §12 #43 — personalization opt-out
// ---------------------------------------------------------------------------

describe('§12 #43 — personalization opt-out toggle', () => {
  it('opted-out user gets trending only, and no personal signal is read', async () => {
    db.tables.agent_memory = [
      { user_id: USER, preferences: { personalizationOptOut: true } },
    ];
    db.tables.search_history = [{ user_id: USER, query: 'laptop', created_at: '2026-11-12' }];
    db.tables.product_views = [{ user_id: USER, product_id: 'p-mouse', viewed_at: '2026-11-12' }];
    db.tables.user_preferences = [
      { user_id: USER, favorite_brands: ['Sony'], favorite_categories: [], budget_min: null, budget_max: null },
    ];
    const { recommendations, context } = await getRecommendations(
      makeFakeClient() as never,
      USER,
      10
    );
    expect(context.personalizationOptOut).toBe(true);
    expect(context.basedOn).toBe('trending');
    expect(recommendations[0].reason).toMatch(/personalisation is off/);
    // The opt-out is real: none of the personal-signal tables was read.
    for (const table of ['search_history', 'wishlists', 'wishlist_items', 'product_views', 'user_preferences']) {
      expect(db.queried).not.toContain(table);
    }
    expect(db.queried).toContain('agent_memory');
    expect(db.queried).toContain('products');
  });

  it('the toggle round-trips and preserves the other agent-memory preferences', async () => {
    db.tables.agent_memory = [
      { user_id: USER, preferences: { maxBudgetUsd: 500, categories: ['Laptops'] } },
    ];
    expect(await getPersonalizationOptOut(makeFakeClient() as never, USER)).toBe(false);
    const set = await setPersonalizationOptOut(makeFakeClient() as never, USER, true);
    expect(set).toEqual({ ok: true, optedOut: true, unavailable: false });
    expect(await getPersonalizationOptOut(makeFakeClient() as never, USER)).toBe(true);
    const stored = db.tables.agent_memory[0].preferences as Record<string, unknown>;
    expect(stored.maxBudgetUsd).toBe(500);
    expect(stored.categories).toEqual(['Laptops']);
    await setPersonalizationOptOut(makeFakeClient() as never, USER, false);
    expect(await getPersonalizationOptOut(makeFakeClient() as never, USER)).toBe(false);
  });

  it('a missing agent_memory row reads as opted-in (fail-safe default)', async () => {
    expect(await getPersonalizationOptOut(makeFakeClient() as never, USER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §12 #44 / #45 — export + deletion cover product_views + user_preferences
// ---------------------------------------------------------------------------

describe('§12 #44/#45 — product_views + user_preferences in export and deletion', () => {
  it('both tables are in the account-deletion list', () => {
    expect(USER_DATA_TABLES).toContain('product_views');
    expect(USER_DATA_TABLES).toContain('user_preferences');
  });

  it('the export document carries both sections and counts their rows', () => {
    const doc = buildExportDocument('u1', {
      profile: buildExportSection([]),
      wishlists: buildExportSection([]),
      wishlistItems: buildExportSection([]),
      alerts: buildExportSection([]),
      buyList: buildExportSection([]),
      savings: buildExportSection([]),
      searchHistory: buildExportSection([{ id: 's1' }]),
      referralLinks: buildExportSection([]),
      productViews: buildExportSection([{ id: 'v1' }, { id: 'v2' }]),
      userPreferences: buildExportSection([{ id: 'p1' }]),
    });
    expect(exportTotalRows(doc)).toBe(4);
    expect(exportNonEmptySections(doc)).toEqual(['searchHistory', 'productViews', 'userPreferences']);
  });
});
