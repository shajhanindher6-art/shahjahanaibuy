/**
 * Section 18, Phase 2 — /status DB aggregate + explicit column
 * lists (audit §1 #21/#68, §12 items 29, 30).
 *
 * Item 29: /status pulled up to 2,000 uptime_checks rows per visit
 * and summarized in JS. `fetchStatusUptime` must return the
 * IDENTICAL summary from two head:true counts + first/last rows.
 *
 * Item 30: 23× select('*'). The worst offenders (subscriptions
 * route ×4, services/monitoring.ts ×4) plus settings, preferences,
 * ai-summary, ai-deals, ai-predictions, affiliate links and the
 * notification routes now select explicit column lists. The fake
 * client PROJECTS rows to the requested columns, so a dropped
 * column shows up as an undefined field in the mapped result —
 * these tests assert the callers still see every column they read.
 * Deliberately NOT converted (and asserted as such): the
 * settings/webhooks GET, whose `c in row` migration detection
 * needs select('*') semantics, and services/stripe.ts (owned by
 * another worker — untouched here).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';

import {
  buildStatusSummary,
  buildStatusSummaryFromUptime,
  fetchStatusUptime,
  type StatusIncident,
} from '@/lib/status';
import { summarizeUptime, summarizeUptimeFromCounts } from '@/lib/uptime';
import {
  getProviderHealth,
  getSyncHistory,
  getQueueMetrics,
  recordProviderHealth,
} from '@/services/monitoring';
import { getUserSettings, updateUserSettings } from '@/services/settings';
import { getUserPreferences, upsertUserPreferences } from '@/services/user-preferences';

// --- Route mocks (module boundary) -------------------------------------------
const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: mocks.createServerClient,
}));

vi.mock('@/lib/api/middleware', () => ({
  logApiRequest: () => {},
  requireAuth: async () => ({ userId: 'u1' }),
  rateLimitResponse: async () => null,
  getClientIp: () => '127.0.0.1',
}));

import { GET as subscriptionsGET, POST as subscriptionsPOST } from '@/app/api/v1/subscriptions/route';
import { GET as affiliateLinksGET } from '@/app/api/v1/affiliate/links/route';
import { GET as notificationsGET } from '@/app/api/v1/notifications/route';
import { PATCH as notificationPATCH } from '@/app/api/v1/notifications/[id]/route';
import { GET as webhooksGET } from '@/app/api/v1/settings/webhooks/route';

// --- Fake Supabase client (column-projecting) --------------------------------

type Row = Record<string, unknown>;

interface FakeTable {
  rows: Row[];
  selectError?: { code?: string; message: string };
}

const fakeDb = {
  tables: {} as Record<string, FakeTable>,
  queries: [] as Array<{ table: string; cols?: string; head?: boolean; limit?: number | null }>,
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
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private writeRows: Row[] = [];
  private upsertConflict: string | null = null;
  private updatePatch: Row = {};
  private wantSingle = false;
  private wantMaybeSingle = false;
  private selectCols?: string;
  private selectOpts?: { count?: string; head?: boolean };

  constructor(private readonly table: string) {}

  select(cols?: string, opts?: { count?: string; head?: boolean }): this {
    this.selectCols = cols;
    this.selectOpts = opts;
    fakeDb.queries.push({ table: this.table, cols, head: opts?.head, limit: this.limitN });
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
  gt(col: string, value: unknown): this {
    this.filters.push((r) => String(r[col] ?? '') > String(value));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
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
    this.writeRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return this;
  }
  update(patch: Row): this {
    this.op = 'update';
    this.updatePatch = patch;
    return this;
  }
  upsert(rowOrRows: Row | Row[], opts?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.upsertConflict = opts?.onConflict ?? null;
    this.writeRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private project(rows: Row[]): Row[] {
    if (!this.selectCols || this.selectCols.trim() === '*') return rows;
    const cols = this.selectCols.split(',').map((s) => s.trim()).filter(Boolean);
    return rows.map((r) => {
      const out: Row = {};
      for (const c of cols) out[c] = r[c];
      return out;
    });
  }

  private async execute(): Promise<{ data: unknown; error: unknown; count?: number }> {
    const table = fakeDb.tables[this.table];
    if (!table) {
      return { data: null, error: { code: 'PGRST205', message: `Could not find the table '${this.table}'` } };
    }
    if (table.selectError) return { data: null, error: table.selectError };
    if (this.op === 'insert' || this.op === 'upsert') {
      const inserted = this.writeRows.map((row) => ({ ...row }));
      for (const row of inserted) {
        // Upsert with an onConflict column replaces the matching
        // row (like Postgres ON CONFLICT DO UPDATE); a plain
        // insert appends.
        const conflictCol = this.op === 'upsert' ? this.upsertConflict : null;
        const existing =
          conflictCol !== null
            ? table.rows.find((r) => r[conflictCol] === row[conflictCol])
            : undefined;
        if (existing) Object.assign(existing, row);
        else table.rows.push(row);
      }
      const projected = this.project(inserted);
      return this.wantMaybeSingle || this.wantSingle
        ? { data: projected[0] ?? null, error: null }
        : { data: projected, error: null };
    }
    if (this.op === 'update') {
      const matched = table.rows.filter((r) => this.filters.every((f) => f(r)));
      for (const row of matched) Object.assign(row, this.updatePatch);
      const projected = this.project(matched);
      return this.wantMaybeSingle || this.wantSingle
        ? { data: projected[0] ?? null, error: null }
        : { data: projected, error: null };
    }
    let rows = table.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.selectOpts?.head) {
      return { data: [], error: null, count: rows.length };
    }
    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      rows = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av;
        const as = String(av ?? '');
        const bs = String(bv ?? '');
        return asc ? (as < bs ? -1 : as > bs ? 1 : 0) : as > bs ? -1 : as < bs ? 1 : 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    const projected = this.project(rows);
    if (this.wantMaybeSingle) return { data: projected[0] ?? null, error: null };
    if (this.wantSingle) {
      return projected.length === 0
        ? { data: null, error: { code: 'PGRST116', message: '0 rows' } }
        : { data: projected[0], error: null };
    }
    return { data: projected, error: null };
  }
}

const fakeClient = {
  from: (table: string) => {
    fakeDb.fromCalls[table] = (fakeDb.fromCalls[table] ?? 0) + 1;
    return new FakeQuery(table);
  },
  auth: {
    getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
  },
} as unknown as Parameters<typeof getUserSettings>[0];

function repoFile(...parts: string[]): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts),
    'utf8'
  );
}

beforeEach(() => {
  resetFakeDb();
  mocks.createServerClient.mockReturnValue(fakeClient);
});

// ---------------------------------------------------------------------------
// Item 29 — /status DB-side aggregate, identical numbers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-11-12T12:00:00Z');

function uptimeRows(): Row[] {
  return [
    { checked_at: '2026-08-01T12:00:00Z', ok: true }, // outside the 90d window
    { checked_at: '2026-08-15T12:00:00Z', ok: true },
    { checked_at: '2026-11-10T12:00:00Z', ok: true },
    { checked_at: '2026-11-11T12:00:00Z', ok: false },
    { checked_at: '2026-11-12T11:00:00Z', ok: true },
  ];
}

function checkRow(overrides: Partial<Row> = {}): Row {
  return {
    checked_at: '2026-11-12T11:00:00Z',
    target_url: 'https://example.com/',
    status_code: 200,
    ok: true,
    response_ms: 120,
    error: null,
    source: 'cron',
    ...overrides,
  };
}

describe('status aggregate DB-side (item 29)', () => {
  it('counts summary equals the row summary on the same data', () => {
    const rows = uptimeRows().map((r) => checkRow(r));
    const fromRows = buildStatusSummary(rows as never, [], 90, NOW);
    const counts = summarizeUptimeFromCounts({
      totalChecks: 4,
      okChecks: 3,
      firstCheckAt: '2026-08-15T12:00:00Z',
      lastCheckAt: '2026-11-12T11:00:00Z',
      lastOk: true,
      lastStatusCode: 200,
      lastTargetUrl: 'https://example.com/',
      windowDays: 90,
    });
    const fromCounts = buildStatusSummaryFromUptime(counts, []);
    expect(fromCounts).toEqual(fromRows);
    expect(fromCounts.uptime.uptimePercent).toBe(75);
    expect(fromCounts.overall).toBe('operational');
  });

  it('agrees on degraded (last check failed) and unknown (no data)', () => {
    const failed = summarizeUptimeFromCounts({
      totalChecks: 2, okChecks: 1,
      firstCheckAt: '2026-11-11T00:00:00Z', lastCheckAt: '2026-11-12T00:00:00Z',
      lastOk: false, windowDays: 90,
    });
    expect(buildStatusSummaryFromUptime(failed, []).overall).toBe('degraded');
    expect(buildStatusSummaryFromUptime(failed, []).message).toContain('most recent check failed');

    const empty = summarizeUptimeFromCounts({
      totalChecks: 0, okChecks: 0,
      firstCheckAt: null, lastCheckAt: null, lastOk: null, windowDays: 90,
    });
    expect(buildStatusSummaryFromUptime(empty, []).overall).toBe('unknown');

    // And the row-based builder still agrees with the counts one.
    const rows = [checkRow({ checked_at: '2026-11-11T00:00:00Z', ok: true }), checkRow({ ok: false })];
    expect(buildStatusSummary(rows as never, [], 90, NOW).overall).toBe('degraded');
  });

  it('agrees on outage / monitored incidents', () => {
    const counts = summarizeUptimeFromCounts({
      totalChecks: 4, okChecks: 4,
      firstCheckAt: '2026-08-15T12:00:00Z', lastCheckAt: '2026-11-12T11:00:00Z',
      lastOk: true, windowDays: 90,
    });
    const investigating: StatusIncident[] = [
      { id: 'i1', started_at: '2026-11-12T00:00:00Z', resolved_at: null, title: 'Outage', status: 'investigating', description: null },
    ];
    expect(buildStatusSummaryFromUptime(counts, investigating).overall).toBe('outage');
    const monitoring: StatusIncident[] = [
      { ...investigating[0], status: 'monitoring' },
    ];
    expect(buildStatusSummaryFromUptime(counts, monitoring).overall).toBe('degraded');
  });

  it('fetchStatusUptime issues 4 small queries, never a 2000-row pull', async () => {
    seedTable('uptime_checks', uptimeRows().map((r) => checkRow(r)));
    const uptime = await fetchStatusUptime(fakeClient, 90, NOW);
    expect(uptime).not.toBeNull();
    expect(uptime?.totalChecks).toBe(4);
    expect(uptime?.okChecks).toBe(3);
    expect(uptime?.uptimePercent).toBe(75);
    expect(uptime?.firstCheckAt).toBe('2026-08-15T12:00:00Z');
    expect(uptime?.lastCheckAt).toBe('2026-11-12T11:00:00Z');
    expect(uptime?.lastOk).toBe(true);

    const checks = fakeDb.queries.filter((q) => q.table === 'uptime_checks');
    expect(checks).toHaveLength(4);
    // Two head:true counts (zero rows transferred)…
    expect(checks.filter((q) => q.head === true)).toHaveLength(2);
    // …and two one-row reads. No 2000-row pull anywhere.
    expect(checks.some((q) => q.limit === 2000)).toBe(false);
    expect(checks.every((q) => (q.limit ?? 1) <= 1 || q.head === true)).toBe(true);
    // The counts summary equals the row summary for the same data.
    const rows = uptimeRows().map((r) => checkRow(r));
    const rowSummary = summarizeUptime(rows as never, 90, NOW);
    expect({ ...uptime, lastOk: uptime?.lastOk }).toEqual(rowSummary);
  });

  it('fetchStatusUptime returns null on a read failure', async () => {
    seedTable('uptime_checks', [], {
      selectError: { code: '42P01', message: 'relation does not exist' },
    });
    await expect(fetchStatusUptime(fakeClient, 90, NOW)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Item 30 — explicit column lists
// ---------------------------------------------------------------------------

describe('explicit column lists (item 30)', () => {
  it('monitoring getters read back every column they map', async () => {
    seedTable('provider_health', [
      {
        provider_key: 'resend', status: 'healthy', success_count: 3, failure_count: 1,
        consecutive_failures: 0, last_success_at: '2026-11-12T00:00:00Z',
        last_failure_at: '2026-11-11T00:00:00Z', last_error: 'x',
        circuit_opened_at: null, avg_response_ms: 42, updated_at: '2026-11-12T00:00:00Z',
      },
    ]);
    seedTable('sync_history', [
      {
        id: 's1', provider_key: 'resend', sync_type: 'incremental', status: 'ok',
        records_fetched: 5, records_inserted: 4, records_updated: 1, records_rejected: 0,
        error_message: null, duration_ms: 100, started_at: '2026-11-12T00:00:00Z',
        completed_at: '2026-11-12T00:01:00Z',
      },
    ]);
    seedTable('queue_metrics', [
      {
        queue_name: 'sync', waiting_count: 1, active_count: 0, completed_count: 9,
        failed_count: 1, delayed_count: 0, throughput_per_min: 10, avg_latency_ms: 5,
        recorded_at: '2026-11-12T00:00:00Z',
      },
    ]);
    const providers = await getProviderHealth(fakeClient);
    expect(providers[0]).toEqual({
      providerKey: 'resend', status: 'healthy', successCount: 3, failureCount: 1,
      consecutiveFailures: 0, lastSuccessAt: '2026-11-12T00:00:00Z',
      lastFailureAt: '2026-11-11T00:00:00Z', avgResponseMs: 42,
    });
    const syncs = await getSyncHistory(fakeClient);
    expect(syncs[0]?.recordsFetched).toBe(5);
    expect(syncs[0]?.completedAt).toBe('2026-11-12T00:01:00Z');
    const metrics = await getQueueMetrics(fakeClient);
    expect(metrics[0]?.throughputPerMin).toBe(10);
    expect(metrics[0]?.recordedAt).toBe('2026-11-12T00:00:00Z');

    // And the recorded selects are explicit lists, never '*'.
    const selects = fakeDb.queries.map((q) => q.cols ?? '');
    expect(selects.length).toBeGreaterThan(0);
    expect(selects.every((c) => c !== '*')).toBe(true);
  });

  it('recordProviderHealth reads back the counters it increments', async () => {
    seedTable('provider_health', [
      {
        provider_key: 'resend', status: 'healthy', success_count: 2, failure_count: 0,
        consecutive_failures: 0, last_success_at: null, last_failure_at: null,
        avg_response_ms: 100, updated_at: '2026-11-12T00:00:00Z',
      },
    ]);
    await recordProviderHealth(fakeClient, { providerKey: 'resend', success: true, responseMs: 50 });
    const row = fakeDb.tables['provider_health'].rows[0];
    // 2 + 1 successes; avg moves 10% toward the new sample.
    expect(row.success_count).toBe(3);
    expect(row.avg_response_ms).toBe(Math.round(100 * 0.9 + 50 * 0.1));
  });

  it('settings + preferences map every column they read', async () => {
    seedTable('user_settings', [
      {
        id: 'us1', user_id: 'u1', currency: 'PKR', language: 'ur', timezone: 'Asia/Karachi',
        email_notifications: true, push_notifications: false, price_alerts: true,
        created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
      },
    ]);
    seedTable('user_preferences', [
      {
        id: 'up1', user_id: 'u1', budget_min: 100, budget_max: 500,
        favorite_brands: ['Apple'], favorite_categories: ['phones'],
        preferred_retailers: ['amazon'], notification_email: true,
        notification_push: false, created_at: '2026-11-01T00:00:00Z',
        updated_at: '2026-11-02T00:00:00Z',
      },
    ]);
    const settings = await getUserSettings(fakeClient, 'u1');
    expect(settings).toMatchObject({ currency: 'PKR', language: 'ur', timezone: 'Asia/Karachi' });
    const updated = await updateUserSettings(fakeClient, 'u1', { currency: 'USD' });
    expect((updated as unknown as Row).currency).toBe('USD');
    const prefs = await getUserPreferences(fakeClient, 'u1');
    expect(prefs).toMatchObject({ budgetMin: 100, budgetMax: 500, favoriteBrands: ['Apple'] });
    const upserted = await upsertUserPreferences(fakeClient, 'u1', { budgetMax: 900 });
    expect(upserted?.budgetMax).toBe(900);
    expect(fakeDb.queries.map((q) => q.cols ?? '').every((c) => c !== '*')).toBe(true);
  });

  it('subscriptions GET returns all 13 columns, POST insert + update too', async () => {
    const row: Row = {
      id: 'sub-1', user_id: 'u1', plan: 'free', status: 'active',
      stripe_customer_id: 'cus_1', stripe_subscription_id: null, stripe_price_id: null,
      current_period_start: '2026-11-01T00:00:00Z', current_period_end: '2026-12-01T00:00:00Z',
      cancel_at_period_end: false, trial_end: null,
      created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
    };
    const cols = Object.keys(row).sort();
    seedTable('subscriptions', [row]);

    const getRes = await subscriptionsGET(new NextRequest('http://localhost/api/v1/subscriptions'));
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { data: Row };
    expect(Object.keys(getBody.data).sort()).toEqual(cols);

    // POST with an existing row → update path.
    const postRes = await subscriptionsPOST(
      new NextRequest('http://localhost/api/v1/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: 'free' }),
      })
    );
    expect(postRes.status).toBe(200);
    const postBody = (await postRes.json()) as { data: Row };
    expect(Object.keys(postBody.data).sort()).toEqual(cols);

    // POST with no row → insert path.
    resetFakeDb();
    mocks.createServerClient.mockReturnValue(fakeClient);
    seedTable('subscriptions', []);
    const insertRes = await subscriptionsPOST(
      new NextRequest('http://localhost/api/v1/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: 'free' }),
      })
    );
    // POST with no row → insert path. The fake insert has no DB
    // defaults (no id/created_at/updated_at generated), so the
    // JSON response cannot carry those keys — assert instead the
    // client-set fields AND that the insert's select asked for the
    // full 13-column list (the GET + update paths above already
    // prove the list round-trips).
    expect(insertRes.status).toBe(200);
    const insertBody = (await insertRes.json()) as { data: Row };
    expect(insertBody.data).toMatchObject({ plan: 'free', user_id: 'u1' });
    const insertSelect = fakeDb.queries.find(
      (q) => q.table === 'subscriptions' && (q.cols ?? '').includes('stripe_customer_id')
    );
    expect(insertSelect?.cols?.split(',').map((s) => s.trim()).sort()).toEqual(cols);
  });

  it('affiliate links + notifications return every mapped column', async () => {
    seedTable('affiliate_links', [
      {
        id: 'al1', product_id: 'p1', retailer_id: 'r1', merchant_id: 'm1',
        retailer_name: 'Amazon', original_url: 'https://example.com/p',
        affiliate_url: 'https://example.com/p?tag=x', affiliate_id: 'aff1',
        commission_rate: 0.04, clicks_count: 7, conversions_count: 1,
        revenue_generated: 12.5, active: true,
        created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
      },
    ]);
    const linksRes = await affiliateLinksGET(
      new NextRequest('http://localhost/api/v1/affiliate/links?productId=p1')
    );
    expect(linksRes.status).toBe(200);
    const linksBody = (await linksRes.json()) as { data: Row[] };
    expect(Object.keys(linksBody.data[0]).sort()).toEqual([
      'active', 'affiliate_id', 'affiliate_url', 'clicks_count', 'commission_rate',
      'conversions_count', 'created_at', 'id', 'merchant_id', 'original_url',
      'product_id', 'retailer_id', 'retailer_name', 'revenue_generated', 'updated_at',
    ]);

    seedTable('notification_queue', [
      {
        id: 'n1', user_id: 'u1', type: 'price_drop', channel: 'email',
        subject: 'Drop', body: 'Price dropped', data: { read: false },
        status: 'sent', scheduled_for: '2026-11-11T00:00:00Z',
        sent_at: '2026-11-11T01:00:00Z', created_at: '2026-11-10T00:00:00Z',
      },
    ]);
    const listRes = await notificationsGET(new NextRequest('http://localhost/api/v1/notifications'));
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: Array<Row> };
    expect(listBody.data[0]).toMatchObject({
      id: 'n1', scheduledFor: '2026-11-11T00:00:00Z',
      sentAt: '2026-11-11T01:00:00Z', createdAt: '2026-11-10T00:00:00Z',
    });

    const patchRes = await notificationPATCH(
      new NextRequest('http://localhost/api/v1/notifications/n1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ read: true }),
      }),
      { params: { id: 'n1' } }
    );
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { data: Row };
    expect((patchBody.data.data as Row).read).toBe(true);
    expect(patchBody.data.id).toBe('n1');
  });

  it('webhooks GET still detects a partially-applied migration (select * kept on purpose)', async () => {
    // All six webhook columns present → both applied.
    seedTable('user_settings', [
      {
        id: 'us1', user_id: 'u1', currency: 'USD', language: 'en', timezone: 'UTC',
        email_notifications: true, push_notifications: true, price_alerts: true,
        created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
        whatsapp_enabled: true, whatsapp_phone: '+92', telegram_enabled: false,
        telegram_chat_id: null, generic_webhook_url: 'https://example.com/hook',
        generic_webhook_secret_hash: 'abc',
      },
    ]);
    const fullRes = await webhooksGET(new NextRequest('http://localhost/api/v1/settings/webhooks'));
    const fullBody = (await fullRes.json()) as { data: Row };
    expect(fullBody.data.migrationApplied).toBe(true);
    expect(fullBody.data.genericMigrationApplied).toBe(true);

    // Only the WhatsApp/Telegram columns present (generic migration
    // not run) → whatsapp applied, generic not. An explicit column
    // list would have 42703-failed the whole select here instead.
    resetFakeDb();
    mocks.createServerClient.mockReturnValue(fakeClient);
    seedTable('user_settings', [
      {
        id: 'us1', user_id: 'u1', currency: 'USD', language: 'en', timezone: 'UTC',
        email_notifications: true, push_notifications: true, price_alerts: true,
        created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
        whatsapp_enabled: true, whatsapp_phone: '+92', telegram_enabled: false,
        telegram_chat_id: null,
      },
    ]);
    const partRes = await webhooksGET(new NextRequest('http://localhost/api/v1/settings/webhooks'));
    const partBody = (await partRes.json()) as { data: Row };
    expect(partBody.data.migrationApplied).toBe(true);
    expect(partBody.data.genericMigrationApplied).toBe(false);
  });

  it('no row-returning select(*) remains in the converted files', () => {
    const converted = [
      ['app', 'api', 'v1', 'subscriptions', 'route.ts'],
      ['services', 'monitoring.ts'],
      ['services', 'settings.ts'],
      ['services', 'user-preferences.ts'],
      ['services', 'ai-summary.ts'],
      ['services', 'ai-deals.ts'],
      ['services', 'ai-predictions.ts'],
      ['app', 'api', 'v1', 'affiliate', 'links', 'route.ts'],
      ['app', 'api', 'v1', 'notifications', 'route.ts'],
      ['app', 'api', 'v1', 'notifications', '[id]', 'route.ts'],
    ];
    for (const parts of converted) {
      const src = repoFile(...parts);
      // `.select('*')` as code (comments mentioning it don't count).
      const codeSelects = src
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .filter((line) => line.includes(".select('*')"));
      expect(codeSelects).toEqual([]);
    }
    // ai-summary's getVariantsData uses select('*', {count, head:true})
    // — a count-only query that transfers no rows; out of scope.
    const aiSummary = repoFile('services', 'ai-summary.ts');
    expect(aiSummary).toContain("select('*', { count: 'exact', head: true })");
  });

  it('the two deliberate exceptions are documented in code', () => {
    const webhooks = repoFile('app', 'api', 'v1', 'settings', 'webhooks', 'route.ts');
    expect(webhooks).toContain('INTENTIONALLY kept');
    const stripe = repoFile('services', 'stripe.ts');
    expect(stripe).toContain(".select('*')");
  });
});
