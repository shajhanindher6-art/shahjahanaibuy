/**
 * Section 18, Phase 2 — database reliability (items 16–21, 23).
 *
 * Covers, against mocked Supabase clients (no DB, no network):
 * - Item 16: public-product helper (lib/public-products.ts) —
 *   deleted/pending products are excluded from the extension/price
 *   and gifts reads; 42703 retry when migration 045 is unapplied;
 *   both routes use the helper and no longer query `products`
 *   directly.
 * - Item 17: alert-checker batch (services/alert-checker.ts) —
 *   one price_history query + one merchant_products query for N
 *   alerts, not N fetches; latest history wins, merchant fallback
 *   covers products without history.
 * - Items 18/19/20: SQL-text assertions for migrations 051 (12
 *   user-table FKs to auth.users), 052 (unique partial index,
 *   one running refresh run), 053 (atomic quota-increment RPC).
 * - Item 20: quota RPC path (called when present, count from the
 *   RPC, no legacy reads) and fallback (42883 → legacy path).
 * - Item 21: webhook 23505 on insert returns already-processed
 *   without throwing; any other insert error still throws.
 * - Item 23: pipeline ingestion writes BOTH the FK ids and the
 *   text brand/category columns (functional ingestProduct test
 *   with a mocked Supabase client).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findPublicProductByName,
  findPublicProductBySlug,
  listPublicProducts,
} from '@/lib/public-products';
import { checkPriceAlerts } from '@/services/alert-checker';
import { createDurableQuotaStore, createMemoryQuotaStore } from '@/lib/api-quota';
import { processWebhookEvent } from '@/services/stripe';

// ---------------------------------------------------------------------------
// Migration SQL text
// ---------------------------------------------------------------------------

function readMigration(filename: string): string {
  return readFileSync(join(process.cwd(), 'supabase', 'migrations', filename), 'utf8');
}

function readSource(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf8');
}

const MIG_051 = '20261112213000_051_user_table_auth_user_fks.sql';
const MIG_052 = '20261112214000_052_refresh_runs_one_running.sql';
const MIG_053 = '20261112215000_053_increment_api_key_usage_rpc.sql';

const FK_TABLES = [
  'agent_memory',
  'agent_rules',
  'user_expenses',
  'consumer_subscriptions',
  'shopping_lists',
  'monthly_plans',
  'future_you_goals',
  'warranty_claims',
  'smart_home_rules',
  'smart_home_confirmations',
  'eco_budgets',
  'digest_preferences',
];

describe('migration 051 — FKs from 12 user tables to auth.users', () => {
  it('adds ON DELETE CASCADE FKs for all 12 tables, guarded + DO NOT APPLY header', () => {
    const sql = readMigration(MIG_051);
    expect(sql).toContain('DO NOT APPLY YET');
    expect(sql).toContain('orphan check');
    for (const table of FK_TABLES) {
      expect(sql).toContain(`ALTER TABLE public.${table}`);
      expect(sql).toContain(`${table}_user_id_fkey`);
      expect(sql).toContain('FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE');
    }
    // No orphan is deleted by the file itself.
    expect(sql).not.toMatch(/DELETE FROM/i);
  });
});

describe('migration 052 — atomic refresh-guard index', () => {
  it('creates one unique partial index on running runs, with DO NOT APPLY header', () => {
    const sql = readMigration(MIG_052);
    expect(sql).toContain('DO NOT APPLY YET');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_price_refresh_runs_one_running'
    );
    expect(sql).toContain('ON public.price_refresh_runs (status)');
    expect(sql).toContain("WHERE status = 'running'");
  });
});

describe('migration 053 — atomic quota-increment RPC', () => {
  it('defines increment_api_key_usage as one INSERT … ON CONFLICT DO UPDATE, service-role only', () => {
    const sql = readMigration(MIG_053);
    expect(sql).toContain('DO NOT APPLY YET');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.increment_api_key_usage(');
    expect(sql).toContain('ON CONFLICT (key_hash, window_date)');
    expect(sql).toContain('request_count = public.api_key_usage.request_count + 1');
    expect(sql).toContain('RETURNING public.api_key_usage.request_count');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.increment_api_key_usage(text, date, text) FROM PUBLIC'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.increment_api_key_usage(text, date, text) TO service_role'
    );
  });
});

// ---------------------------------------------------------------------------
// Shared fake Supabase client: chainable query builder that applies
// the recorded eq/neq/is/ilike/in filters to canned rows, so tests
// assert behaviour (which rows survive), not just call shapes.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface FakeDbOptions {
  rows: Record<string, Row[]>;
  singleRows?: Record<string, Row | null>;
  insertReturns?: Record<string, Row>;
  /** First awaited query on each listed table errors with this. */
  failFirst?: Record<string, { code: string; message: string }>;
}

class FakeQuery {
  private filters: Array<{ op: string; column: string; value: unknown }> = [];
  private limitN: number | null = null;
  private mode: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private insertRow: Row | null = null;
  private patch: Row | null = null;

  constructor(
    private db: FakeDb,
    private table: string
  ) {}

  select(): this {
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push({ op: 'eq', column, value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ op: 'neq', column, value });
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push({ op: 'is', column, value });
    return this;
  }
  ilike(column: string, value: unknown): this {
    this.filters.push({ op: 'ilike', column, value });
    return this;
  }
  in(column: string, value: unknown): this {
    this.filters.push({ op: 'in', column, value });
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push({ op: 'gte', column, value });
    return this;
  }
  order(): this {
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  insert(row: Row): this {
    this.mode = 'insert';
    this.insertRow = row;
    this.db.inserts.push({ table: this.table, row });
    return this;
  }
  update(patch: Row): this {
    this.mode = 'update';
    this.patch = patch;
    this.db.updates.push({ table: this.table, patch });
    return this;
  }
  upsert(row: Row): this {
    this.mode = 'upsert';
    this.db.upserts.push({ table: this.table, row });
    return this;
  }

  private filteredRows(): Row[] {
    let rows = [...(this.db.opts.rows[this.table] ?? [])];
    for (const f of this.filters) {
      if (f.op === 'eq') rows = rows.filter((r) => r[f.column] === f.value);
      else if (f.op === 'neq') rows = rows.filter((r) => r[f.column] !== f.value);
      else if (f.op === 'is')
        rows = rows.filter((r) => (f.value === null ? r[f.column] == null : r[f.column] === f.value));
      else if (f.op === 'ilike') {
        const needle = String(f.value).replace(/%/g, '').toLowerCase();
        rows = rows.filter((r) => String(r[f.column] ?? '').toLowerCase().includes(needle));
      } else if (f.op === 'in')
        rows = rows.filter((r) => (f.value as unknown[]).includes(r[f.column]));
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  private resolveSelect(): { data: Row[] | null; error: { code?: string; message: string } | null } {
    const fail = this.db.opts.failFirst?.[this.table];
    if (fail && !this.db.failedOnce[this.table]) {
      this.db.failedOnce[this.table] = true;
      return { data: null, error: fail };
    }
    return { data: this.filteredRows(), error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: { code?: string; message: string } | null }> {
    const fail = this.db.opts.failFirst?.[this.table];
    if (fail && !this.db.failedOnce[this.table]) {
      this.db.failedOnce[this.table] = true;
      return { data: null, error: fail };
    }
    const single = this.db.opts.singleRows?.[this.table];
    if (single !== undefined) return { data: single, error: null };
    return { data: this.filteredRows()[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: { message: string } | null }> {
    if (this.mode === 'insert') {
      const ret = this.db.opts.insertReturns?.[this.table];
      if (ret) return { data: ret, error: null };
    }
    const row = this.filteredRows()[0] ?? null;
    return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } };
  }

  then(
    onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
    onRejected?: (e: unknown) => unknown
  ): Promise<unknown> {
    if (this.mode === 'insert' || this.mode === 'update' || this.mode === 'upsert') {
      return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
    }
    return Promise.resolve(this.resolveSelect()).then(onFulfilled, onRejected);
  }
}

class FakeDb {
  readonly fromCalls: string[] = [];
  readonly inserts: Array<{ table: string; row: Row }> = [];
  readonly updates: Array<{ table: string; patch: Row }> = [];
  readonly upserts: Array<{ table: string; row: Row }> = [];
  readonly failedOnce: Record<string, boolean> = {};

  constructor(readonly opts: FakeDbOptions) {}

  from(table: string): FakeQuery {
    this.fromCalls.push(table);
    return new FakeQuery(this, table);
  }
}

// ---------------------------------------------------------------------------
// Item 16 — public-product helper
// ---------------------------------------------------------------------------

const PUBLIC_PRODUCTS: Row[] = [
  { id: 'p-live', name: 'MacBook Air', slug: 'macbook-air-13', brand: 'Apple', category: 'Laptops', description: 'Laptop', deleted_at: null, status: 'published' },
  { id: 'p-deleted', name: 'Deleted Phone', slug: 'deleted-phone', brand: 'Nope', category: 'Phones', description: 'Gone', deleted_at: '2026-11-01T00:00:00.000Z', status: 'published' },
  { id: 'p-pending', name: 'Pending Tablet', slug: 'pending-tablet', brand: 'Nope', category: 'Tablets', description: 'Waiting', deleted_at: null, status: 'pending' },
];

describe('item 16 — public-product helper filters deleted/pending rows', () => {
  it('findPublicProductBySlug returns the published row and never the deleted/pending ones', async () => {
    const db = new FakeDb({ rows: { products: PUBLIC_PRODUCTS } });
    expect((await findPublicProductBySlug(db as never, 'macbook-air-13'))?.id).toBe('p-live');
    expect(await findPublicProductBySlug(db as never, 'deleted-phone')).toBeNull();
    expect(await findPublicProductBySlug(db as never, 'pending-tablet')).toBeNull();
  });

  it('findPublicProductByName resolves by name match with the same filter', async () => {
    const db = new FakeDb({ rows: { products: PUBLIC_PRODUCTS } });
    expect((await findPublicProductByName(db as never, 'macbook'))?.id).toBe('p-live');
    expect(await findPublicProductByName(db as never, 'deleted phone')).toBeNull();
  });

  it('listPublicProducts lists only published, non-deleted rows', async () => {
    const db = new FakeDb({ rows: { products: PUBLIC_PRODUCTS } });
    const rows = await listPublicProducts(db as never, 100);
    expect(rows.map((r) => r.id)).toEqual(['p-live']);
  });

  it('retries without the status filter on 42703 (migration 045 unapplied) instead of failing', async () => {
    const db = new FakeDb({
      rows: { products: PUBLIC_PRODUCTS },
      failFirst: { products: { code: '42703', message: 'column "status" does not exist' } },
    });
    const row = await findPublicProductBySlug(db as never, 'macbook-air-13');
    expect(row?.id).toBe('p-live');
    // Two products queries: the 42703 attempt + the retry.
    expect(db.fromCalls.filter((t) => t === 'products').length).toBe(2);
  });

  it('both public routes use the helper and no longer query products directly', () => {
    const extension = readSource('app/api/v1/extension/price/route.ts');
    expect(extension).toContain("from '@/lib/public-products'");
    expect(extension).toContain('findPublicProductBySlug');
    expect(extension).toContain('findPublicProductByName');
    expect(extension).not.toContain(".from('products')");

    const gifts = readSource('app/api/v1/gifts/route.ts');
    expect(gifts).toContain("from '@/lib/public-products'");
    expect(gifts).toContain('listPublicProducts');
    expect(gifts).not.toContain(".from('products')");
  });
});

// ---------------------------------------------------------------------------
// Item 17 — alert-checker batch
// ---------------------------------------------------------------------------

describe('item 17 — alert checker batches prices (one query per table, not per alert)', () => {
  it('checks 3 alerts over 2 products with exactly 1 price_history + 1 merchant_products query', async () => {
    const db = new FakeDb({
      rows: {
        alerts: [
          { id: 'a1', user_id: 'u1', product_id: 'p1', alert_type: 'price_drop', condition_value: 100, channel: 'email', active: true, last_triggered_at: null, trigger_count: 0 },
          { id: 'a2', user_id: 'u2', product_id: 'p2', alert_type: 'price_drop', condition_value: 100, channel: 'email', active: true, last_triggered_at: null, trigger_count: 0 },
          { id: 'a3', user_id: 'u3', product_id: 'p1', alert_type: 'price_drop', condition_value: 200, channel: 'email', active: true, last_triggered_at: null, trigger_count: 0 },
        ],
        products: [
          { id: 'p1', name: 'Sony Headphones', slug: 'sony-headphones' },
          { id: 'p2', name: 'Mouse', slug: 'mouse' },
        ],
        // Latest first: p1's newest price is 90 (older 120 must not win).
        price_history: [
          { product_id: 'p1', price: 90, availability: 'in_stock', recorded_at: '2026-11-12T10:00:00.000Z' },
          { product_id: 'p1', price: 120, availability: 'in_stock', recorded_at: '2026-11-11T10:00:00.000Z' },
        ],
        // p2 has no history: the merchant fallback prices it at 150.
        merchant_products: [{ product_id: 'p2', price: 150, in_stock: true, deleted_at: null }],
        price_alert_history: [],
      },
    });

    const result = await checkPriceAlerts(db as never);

    expect(db.fromCalls.filter((t) => t === 'price_history').length).toBe(1);
    expect(db.fromCalls.filter((t) => t === 'merchant_products').length).toBe(1);
    expect(result.checked).toBe(3);
    // a1 (90 <= 100) and a3 (90 <= 200) trigger; a2 (150 > 100) does not.
    expect(result.triggered).toBe(2);
    expect(result.queued).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('no longer calls getCurrentPrice per alert', () => {
    const source = readSource('services/alert-checker.ts');
    expect(source).toContain('getCurrentPrices');
    expect(source).not.toContain('getCurrentPrice(');
  });
});

// ---------------------------------------------------------------------------
// Item 20 — quota RPC path + fallback
// ---------------------------------------------------------------------------

/** Fake service client with an RPC function and an in-memory ledger. */
class FakeRpcLedger {
  readonly rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  readonly fromCalls: string[] = [];
  private counts = new Map<string, number>();
  /** When set, rpc fails with this error (e.g. 42883 = function missing). */
  rpcError: { code: string; message: string } | null = null;

  async rpc(fn: string, params: Record<string, unknown>) {
    this.rpcCalls.push({ fn, params });
    if (this.rpcError) return { data: null, error: this.rpcError };
    const key = `${params.p_key_hash}:${params.p_window_date}`;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return { data: next, error: null };
  }

  from() {
    this.fromCalls.push('api_key_usage');
    const counts = this.counts;
    const filters: Record<string, string> = {};
    const query = {
      select() {
        return query;
      },
      eq(column: string, value: string) {
        filters[column] = value;
        return query;
      },
      async maybeSingle() {
        const count = counts.get(`${filters.key_hash}:${filters.window_date}`);
        return { data: count === undefined ? null : { request_count: count }, error: null };
      },
      async insert(row: { key_hash: string; window_date: string; request_count: number }) {
        const key = `${row.key_hash}:${row.window_date}`;
        if (counts.has(key)) return { error: { code: '23505', message: 'duplicate key' } };
        counts.set(key, row.request_count);
        return { error: null };
      },
      update(patch: { request_count: number }) {
        return {
          eq(column: string, value: string) {
            filters[column] = value;
            return {
              eq(column2: string, value2: string) {
                filters[column2] = value2;
                counts.set(`${filters.key_hash}:${filters.window_date}`, patch.request_count);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };
    return query;
  }
}

describe('item 20 — quota atomic increment via RPC', () => {
  it('uses the RPC when present: count comes from the function, no legacy reads', async () => {
    const ledger = new FakeRpcLedger();
    const store = createDurableQuotaStore({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      serviceClient: ledger as any,
    });
    const now = new Date('2026-11-12T10:00:00.000Z');
    expect((await store.checkAndIncrement('key:aaaa', 2, 'free', now)).used).toBe(1);
    expect((await store.checkAndIncrement('key:aaaa', 2, 'free', now)).used).toBe(2);
    expect((await store.checkAndIncrement('key:aaaa', 2, 'free', now)).allowed).toBe(false);
    expect(ledger.rpcCalls.length).toBe(3);
    expect(ledger.rpcCalls[0].fn).toBe('increment_api_key_usage');
    expect(ledger.fromCalls.length).toBe(0);
  });

  it('falls back to the legacy path when the RPC is missing (42883), never throws', async () => {
    const ledger = new FakeRpcLedger();
    ledger.rpcError = { code: '42883', message: 'function increment_api_key_usage does not exist' };
    const store = createDurableQuotaStore({
      fallback: createMemoryQuotaStore(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      serviceClient: ledger as any,
    });
    const now = new Date('2026-11-12T10:00:00.000Z');
    expect((await store.checkAndIncrement('key:bbbb', 5, 'free', now)).used).toBe(1);
    expect((await store.checkAndIncrement('key:bbbb', 5, 'free', now)).used).toBe(2);
    expect(ledger.rpcCalls.length).toBe(2);
    expect(ledger.fromCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Item 21 — webhook 23505 handling
// ---------------------------------------------------------------------------

function fakeWebhookClient(options: {
  existing?: { id: string } | null;
  insertError?: { code?: string; message: string } | null;
}) {
  const inserts: Array<Row> = [];
  const client = {
    inserts,
    from(table: string) {
      if (table !== 'webhook_events') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: options.existing ?? null, error: null };
                },
              };
            },
          };
        },
        async insert(row: Row) {
          inserts.push(row);
          return { error: options.insertError ?? null };
        },
      };
    },
  };
  return client;
}

describe('item 21 — webhook 23505 is already-processed, not a 500', () => {
  it('a concurrent double delivery (23505 on insert) resolves cleanly without throwing', async () => {
    const client = fakeWebhookClient({
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    await expect(
      processWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client as any,
        { id: 'evt_test_dup', type: 'customer.subscription.updated', data: {} }
      )
    ).resolves.toBeUndefined();
    expect(client.inserts.length).toBe(1);
  });

  it('any other insert error still throws so Stripe retries', async () => {
    const client = fakeWebhookClient({
      insertError: { message: 'connection refused' },
    });
    await expect(
      processWebhookEvent(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client as any,
        { id: 'evt_test_err', type: 'customer.subscription.updated', data: {} }
      )
    ).rejects.toThrow('Failed to record webhook event evt_test_err');
  });
});

// ---------------------------------------------------------------------------
// Item 23 — pipeline writes FK ids AND text brand/category
// ---------------------------------------------------------------------------

/**
 * Ingestion's service client comes from createClient() in
 * @supabase/supabase-js, so the functional test swaps that module
 * for a recording fake. The fake resolves brands/categories by
 * slug/name miss (forcing creation) and records the products
 * insert row for the assertion.
 */
const ingestionState = vi.hoisted(() => ({
  productInserts: [] as Row[],
}));

vi.mock('@supabase/supabase-js', () => {
  type IngRow = Record<string, unknown>;
  const state = ingestionState;
  function chain(table: string) {
    const q: Record<string, unknown> = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      neq() {
        return q;
      },
      ilike() {
        return q;
      },
      is() {
        return q;
      },
      in() {
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      async maybeSingle() {
        if (table === 'retailers') return { data: { id: 'retailer-1' }, error: null };
        return { data: null, error: null };
      },
      async single() {
        if (table === 'brands') return { data: { id: 'brand-1' }, error: null };
        if (table === 'categories') return { data: { id: 'cat-1' }, error: null };
        if (table === 'products') return { data: { id: 'prod-1' }, error: null };
        return { data: null, error: null };
      },
      async insert(row: IngRow) {
        if (table === 'products') state.productInserts.push(row);
        return { data: null, error: null };
      },
      async update() {
        return { data: null, error: null };
      },
      async upsert() {
        return { data: null, error: null };
      },
    };
    // insert().select().single() — the create path chains select
    // after insert; make insert return the chainable too.
    const origInsert = q.insert as (row: IngRow) => Promise<{ data: null; error: null }>;
    q.insert = ((row: IngRow) => {
      if (table === 'products') state.productInserts.push(row);
      return q;
    }) as unknown as (row: IngRow) => Promise<{ data: null; error: null }>;
    void origInsert;
    // Awaiting the builder directly (limit/ilike selects) resolves
    // to an empty row set.
    q.then = (onF: (v: { data: IngRow[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onF);
    return q;
  }
  return {
    createClient: () => ({
      from: (table: string) => chain(table),
    }),
  };
});

describe('item 23 — pipeline ingestion writes FK ids and text columns', () => {
  beforeEach(() => {
    ingestionState.productInserts.length = 0;
  });

  it('an ingested product carries brand_id + brand and category_id + category', async () => {
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    const result = await ingestProduct(
      {
        externalId: 'ext-sony-1',
        retailerSlug: 'amazon',
        name: 'Sony WH-1000XM5',
        description: 'Noise cancelling headphones',
        brand: 'Sony',
        category: 'Headphones',
        price: 299,
        currency: 'USD',
        availability: 'in_stock',
        url: 'https://example.com/sony-wh-1000xm5',
        images: [],
      },
      'test-provider'
    );
    expect(result.success).toBe(true);
    expect(result.action).toBe('created');
    expect(ingestionState.productInserts.length).toBe(1);
    const row = ingestionState.productInserts[0];
    expect(row.brand_id).toBe('brand-1');
    expect(row.brand).toBe('Sony');
    expect(row.category_id).toBe('cat-1');
    expect(row.category).toBe('Headphones');
  });
});
