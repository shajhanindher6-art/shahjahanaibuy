/**
 * Section 18, Phase 2 — run counts in steps JSONB (audit §1 #70,
 * §12 item 38).
 *
 * The run record used to store step status + error only, so the
 * admin page could show THAT a step failed but never HOW MANY
 * prices a past run refreshed. Now summarizeStep takes the counts
 * the step already computed (processed/succeeded/failed, plus
 * skipped where the step has one); steps with no failure count
 * (hunts) store no counts rather than an invented zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { summarizeStep } from '@/services/refresh-run';

describe('summarizeStep with counts (item 38)', () => {
  it('stores the counts alongside the status', () => {
    const summary = summarizeStep(
      { status: 'ok', result: { tracked: 2 } },
      { processed: 2, succeeded: 2, failed: 0, skipped: 0 }
    );
    expect(summary).toEqual({
      status: 'ok',
      counts: { processed: 2, succeeded: 2, failed: 0, skipped: 0 },
    });
  });

  it('omits counts when the step computes none (hunts)', () => {
    const summary = summarizeStep({ status: 'ok', result: {} });
    expect(summary).toEqual({ status: 'ok' });
    expect('counts' in summary).toBe(false);
  });

  it('keeps the error and the counts together on a failed step', () => {
    const summary = summarizeStep(
      { status: 'failed', result: {}, error: 'price load failed' },
      { processed: 2, succeeded: 0, failed: 2 }
    );
    expect(summary.status).toBe('failed');
    expect(summary.error).toBe('price load failed');
    expect(summary.counts).toEqual({ processed: 2, succeeded: 0, failed: 2 });
  });
});

// --- Route level: counts in the response AND the stored row -----------

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};

function seed(table: string, rows: Row[]): void {
  tables[table] = rows.map((r) => ({ ...r }));
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private sortCol: string | null = null;
  private sortAsc = true;
  private limitN: number | null = null;
  private op: 'select' | 'insert' | 'update' = 'select';
  private insertRows: Row[] = [];
  private updateValues: Row = {};
  private wantSingle = false;

  constructor(private readonly table: string) {}

  select(): this { return this; }
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
  gte(): this { return this; }
  lte(): this { return this; }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.sortCol = col;
    this.sortAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number): this { this.limitN = n; return this; }
  single(): this { this.wantSingle = true; return this; }
  maybeSingle(): this { this.wantSingle = true; return this; }
  insert(rowOrRows: Row | Row[]): this {
    this.op = 'insert';
    this.insertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return this;
  }
  update(values: Row): this {
    this.op = 'update';
    this.updateValues = values;
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
      const rows = this.insertRows.map((row, i) => ({ ...row, id: row.id ?? `fake-${this.table}-${i}` }));
      tables[this.table] = [...(tables[this.table] ?? []), ...rows];
      return this.wantSingle ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
    }
    if (this.op === 'update') {
      const rows = tables[this.table] ?? [];
      for (const row of rows) {
        if (this.filters.every((f) => f(row))) Object.assign(row, this.updateValues);
      }
      return { data: rows.filter((r) => this.filters.every((f) => f(r))), error: null };
    }
    let rows = (tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.sortCol) {
      const col = this.sortCol;
      const asc = this.sortAsc;
      rows = [...rows].sort((a, b) => {
        const cmp = String(a[col] ?? '').localeCompare(String(b[col] ?? ''));
        return asc ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantSingle) {
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
  for (const k of Object.keys(tables)) delete tables[k];
  process.env.CRON_SECRET = 'test-secret';
  serviceMocks.createServiceClient.mockReturnValue(fakeClient);
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
    { product_id: 'p2', merchant_id: 'm1', price: 80, availability: 'in_stock', url: 'https://example.com/p2', in_stock: true, deleted_at: null },
    { product_id: 'p3', merchant_id: 'm1', price: 70, availability: 'out_of_stock', url: 'https://example.com/p3', in_stock: false, deleted_at: null },
  ]);
  seed('price_history', [
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

describe('run counts in steps JSONB (item 38)', () => {
  it('stores honest per-step counts in the response and the run row', async () => {
    const req = new NextRequest('http://localhost/api/v1/prices/refresh', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret', 'x-real-ip': '203.0.113.96' },
    });
    const res = await refreshPOST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { steps: Record<string, { status: string; counts?: Record<string, number> }> };
    };

    // refresh: p1 changed 95 → 90 (inserted), p2 unchanged at 80.
    // FINAL 100%: counts now also carry suspiciousPriceChanges (0 here).
    expect(body.data.steps.refresh.counts).toEqual({ processed: 2, succeeded: 2, failed: 0, skipped: 0, suspiciousPriceChanges: 0 });
    // stock: all three products tracked and recorded.
    expect(body.data.steps.stock.counts).toEqual({ processed: 3, succeeded: 3, failed: 0 });
    // guestAlerts: p3 at 70 against a $100 target.
    expect(body.data.steps.guestAlerts.counts).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    // hunts computes no failure count — no counts, never a zero.
    expect(body.data.steps.hunts.counts).toBeUndefined();
    // savedSearches succeeded with nothing to check — failed: 0 is honest here.
    expect(body.data.steps.savedSearches.counts).toEqual({ processed: 0, succeeded: 0, failed: 0 });

    // The stored run row carries the same counts (finishRefreshRun
    // wrote the steps JSONB with the update).
    const stored = tables['price_refresh_runs'][0] as Row & {
      steps: Record<string, { counts?: Record<string, number> }>;
    };
    // FINAL 100% (F-P1-28, K10b): this harness fetches no live
    // provider prices (only recorded rows are re-read), so the
    // stored status is completed_no_live_source, never 'completed'.
    expect(stored.status).toBe('completed_no_live_source');
    expect(stored.steps.refresh.counts).toEqual({ processed: 2, succeeded: 2, failed: 0, skipped: 0, suspiciousPriceChanges: 0 });
    expect(stored.steps.hunts.counts).toBeUndefined();
  });
});
