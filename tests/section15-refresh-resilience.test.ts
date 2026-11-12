/**
 * Section 15, W3A — refresh resilience + observability tests
 * (P1-1, P1-3, P1-5, P1-7, P1-8).
 *
 * Route tests run against an in-memory fake Supabase client (no DB,
 * no network). checkPriceAlerts / processNotificationQueue /
 * runHuntsForConsentedUsers are mocked at the module boundary so a
 * single step can be made to throw; refreshTrackedPrices,
 * recordAvailabilitySnapshots, the guest steps and the runs-table
 * guard run for real against the fake client.
 *
 * The fake client is a small query engine: select/eq/in/is/gte/
 * order/limit/single/insert/update, per-table select errors, and a
 * missing-table error (PGRST205) when a table was never seeded —
 * which is how the "migration not applied yet" state is simulated.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { refreshTrackedPrices } from '@/services/price-refresh';
import {
  runRefreshStep,
  tryStartRefreshRun,
  finishRefreshRun,
  getLatestRefreshRun,
  REFRESH_RUN_STALE_MS,
} from '@/services/refresh-run';
import { withTimeout } from '@/lib/with-timeout';
import {
  searchEbayListings,
  resetEbayTokenCacheForTests,
  EBAY_FETCH_TIMEOUT_MS,
} from '@/services/ebay-browse';
import { EMAIL_SEND_TIMEOUT_MS } from '@/services/email';
import { PUSH_SEND_TIMEOUT_MS } from '@/services/push';

// --- Step mocks (module boundary) ------------------------------------------

const mocks = vi.hoisted(() => ({
  checkPriceAlerts: vi.fn(),
  processNotificationQueue: vi.fn(),
  runHunts: vi.fn(),
}));

vi.mock('@/services/alert-checker', () => ({
  checkPriceAlerts: mocks.checkPriceAlerts,
}));
vi.mock('@/services/notification-dispatch', () => ({
  processNotificationQueue: mocks.processNotificationQueue,
}));
vi.mock('@/lib/agent-hunt', () => ({
  runHuntsForConsentedUsers: mocks.runHunts,
}));

// --- In-memory fake Supabase -----------------------------------------------

type Row = Record<string, unknown>;

interface FakeTable {
  rows: Row[];
  selectError?: { code?: string; message: string };
  insertError?: { code?: string; message: string };
  throws?: boolean;
}

const fakeDb = vi.hoisted(() => ({
  tables: {} as Record<string, FakeTable>,
  runSeq: 0,
}));

function seedTable(name: string, rows: Row[] = [], opts: Partial<FakeTable> = {}): void {
  fakeDb.tables[name] = { rows: rows.map((r) => ({ ...r })), ...opts };
}

function resetFakeDb(): void {
  fakeDb.tables = {};
  fakeDb.runSeq = 0;
  // Core catalog tables (happy path: one tracked product, price unchanged).
  seedTable('alerts', [{ product_id: 'p1', active: true }]);
  seedTable('wishlist_items', []);
  seedTable('merchant_products', [
    {
      product_id: 'p1',
      merchant_id: 'm1',
      price: 999,
      availability: 'in_stock',
      url: 'https://example.com/p1',
      in_stock: true,
      deleted_at: null,
    },
  ]);
  seedTable('merchants', [{ id: 'm1', slug: 'amazon' }]);
  seedTable('retailers', [{ id: 'r1', slug: 'amazon' }]);
  seedTable('price_history', [
    {
      product_id: 'p1',
      retailer_id: 'r1',
      price: 999,
      availability: 'in_stock',
      recorded_at: '2026-11-02T07:13:52Z',
    },
  ]);
  seedTable('availability_history', []);
  seedTable('price_refresh_runs', []);
  // Guest tables are deliberately NOT seeded by default: migration
  // 026 not applied yet is the honest default, and the refresh
  // chain must tolerate their absence.
}

const MISSING_TABLE_ERROR = { code: 'PGRST205', message: 'Could not find the table' };

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private op: 'select' | 'insert' | 'update' = 'select';
  private insertRows: Row[] = [];
  private updatePatch: Row = {};
  private wantSingle = false;
  private wantMaybeSingle = false;

  constructor(
    private readonly db: typeof fakeDb,
    private readonly table: string
  ) {}

  select(_cols?: string): this {
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
  gte(col: string, value: unknown): this {
    this.filters.push((r) => String(r[col] ?? '') >= String(value));
    return this;
  }
  lte(col: string, value: unknown): this {
    this.filters.push((r) => String(r[col] ?? '') <= String(value));
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
  // Section 17, Stage D: the eBay leg (.maybeSingle on the
  // merchants lookup) and the pipeline leg (.lte on the
  // next_refresh_at due query) both need these chain methods —
  // the real Supabase builder has them, the fake did not.
  maybeSingle(): this {
    this.wantMaybeSingle = true;
    return this;
  }
  insert(rowOrRows: Row | Row[]): this {
    this.op = 'insert';
    this.insertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return this;
  }
  update(patch: Row): this {
    this.op = 'update';
    this.updatePatch = patch;
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    const table = this.db.tables[this.table];
    if (!table) {
      return { data: null, error: { ...MISSING_TABLE_ERROR, message: `Could not find the table '${this.table}'` } };
    }
    if (table.throws) {
      throw new Error(`fake transport failure on ${this.table}`);
    }
    if (this.op === 'insert') {
      if (table.insertError) return { data: null, error: table.insertError };
      const inserted = this.insertRows.map((row) => {
        const next: Row = { ...row };
        if (this.table === 'price_refresh_runs') {
          fakeDb.runSeq += 1;
          next.id = next.id ?? `run-${fakeDb.runSeq}`;
          next.started_at = next.started_at ?? new Date().toISOString();
          next.finished_at = next.finished_at ?? null;
          next.status = next.status ?? 'running';
          next.steps = next.steps ?? {};
          next.error = next.error ?? null;
        }
        return next;
      });
      table.rows.push(...inserted);
      return this.wantSingle
        ? { data: inserted[0] ?? null, error: null }
        : { data: inserted, error: null };
    }
    if (this.op === 'update') {
      const matched = table.rows.filter((r) => this.filters.every((f) => f(r)));
      for (const row of matched) Object.assign(row, this.updatePatch);
      return { data: matched, error: null };
    }
    // select
    if (table.selectError) return { data: null, error: table.selectError };
    let rows = table.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      rows = [...rows].sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        return asc ? (av < bv ? -1 : av > bv ? 1 : 0) : av > bv ? -1 : av < bv ? 1 : 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantMaybeSingle) {
      // Like the real builder: 0 rows is data null, no error.
      return { data: rows[0] ?? null, error: null };
    }
    if (this.wantSingle) {
      return rows.length === 0
        ? { data: null, error: { code: 'PGRST116', message: '0 rows' } }
        : { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }
}

const fakeClient = {
  from: (table: string) => new FakeQuery(fakeDb, table),
};

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => fakeClient,
}));

// Imported after the mocks so the routes use the fake client.
import { POST as refreshPOST } from '@/app/api/v1/prices/refresh/route';
import { POST as alertsCheckPOST } from '@/app/api/v1/alerts/check/route';

function refreshRequest(ip = '203.0.113.10'): NextRequest {
  return new NextRequest('http://localhost/api/v1/prices/refresh', {
    method: 'POST',
    headers: { authorization: 'Bearer test-cron-secret', 'x-real-ip': ip },
  });
}

function alertsCheckRequest(ip = '203.0.113.11'): NextRequest {
  return new NextRequest('http://localhost/api/v1/alerts/check', {
    method: 'POST',
    headers: { authorization: 'Bearer test-cron-secret', 'x-real-ip': ip },
  });
}

function repoFile(...parts: string[]): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts),
    'utf8'
  );
}

beforeEach(() => {
  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.EBAY_CLIENT_ID = 'test-client-id';
  process.env.EBAY_CLIENT_SECRET = 'test-client-secret';
  resetFakeDb();
  resetEbayTokenCacheForTests();
  mocks.checkPriceAlerts.mockReset();
  mocks.processNotificationQueue.mockReset();
  mocks.runHunts.mockReset();
  mocks.checkPriceAlerts.mockResolvedValue({
    checked: 1,
    triggered: 0,
    queued: 0,
    skippedDuplicate: 0,
    failed: 0,
  });
  mocks.processNotificationQueue.mockResolvedValue({ processed: 0, sent: 0, failed: 0 });
  mocks.runHunts.mockResolvedValue({
    usersChecked: 0,
    huntsRun: 0,
    matchesCreated: 0,
    huntsEnabled: false,
  });
});

// ---------------------------------------------------------------------------
// P1-1 — per-step isolation
// ---------------------------------------------------------------------------

describe('P1-1 per-step isolation (refresh route)', () => {
  it('returns 200 with all steps ok on the happy path', async () => {
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(body.success).toBe(true);
    const data = body.data as {
      skipped: boolean;
      refresh: { tracked: number; unchanged: number };
      stock: { tracked: number; recorded: number };
      steps: Record<string, { status: string }>;
    };
    expect(data.skipped).toBe(false);
    expect(data.refresh.tracked).toBe(1);
    expect(data.refresh.unchanged).toBe(1);
    expect(data.stock.tracked).toBe(1);
    expect(data.stock.recorded).toBe(1);
    for (const step of ['refresh', 'alerts', 'hunts', 'notifications', 'stock', 'guestAlerts', 'guestEmail']) {
      expect(data.steps[step].status).toBe('ok');
    }
  });

  it('a throwing alerts step is reported failed and later steps still run', async () => {
    mocks.checkPriceAlerts.mockRejectedValueOnce(new Error('checker exploded'));
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        alerts: { checked: number };
        notifications: { processed: number };
        steps: Record<string, { status: string; error?: string }>;
      };
    };
    expect(data.steps.alerts.status).toBe('failed');
    expect(data.steps.alerts.error).toContain('checker exploded');
    expect(data.alerts.checked).toBe(0);
    expect(data.steps.refresh.status).toBe('ok');
    expect(data.steps.notifications.status).toBe('ok');
    expect(mocks.processNotificationQueue).toHaveBeenCalled();
  });

  it('a throwing notifications step is reported failed and stock/guest steps still run', async () => {
    mocks.processNotificationQueue.mockRejectedValueOnce(new Error('queue exploded'));
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { steps: Record<string, { status: string }> };
    };
    expect(data.steps.notifications.status).toBe('failed');
    expect(data.steps.stock.status).toBe('ok');
    expect(data.steps.guestAlerts.status).toBe('ok');
    expect(data.steps.guestEmail.status).toBe('ok');
  });

  it('a throwing refresh step (price_history transport failure) is reported failed, others ok', async () => {
    fakeDb.tables.price_history!.throws = true;
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { steps: Record<string, { status: string; error?: string }> };
    };
    expect(data.steps.refresh.status).toBe('failed');
    expect(data.steps.refresh.error).toContain('price_history');
    expect(data.steps.alerts.status).toBe('ok');
    expect(data.steps.notifications.status).toBe('ok');
    expect(data.steps.stock.status).toBe('ok');
  });
});

describe('P1-1 per-step isolation (alerts/check route)', () => {
  it('a throwing alerts step is reported failed and notifications still run', async () => {
    mocks.checkPriceAlerts.mockRejectedValueOnce(new Error('checker exploded'));
    const res = await alertsCheckPOST(alertsCheckRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { steps: Record<string, { status: string; error?: string }> };
    };
    expect(data.steps.alerts.status).toBe('failed');
    expect(data.steps.alerts.error).toContain('checker exploded');
    expect(data.steps.refresh.status).toBe('ok');
    expect(data.steps.notifications.status).toBe('ok');
    expect(mocks.processNotificationQueue).toHaveBeenCalled();
  });

  it('returns 200 with all steps ok on the happy path', async () => {
    const res = await alertsCheckPOST(alertsCheckRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { skipped: boolean; steps: Record<string, { status: string }> };
    };
    expect(data.skipped).toBe(false);
    expect(data.steps.refresh.status).toBe('ok');
    expect(data.steps.alerts.status).toBe('ok');
    expect(data.steps.notifications.status).toBe('ok');
  });
});

describe('runRefreshStep helper', () => {
  it('passes a successful result through as ok', async () => {
    const out = await runRefreshStep('x', async () => 42, 0);
    expect(out).toEqual({ status: 'ok', result: 42 });
  });

  it('converts a throw into failed + fallback + error message', async () => {
    const out = await runRefreshStep('x', async () => {
      throw new Error('boom');
    }, 0);
    expect(out.status).toBe('failed');
    expect(out.result).toBe(0);
    expect(out.error).toBe('boom');
  });

  it('marks a result failed when isFailed reports a load failure', async () => {
    const out = await runRefreshStep(
      'x',
      async () => ({ loadFailed: true, loadError: 'alerts: boom' }),
      { loadFailed: false, loadError: '' },
      (r) => (r.loadFailed ? r.loadError : null)
    );
    expect(out.status).toBe('failed');
    expect(out.error).toBe('alerts: boom');
  });
});

// ---------------------------------------------------------------------------
// P1-8 — silent no-op on DB failure
// ---------------------------------------------------------------------------

describe('P1-8 DB-error surfacing in refreshTrackedPrices', () => {
  it('a failed alerts select marks the step loadFailed instead of tracked: 0 success', async () => {
    fakeDb.tables.alerts!.selectError = { message: 'alerts boom' };
    const result = await refreshTrackedPrices(fakeClient as never);
    expect(result.loadFailed).toBe(true);
    expect(result.loadError).toContain('alerts');
    expect(result.tracked).toBe(0);
    expect(result.inserted).toBe(0);
  });

  it('a failed wishlist select still refreshes alerted products, but marks loadFailed', async () => {
    fakeDb.tables.wishlist_items!.selectError = { message: 'wishlist boom' };
    const result = await refreshTrackedPrices(fakeClient as never);
    expect(result.loadFailed).toBe(true);
    expect(result.loadError).toContain('wishlist_items');
    expect(result.tracked).toBe(1);
    expect(result.unchanged).toBe(1);
  });

  it('a failed merchant_products select marks loadFailed and fails every tracked product', async () => {
    fakeDb.tables.merchant_products!.selectError = { message: 'merchants boom' };
    const result = await refreshTrackedPrices(fakeClient as never);
    expect(result.loadFailed).toBe(true);
    expect(result.failed).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it('a failed price_history select inserts nothing (no blind duplicates)', async () => {
    fakeDb.tables.price_history!.selectError = { message: 'history boom' };
    const result = await refreshTrackedPrices(fakeClient as never);
    expect(result.loadFailed).toBe(true);
    expect(result.loadError).toContain('price_history');
    expect(result.inserted).toBe(0);
  });
});

describe('P1-8 DB-error surfacing at the route level', () => {
  it('an alerts load failure reports the refresh step failed, never silent success', async () => {
    fakeDb.tables.alerts!.selectError = { message: 'alerts boom' };
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        refresh: { loadFailed: boolean };
        steps: Record<string, { status: string; error?: string }>;
      };
    };
    expect(data.refresh.loadFailed).toBe(true);
    expect(data.steps.refresh.status).toBe('failed');
    expect(data.steps.refresh.error).toContain('alerts');
    // The other steps still ran.
    expect(data.steps.notifications.status).toBe('ok');
  });

  it('a merchant_products load failure reports the stock step failed', async () => {
    fakeDb.tables.merchant_products!.selectError = { message: 'merchants boom' };
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { steps: Record<string, { status: string }> };
    };
    expect(data.steps.refresh.status).toBe('failed');
    expect(data.steps.stock.status).toBe('failed');
    expect(data.steps.alerts.status).toBe('ok');
    expect(data.steps.notifications.status).toBe('ok');
  });

  it('a missing guest_email_alerts table (migration 026 not applied) is still the tolerated empty state', async () => {
    // Default seed already omits the guest tables.
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        guestAlerts: { checked: number };
        steps: Record<string, { status: string }>;
      };
    };
    expect(data.guestAlerts.checked).toBe(0);
    expect(data.steps.stock.status).toBe('ok');
    expect(data.steps.guestAlerts.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// P1-7 — idempotency / run-in-progress guard
// ---------------------------------------------------------------------------

describe('P1-7 run-in-progress guard', () => {
  it('a second start while a run is in progress is refused', async () => {
    const first = await tryStartRefreshRun(fakeClient as never, 'prices-refresh');
    expect(first.started).toBe(true);
    expect(first.runId).toBeTruthy();
    const second = await tryStartRefreshRun(fakeClient as never, 'alerts-check');
    expect(second.started).toBe(false);
    expect(second.reason).toBe('run-in-progress');
    expect(second.existingRunId).toBe(first.runId);
  });

  it('a stale running row (older than the window) is marked failed and a new run starts', async () => {
    const staleStarted = new Date(Date.now() - REFRESH_RUN_STALE_MS - 60_000).toISOString();
    fakeDb.tables.price_refresh_runs!.rows.push({
      id: 'run-stale',
      source: 'prices-refresh',
      started_at: staleStarted,
      finished_at: null,
      status: 'running',
      steps: {},
      error: null,
    });
    const next = await tryStartRefreshRun(fakeClient as never, 'prices-refresh');
    expect(next.started).toBe(true);
    expect(next.runId).not.toBe('run-stale');
    const stale = fakeDb.tables.price_refresh_runs!.rows.find((r) => r.id === 'run-stale');
    expect(stale?.status).toBe('failed');
    expect(stale?.finished_at).toBeTruthy();
  });

  it('fails open when the runs table does not exist yet (migration 040 not applied)', async () => {
    delete fakeDb.tables.price_refresh_runs;
    const started = await tryStartRefreshRun(fakeClient as never, 'prices-refresh');
    expect(started.started).toBe(true);
    expect(started.runId).toBeNull();
  });

  it('the refresh route skips with 200 when another run is in progress', async () => {
    fakeDb.tables.price_refresh_runs!.rows.push({
      id: 'run-live',
      source: 'alerts-check',
      started_at: new Date().toISOString(),
      finished_at: null,
      status: 'running',
      steps: {},
      error: null,
    });
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        skipped: boolean;
        reason: string;
        existingRunId: string;
        steps: Record<string, { status: string }>;
      };
    };
    expect(data.skipped).toBe(true);
    expect(data.reason).toBe('run-in-progress');
    expect(data.existingRunId).toBe('run-live');
    expect(data.steps.refresh.status).toBe('skipped');
    // No new run row was started and no step ran.
    expect(fakeDb.tables.price_refresh_runs!.rows).toHaveLength(1);
    expect(mocks.checkPriceAlerts).not.toHaveBeenCalled();
  });

  it('the alerts/check route is skipped by the same shared guard', async () => {
    fakeDb.tables.price_refresh_runs!.rows.push({
      id: 'run-live',
      source: 'prices-refresh',
      started_at: new Date().toISOString(),
      finished_at: null,
      status: 'running',
      steps: {},
      error: null,
    });
    const res = await alertsCheckPOST(alertsCheckRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { skipped: boolean } };
    expect(data.skipped).toBe(true);
    expect(mocks.checkPriceAlerts).not.toHaveBeenCalled();
  });

  it('a completed run does not block the next run', async () => {
    const res1 = await refreshPOST(refreshRequest());
    expect(res1.status).toBe(200);
    const res2 = await refreshPOST(refreshRequest('203.0.113.12'));
    expect(res2.status).toBe(200);
    const { data } = (await res2.json()) as { data: { skipped: boolean } };
    expect(data.skipped).toBe(false);
    expect(fakeDb.tables.price_refresh_runs!.rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// P1-5 — last-refresh record
// ---------------------------------------------------------------------------

describe('P1-5 price_refresh_runs record', () => {
  it('writes one completed row per refresh run with per-step statuses', async () => {
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const rows = fakeDb.tables.price_refresh_runs!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('prices-refresh');
    expect(rows[0].status).toBe('completed');
    expect(rows[0].started_at).toBeTruthy();
    expect(rows[0].finished_at).toBeTruthy();
    const steps = rows[0].steps as Record<string, { status: string }>;
    expect(steps.refresh.status).toBe('ok');
    expect(steps.alerts.status).toBe('ok');
    expect(steps.notifications.status).toBe('ok');
    // Section 17, Stage D: the pipeline step is part of the
    // recorded run, with its honest skip status.
    expect(steps.pipeline.status).toBe('ok');
  });

  it('records completed_with_failures when a step fails', async () => {
    mocks.checkPriceAlerts.mockRejectedValueOnce(new Error('checker exploded'));
    await refreshPOST(refreshRequest());
    const rows = fakeDb.tables.price_refresh_runs!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed_with_failures');
    const steps = rows[0].steps as Record<string, { status: string; error?: string }>;
    expect(steps.alerts.status).toBe('failed');
    expect(steps.alerts.error).toContain('checker exploded');
    expect(rows[0].error).toContain('alerts: checker exploded');
  });

  it('the alerts/check run is recorded with its own source', async () => {
    await alertsCheckPOST(alertsCheckRequest());
    const rows = fakeDb.tables.price_refresh_runs!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('alerts-check');
    expect(rows[0].status).toBe('completed');
  });

  it('finishRefreshRun is a no-op without a run id (table missing)', async () => {
    // Must not throw when there is no run to finish.
    await finishRefreshRun(fakeClient as never, null, {}, 'completed');
  });

  it('getLatestRefreshRun returns the newest run and null when the table is missing', async () => {
    await refreshPOST(refreshRequest());
    await alertsCheckPOST(alertsCheckRequest('203.0.113.13'));
    const latest = await getLatestRefreshRun(fakeClient as never);
    expect(latest).not.toBeNull();
    expect(latest?.source).toBe('alerts-check');
    expect(latest?.status).toBe('completed');

    delete fakeDb.tables.price_refresh_runs;
    expect(await getLatestRefreshRun(fakeClient as never)).toBeNull();
  });

  it('migration 040 defines the runs table with CHECKs, RLS and a public SELECT policy', () => {
    const sql = repoFile('supabase', 'migrations', '20261112093000_040_price_refresh_runs.sql');
    expect(sql).toContain('DO NOT APPLY YET');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.price_refresh_runs');
    expect(sql).toContain("CHECK (source IN ('prices-refresh', 'alerts-check'))");
    expect(sql).toContain("CHECK (status IN ('running', 'completed', 'completed_with_failures', 'failed'))");
    expect(sql).toContain('finished_at timestamptz NULL DEFAULT NULL');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FOR SELECT TO anon');
    // No anon/authenticated INSERT policy: writes are service-role only.
    expect(sql).not.toMatch(/FOR INSERT TO (anon|authenticated)/);
    // The price_history UNIQUE index was deliberately NOT added here
    // (needs a live duplicate check first) — the migration must not
    // contain one.
    expect(sql).not.toContain('CREATE UNIQUE INDEX');
  });

  it('the status page reads the latest run and fails open without it', () => {
    const page = repoFile('app', 'status', 'page.tsx');
    expect(page).toContain('getLatestRefreshRun');
    expect(page).toContain('Last price refresh');
    expect(page).toContain('No price refresh run has been recorded yet');
  });
});

// ---------------------------------------------------------------------------
// P1-3 — timeouts
// ---------------------------------------------------------------------------

describe('P1-3 timeouts', () => {
  it('withTimeout resolves a fast promise', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'fast')).resolves.toBe('ok');
  });

  it('withTimeout rejects a hanging promise with a TimeoutError', async () => {
    const hanging = new Promise(() => {
      // Never settles.
    });
    await expect(withTimeout(hanging, 10, 'hanging call')).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });

  it('withTimeout passes a rejection through unchanged', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('upstream boom')), 50, 'failing')
    ).rejects.toThrow('upstream boom');
  });

  it('the eBay adapter passes an AbortSignal with a 10s timeout to every fetch', async () => {
    const seenSignals: Array<AbortSignal | undefined> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seenSignals.push(init?.signal as AbortSignal | undefined);
      if (String(url).includes('oauth2/token')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      return { ok: true, json: async () => ({ itemSummaries: [] }) };
    }) as unknown as typeof fetch;
    const result = await searchEbayListings('macbook', { fetchFn });
    expect(result).toEqual({ ok: true, source: 'ebay-browse-api', listings: [] });
    expect(seenSignals).toHaveLength(2);
    for (const signal of seenSignals) {
      expect(signal).toBeInstanceOf(AbortSignal);
    }
    expect(EBAY_FETCH_TIMEOUT_MS).toBe(10_000);
  });

  it('an aborted eBay call surfaces as api-error, never a throw', async () => {
    const fetchFn = (async (url: string) => {
      if (String(url).includes('oauth2/token')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      const err = new Error('The operation timed out');
      err.name = 'TimeoutError';
      throw err;
    }) as unknown as typeof fetch;
    const result = await searchEbayListings('macbook', { fetchFn });
    expect(result).toEqual({ ok: false, reason: 'api-error', listings: [] });
  });

  it('email and push sends are bounded at 10s via withTimeout', () => {
    expect(EMAIL_SEND_TIMEOUT_MS).toBe(10_000);
    expect(PUSH_SEND_TIMEOUT_MS).toBe(10_000);
    const emailSrc = repoFile('services', 'email.ts');
    expect(emailSrc).toContain('withTimeout(');
    expect(emailSrc).toContain('EMAIL_SEND_TIMEOUT_MS');
    const pushSrc = repoFile('services', 'push.ts');
    expect(pushSrc).toContain('withTimeout(');
    expect(pushSrc).toContain('PUSH_SEND_TIMEOUT_MS');
    const ebaySrc = repoFile('services', 'ebay-browse.ts');
    expect(ebaySrc).toContain('AbortSignal.timeout(EBAY_FETCH_TIMEOUT_MS)');
  });

  it('maxDuration is set only on the five intended cron routes, and never above the 60s Hobby ceiling', () => {
    // Section 18, item 36 — the old "no route sets maxDuration"
    // premise is superseded BY DESIGN: the five long-running cron
    // routes deliberately export maxDuration = 60 (the Vercel
    // Hobby ceiling, documented in each route's comment). The
    // policy now is: no maxDuration anywhere exceeds 60, and
    // exactly these five routes carry it.
    const intended = [
      ['app', 'api', 'v1', 'prices', 'refresh', 'route.ts'],
      ['app', 'api', 'v1', 'alerts', 'check', 'route.ts'],
      ['app', 'api', 'v1', 'data', 'refresh', 'route.ts'],
      ['app', 'api', 'v1', 'notifications', 'process', 'route.ts'],
      ['app', 'api', 'v1', 'notifications', 'digest', 'route.ts'],
    ];
    for (const parts of intended) {
      expect(repoFile(...parts)).toContain('export const maxDuration = 60');
    }
    // Sweep the whole app tree: every maxDuration assignment must
    // be <= 60, and only the five intended routes may set one.
    const found: Array<{ file: string; value: number }> = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(full, 'utf8');
          for (const m of src.matchAll(/maxDuration\s*=\s*(\d+)/g)) {
            found.push({ file: full, value: Number(m[1]) });
          }
        }
      }
    };
    walk(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app'));
    expect(found.length).toBe(5);
    for (const { file, value } of found) {
      expect(value).toBeLessThanOrEqual(60);
      expect(value).toBe(60);
    }
  });
});

// ---------------------------------------------------------------------------
// Section 17, Stage D — pipeline re-fetch leg + run ledger
// ---------------------------------------------------------------------------

describe('Stage D pipeline step (refresh route)', () => {
  it('runs after ebay and before refresh, and available:false is a skip, not a failure', async () => {
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        skipped: boolean;
        ebay: { status: string };
        pipeline: { available: boolean; reason?: string };
        steps: Record<string, { status: string }>;
      };
    };
    expect(data.skipped).toBe(false);
    // Step order: ebay → pipeline → refresh (insertion order of
    // the steps record).
    const names = Object.keys(data.steps);
    expect(names.indexOf('pipeline')).toBeGreaterThan(names.indexOf('ebay'));
    expect(names.indexOf('pipeline')).toBeLessThan(names.indexOf('refresh'));
    // In this harness the Mock provider is available but the
    // fake client has no `products` table, so the step reports
    // available:false — and the step status is still 'ok': an
    // honest skip, never a failure.
    expect(data.pipeline.available).toBe(false);
    expect(data.pipeline.reason).toBe('due-products-unreadable');
    expect(data.steps.pipeline.status).toBe('ok');
    // The run is NOT completed_with_failures because of it.
    const rows = fakeDb.tables.price_refresh_runs!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
  });

  it('the eBay leg is still intact: it runs first and degrades to merchant-missing', async () => {
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        ebay: { status: string };
        steps: Record<string, { status: string }>;
      };
    };
    // merchants has only the amazon row in this harness — no
    // ebay row — so the step degrades honestly and the run
    // continues on recorded prices.
    expect(data.ebay.status).toBe('merchant-missing');
    expect(data.steps.ebay.status).toBe('ok');
  });

  it('the run ledger is still written when the table exists, and the run proceeds when it is missing', async () => {
    const res = await refreshPOST(refreshRequest());
    expect(res.status).toBe(200);
    const rows = fakeDb.tables.price_refresh_runs!.rows;
    expect(rows).toHaveLength(1);
    const steps = rows[0].steps as Record<string, { status: string }>;
    expect(steps.ebay.status).toBe('ok');
    expect(steps.pipeline.status).toBe('ok');
    expect(steps.refresh.status).toBe('ok');

    // Missing-table path (migration 040 unapplied): the guard
    // fails open — 200, unguarded, unrecorded, never a 500.
    delete fakeDb.tables.price_refresh_runs;
    const res2 = await refreshPOST(refreshRequest('203.0.113.12'));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { data: { skipped: boolean } };
    expect(body2.data.skipped).toBe(false);
  });

  it('the route wires the pipeline wrapper, not pipeline ingestion', () => {
    const src = repoFile('app', 'api', 'v1', 'prices', 'refresh', 'route.ts');
    expect(src).toContain('refreshPricesViaPipeline');
    expect(src).toContain("from '@/services/pipeline-refresh'");
    expect(src).toContain('pipeline: summarizeStep(pipeline, {');
    expect(src).toContain('pipeline: pipeline.result');
    expect(src).toContain("'pipeline',");
    expect(src).not.toContain('ingestBatch');
    expect(src).not.toContain('ingestProduct');
  });
});
