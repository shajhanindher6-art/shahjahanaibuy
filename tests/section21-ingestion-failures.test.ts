/**
 * Sections 21–25, Stage K (K3) — /admin/ingestion-failures coverage.
 * The page had zero test coverage.
 *
 * Two layers, both with fake Supabase clients (no DB, no network):
 *
 * 1. Data path (services/error-log-admin.ts, services/refresh-runs-admin.ts):
 *    - table missing (migration 048 / 040 unapplied — PGRST205 and
 *      42P01) → tableMissing: true, never an empty list pretending
 *      nothing ever failed, never a throw;
 *    - rows present → the rows are returned newest-first, and
 *      listRefreshFailures filters to rows with a productId in meta;
 *    - any other read error → reported in `error`, never swallowed
 *      into an empty list;
 *    - failedStepsOf / refreshStepLabel pick out failed steps only.
 *
 * 2. Page render (app/admin/ingestion-failures/page.tsx, real
 *    component via react-dom/server renderToStaticMarkup):
 *    - 048 + 040 unapplied → the honest "not applied yet" copy
 *      renders (not an empty list claiming zero failures);
 *    - an error_log row + a failed run render with their messages;
 *    - service client missing → the "service-role key is not
 *      configured" copy renders.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { listRecentErrors, listRefreshFailures } from '@/services/error-log-admin';
import {
  failedStepsOf,
  listRefreshRuns,
  refreshStepLabel,
} from '@/services/refresh-runs-admin';
import type { AnySupabaseClient } from '@/lib/supabase/types';

type TableResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

const state = vi.hoisted(() => ({
  tables: {} as Record<string, TableResult>,
  serviceAvailable: true,
  deadLettered: [] as Array<{
    id: string;
    type: string;
    attempts: number;
    error: string;
    failedAt: string;
  }>,
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => {
    if (!state.serviceAvailable) return null;
    return {
      from: (table: string) => {
        const result: TableResult = state.tables[table] ?? {
          data: [],
          error: null,
        };
        const chain: Record<string, unknown> = {
          then: (resolve: (value: TableResult) => void) => resolve(result),
        };
        for (const method of ['select', 'eq', 'order', 'limit', 'is']) {
          chain[method] = (..._args: unknown[]) => chain;
        }
        return chain;
      },
    };
  },
}));

// The page reads the in-process dead-letter queue. It is mocked
// (empty by default, one entry on demand) so the render test is
// deterministic and does not pull the queue module's transitive
// import graph into this file.
vi.mock('@/lib/workers/queue', () => ({
  getDeadLetterQueue: () => state.deadLettered,
  getQueueMetrics: () => ({
    enqueued: 0,
    completed: 0,
    failed: state.deadLettered.length,
    deadLetterCount: state.deadLettered.length,
  }),
}));

// Imported after the mock so the page under test uses the fake client.
import AdminIngestionFailuresPage from '@/app/admin/ingestion-failures/page';

function fakeClient(tables: Record<string, TableResult>): AnySupabaseClient {
  return {
    from: (table: string) => {
      const result: TableResult = tables[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {
        then: (resolve: (value: TableResult) => void) => resolve(result),
      };
      for (const method of ['select', 'eq', 'order', 'limit', 'is']) {
        chain[method] = (..._args: unknown[]) => chain;
      }
      return chain;
    },
  } as unknown as AnySupabaseClient;
}

const missingTable = (code: string): TableResult => ({
  data: null,
  error: { code, message: 'Could not find the table' },
});

beforeEach(() => {
  state.tables = {};
  state.serviceAvailable = true;
  state.deadLettered = [];
});

describe('listRecentErrors — missing-table contract (048 unapplied)', () => {
  it('PGRST205 → tableMissing true, errors []', async () => {
    const client = fakeClient({ error_log: missingTable('PGRST205') });
    expect(await listRecentErrors(client, 50)).toEqual({
      errors: [],
      tableMissing: true,
    });
  });

  it('42P01 → tableMissing true, errors []', async () => {
    const client = fakeClient({ error_log: missingTable('42P01') });
    expect(await listRecentErrors(client, 50)).toEqual({
      errors: [],
      tableMissing: true,
    });
  });

  it('rows present → returned as-is, tableMissing false', async () => {
    const row = {
      id: 'e1',
      created_at: '2026-11-13T00:00:00.000Z',
      level: 'error',
      message: 'boom',
      request_id: null,
      route: 'prices.refresh',
      user_id: null,
      meta: null,
    };
    const client = fakeClient({ error_log: { data: [row], error: null } });
    const result = await listRecentErrors(client, 50);
    expect(result.tableMissing).toBe(false);
    expect(result.errors).toEqual([row]);
  });

  it('any other read error → reported in error, never an empty history', async () => {
    const client = fakeClient({
      error_log: { data: null, error: { message: 'connection reset' } },
    });
    const result = await listRecentErrors(client, 50);
    expect(result.tableMissing).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.error).toBe('connection reset');
  });
});

describe('listRefreshFailures — product-failure filter (048 unapplied)', () => {
  it('PGRST205 → tableMissing true, failures []', async () => {
    const client = fakeClient({ error_log: missingTable('PGRST205') });
    expect(await listRefreshFailures(client, 20)).toEqual({
      failures: [],
      tableMissing: true,
    });
  });

  it('keeps only rows with a productId in meta, drops plain API errors', async () => {
    const rows = [
      {
        id: 'f1',
        created_at: '2026-11-13T00:00:00.000Z',
        message: 'Product refresh failed',
        meta: { productId: 'p1', productName: 'MacBook', reason: 'insert failed' },
      },
      {
        id: 'f2',
        created_at: '2026-11-13T00:00:00.000Z',
        message: 'API error, no product',
        meta: { status: 500 },
      },
    ];
    const client = fakeClient({ error_log: { data: rows, error: null } });
    const result = await listRefreshFailures(client, 20);
    expect(result.tableMissing).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      id: 'f1',
      productId: 'p1',
      productName: 'MacBook',
      reason: 'insert failed',
    });
  });

  it('other read error → reported in error', async () => {
    const client = fakeClient({
      error_log: { data: null, error: { message: 'timeout' } },
    });
    const result = await listRefreshFailures(client, 20);
    expect(result.tableMissing).toBe(false);
    expect(result.error).toBe('timeout');
  });
});

describe('listRefreshRuns + failedStepsOf (040 unapplied)', () => {
  it('PGRST205 → tableMissing true, runs []', async () => {
    const client = fakeClient({ price_refresh_runs: missingTable('PGRST205') });
    expect(await listRefreshRuns(client, 10)).toEqual({
      runs: [],
      tableMissing: true,
    });
  });

  it('failedStepsOf returns failed steps only, with their errors', () => {
    const run = {
      id: 'r1',
      status: 'failed',
      steps: {
        ebay: { status: 'ok' },
        refresh: { status: 'failed', error: 'merchant read failed' },
        alerts: { status: 'skipped' },
      },
    } as unknown as Parameters<typeof failedStepsOf>[0];
    expect(failedStepsOf(run)).toEqual([
      { name: 'refresh', error: 'merchant read failed', counts: undefined },
    ]);
    expect(failedStepsOf({ steps: {} } as never)).toEqual([]);
  });

  it('refreshStepLabel falls back to the raw step name', () => {
    expect(refreshStepLabel('refresh')).toBe('Recorded price refresh');
    expect(refreshStepLabel('brand-new-step')).toBe('brand-new-step');
  });
});

describe('AdminIngestionFailuresPage — rendered copy (K3)', () => {
  it('048 + 040 unapplied → honest "not applied yet" copy, not a zero-failures claim', async () => {
    state.tables = {
      error_log: missingTable('PGRST205'),
      price_refresh_runs: missingTable('PGRST205'),
    };
    const html = renderToStaticMarkup(await AdminIngestionFailuresPage());
    expect(html).toContain('Ingestion failures');
    expect(html).toContain('migration 048 not applied');
    expect(html).toContain('migration 040 not applied');
    expect(html).toContain('No dead-lettered jobs on this instance.');
    expect(html).not.toContain('No errors recorded.');
    expect(html).not.toContain('No failed refresh runs in the last');
  });

  it('an error_log row and a failed run render with their messages', async () => {
    state.tables = {
      error_log: {
        data: [
          {
            id: 'e1',
            created_at: '2026-11-13T00:00:00.000Z',
            level: 'error',
            message: 'price_history insert failed: boom',
            request_id: null,
            route: 'prices.refresh',
            user_id: null,
            meta: { productId: 'p1', reason: 'insert failed' },
          },
        ],
        error: null,
      },
      price_refresh_runs: {
        data: [
          {
            id: 'r1',
            source: 'cron',
            started_at: '2026-11-13T00:00:00.000Z',
            finished_at: '2026-11-13T00:01:00.000Z',
            status: 'failed',
            steps: { refresh: { status: 'failed', error: 'merchant read failed' } },
            error: null,
          },
        ],
        error: null,
      },
    };
    const html = renderToStaticMarkup(await AdminIngestionFailuresPage());
    expect(html).toContain('price_history insert failed: boom');
    expect(html).toContain('Failed step: Recorded price refresh');
    expect(html).toContain('merchant read failed');
  });

  it('service client missing → "service-role key is not configured" copy', async () => {
    state.serviceAvailable = false;
    const html = renderToStaticMarkup(await AdminIngestionFailuresPage());
    expect(html).toContain('service-role key is not configured');
  });

  it('a dead-lettered job renders in the dead-letter section', async () => {
    state.tables = {
      error_log: missingTable('PGRST205'),
      price_refresh_runs: missingTable('PGRST205'),
    };
    state.deadLettered = [
      {
        id: 'dlq-1',
        type: 'price.refresh',
        attempts: 3,
        error: 'provider timeout',
        failedAt: '2026-11-13T00:00:00.000Z',
      },
    ];
    const html = renderToStaticMarkup(await AdminIngestionFailuresPage());
    expect(html).toContain('price.refresh');
    expect(html).toContain('provider timeout');
    expect(html).toContain('3 attempts');
  });
});
