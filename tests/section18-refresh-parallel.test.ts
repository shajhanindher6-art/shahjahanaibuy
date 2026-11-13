/**
 * Section 18, Phase 2 — refresh chain parallelisation (audit §1
 * #27, §12 item 37) and maxDuration (audit §1 #26, §12 item 36).
 *
 * Item 37: the 11 steps run in waves — A sequential (ebay →
 * pipeline), B parallel (refresh + stock), C parallel (alerts +
 * hunts + digest + savedSearches), D parallel (notifications +
 * guestAlerts), E sequential (guestEmail). Steps that depend on
 * earlier steps stay sequential; independent steps run
 * concurrently. The barrier test below proves C actually overlaps:
 * if alerts and hunts ran one after another, the barrier would
 * time out instead of resolving.
 *
 * Item 36: the five long-running cron routes export
 * `maxDuration = 60` (Vercel Hobby cap — do not raise without a
 * paid plan).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mapWithConcurrencyLimit } from '@/lib/with-concurrency';

function repoFile(...parts: string[]): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts),
    'utf8'
  );
}

describe('maxDuration (item 36)', () => {
  const routes = [
    'app/api/v1/prices/refresh/route.ts',
    'app/api/v1/alerts/check/route.ts',
    'app/api/v1/data/refresh/route.ts',
    'app/api/v1/notifications/process/route.ts',
    'app/api/v1/notifications/digest/route.ts',
  ];
  for (const route of routes) {
    it(`${route} exports maxDuration = 60 (Vercel Hobby ceiling)`, () => {
      const src = repoFile(...route.split('/'));
      expect(src).toContain('export const maxDuration = 60;');
      expect(src).not.toMatch(/export const maxDuration = (?!60)[0-9]+/);
    });
  }
});

describe('mapWithConcurrencyLimit (item 37)', () => {
  it('preserves input order', async () => {
    const out = await mapWithConcurrencyLimit([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n === 1 ? 20 : 0));
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it('never exceeds the cap', async () => {
    let running = 0;
    let maxRunning = 0;
    await mapWithConcurrencyLimit(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(maxRunning).toBeGreaterThan(1); // actually parallel, not serial
  });

  it('handles an empty list and a cap above the list size', async () => {
    expect(await mapWithConcurrencyLimit([], 5, async (n: number) => n)).toEqual([]);
    expect(await mapWithConcurrencyLimit([1, 2], 10, async (n) => n + 1)).toEqual([2, 3]);
  });
});

// --- Route level: wave C really runs concurrently ---------------------------

type Row = Record<string, unknown>;

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private limitN: number | null = null;
  private op: 'select' | 'insert' | 'update' = 'select';
  private insertRows: Row[] = [];
  private wantSingle = false;

  constructor(
    private readonly table: string,
    private readonly tables: Record<string, Row[]>
  ) {}

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
  order(): this { return this; }
  limit(n: number): this { this.limitN = n; return this; }
  single(): this { this.wantSingle = true; return this; }
  maybeSingle(): this { this.wantSingle = true; return this; }
  insert(rowOrRows: Row | Row[]): this {
    this.op = 'insert';
    this.insertRows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    return this;
  }
  update(): this { this.op = 'update'; return this; }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    if (this.op === 'insert') {
      const rows = this.insertRows.map((row, i) => ({ ...row, id: row.id ?? `fake-${i}` }));
      this.tables[this.table] = [...(this.tables[this.table] ?? []), ...rows];
      return this.wantSingle ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
    }
    if (this.op === 'update') return { data: [], error: null };
    let rows = (this.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantSingle) {
      return rows.length === 0
        ? { data: null, error: { code: 'PGRST116', message: '0 rows' } }
        : { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }
}

const routeMocks = vi.hoisted(() => ({
  checkPriceAlerts: vi.fn(),
  processNotificationQueue: vi.fn(async () => ({ processed: 0, sent: 0, failed: 0 })),
  runHunts: vi.fn(),
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

describe('refresh waves run concurrently where independent (item 37)', () => {
  it(
    'wave C: alerts and hunts overlap (barrier), and the run still returns 200 with all steps',
    async () => {
      const tables: Record<string, Row[]> = {
        price_refresh_runs: [],
        merchants: [],
        weekly_digests: [],
        saved_searches: [],
      };
      serviceMocks.createServiceClient.mockReturnValue({
        from: (table: string) => new FakeQuery(table, tables),
      });
      process.env.CRON_SECRET = 'test-secret';

      // Barrier: each step signals it started, then waits until
      // BOTH have started. Sequential execution deadlocks (the
      // first step waits forever for the second to start) — the
      // 5s timeout below fails fast instead of hanging. (Was 2s:
      // under parallel load the second step can take longer than
      // that to start — Section 19, Phase 0, §12 #90.)
      let alertsStarted = false;
      let huntsStarted = false;
      const waitForBoth = () =>
        new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(() => reject(new Error('wave-C barrier timed out — steps did not overlap')), 5000);
          const check = () => {
            if (alertsStarted && huntsStarted) {
              clearTimeout(deadline);
              resolve();
            } else {
              setTimeout(check, 5);
            }
          };
          check();
        });
      routeMocks.checkPriceAlerts.mockImplementation(async () => {
        alertsStarted = true;
        await waitForBoth();
        return { checked: 0, triggered: 0, queued: 0, skippedDuplicate: 0, failed: 0 };
      });
      routeMocks.runHunts.mockImplementation(async () => {
        huntsStarted = true;
        await waitForBoth();
        return { usersChecked: 0, huntsRun: 0, matchesCreated: 0, huntsEnabled: false };
      });

      const req = new NextRequest('http://localhost/api/v1/prices/refresh', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret', 'x-real-ip': '203.0.113.97' },
      });
      const res = await refreshPOST(req);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { steps: Record<string, { status: string }> } };
      // Every step reported (the always-200-with-per-step-status
      // contract holds under the parallel waves). 'outcomes' is the
      // Section 19, Phase 3 (§12 #34) prediction-outcome step,
      // which runs in wave C with the other post-refresh steps.
      expect(Object.keys(body.data.steps).sort()).toEqual(
        ['alerts', 'digest', 'ebay', 'guestAlerts', 'guestEmail', 'hunts', 'notifications', 'outcomes', 'pipeline', 'refresh', 'savedSearches', 'stock']
      );
      expect(routeMocks.checkPriceAlerts).toHaveBeenCalled();
      expect(routeMocks.runHunts).toHaveBeenCalled();
    },
    10000
  );
});
