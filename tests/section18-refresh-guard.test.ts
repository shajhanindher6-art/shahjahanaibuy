/**
 * Section 18, Phase 2 — refresh guard fails open ONLY for a
 * missing table (audit §1 #25, §12 item 35; coordinator decision).
 *
 * Before: ANY guard-read or insert error returned
 * `{ started: true, runId: null }` — the refresh ran unguarded, so
 * a transient DB error could silently duplicate the chain. Now:
 * missing-table (PGRST205 / 42P01) still fails open (migration 040
 * not applied); every other guard error fails safe
 * (`{ started: false, reason: 'guard-error' }`) and the routes
 * surface the honest not-started state (200 + skipped, never a
 * 500, never an unguarded run).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { tryStartRefreshRun } from '@/services/refresh-run';

type Row = Record<string, unknown>;

interface FakeTable {
  rows: Row[];
  selectError?: { code?: string; message: string };
  insertError?: { code?: string; message: string };
  throws?: boolean;
}

const fakeDb = {
  tables: {} as Record<string, FakeTable>,
  insertCalls: 0,
  selectCalls: 0,
};

function seedTable(name: string, rows: Row[] = [], opts: Partial<FakeTable> = {}): void {
  fakeDb.tables[name] = { rows: rows.map((r) => ({ ...r })), ...opts };
}

function resetFakeDb(): void {
  fakeDb.tables = {};
  fakeDb.insertCalls = 0;
  fakeDb.selectCalls = 0;
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private limitN: number | null = null;
  private op: 'select' | 'insert' | 'update' = 'select';
  private insertRows: Row[] = [];
  private wantSingle = false;

  constructor(private readonly table: string) {}

  select(): this {
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  order(): this {
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
    const table = fakeDb.tables[this.table];
    if (!table) {
      return { data: null, error: { code: 'PGRST205', message: `Could not find the table '${this.table}'` } };
    }
    if (table.throws) throw new Error(`fake transport failure on ${this.table}`);
    if (this.op === 'insert') {
      fakeDb.insertCalls++;
      if (table.insertError) return { data: null, error: table.insertError };
      const inserted = this.insertRows.map((row, i) => ({
        ...row,
        id: `run-${fakeDb.insertCalls}-${i}`,
        started_at: new Date().toISOString(),
      }));
      table.rows.push(...inserted);
      return this.wantSingle ? { data: inserted[0] ?? null, error: null } : { data: inserted, error: null };
    }
    if (this.op === 'update') return { data: [], error: null };
    fakeDb.selectCalls++;
    if (table.selectError) return { data: null, error: table.selectError };
    let rows = table.rows.filter((r) => this.filters.every((f) => f(r)));
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
} as unknown as Parameters<typeof tryStartRefreshRun>[0];

beforeEach(() => {
  resetFakeDb();
  process.env.CRON_SECRET = 'test-secret';
});

describe('tryStartRefreshRun fail-open narrowing (item 35)', () => {
  it('(a) missing table still starts unguarded', async () => {
    // price_refresh_runs never seeded → PGRST205.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await tryStartRefreshRun(fakeClient, 'prices-refresh');
      expect(res).toEqual({ started: true, runId: null });
      expect(fakeDb.insertCalls).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('(b) a generic guard-read error fails safe and never inserts', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      seedTable('price_refresh_runs', [], {
        selectError: { code: '50000', message: 'connection refused' },
      });
      const res = await tryStartRefreshRun(fakeClient, 'prices-refresh');
      expect(res.started).toBe(false);
      expect(res.reason).toBe('guard-error');
      expect(res.error).toContain('connection refused');
      expect(fakeDb.insertCalls).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('a throwing guard read fails safe (unless it is a missing table)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      seedTable('price_refresh_runs', [], { throws: true });
      const res = await tryStartRefreshRun(fakeClient, 'prices-refresh');
      expect(res.started).toBe(false);
      expect(res.reason).toBe('guard-error');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('a generic insert error fails safe (run not started)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      seedTable('price_refresh_runs', [], {
        insertError: { code: '23505', message: 'duplicate key' },
      });
      const res = await tryStartRefreshRun(fakeClient, 'prices-refresh');
      expect(res.started).toBe(false);
      expect(res.reason).toBe('guard-error');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('a missing-table insert error still fails open', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      seedTable('price_refresh_runs', [], {
        insertError: { code: 'PGRST205', message: 'Could not find the table' },
      });
      const res = await tryStartRefreshRun(fakeClient, 'prices-refresh');
      expect(res).toEqual({ started: true, runId: null });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('a live run still blocks with run-in-progress', async () => {
    seedTable('price_refresh_runs', [
      { id: 'run-live', status: 'running', started_at: new Date().toISOString() },
    ]);
    const res = await tryStartRefreshRun(fakeClient, 'prices-refresh');
    expect(res).toEqual({
      started: false,
      runId: null,
      reason: 'run-in-progress',
      existingRunId: 'run-live',
    });
    expect(fakeDb.insertCalls).toBe(0);
  });

  it('a healthy guard still starts a recorded run', async () => {
    seedTable('price_refresh_runs', []);
    const res = await tryStartRefreshRun(fakeClient, 'prices-refresh');
    expect(res.started).toBe(true);
    expect(res.runId).toMatch(/^run-/);
    expect(fakeDb.insertCalls).toBe(1);
  });
});

// --- Route level: the cron call gets the honest not-started state -----------

const routeMocks = vi.hoisted(() => ({
  checkPriceAlerts: vi.fn(),
  processNotificationQueue: vi.fn(),
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

describe('refresh route surfaces guard-error honestly (item 35)', () => {
  it('returns 200 + skipped + guard-error, and runs no step', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      resetFakeDb();
      seedTable('price_refresh_runs', [], {
        selectError: { code: '50000', message: 'connection refused' },
      });
      serviceMocks.createServiceClient.mockReturnValue(fakeClient);
      const req = new NextRequest('http://localhost/api/v1/prices/refresh', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret', 'x-real-ip': '203.0.113.99' },
      });
      const res = await refreshPOST(req);
      expect(res.status).toBe(200); // always-200 contract: not a 500
      const body = (await res.json()) as {
        success: boolean;
        data: { skipped: boolean; reason: string; steps: Record<string, { status: string }> };
      };
      expect(body.data.skipped).toBe(true);
      expect(body.data.reason).toBe('guard-error');
      expect(Object.values(body.data.steps).every((s) => s.status === 'skipped')).toBe(true);
      // No step ran: no insert was attempted anywhere.
      expect(fakeDb.insertCalls).toBe(0);
      expect(routeMocks.checkPriceAlerts).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
