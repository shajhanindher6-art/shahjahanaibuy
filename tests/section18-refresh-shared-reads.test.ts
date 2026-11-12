/**
 * Section 18, Phase 2 — refresh re-reads (audit §1 #69, §12 item 31).
 *
 * Before: `refreshTrackedPrices` and `recordAvailabilitySnapshots`
 * each read merchant_products, and `refreshTrackedPrices` and
 * `checkGuestEmailAlerts` each read price_history — 2 merchant
 * reads + 2 history reads per run. Now the route builds the shared
 * reads once (after the live-fetch legs) and passes them down, so
 * the whole run does ONE merchant_products select + ONE
 * price_history select, with identical per-step counts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;

const store: Record<string, Row[]> = {};
const readCounts: Record<string, number> = {};

function seed(table: string, rows: Row[]): void {
  store[table] = rows.map((r) => ({ ...r }));
}

function resetStore(): void {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(readCounts)) delete readCounts[k];
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private sortCol: string | null = null;
  private sortAsc = true;
  private limitN: number | null = null;
  private op: 'select' | 'insert' | 'update' = 'select';
  private insertRows: Row[] = [];
  private wantSingle = false;
  private wantMaybeSingle = false;

  constructor(private readonly table: string) {}

  select(): this {
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
  gte(col: string, value: string): this {
    this.filters.push((r) => String(r[col] ?? '') >= value);
    return this;
  }
  lte(col: string, value: string): this {
    this.filters.push((r) => String(r[col] ?? '') <= value);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.sortCol = col;
    this.sortAsc = opts?.ascending !== false;
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
  insert(rowOrRows: Row | Row[]): this {
    this.op = 'insert';
    this.insertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return this;
  }
  update(): this {
    this.op = 'update';
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    if (this.op === 'insert') {
      const rows = this.insertRows.map((row, i) => ({
        ...row,
        id: row.id ?? `fake-${this.table}-${Date.now()}-${i}`,
      }));
      store[this.table] = [...(store[this.table] ?? []), ...rows];
      if (this.wantSingle) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }
    if (this.op === 'update') return { data: [], error: null };
    readCounts[this.table] = (readCounts[this.table] ?? 0) + 1;
    let rows = (store[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.sortCol) {
      const col = this.sortCol;
      const asc = this.sortAsc;
      rows = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        const an = typeof av === 'number' ? av : Number(av);
        const bn = typeof bv === 'number' ? bv : Number(bv);
        const cmp =
          Number.isFinite(an) && Number.isFinite(bn)
            ? an - bn
            : String(av ?? '').localeCompare(String(bv ?? ''));
        return asc ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantSingle || this.wantMaybeSingle) {
      return rows.length === 0
        ? { data: null, error: { code: 'PGRST116', message: '0 rows' } }
        : { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }
}

const fakeClient = {
  from: (table: string) => new FakeQuery(table),
} as unknown as Parameters<
  typeof import('@/services/price-refresh').refreshTrackedPrices
>[0];

const routeMocks = vi.hoisted(() => ({
  checkPriceAlerts: vi.fn(async () => ({ checked: 0, triggered: 0, queued: 0, skippedDuplicate: 0, failed: 0 })),
  processNotificationQueue: vi.fn(async () => ({ processed: 0, sent: 0, failed: 0 })),
  runHunts: vi.fn(async () => ({ usersChecked: 0, huntsRun: 0, matchesCreated: 0, huntsEnabled: false })),
}));

vi.mock('@/services/alert-checker', () => ({
  checkPriceAlerts: routeMocks.checkPriceAlerts,
}));
vi.mock('@/services/notification-dispatch', () => ({
  processNotificationQueue: routeMocks.processNotificationQueue,
}));
vi.mock('@/lib/agent-hunt', () => ({
  runHuntsForConsentedUsers: routeMocks.runHunts,
}));

const serviceMocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: serviceMocks.createServiceClient,
}));

import { POST as refreshPOST } from '@/app/api/v1/prices/refresh/route';

beforeEach(() => {
  resetStore();
  process.env.CRON_SECRET = 'test-secret';
  serviceMocks.createServiceClient.mockReturnValue(fakeClient);
  // No eBay merchant row → the eBay step returns 'merchant-missing'
  // after one merchants read and never touches merchant_products.
  seed('merchants', [{ id: 'm1', slug: 'amazon' }]);
  seed('retailers', [{ id: 'r1', slug: 'amazon' }]);
  seed('products', [
    { id: 'p1', name: 'P1', slug: 'p1' },
    { id: 'p2', name: 'P2', slug: 'p2' },
    { id: 'p3', name: 'P3', slug: 'p3' },
  ]);
  seed('alerts', [{ product_id: 'p1', active: true }]);
  seed('wishlist_items', [{ product_id: 'p2' }]);
  seed('guest_email_alerts', [
    {
      id: 'g1', email: 'guest@example.com', product_id: 'p3', alert_type: 'price_drop',
      target_price: 100, guest_token: 'tok', last_triggered_at: null,
      last_triggered_price: null, trigger_count: 0, active: true,
    },
  ]);
  seed('merchant_products', [
    { product_id: 'p1', merchant_id: 'm1', price: 90, availability: 'in_stock', url: 'https://example.com/p1', in_stock: true, deleted_at: null },
    // Cheaper but OUT of stock — the refresh step must ignore it
    // (lowest IN-STOCK is 90); the stock step still sees it.
    { product_id: 'p1', merchant_id: 'm1', price: 85, availability: 'out_of_stock', url: 'https://example.com/p1b', in_stock: false, deleted_at: null },
    { product_id: 'p2', merchant_id: 'm1', price: 80, availability: 'in_stock', url: 'https://example.com/p2', in_stock: true, deleted_at: null },
    { product_id: 'p3', merchant_id: 'm1', price: 70, availability: 'out_of_stock', url: 'https://example.com/p3', in_stock: false, deleted_at: null },
  ]);
  seed('price_history', [
    { product_id: 'p1', retailer_id: 'r1', price: 100, availability: 'in_stock', recorded_at: '2026-11-01T00:00:00Z' },
    { product_id: 'p1', retailer_id: 'r1', price: 95, availability: 'in_stock', recorded_at: '2026-11-10T00:00:00Z' },
    { product_id: 'p2', retailer_id: 'r1', price: 80, availability: 'in_stock', recorded_at: '2026-11-10T00:00:00Z' },
    { product_id: 'p3', retailer_id: 'r1', price: 70, availability: 'out_of_stock', recorded_at: '2026-11-10T00:00:00Z' },
  ]);
  seed('availability_history', []);
  seed('deals', []);
  seed('weekly_digests', []);
  seed('subscriptions', []);
  seed('saved_searches', []);
  seed('price_refresh_runs', []);
});

describe('shared refresh reads (item 31)', () => {
  it('reads merchant_products and price_history ONCE each for the whole run', async () => {
    const req = new NextRequest('http://localhost/api/v1/prices/refresh', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret', 'x-real-ip': '203.0.113.98' },
    });
    const res = await refreshPOST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, Record<string, unknown>> };

    // Before item 31: merchant_products was read 2× (refresh +
    // stock) and price_history 2× (refresh + guestAlerts).
    expect(readCounts['merchant_products']).toBe(1);
    expect(readCounts['price_history']).toBe(1);

    // Per-step behaviour is identical to the unshared run:
    // refresh: p1 changed 95 → 90 (inserted), p2 unchanged at 80.
    expect(body.data.refresh).toMatchObject({ tracked: 2, inserted: 1, unchanged: 1, failed: 0 });
    // stock: all three products tracked, all recorded (no history).
    expect(body.data.stock).toMatchObject({ tracked: 3, recorded: 3, failed: 0 });
    // guestAlerts: p3 dropped to 70 against a $100 target → triggered.
    expect(body.data.guestAlerts).toMatchObject({ checked: 1, triggered: 1, failed: 0 });
  });
});
