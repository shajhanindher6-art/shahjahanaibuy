import { describe, expect, it } from 'vitest';
import {
  effectiveBudgetUsd,
  huntMatchDedupeKey,
  huntMatchesCandidate,
  isDemoSlug,
  isMissingTableError,
  lowestRecordedPrice,
  runHuntForUser,
  runHuntsForConsentedUsers,
  type HuntCandidate,
} from '@/lib/agent-hunt';

// ---------------------------------------------------------------------------
// Minimal fake Supabase client — implements only the query-chain methods
// lib/agent-hunt.ts uses (select/eq/is/in/not/order/limit/maybeSingle/
// insert().select() / update().eq() / awaitable queries).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private sortKey: string | null = null;
  private sortAsc = true;
  private limitN: number | null = null;
  private static counter = 0;

  constructor(
    private table: Row[],
    private tableName: string,
    private missing: Set<string>
  ) {}

  select(): this {
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push((r) => (val === null ? r[col] == null : r[col] === val));
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  not(col: string, op: string, val: unknown): this {
    this.filters.push((r) => (op === 'is' ? r[col] !== val : true));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.sortKey = col;
    this.sortAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  private rows(): Row[] {
    let out = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.sortKey) {
      const key = this.sortKey;
      const asc = this.sortAsc;
      out = [...out].sort((a, b) => {
        const av = a[key] as number | string;
        const bv = b[key] as number | string;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }
  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const rows = this.rows();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  single(): Promise<{ data: Row | null; error: null }> {
    const rows = this.rows();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  insert(rows: Row[]): { select: () => Promise<{ data: Row[]; error: null }> } {
    const inserted = rows.map((r) => {
      FakeQuery.counter += 1;
      return {
        id: `fake-${FakeQuery.counter}`,
        matched_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        ...r,
      };
    });
    this.table.push(...inserted);
    return { select: () => Promise.resolve({ data: inserted, error: null }) };
  }
  update(patch: Row): { eq: () => Promise<{ data: Row[]; error: null }> } {
    const rows = this.rows();
    for (const r of rows) Object.assign(r, patch);
    return { eq: () => Promise.resolve({ data: rows, error: null }) };
  }
  then(
    resolve: (v: { data: Row[] | null; error: { code: string; message: string } | null }) => void,
    reject?: (e: unknown) => void
  ): Promise<{ data: Row[] | null; error: { code: string; message: string } | null }> {
    const result: Promise<{ data: Row[] | null; error: { code: string; message: string } | null }> =
      this.missing.has(this.tableName)
        ? Promise.resolve({
            data: null,
            error: { code: 'PGRST205', message: 'Could not find the table' },
          })
        : Promise.resolve({ data: this.rows(), error: null });
    result.then(resolve, reject);
    return result;
  }
}

function fakeSupabase(db: Record<string, Row[]>, missing: string[] = []) {
  const missingSet = new Set(missing);
  return {
    from(table: string) {
      if (!db[table]) db[table] = [];
      return new FakeQuery(db[table], table, missingSet);
    },
  };
}

function seedDb(): Record<string, Row[]> {
  return {
    agent_memory: [
      {
        user_id: 'user-1',
        preferences: { maxBudgetUsd: 1000, categories: ['Laptops'], preferredBrands: [] },
        consent_granted_at: '2026-11-01T00:00:00Z',
      },
      { user_id: 'user-2', preferences: {}, consent_granted_at: null },
    ],
    agent_rules: [
      { user_id: 'user-1', product_id: 'prod-dell', target_price_usd: 1100, active: true },
    ],
    agent_hunts: [
      {
        id: 'hunt-1',
        user_id: 'user-1',
        category: 'Laptops',
        max_budget_usd: 1000,
        preferred_brands: null,
        active: true,
        last_run_at: null,
        created_at: '2026-11-01T00:00:00Z',
      },
      {
        id: 'hunt-2',
        user_id: 'user-1',
        category: null,
        max_budget_usd: 200,
        preferred_brands: ['Sony'],
        active: true,
        last_run_at: null,
        created_at: '2026-11-02T00:00:00Z',
      },
      {
        id: 'hunt-3',
        user_id: 'user-1',
        category: 'Laptops',
        max_budget_usd: 1300,
        preferred_brands: null,
        active: false,
        last_run_at: null,
        created_at: '2026-11-03T00:00:00Z',
      },
    ],
    hunt_matches: [],
    products: [
      { id: 'prod-mac', slug: 'macbook-air', name: 'MacBook Air', brand: 'Apple', category: 'Laptops', deleted_at: null, created_at: '2026-10-01T00:00:00Z' },
      { id: 'prod-dell', slug: 'dell-xps', name: 'Dell XPS', brand: 'Dell', category: 'Laptops', deleted_at: null, created_at: '2026-10-02T00:00:00Z' },
      { id: 'prod-sony', slug: 'sony-headphones', name: 'Sony Headphones', brand: 'Sony', category: 'Headphones', deleted_at: null, created_at: '2026-10-03T00:00:00Z' },
      { id: 'prod-sample', slug: 'sample-laptop', name: 'Sample Laptop', brand: 'Sample', category: 'Laptops', deleted_at: null, created_at: '2026-10-04T00:00:00Z' },
      { id: 'prod-watch', slug: 'watch-x', name: 'Watch X', brand: 'Acme', category: 'Wearables', deleted_at: null, created_at: '2026-10-05T00:00:00Z' },
      { id: 'prod-noprice', slug: 'phone-z', name: 'Phone Z', brand: 'Zed', category: 'Phones', deleted_at: null, created_at: '2026-10-06T00:00:00Z' },
    ],
    merchant_products: [
      { product_id: 'prod-mac', price: 999, in_stock: true, deleted_at: null },
      { product_id: 'prod-dell', price: 1200, in_stock: true, deleted_at: null },
      // Out-of-stock cheap listing: must NEVER produce a match.
      { product_id: 'prod-dell', price: 500, in_stock: false, deleted_at: null },
      { product_id: 'prod-sony', price: 150, in_stock: true, deleted_at: null },
      { product_id: 'prod-sample', price: 10, in_stock: true, deleted_at: null },
    ],
    price_history: [
      // Fallback price for a product with no merchant listing at all.
      { product_id: 'prod-watch', price: 80, availability: 'in_stock', recorded_at: '2026-11-09T00:00:00Z' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('isDemoSlug', () => {
  it('excludes the sample laptop and nothing else', () => {
    expect(isDemoSlug('sample-laptop')).toBe(true);
    expect(isDemoSlug('macbook-air')).toBe(false);
  });
});

describe('huntMatchesCandidate', () => {
  const mac: HuntCandidate = {
    productId: 'prod-mac',
    slug: 'macbook-air',
    name: 'MacBook Air',
    brand: 'Apple',
    category: 'Laptops',
    lowestPriceUsd: 999,
  };

  it('matches a real recorded price at or under budget', () => {
    expect(huntMatchesCandidate(mac, { maxBudgetUsd: 999 })).toBe(true);
    expect(huntMatchesCandidate(mac, { maxBudgetUsd: 1000 })).toBe(true);
    expect(huntMatchesCandidate(mac, { maxBudgetUsd: 998 })).toBe(false);
  });

  it('never matches an unpriced product', () => {
    expect(huntMatchesCandidate({ ...mac, lowestPriceUsd: null }, { maxBudgetUsd: 1000 })).toBe(false);
    expect(huntMatchesCandidate({ ...mac, lowestPriceUsd: 0 }, { maxBudgetUsd: 1000 })).toBe(false);
  });

  it('never matches the demo product, even at $10', () => {
    const demo: HuntCandidate = { ...mac, slug: 'sample-laptop', lowestPriceUsd: 10 };
    expect(huntMatchesCandidate(demo, { maxBudgetUsd: 1000 })).toBe(false);
  });

  it('enforces stated category and brand filters (case-insensitive)', () => {
    expect(huntMatchesCandidate(mac, { maxBudgetUsd: 1000, categories: ['laptops'] })).toBe(true);
    expect(huntMatchesCandidate(mac, { maxBudgetUsd: 1000, categories: ['Phones'] })).toBe(false);
    expect(huntMatchesCandidate(mac, { maxBudgetUsd: 1000, preferredBrands: ['apple'] })).toBe(true);
    expect(huntMatchesCandidate(mac, { maxBudgetUsd: 1000, preferredBrands: ['Dell'] })).toBe(false);
    // Empty constraint lists mean "no constraint".
    expect(huntMatchesCandidate(mac, { maxBudgetUsd: 1000, categories: [], preferredBrands: [] })).toBe(true);
  });
});

describe('effectiveBudgetUsd', () => {
  it('takes the strictest stated budget', () => {
    expect(effectiveBudgetUsd({ maxBudgetUsd: 1000 }, { maxBudgetUsd: 800 }, 900)).toBe(800);
    expect(effectiveBudgetUsd({ maxBudgetUsd: null }, {}, 750)).toBe(750);
    expect(effectiveBudgetUsd({}, { maxBudgetUsd: 500 }, null)).toBe(500);
  });

  it('returns null when nothing is stated', () => {
    expect(effectiveBudgetUsd({}, {}, null)).toBeNull();
    expect(effectiveBudgetUsd({ maxBudgetUsd: 0 }, { maxBudgetUsd: -5 }, 0)).toBeNull();
  });
});

describe('lowestRecordedPrice', () => {
  it('returns the lowest finite positive price, or null', () => {
    expect(lowestRecordedPrice([1200, 999, 1500])).toBe(999);
    expect(lowestRecordedPrice([null, undefined, 0, -5])).toBeNull();
    expect(lowestRecordedPrice([])).toBeNull();
    expect(lowestRecordedPrice([NaN, 42])).toBe(42);
  });
});

describe('isMissingTableError', () => {
  it('recognises 42P01, PGRST205, and "does not exist"', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTableError({ message: 'relation "x" does not exist' })).toBe(true);
    expect(isMissingTableError({ code: '23505' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe('huntMatchDedupeKey', () => {
  it('is stable and distinguishes price', () => {
    expect(huntMatchDedupeKey('h', 'p', 999)).toBe(huntMatchDedupeKey('h', 'p', 999));
    expect(huntMatchDedupeKey('h', 'p', 999)).not.toBe(huntMatchDedupeKey('h', 'p', 998));
  });
});

// ---------------------------------------------------------------------------
// Runner (fake Supabase)
// ---------------------------------------------------------------------------

describe('runHuntForUser', () => {
  it('matches only recorded in-stock prices within budget and category', async () => {
    const db = seedDb();
    const supabase = fakeSupabase(db) as never;
    const result = await runHuntForUser(supabase, 'user-1');

    expect(result.huntsEnabled).toBe(true);
    // hunt-3 is inactive and must not run.
    expect(result.huntsRun).toBe(2);
    // hunt-1 (Laptops ≤ $1000): MacBook $999 only — Dell $1200 is over
    // budget, its $500 listing is out of stock, sample-laptop excluded.
    // hunt-2 (Sony ≤ $200): Sony headphones $150.
    expect(result.matches).toHaveLength(2);
    const slugs = result.matches.map((m) => m.productSlug).sort();
    expect(slugs).toEqual(['macbook-air', 'sony-headphones']);
    expect(db.hunt_matches).toHaveLength(2);
  });

  it('dedupes: a second run at the same prices creates no new matches', async () => {
    const db = seedDb();
    const supabase = fakeSupabase(db) as never;
    const first = await runHuntForUser(supabase, 'user-1');
    expect(first.matches).toHaveLength(2);
    const second = await runHuntForUser(supabase, 'user-1');
    expect(second.matches).toHaveLength(0);
    expect(db.hunt_matches).toHaveLength(2);
  });

  it('uses the price_history fallback for products with no merchant listing', async () => {
    const db = seedDb();
    // A hunt with no category/brand filter and a $100 budget: only the
    // watch ($80 via price_history) qualifies.
    db.agent_hunts = [
      {
        id: 'hunt-watch',
        user_id: 'user-1',
        category: null,
        max_budget_usd: 100,
        preferred_brands: null,
        active: true,
        last_run_at: null,
        created_at: '2026-11-01T00:00:00Z',
      },
    ];
    db.agent_memory[0].preferences = {};
    const supabase = fakeSupabase(db) as never;
    const result = await runHuntForUser(supabase, 'user-1');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].productSlug).toBe('watch-x');
    expect(result.matches[0].matchedPriceUsd).toBe(80);
  });

  it('returns an empty, disabled result when migration 033 has not run', async () => {
    const db = seedDb();
    const supabase = fakeSupabase(db, ['agent_hunts']) as never;
    const result = await runHuntForUser(supabase, 'user-1');
    expect(result).toEqual({ huntsRun: 0, matches: [], huntsEnabled: false });
  });

  it('returns no matches for a user with no active hunts', async () => {
    const db = seedDb();
    const supabase = fakeSupabase(db) as never;
    const result = await runHuntForUser(supabase, 'user-2');
    expect(result).toEqual({ huntsRun: 0, matches: [], huntsEnabled: true });
  });
});

describe('runHuntsForConsentedUsers', () => {
  it('runs only for users with consent_granted_at set', async () => {
    const db = seedDb();
    // user-2 has no consent; give them an active hunt that must NOT run.
    db.agent_hunts.push({
      id: 'hunt-user2',
      user_id: 'user-2',
      category: null,
      max_budget_usd: 5000,
      preferred_brands: null,
      active: true,
      last_run_at: null,
      created_at: '2026-11-01T00:00:00Z',
    });
    const supabase = fakeSupabase(db) as never;
    const result = await runHuntsForConsentedUsers(supabase);
    expect(result.usersChecked).toBe(1);
    expect(result.huntsRun).toBe(2);
    expect(result.matchesCreated).toBe(2);
    expect(result.huntsEnabled).toBe(true);
    expect(db.hunt_matches.every((m) => m.user_id === 'user-1')).toBe(true);
  });

  it('fail-safes when the tables do not exist yet', async () => {
    const db = seedDb();
    const supabase = fakeSupabase(db, ['agent_memory']) as never;
    const result = await runHuntsForConsentedUsers(supabase);
    expect(result).toEqual({ usersChecked: 0, huntsRun: 0, matchesCreated: 0, huntsEnabled: false });
  });
});
