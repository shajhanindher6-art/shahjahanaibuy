/**
 * Section 17, Stage F, item 27 — admin surfacing of price_refresh_runs.
 *
 * Tests the read side for /admin/refresh-runs against a fake
 * Supabase client (no DB, no network): the missing-table guard
 * (migration 040 unapplied → tableMissing, never a throw), the
 * failed-step extraction per run, and the step labels. The page
 * itself is a server component under the admin layout guard and is
 * not rendered here; its logic lives in services/refresh-runs-admin.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  listRefreshRuns,
  failedStepsOf,
  refreshStepLabel,
  REFRESH_STEP_LABELS,
} from '@/services/refresh-runs-admin';
import type { RefreshRunRow } from '@/services/refresh-run';
import type { AnySupabaseClient } from '@/lib/supabase/types';

type FakeQueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

function fakeClient(result: FakeQueryResult): AnySupabaseClient {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async () => result,
        }),
      }),
    }),
  } as unknown as AnySupabaseClient;
}

function runRow(overrides: Partial<RefreshRunRow> = {}): RefreshRunRow {
  return {
    id: 'run-1',
    source: 'prices-refresh',
    started_at: '2026-11-12T06:00:00.000Z',
    finished_at: '2026-11-12T06:01:00.000Z',
    status: 'completed_with_failures',
    steps: {
      ebay: { status: 'ok' },
      refresh: { status: 'ok' },
      alerts: { status: 'failed', error: 'alert load failed' },
      stock: { status: 'failed', error: 'availability load failed' },
      digest: { status: 'skipped' },
    },
    error: 'alerts: alert load failed; stock: availability load failed',
    ...overrides,
  };
}

describe('listRefreshRuns', () => {
  it('returns tableMissing when the table does not exist (PGRST205 — migration 040 unapplied)', async () => {
    const client = fakeClient({
      data: null,
      error: { code: 'PGRST205', message: 'Could not find the table' },
    });
    const result = await listRefreshRuns(client);
    expect(result.tableMissing).toBe(true);
    expect(result.runs).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('returns tableMissing for the Postgres undefined-table code 42P01 too', async () => {
    const client = fakeClient({
      data: null,
      error: { code: '42P01', message: 'relation "price_refresh_runs" does not exist' },
    });
    const result = await listRefreshRuns(client);
    expect(result.tableMissing).toBe(true);
    expect(result.runs).toEqual([]);
  });

  it('returns the runs newest-first when the table exists', async () => {
    const rows = [runRow({ id: 'run-new' }), runRow({ id: 'run-old', started_at: '2026-11-11T06:00:00.000Z' })];
    const client = fakeClient({ data: rows, error: null });
    const result = await listRefreshRuns(client);
    expect(result.tableMissing).toBe(false);
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0].id).toBe('run-new');
  });

  it('returns an empty list (not tableMissing) when the table exists but no run was recorded', async () => {
    const client = fakeClient({ data: [], error: null });
    const result = await listRefreshRuns(client);
    expect(result).toEqual({ runs: [], tableMissing: false });
  });

  it('reports a non-missing-table read error instead of inventing an empty history', async () => {
    const client = fakeClient({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    const result = await listRefreshRuns(client);
    expect(result.tableMissing).toBe(false);
    expect(result.runs).toEqual([]);
    expect(result.error).toContain('permission denied');
  });
});

describe('failedStepsOf', () => {
  it('extracts only the failed steps, in recorded order, with their errors', () => {
    const failed = failedStepsOf(runRow());
    expect(failed).toEqual([
      { name: 'alerts', error: 'alert load failed' },
      { name: 'stock', error: 'availability load failed' },
    ]);
  });

  it('returns [] for a fully successful run', () => {
    const failed = failedStepsOf(
      runRow({
        status: 'completed',
        steps: { ebay: { status: 'ok' }, refresh: { status: 'ok' } },
        error: null,
      })
    );
    expect(failed).toEqual([]);
  });

  it('returns [] when a run has no steps recorded at all', () => {
    expect(failedStepsOf(runRow({ steps: {} }))).toEqual([]);
  });

  it('keeps a failed step even when the chain recorded no error message', () => {
    const failed = failedStepsOf(runRow({ steps: { hunts: { status: 'failed' } } }));
    expect(failed).toEqual([{ name: 'hunts', error: undefined }]);
  });
});

describe('refreshStepLabel', () => {
  it('labels every step of the refresh chain', () => {
    const chainSteps = [
      'ebay',
      'refresh',
      'alerts',
      'hunts',
      'digest',
      'notifications',
      'stock',
      'guestAlerts',
      'guestEmail',
      'savedSearches',
    ];
    for (const name of chainSteps) {
      expect(REFRESH_STEP_LABELS[name]).toBeTruthy();
      expect(refreshStepLabel(name)).not.toBe(name);
    }
  });

  it('falls back to the raw name for an unknown step instead of rendering blank', () => {
    expect(refreshStepLabel('some-future-step')).toBe('some-future-step');
  });
});
