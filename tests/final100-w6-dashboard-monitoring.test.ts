/**
 * Final 100% Product & Real Data Completion — Worker W6 (dashboard
 * + monitoring) regression tests.
 *
 * Items covered:
 * - F-P1-51: the three computed-but-unrendered metrics are now
 *   part of the admin payload and rendered (source assertions on
 *   the control center + the new data-quality page).
 * - F-P1-52: /admin/data-quality page exists with totals,
 *   verification/freshness/coverage, reliability, ingestion
 *   failures, last successful sync, dead-man's switch, filters
 *   and drill-down (source assertions — the page is a server
 *   component under the admin guard and is not rendered here).
 * - F-P1-53: dead-man's switch evaluation (pure) + monitor state
 *   reads (fake client), including CRON_SECRET unset and the
 *   no-runs-recorded unknown.
 * - F-P1-54: dateless-verified stale flip (predicate + writer
 *   with the 045 fail-safe) and its wiring into finishRefreshRun.
 * - F-P2-44: quality filters on /admin/products (pure predicate
 *   + list path with a fake client) and the filter UI.
 * - F-P2-45: ingestion rejections persisted from the intake
 *   approve path (build + record with a fake client) and the
 *   route wiring (source assertion).
 * - F-P2-46: DLQ persistence status on in-memory entries
 *   (volatile vs durable labelling).
 * - F-P1-50: canonical policy scorer wired into the dashboard
 *   (source assertions — the scorer itself is covered by its own
 *   tests; here we pin that the dashboard renders it).
 * - F-P1-58: currency_code written on history rows (see the
 *   updated tiered-retry cases in
 *   tests/section20-pipeline-validation.test.ts), stored currency
 *   read per product, and the currency-code writer helper.
 * - F-P1-05: product-level attribution reader (fail-closed).
 *
 * Fake Supabase clients follow the pattern in
 * tests/section20-admin-catalog.test.ts: every builder method
 * returns the same thenable chain, resolving to the configured
 * result for that table.
 */
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import {
  REFRESH_OVERDUE_MS,
  evaluateRefreshHealth,
  getRefreshMonitorState,
  type RefreshRunEvidence,
} from '@/services/refresh-monitor';
import {
  flipDatelessVerifiedToStale,
  shouldFlipDatelessVerifiedToStale,
} from '@/services/verification-stale-flip';
import { getProductAttribution } from '@/services/product-attribution';
import {
  getMerchantCurrencies,
  persistMerchantCurrencyCode,
} from '@/services/merchant-currency';
import {
  buildRejectionRecords,
  recordIngestionRejection,
} from '@/services/ingestion-rejections';
import {
  listAdminProducts,
  productMatchesQualityFilters,
  type AdminProduct,
} from '@/services/admin-products';
import type { QualityScoreContext } from '@/services/product-quality-score';
import { finishRefreshRun, getRecentRefreshRuns } from '@/services/refresh-run';
import { getDeadLetterQueue, getQueue } from '@/lib/workers/queue';
import type { IntakeReview, IntakeRowInput } from '@/services/catalog-intake';

function repoFile(...parts: string[]): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts),
    'utf8'
  );
}

// ---------------------------------------------------------------------------
// Fake Supabase client
// ---------------------------------------------------------------------------

type FakeResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
};

const CHAIN_METHODS = [
  'select',
  'eq',
  'neq',
  'is',
  'or',
  'order',
  'range',
  'limit',
  'in',
  'lt',
  'lte',
  'gte',
  'maybeSingle',
  'single',
  'update',
  'insert',
  'delete',
] as const;

function fakeChain(result: FakeResult): AnySupabaseClient {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: FakeResult) => void) => resolve(result),
  };
  for (const method of CHAIN_METHODS) {
    chain[method] = (..._args: unknown[]) => chain;
  }
  return chain as unknown as AnySupabaseClient;
}

function fakeClient(handler: (table: string) => FakeResult): AnySupabaseClient {
  return {
    from: (table: string) => fakeChain(handler(table)),
  } as unknown as AnySupabaseClient;
}

function ok(data: unknown, count?: number): FakeResult {
  return { data, error: null, count: count ?? (Array.isArray(data) ? data.length : null) };
}

function err(code: string, message: string): FakeResult {
  return { data: null, error: { code, message } };
}

// ---------------------------------------------------------------------------
// F-P1-53 — dead-man's switch
// ---------------------------------------------------------------------------

describe('evaluateRefreshHealth (F-P1-53 dead-man\'s switch)', () => {
  const now = new Date('2026-11-13T14:30:00.000Z');
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString();

  function run(over: Partial<RefreshRunEvidence> = {}): RefreshRunEvidence {
    return {
      id: 'run-1',
      startedAt: twoHoursAgo,
      finishedAt: twoHoursAgo,
      status: 'completed',
      ...over,
    };
  }

  it('is ok when the last run finished recently and cleanly', () => {
    const h = evaluateRefreshHealth({
      runs: [run()],
      runsTableMissing: false,
      cronSecretConfigured: true,
      now,
    });
    expect(h.status).toBe('ok');
    expect(h.ownerAction).toBeNull();
    expect(h.lastSuccessfulRun?.id).toBe('run-1');
  });

  it('is overdue when no run finished within two cadences', () => {
    const h = evaluateRefreshHealth({
      runs: [run({ startedAt: twentyHoursAgo, finishedAt: twentyHoursAgo })],
      runsTableMissing: false,
      cronSecretConfigured: true,
      now,
    });
    expect(h.status).toBe('overdue');
    expect(h.minutesSinceLastFinishedRun).toBeGreaterThan(REFRESH_OVERDUE_MS / 60_000);
    expect(h.ownerAction).toContain('cron-job.org');
  });

  it('is failing after three consecutive failed runs', () => {
    const failed = (id: string): RefreshRunEvidence => ({
      id,
      startedAt: twoHoursAgo,
      finishedAt: twoHoursAgo,
      status: 'failed',
    });
    const h = evaluateRefreshHealth({
      runs: [failed('r3'), failed('r2'), failed('r1')],
      runsTableMissing: false,
      cronSecretConfigured: true,
      now,
    });
    expect(h.status).toBe('failing');
    expect(h.consecutiveFailures).toBe(3);
  });

  it('is failing on a stale running row (a crashed run, not a live one)', () => {
    const h = evaluateRefreshHealth({
      runs: [
        {
          id: 'run-stuck',
          startedAt: twentyHoursAgo,
          finishedAt: null,
          status: 'running',
        },
      ],
      runsTableMissing: false,
      cronSecretConfigured: true,
      now,
    });
    expect(h.status).toBe('failing');
  });

  it('is ok on a fresh running row (a run in progress)', () => {
    const started = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const h = evaluateRefreshHealth({
      runs: [{ id: 'run-live', startedAt: started, finishedAt: null, status: 'running' }],
      runsTableMissing: false,
      cronSecretConfigured: true,
      now,
    });
    expect(h.status).toBe('ok');
  });

  it('is no-runs-recorded (unknown, not healthy) when 040 is unapplied', () => {
    const h = evaluateRefreshHealth({
      runs: [],
      runsTableMissing: true,
      cronSecretConfigured: true,
      now,
    });
    expect(h.status).toBe('no-runs-recorded');
    expect(h.reason).toContain('040');
    expect(h.ownerAction).toContain('040');
  });

  it('is no-runs-recorded when the table exists but is empty', () => {
    const h = evaluateRefreshHealth({
      runs: [],
      runsTableMissing: false,
      cronSecretConfigured: true,
      now,
    });
    expect(h.status).toBe('no-runs-recorded');
  });

  it('cron-secret-unset outranks a recent healthy run', () => {
    const h = evaluateRefreshHealth({
      runs: [run()],
      runsTableMissing: false,
      cronSecretConfigured: false,
      now,
    });
    expect(h.status).toBe('cron-secret-unset');
    expect(h.reason).toContain('CRON_SECRET');
    expect(h.ownerAction).toContain('CRON_SECRET');
  });

  it('a completed_with_failures run counts toward consecutive failures', () => {
    const h = evaluateRefreshHealth({
      runs: [
        { id: 'r3', startedAt: twoHoursAgo, finishedAt: twoHoursAgo, status: 'completed_with_failures' },
        { id: 'r2', startedAt: twoHoursAgo, finishedAt: twoHoursAgo, status: 'failed' },
        { id: 'r1', startedAt: twoHoursAgo, finishedAt: twoHoursAgo, status: 'failed' },
      ],
      runsTableMissing: false,
      cronSecretConfigured: true,
      now,
    });
    expect(h.status).toBe('failing');
    expect(h.consecutiveFailures).toBe(3);
  });
});

describe('getRefreshMonitorState (F-P1-53)', () => {
  const OLD_SECRET = process.env.CRON_SECRET;

  it('reports ok from recorded runs when the secret is set', async () => {
    process.env.CRON_SECRET = 'test-secret';
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const client = fakeClient((table) =>
        table === 'price_refresh_runs'
          ? ok([
              {
                id: 'run-1',
                source: 'prices-refresh',
                started_at: twoHoursAgo,
                finished_at: twoHoursAgo,
                status: 'completed',
                steps: {},
                error: null,
              },
            ])
          : err('42P01', 'missing')
      );
      const state = await getRefreshMonitorState(client);
      expect(state.status).toBe('ok');
      expect(state.cronSecretConfigured).toBe(true);
      expect(state.runsChecked).toBe(1);
    } finally {
      if (OLD_SECRET === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = OLD_SECRET;
    }
  });

  it('reports no-runs-recorded when the runs table is missing', async () => {
    process.env.CRON_SECRET = 'test-secret';
    try {
      const client = fakeClient(() => err('PGRST205', 'table not found'));
      const state = await getRefreshMonitorState(client);
      expect(state.status).toBe('no-runs-recorded');
      expect(state.runsTableMissing).toBe(true);
    } finally {
      if (OLD_SECRET === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = OLD_SECRET;
    }
  });
});

describe('getRecentRefreshRuns (F-P1-53)', () => {
  it('returns runs newest first', async () => {
    const client = fakeClient((table) =>
      table === 'price_refresh_runs'
        ? ok([
            { id: 'r2', started_at: '2026-11-13T10:00:00Z', status: 'completed' },
            { id: 'r1', started_at: '2026-11-13T04:00:00Z', status: 'failed' },
          ])
        : err('42P01', 'missing')
    );
    const { runs, tableMissing } = await getRecentRefreshRuns(client, 5);
    expect(tableMissing).toBe(false);
    expect(runs.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('reports tableMissing instead of throwing on a missing table', async () => {
    const client = fakeClient(() => err('42P01', 'relation does not exist'));
    const { runs, tableMissing } = await getRecentRefreshRuns(client, 5);
    expect(tableMissing).toBe(true);
    expect(runs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F-P1-54 — dateless-verified stale flip
// ---------------------------------------------------------------------------

describe('shouldFlipDatelessVerifiedToStale (F-P1-54)', () => {
  it('flips verified with no check date', () => {
    expect(shouldFlipDatelessVerifiedToStale('verified', null)).toBe(true);
    expect(shouldFlipDatelessVerifiedToStale('verified', undefined)).toBe(true);
    expect(shouldFlipDatelessVerifiedToStale('verified', '  ')).toBe(true);
  });

  it('does not flip verified WITH a date (the dated flip owns those)', () => {
    expect(shouldFlipDatelessVerifiedToStale('verified', '2026-11-01T00:00:00Z')).toBe(false);
  });

  it('does not flip unverified or stale rows', () => {
    expect(shouldFlipDatelessVerifiedToStale('unverified', null)).toBe(false);
    expect(shouldFlipDatelessVerifiedToStale('stale', null)).toBe(false);
    expect(shouldFlipDatelessVerifiedToStale(null, null)).toBe(false);
  });
});

describe('flipDatelessVerifiedToStale (F-P1-54)', () => {
  it('flips verified rows with NULL verified_at on both tables', async () => {
    const updates: Array<{ table: string }> = [];
    const client = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {
          then: (resolve: (v: unknown) => void) => {
            updates.push({ table });
            resolve({ data: [{ id: 'x1' }], error: null });
          },
        };
        for (const m of ['update', 'eq', 'is', 'select']) {
          chain[m] = () => chain;
        }
        return chain;
      },
    } as unknown as AnySupabaseClient;
    const result = await flipDatelessVerifiedToStale(client);
    expect(result).toMatchObject({
      flippedProducts: 1,
      flippedMerchantRows: 1,
      columnsMissing: false,
    });
    expect(updates.map((u) => u.table)).toEqual(['products', 'merchant_products']);
  });

  it('reports columnsMissing (honest unknown) while 045 is unapplied', async () => {
    const client = fakeClient(() => err('42703', 'column does not exist'));
    const result = await flipDatelessVerifiedToStale(client);
    expect(result.columnsMissing).toBe(true);
    expect(result.flippedProducts).toBe(0);
    expect(result.flippedMerchantRows).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('reports a non-42703 error instead of throwing', async () => {
    const client = fakeClient(() => err('23505', 'unique violation'));
    const result = await flipDatelessVerifiedToStale(client);
    expect(result.columnsMissing).toBe(false);
    expect(result.error).toContain('unique violation');
  });
});

describe('finishRefreshRun runs the dateless flip (F-P1-54 wiring)', () => {
  it('calls the flip after recording the run and never throws', async () => {
    const calls: string[] = [];
    const client = {
      from: (table: string) => {
        const chain: Record<string, unknown> = {
          then: (resolve: (v: unknown) => void) => {
            calls.push(table);
            resolve({ data: [{ id: 'p1' }], error: null });
          },
        };
        for (const m of ['update', 'eq', 'is', 'select']) {
          chain[m] = () => chain;
        }
        return chain;
      },
    } as unknown as AnySupabaseClient;
    await finishRefreshRun(client, 'run-1', {}, 'completed');
    // price_refresh_runs update + products flip + merchant_products flip.
    expect(calls).toEqual(['price_refresh_runs', 'products', 'merchant_products']);
  });

  it('is a no-op without a run id (040 unapplied)', async () => {
    const client = fakeClient(() => ok([]));
    await expect(
      finishRefreshRun(client, null, {}, 'completed')
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// F-P1-05 — product-level attribution (fail-closed)
// ---------------------------------------------------------------------------

describe('getProductAttribution (F-P1-05)', () => {
  it('reads merchant sources, pipeline sources, and spec attribution together', async () => {
    const client = fakeClient((table) => {
      if (table === 'merchant_products') {
        return ok([
          { merchant_id: 'm-amazon', price_source: 'ebay-browse-api', price_verified_at: '2026-11-13T10:00:00Z' },
        ]);
      }
      if (table === 'merchants') return ok([{ id: 'm-amazon', name: 'Amazon' }]);
      if (table === 'product_sources') {
        return ok([
          { provider_key: 'ebay', source_url: 'https://example.com/item', last_fetched_at: '2026-11-13T10:00:00Z' },
        ]);
      }
      if (table === 'product_attributes') {
        return ok([
          { id: 'a1', product_id: 'p1', key: 'ram', value: '16 GB', unit: null, source: 'manual-intake', verified_at: null, verified_by: 'admin-1', sort_order: 0 },
          { id: 'a2', product_id: 'p1', key: 'cpu', value: 'M3', unit: null, source: null, verified_at: null, verified_by: null, sort_order: 1 },
        ]);
      }
      return err('42P01', 'missing');
    });
    const attr = await getProductAttribution(client, 'p1');
    expect(attr.hasAnyAttribution).toBe(true);
    expect(attr.merchantSources).toEqual([
      {
        merchantId: 'm-amazon',
        merchantName: 'Amazon',
        priceSource: 'ebay-browse-api',
        priceVerifiedAt: '2026-11-13T10:00:00Z',
      },
    ]);
    expect(attr.productSources).toHaveLength(1);
    expect(attr.specsAttributed).toBe(1);
    expect(attr.specsTotal).toBe(2);
    expect(attr.columnsMissing).toBe(false);
  });

  it('is honestly empty when nothing was ever recorded', async () => {
    const client = fakeClient((table) => {
      if (table === 'product_attributes') return ok([]);
      return ok([]);
    });
    const attr = await getProductAttribution(client, 'p1');
    expect(attr.hasAnyAttribution).toBe(false);
    expect(attr.merchantSources).toEqual([]);
    expect(attr.productSources).toEqual([]);
    expect(attr.specsTotal).toBe(0);
  });

  it('reports columnsMissing when 045 is unapplied instead of inventing a source', async () => {
    const client = fakeClient((table) => {
      if (table === 'merchant_products') return err('42703', 'column does not exist');
      if (table === 'product_attributes') return ok([]);
      return ok([]);
    });
    const attr = await getProductAttribution(client, 'p1');
    expect(attr.columnsMissing).toBe(true);
    expect(attr.merchantSources).toEqual([]);
    expect(attr.hasAnyAttribution).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F-P1-58 — stored currency (read + writer helper)
// ---------------------------------------------------------------------------

describe('getMerchantCurrencies (F-P1-58)', () => {
  it('resolves stored codes and labels NULL currency_id as assumed, not stored', async () => {
    const client = fakeClient((table) => {
      if (table === 'currencies') {
        return ok([
          { id: 'cur-eur', code: 'EUR' },
          { id: 'cur-usd', code: 'USD' },
        ]);
      }
      if (table === 'merchant_products') {
        return ok([
          { product_id: 'p1', merchant_id: 'm1', currency_id: 'cur-eur' },
          { product_id: 'p1', merchant_id: 'm2', currency_id: null },
        ]);
      }
      return err('42P01', 'missing');
    });
    const result = await getMerchantCurrencies(client, ['p1']);
    const rows = result.byProduct.get('p1') ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ code: 'EUR', assumedUsd: false });
    // NULL currency_id: no stored code — USD is assumed in run
    // counts only, never presented as a stored currency.
    expect(rows[1]).toMatchObject({ code: null, assumedUsd: true });
    expect(result.distinctCodes).toEqual(['EUR']);
  });

  it('marks an unresolvable currency_id as unknown, not USD', async () => {
    const client = fakeClient((table) => {
      if (table === 'currencies') return ok([{ id: 'cur-usd', code: 'USD' }]);
      if (table === 'merchant_products') {
        return ok([{ product_id: 'p1', merchant_id: 'm1', currency_id: 'cur-gone' }]);
      }
      return err('42P01', 'missing');
    });
    const result = await getMerchantCurrencies(client, ['p1']);
    const rows = result.byProduct.get('p1') ?? [];
    expect(rows[0]).toMatchObject({ code: null, assumedUsd: true, unknownCurrencyId: true });
  });
});

describe('persistMerchantCurrencyCode (F-P1-58)', () => {
  function recordingClient(currencyId: string | null) {
    const updates: Array<{ table: string; patch: unknown }> = [];
    const client = {
      updates,
      from: (table: string) => {
        const chain: Record<string, unknown> = {
          then: (resolve: (v: unknown) => void) => {
            if (table === 'currencies') {
              resolve({
                data: currencyId ? [{ id: currencyId }] : [],
                error: null,
              });
            } else {
              resolve({ data: null, error: null });
            }
          },
        };
        for (const m of ['select', 'eq', 'limit', 'update']) {
          chain[m] = (...args: unknown[]) => {
            if (m === 'update') updates.push({ table, patch: args[0] });
            return chain;
          };
        }
        return chain;
      },
    };
    return client as unknown as AnySupabaseClient & {
      updates: Array<{ table: string; patch: unknown }>;
    };
  }

  it('stores the resolved currency_id verbatim (no conversion)', async () => {
    const client = recordingClient('cur-eur');
    const outcome = await persistMerchantCurrencyCode(client, 'mp-1', 'eur');
    expect(outcome).toBe('updated');
    expect(client.updates).toEqual([
      { table: 'merchant_products', patch: { currency_id: 'cur-eur' } },
    ]);
  });

  it('returns unknown-currency when no currencies row carries the code', async () => {
    const client = recordingClient(null);
    const outcome = await persistMerchantCurrencyCode(client, 'mp-1', 'XXX');
    expect(outcome).toBe('unknown-currency');
    expect(client.updates).toEqual([]);
  });

  it('rejects a malformed code instead of storing it', async () => {
    const client = recordingClient('cur-usd');
    expect(await persistMerchantCurrencyCode(client, 'mp-1', 'US')).toBe('unknown-currency');
    expect(await persistMerchantCurrencyCode(client, 'mp-1', 'USDD')).toBe('unknown-currency');
    expect(client.updates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F-P2-45 — ingestion rejections persisted at approve
// ---------------------------------------------------------------------------

describe('buildRejectionRecords + recordIngestionRejection (F-P2-45)', () => {
  const review: IntakeReview = {
    rows: [
      {
        rowNumber: 2,
        status: 'error',
        errors: [{ row: 2, field: 'price', reason: 'Price must be greater than 0' }],
        data: null,
      },
      { rowNumber: 3, status: 'valid', errors: [], data: null },
      {
        rowNumber: 4,
        status: 'error',
        errors: [{ row: 4, field: 'gtin', reason: 'Invalid GTIN check digit' }],
        data: null,
      },
    ],
    summary: { total: 3, valid: 1, errors: 2, duplicates: 0, nearDuplicates: 0 },
  };
  const rows: IntakeRowInput[] = [
    { rowNumber: 2, name: 'Bad Price', slug: 'bad-price', brand: 'X', category: 'Audio', price: '0', currency: 'USD', merchant: 'amazon' },
    { rowNumber: 3, name: 'Good', slug: 'good', brand: 'X', category: 'Audio', price: '10', currency: 'USD', merchant: 'amazon' },
    { rowNumber: 4, name: 'Bad GTIN', slug: 'bad-gtin', brand: 'X', category: 'Audio', price: '10', currency: 'USD', merchant: 'amazon', gtin: '123' },
  ];

  it('builds one record per error row (never for ok rows)', () => {
    const records = buildRejectionRecords(review, rows, 'csv-intake');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      source: 'csv-intake',
      rowNumber: 2,
      productName: 'Bad Price',
    });
    expect(records[0].reason).toContain('Price must be greater than 0');
    expect(records[1].rowNumber).toBe(4);
  });

  it('persists a rejection into error_log and returns inserted', async () => {
    const inserts: Array<{ table: string; row: unknown }> = [];
    const client = {
      from: (table: string) => ({
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { data: null, error: null };
        },
      }),
    } as unknown as AnySupabaseClient;
    const outcome = await recordIngestionRejection(client, {
      source: 'csv-intake',
      rowNumber: 2,
      productName: 'Bad Price',
      row: { name: 'Bad Price' },
      reason: 'price: Price must be greater than 0',
    });
    expect(outcome).toBe('inserted');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('error_log');
    expect(inserts[0].row).toMatchObject({ route: 'catalog-ingestion', level: 'warn' });
  });

  it('returns missing-table while 048 is unapplied (never throws)', async () => {
    const client = {
      from: () => ({
        insert: async () => ({
          data: null,
          error: { code: '42P01', message: 'relation does not exist' },
        }),
      }),
    } as unknown as AnySupabaseClient;
    const outcome = await recordIngestionRejection(client, {
      source: 'csv-intake',
      rowNumber: 2,
      productName: 'Bad Price',
      row: { name: 'Bad Price' },
      reason: 'price: Price must be greater than 0',
    });
    expect(outcome).toBe('missing-table');
  });
});

// ---------------------------------------------------------------------------
// F-P2-44 — quality filters on /admin/products
// ---------------------------------------------------------------------------

describe('productMatchesQualityFilters (F-P2-44)', () => {
  const staleIso = '2026-11-02T07:13:52.000Z';
  const freshIso = new Date().toISOString();

  function product(over: Partial<AdminProduct> = {}): AdminProduct {
    return {
      id: 'p1',
      name: 'Test Product',
      slug: 'test-product',
      description: 'A test product.',
      brand: 'TestBrand',
      category: 'Audio',
      imageUrl: null,
      gtin: null,
      confidenceScore: 50,
      dataFreshness: staleIso,
      createdAt: staleIso,
      updatedAt: staleIso,
      status: 'published',
      priceVerificationStatus: 'unverified',
      priceVerifiedAt: null,
      ...over,
    };
  }

  const emptyCtx: QualityScoreContext = {};

  it('matches a stale product on the stale filter only when its price is stale', () => {
    expect(productMatchesQualityFilters(product(), emptyCtx, { stale: true })).toBe(true);
    expect(
      productMatchesQualityFilters(
        product({ dataFreshness: freshIso }),
        { lastPriceRecordedAt: freshIso },
        { stale: true }
      )
    ).toBe(false);
  });

  it('matches no-GTIN / no-image filters from stored fields', () => {
    expect(productMatchesQualityFilters(product(), emptyCtx, { noGtin: true })).toBe(true);
    expect(productMatchesQualityFilters(product(), emptyCtx, { noImage: true })).toBe(true);
    expect(
      productMatchesQualityFilters(product({ gtin: '4006381333931' }), emptyCtx, {
        noGtin: true,
      })
    ).toBe(false);
    expect(
      productMatchesQualityFilters(
        product({ imageUrl: 'https://example.com/x.jpg' }),
        emptyCtx,
        { noImage: true }
      )
    ).toBe(false);
  });

  it('matches the missing-field filter (specs / gtin / history)', () => {
    expect(productMatchesQualityFilters(product(), emptyCtx, { missing: 'specs' })).toBe(true);
    expect(
      productMatchesQualityFilters(product(), { specCount: 3 }, { missing: 'specs' })
    ).toBe(false);
    expect(productMatchesQualityFilters(product(), emptyCtx, { missing: 'gtin' })).toBe(true);
    expect(productMatchesQualityFilters(product(), emptyCtx, { missing: 'history' })).toBe(true);
    expect(
      productMatchesQualityFilters(product(), { lastPriceRecordedAt: freshIso }, { missing: 'history' })
    ).toBe(false);
  });

  it('matches the 5-state taxonomy filter with the same scorer the rows render', () => {
    // Unverified + stale price, no GTIN, no source → 'unverified'.
    expect(
      productMatchesQualityFilters(product(), emptyCtx, { quality: 'unverified' })
    ).toBe(true);
    expect(
      productMatchesQualityFilters(product(), emptyCtx, { quality: 'verified' })
    ).toBe(false);
    // Verified + fresh → 'verified'.
    expect(
      productMatchesQualityFilters(
        product({ priceVerificationStatus: 'verified', priceVerifiedAt: freshIso, dataFreshness: freshIso }),
        { lastPriceRecordedAt: freshIso, merchantCount: 2, inStockMerchantCount: 2 },
        { quality: 'verified' }
      )
    ).toBe(true);
  });
});

describe('listAdminProducts quality-filter path (F-P2-44)', () => {
  const staleIso = '2026-11-02T07:13:52.000Z';
  const freshIso = new Date().toISOString();

  function rows() {
    return [
      {
        id: 'p-stale',
        name: 'Stale No Gtin',
        slug: 'stale-no-gtin',
        description: 'Stale.',
        brand: 'A',
        category: 'Audio',
        image_url: null,
        gtin: null,
        confidence_score: 50,
        data_freshness: staleIso,
        created_at: staleIso,
        updated_at: staleIso,
        status: 'published',
        price_verification_status: 'unverified',
        price_verified_at: null,
      },
      {
        id: 'p-fresh',
        name: 'Fresh With Gtin',
        slug: 'fresh-with-gtin',
        description: 'Fresh.',
        brand: 'B',
        category: 'Audio',
        image_url: 'https://example.com/fresh.jpg',
        gtin: '4006381333931',
        confidence_score: 50,
        data_freshness: freshIso,
        created_at: freshIso,
        updated_at: freshIso,
        status: 'published',
        price_verification_status: 'unverified',
        price_verified_at: null,
      },
    ];
  }

  function client() {
    return fakeClient((table) => {
      if (table === 'products') return ok(rows(), 2);
      if (table === 'price_history') {
        return ok([{ product_id: 'p-fresh', recorded_at: freshIso }]);
      }
      return ok([]);
    });
  }

  it('filters by no-GTIN across the whole set (not just one page)', async () => {
    const result = await listAdminProducts(client(), { noGtin: true, pageSize: 20 });
    expect(result.qualityFiltered).toBe(true);
    expect(result.total).toBe(1);
    expect(result.products.map((p) => p.id)).toEqual(['p-stale']);
  });

  it('filters by stale price', async () => {
    const result = await listAdminProducts(client(), { stale: true, pageSize: 20 });
    expect(result.total).toBe(1);
    expect(result.products.map((p) => p.id)).toEqual(['p-stale']);
  });

  it('filters by missing specs (both products have none)', async () => {
    const result = await listAdminProducts(client(), { missing: 'specs', pageSize: 20 });
    expect(result.total).toBe(2);
  });

  it('ignores an unknown quality value instead of erroring', async () => {
    const result = await listAdminProducts(client(), { quality: 'bogus', pageSize: 20 });
    expect(result.qualityFiltered).toBeUndefined();
    expect(result.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// F-P2-46 — DLQ persistence status (volatile vs durable)
// ---------------------------------------------------------------------------

describe('dead-letter queue persistence status (F-P2-46)', () => {
  it('a dead-lettered job carries a persisted status (never silently volatile)', async () => {
    const before = getDeadLetterQueue().length;
    const jobId = await getQueue().enqueue({
      type: 'dlq-test-w6-no-processor' as never,
      data: { probe: true },
    });
    const entries = getDeadLetterQueue();
    expect(entries.length).toBeGreaterThan(before);
    const entry = entries.find((e) => e.id === jobId);
    expect(entry).toBeDefined();
    expect(entry?.attempts).toBe(1);
    // The best-effort write resolves asynchronously; give it a
    // moment, then the status must be a real outcome — in this
    // sandbox there is no reachable Supabase, so 'failed'.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const settled = getDeadLetterQueue().find((e) => e.id === jobId);
    expect(settled?.persisted).toBeDefined();
    expect(['pending', 'inserted', 'missing-table', 'failed']).toContain(
      settled?.persisted
    );
  });

  it('the admin pages label DLQ durability instead of implying it', () => {
    for (const page of ['app/admin/refresh-runs/page.tsx', 'app/admin/ingestion-failures/page.tsx']) {
      const src = repoFile(...page.split('/'));
      expect(src).toContain('Stored durably in the error log');
      expect(src).toContain('Not stored durably');
    }
    // The dead-letter API already exposes both halves (instance +
    // persisted trail); the pages now label which half each entry is.
    expect(repoFile('app', 'api', 'v1', 'admin', 'jobs', 'dead-letter', 'route.ts')).toContain(
      'persisted'
    );
  });
});

// ---------------------------------------------------------------------------
// F-P1-51 / F-P1-52 / F-P1-50 — dashboard surfaces (source assertions)
// ---------------------------------------------------------------------------

describe('dashboard surfaces (F-P1-51 / F-P1-52 / F-P1-50)', () => {
  it('the /admin/ai panel renders the three previously-dropped metrics', () => {
    const src = repoFile('components', 'admin', 'ai-control-center.tsx');
    expect(src).toContain('historyCoverage');
    expect(src).toContain('sourceReliability');
    expect(src).toContain('lastSuccessfulUpdate');
    expect(src).toContain('productsWithSuccessfulUpdate');
    expect(src).toContain('Price-history coverage');
    expect(src).toContain('Per-source reliability');
    expect(src).toContain('Last successful update');
    // Honest "cannot be computed" states, never a zero.
    expect(src).toContain('Cannot be computed');
  });

  it('the /admin/data-quality page exists and covers every required metric', () => {
    const src = repoFile('app', 'admin', 'data-quality', 'page.tsx');
    expect(src).toContain('Verification distribution');
    expect(src).toContain('Data verification (5-state taxonomy');
    expect(src).toContain('Price freshness');
    expect(src).toContain('Merchant source coverage');
    expect(src).toContain('Recorded currency');
    expect(src).toContain('Price-history coverage');
    expect(src).toContain('Per-source reliability');
    expect(src).toContain('Last successful update');
    expect(src).toContain('Merchant reliability');
    expect(src).toContain('Ingestion failures');
    expect(src).toContain('Refresh monitoring');
    expect(src).toContain('Product drill-down');
    expect(src).toContain('requireAdminPage');
  });

  it('the data-quality page computes percentages from records (never hardcoded)', () => {
    const src = repoFile('app', 'admin', 'data-quality', 'page.tsx');
    expect(src).toContain('pctLabel(summary.verification.verified, total)');
    expect(src).toContain('pctLabel(summary.freshness.fresh, total)');
    expect(src).toContain('pctLabel(summary.productsWithImages, total)');
    expect(src).not.toMatch(/const .* = 35;.*quality/);
  });

  it('the dashboard wires the canonical policy scorer (F-P1-50)', () => {
    const src = repoFile('app', 'admin', 'data-quality', 'page.tsx');
    expect(src).toContain('getProviderHealthPanel');
    expect(src).toContain('Merchant reliability');
    expect(src).toContain('Canonical scorer');
    // The sync scorer stays a separate dimension; no third scorer.
    expect(src).toContain('different dimension, not a duplicate');
    const panel = repoFile('components', 'admin', 'ai-control-center.tsx');
    expect(panel).toContain('Merchant reliability (canonical policy scorer)');
  });

  it('the /status page surfaces the dead-man\'s switch (F-P1-53)', () => {
    const src = repoFile('app', 'status', 'page.tsx');
    expect(src).toContain('getRefreshMonitorState');
    expect(src).toContain('Refresh monitoring');
    expect(src).toContain('cron secret not set');
  });

  it('the intake approve route persists rejections (F-P2-45 wiring)', () => {
    const src = repoFile('app', 'api', 'v1', 'admin', 'intake', 'route.ts');
    expect(src).toContain('buildRejectionRecords');
    expect(src).toContain('recordIngestionRejection');
    expect(src).toContain('rejectionsRecorded');
    // Preview does not persist (a preview is not a commit).
    expect(src).toContain('preview branch does NOT persist');
  });

  it('the products list renders the quality filters (F-P2-44 wiring)', () => {
    const src = repoFile('app', 'admin', 'products', 'page.tsx');
    expect(src).toContain('name="quality"');
    expect(src).toContain('name="missing"');
    expect(src).toContain('name="stale"');
    expect(src).toContain('name="noImage"');
    expect(src).toContain('name="noGtin"');
    expect(src).toContain('/admin/data-quality');
  });

  it('the product detail renders attribution and stored currency (F-P1-05 / F-P1-58)', () => {
    const src = repoFile('app', 'admin', 'products', '[id]', 'page.tsx');
    expect(src).toContain('getProductAttribution');
    expect(src).toContain('Source attribution');
    expect(src).toContain('No source recorded for this product');
    expect(src).toContain('getMerchantCurrencies');
    expect(src).toContain('Recorded currency');
    expect(src).toContain('Currency not recorded');
  });
});
