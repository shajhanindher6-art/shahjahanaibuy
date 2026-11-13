/**
 * Sections 21–25, Stage D — refresh integrity (audit §12 Stage D, §1 #59–#65).
 *
 * Covers, per item:
 *  1. Per-merchant rate limits (services/provider-rate-limits.ts) + the
 *     pipeline wiring (processors.ts paces before provider.fetch).
 *  2. DLQ persistence (queue.ts → error_log) + admin list/inspect
 *     (error-log-admin.ts + GET /api/v1/admin/jobs/dead-letter).
 *  3. Last successful update (services/last-successful-update.ts) +
 *     admin surface (admin-data-quality.ts) + migration 066.
 *  4. Currency carried end-to-end (services/refresh-currency.ts) —
 *     explicit USD default, unknown-currency skip, NO FX conversion.
 *  5. Chain-level retry (services/refresh-run.ts helper + route wiring).
 *  6. eBay budget refund on failure (services/ebay-budget.ts).
 *  7. Residual re-stamp paths R1–R3 (ingestion / intake approve /
 *     price-refresh observed_at).
 *  8. BullMQ code claims corrected (queue.ts + processors.ts + routes).
 *
 * Fakes only: no network, no database, no real credentials.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CURRENCY_CODE,
  isCurrencyCode,
  normalizeCurrencyCode,
  resolveListingCurrency,
  validateProviderCurrency,
} from '@/services/refresh-currency';
import {
  acquireProviderFetchSlot,
  getProviderRateLimit,
  isTransientProviderError,
  PROVIDER_FETCH_MAX_ATTEMPTS,
  resetProviderRateLimitState,
} from '@/services/provider-rate-limits';
import {
  getLastSuccessfulUpdate,
  markProductSuccessfullyUpdated,
  resolveLastSuccessfulUpdate,
  LIVE_PRICE_HISTORY_SOURCES,
} from '@/services/last-successful-update';
import {
  EBAY_DAILY_BUDGET_CAP,
  getEbayBudgetDateKey,
  refundEbayDailyCall,
  type EbayBudgetRedis,
} from '@/services/ebay-budget';
import {
  CHAIN_RETRY_DELAY_MS,
  CHAIN_RETRY_MAX_ATTEMPTS,
  retryFailedRefreshSteps,
} from '@/services/refresh-run';
import { insertPriceHistoryRow } from '@/services/price-history-quality';
import { priceVerificationForIntakeSource } from '@/services/price-verification';
import { resolveIngestFetchedAt } from '@/services/pipeline/ingestion';
import {
  listDeadLetterFailures,
  insertErrorLogRow,
} from '@/services/error-log-admin';
import { persistDeadLetterEntry } from '@/lib/workers/queue';

function repoFile(...parts: string[]): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts),
    'utf8'
  );
}

function repoExists(...parts: string[]): boolean {
  return fs.existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts));
}

// ---------------------------------------------------------------------------
// Item 4 — currency carried end-to-end, explicit USD default, no FX
// ---------------------------------------------------------------------------

describe('refresh currency (item 4)', () => {
  it('resolves a known currency id to its code, never assumed', () => {
    const byId = new Map([['cur-eur', 'EUR']]);
    expect(resolveListingCurrency('cur-eur', byId)).toEqual({
      code: 'EUR',
      assumedUsd: false,
      unknownCurrencyId: false,
    });
  });

  it('a NULL currency_id is explicit-USD and counted as assumed, not silent', () => {
    const byId = new Map([['cur-usd', 'USD']]);
    expect(resolveListingCurrency(null, byId)).toEqual({
      code: 'USD',
      assumedUsd: true,
      unknownCurrencyId: false,
    });
    expect(resolveListingCurrency(undefined, byId)).toMatchObject({
      code: 'USD',
      assumedUsd: true,
    });
  });

  it('an unresolvable currency_id is assumed-USD AND flagged unknown', () => {
    const byId = new Map([['cur-usd', 'USD']]);
    expect(resolveListingCurrency('cur-missing', byId)).toEqual({
      code: 'USD',
      assumedUsd: true,
      unknownCurrencyId: true,
    });
  });

  it('normalises codes and rejects non-codes instead of inventing USD', () => {
    expect(normalizeCurrencyCode(' eur ')).toBe('EUR');
    expect(normalizeCurrencyCode('US')).toBeNull();
    expect(normalizeCurrencyCode('')).toBeNull();
    expect(validateProviderCurrency(undefined)).toBeNull();
    expect(validateProviderCurrency('JPY')).toBe('JPY');
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('USDD')).toBe(false);
    expect(DEFAULT_CURRENCY_CODE).toBe('USD');
  });

  it('never converts: EUR stays EUR (no FX rate is applied in refresh)', () => {
    // The whole point of the module: a non-USD price is stored in
    // its native currency. There is no convert() export at all.
    const src = repoFile('services', 'refresh-currency.ts');
    expect(src).toContain('NO FX CONVERSION');
    expect(src).not.toMatch(/export function convert/);
    expect(resolveListingCurrency('cur-eur', new Map([['cur-eur', 'EUR']])).code).toBe('EUR');
  });

  it('price-refresh counts assumed-USD rows instead of silently defaulting', () => {
    const src = repoFile('services', 'price-refresh.ts');
    expect(src).toContain('currencyAssumedUsd');
    expect(src).toContain('resolveListingCurrency');
    expect(src).toContain('nonUsdCurrencies');
  });
});

// ---------------------------------------------------------------------------
// Item 1 — per-merchant rate limits (pacer) + transient classification
// ---------------------------------------------------------------------------

describe('provider rate limits (item 1)', () => {
  it('defaults to a 1s minimum interval with a 60/min burst cap', () => {
    expect(getProviderRateLimit('amazon')).toEqual({ minIntervalMs: 1000, maxCallsPerMinute: 60 });
    expect(getProviderRateLimit('csv').minIntervalMs).toBe(1000);
  });

  it('the first call to a provider waits 0ms; a second immediate call waits the interval', async () => {
    resetProviderRateLimitState();
    let now = 1_000_000;
    const sleeps: number[] = [];
    const deps = {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    };
    const first = await acquireProviderFetchSlot('csv', deps);
    expect(first.waitedMs).toBe(0);
    const second = await acquireProviderFetchSlot('csv', deps);
    expect(second.waitedMs).toBe(1000);
    expect(sleeps).toEqual([1000]);
  });

  it('different providers are paced independently', async () => {
    resetProviderRateLimitState();
    const deps = { now: () => 5_000_000, sleep: async () => {} };
    await acquireProviderFetchSlot('csv', deps);
    const other = await acquireProviderFetchSlot('amazon', deps);
    expect(other.waitedMs).toBe(0);
  });

  it('the burst cap waits for the oldest call in the window to expire', async () => {
    resetProviderRateLimitState();
    let now = 2_000_000;
    const deps = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };
    // 60 calls at the same instant fill the minute window; each
    // call's sleep advances the injected clock by the interval,
    // so the 61st call hits the burst cap and must wait.
    for (let i = 0; i < 60; i++) {
      await acquireProviderFetchSlot('bestbuy', deps);
    }
    const capped = await acquireProviderFetchSlot('bestbuy', deps);
    expect(capped.waitedMs).toBeGreaterThan(0);
  });

  it('classifies transient provider errors for retry, and never retries auth/config errors', () => {
    expect(isTransientProviderError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isTransientProviderError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isTransientProviderError(new Error('request timed out'))).toBe(true);
    expect(isTransientProviderError(new Error('fetch failed'))).toBe(true);
    expect(isTransientProviderError(new Error('401 Unauthorized'))).toBe(false);
    expect(isTransientProviderError(new Error('403 Forbidden'))).toBe(false);
    expect(isTransientProviderError(new Error('provider not configured'))).toBe(false);
    expect(PROVIDER_FETCH_MAX_ATTEMPTS).toBe(3);
  });

  it('the pipeline processor paces before provider.fetch (no tight loop)', () => {
    const src = repoFile('lib', 'workers', 'processors.ts');
    expect(src).toContain('acquireProviderFetchSlot(provider.key)');
    // The pacing call sits in processPriceRefresh, before the guarded fetch.
    const fetchIdx = src.indexOf('callProviderFetch(provider');
    const paceIdx = src.indexOf('acquireProviderFetchSlot(provider.key)');
    expect(paceIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(paceIdx).toBeLessThan(fetchIdx);
  });
});

// ---------------------------------------------------------------------------
// Item 3 — last successful update
// ---------------------------------------------------------------------------

describe('last successful update (item 3)', () => {
  it('resolves the latest of the three legs, with its source', () => {
    expect(
      resolveLastSuccessfulUpdate(
        '2026-11-10T00:00:00.000Z',
        '2026-11-12T00:00:00.000Z',
        '2026-11-11T00:00:00.000Z',
        false
      )
    ).toEqual({ at: '2026-11-12T00:00:00.000Z', source: 'price-history', columnMissing: false });
    expect(
      resolveLastSuccessfulUpdate('2026-11-12T00:00:00.000Z', null, null, false)
    ).toEqual({ at: '2026-11-12T00:00:00.000Z', source: 'column', columnMissing: false });
  });

  it('ignores invalid timestamps and returns null when nothing is recorded', () => {
    expect(resolveLastSuccessfulUpdate(null, null, null, true)).toEqual({
      at: null,
      source: null,
      columnMissing: true,
    });
    expect(resolveLastSuccessfulUpdate('not-a-date', null, null, false).at).toBeNull();
  });

  it('live sources never include seed / manual-intake / NULL re-reads', () => {
    expect([...LIVE_PRICE_HISTORY_SOURCES]).toEqual(['live', 'ebay-browse-api', 'merchant-feed']);
    expect(LIVE_PRICE_HISTORY_SOURCES).not.toContain('seed');
    expect(LIVE_PRICE_HISTORY_SOURCES).not.toContain('manual-intake');
  });

  /** Minimal chainable fake: every method returns the chain; await resolves the canned result. */
  function fakeChain(result: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'not', 'order', 'limit']) {
      chain[method] = () => chain;
    }
    chain.maybeSingle = async () => result;
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  }

  function fakeSupabaseForLastUpdate(opts: {
    columnError?: { code: string; message: string } | null;
    columnValue?: string | null;
    historyRows?: Array<{ recorded_at: string }>;
    merchantRows?: Array<{ last_synced_at: string }>;
  }) {
    const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
    return {
      updates,
      from(table: string) {
        if (table === 'products' && opts.columnError === undefined) {
          // update() path (mark) — thenable resolving { error: null }.
          return {
            select: () => fakeChain({ data: { last_successful_update: opts.columnValue ?? null }, error: null }),
            update: (patch: Record<string, unknown>) => {
              updates.push({ table, patch });
              return fakeChain({ data: null, error: null });
            },
          };
        }
        if (table === 'products') {
          return {
            select: () =>
              fakeChain({
                data: null,
                error: opts.columnError,
              }),
            update: (patch: Record<string, unknown>) => {
              updates.push({ table, patch });
              return fakeChain({ data: null, error: opts.columnError ?? null });
            },
          };
        }
        if (table === 'price_history') {
          return { select: () => fakeChain({ data: opts.historyRows ?? [], error: null }) };
        }
        if (table === 'merchant_products') {
          return { select: () => fakeChain({ data: opts.merchantRows ?? [], error: null }) };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  }

  it('mark writes the column when it exists', async () => {
    const db = fakeSupabaseForLastUpdate({});
    const result = await markProductSuccessfullyUpdated(
      db as unknown as Parameters<typeof markProductSuccessfullyUpdated>[0],
      'p1',
      '2026-11-13T10:00:00.000Z'
    );
    expect(result).toEqual({ persisted: true });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].patch).toEqual({ last_successful_update: '2026-11-13T10:00:00.000Z' });
  });

  it('mark reports column-missing (never throws, never re-stamps data_freshness) before 066 is applied', async () => {
    const db = fakeSupabaseForLastUpdate({
      columnError: { code: '42703', message: 'column does not exist' },
    });
    const result = await markProductSuccessfullyUpdated(
      db as unknown as Parameters<typeof markProductSuccessfullyUpdated>[0],
      'p1'
    );
    expect(result).toEqual({ persisted: false, reason: 'column-missing' });
    // No fallback stamp onto data_freshness: the patch carries
    // ONLY the new column.
    expect(db.updates[0].patch).not.toHaveProperty('data_freshness');
  });

  it('read prefers the stored column, then derives from live history', async () => {
    const db = fakeSupabaseForLastUpdate({
      columnValue: '2026-11-12T00:00:00.000Z',
      historyRows: [{ recorded_at: '2026-11-10T00:00:00.000Z' }],
    });
    const value = await getLastSuccessfulUpdate(
      db as unknown as Parameters<typeof getLastSuccessfulUpdate>[0],
      'p1'
    );
    expect(value).toEqual({ at: '2026-11-12T00:00:00.000Z', source: 'column', columnMissing: false });
  });

  it('read derives from history when the column is missing (066 unapplied)', async () => {
    const db = fakeSupabaseForLastUpdate({
      columnError: { code: '42703', message: 'column does not exist' },
      historyRows: [{ recorded_at: '2026-11-11T09:00:00.000Z' }],
      merchantRows: [{ last_synced_at: '2026-11-10T09:00:00.000Z' }],
    });
    const value = await getLastSuccessfulUpdate(
      db as unknown as Parameters<typeof getLastSuccessfulUpdate>[0],
      'p1'
    );
    expect(value).toEqual({ at: '2026-11-11T09:00:00.000Z', source: 'price-history', columnMissing: true });
  });

  it('migration 066 exists, is DO NOT APPLY, and adds the nullable column', () => {
    const file = 'supabase/migrations/20261113122000_066_products_last_successful_update.sql';
    expect(repoExists(file)).toBe(true);
    const sql = repoFile(file);
    expect(sql).toContain('DO NOT APPLY YET');
    expect(sql).toContain('last_successful_update timestamptz');
    expect(sql).not.toMatch(/UPDATE .* SET last_successful_update/i);
  });

  it('the admin data-quality summary carries lastSuccessfulUpdate per product', () => {
    const src = repoFile('services', 'admin-data-quality.ts');
    expect(src).toContain('lastSuccessfulUpdate');
    expect(src).toContain('productsWithSuccessfulUpdate');
    expect(src).toContain('lastSuccessfulUpdateColumnMissing');
    expect(src).toContain('resolveLastSuccessfulUpdate');
  });
});

// ---------------------------------------------------------------------------
// Item 6 — eBay budget refund on failure
// ---------------------------------------------------------------------------

describe('eBay budget refund (item 6)', () => {
  function fakeRedis(initial = 0): EbayBudgetRedis & { store: Map<string, number> } {
    const store = new Map<string, number>();
    if (initial > 0) store.set(`sb-ebay-daily:${getEbayBudgetDateKey(new Date('2026-11-12T12:00:00.000Z'))}`, initial);
    return {
      store,
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async incr(key: string) {
        const next = (store.get(key) ?? 0) + 1;
        store.set(key, next);
        return next;
      },
      async decr(key: string) {
        const next = (store.get(key) ?? 0) - 1;
        store.set(key, next);
        return next;
      },
      async expireat() {
        return true;
      },
    };
  }

  function fakeDb(initialCalls: number | null) {
    let calls: number | null = initialCalls;
    const client = {
      __getCalls() {
        return calls;
      },
      from(table: string) {
        if (table !== 'ebay_daily_usage') throw new Error(`unexpected table ${table}`);
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: calls === null ? null : { calls }, error: null };
                  },
                };
              },
            };
          },
          update(patch: { calls: number }) {
            return {
              eq() {
                return {
                  eq(_field: string, expected: number) {
                    return {
                      async select() {
                        if (calls === null || calls !== expected) return { data: [], error: null };
                        calls = patch.calls;
                        return { data: [{ calls }], error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    return client;
  }

  const NOON = new Date('2026-11-12T12:00:00.000Z');

  it('refunds a failed Redis reservation (counter goes back down)', async () => {
    const redis = fakeRedis(5);
    const result = await refundEbayDailyCall(null, { redis, now: NOON, units: 2 });
    expect(result.refunded).toBe(true);
    expect(result.used).toBe(3);
    expect(result.backend).toBe('redis');
    expect(redis.store.get('sb-ebay-daily:2026-11-12')).toBe(3);
  });

  it('never drives the counter below zero', async () => {
    const redis = fakeRedis(1);
    const result = await refundEbayDailyCall(null, { redis, now: NOON, units: 5 });
    expect(result.refunded).toBe(true);
    expect(result.used).toBe(0);
    expect(redis.store.get('sb-ebay-daily:2026-11-12')).toBe(0);
  });

  it('reports unsupported when the Redis client has no DECR', async () => {
    const redisNoDecr: EbayBudgetRedis = {
      async get() {
        return 5;
      },
      async incr() {
        return 6;
      },
      async expireat() {
        return true;
      },
    };
    const result = await refundEbayDailyCall(null, { redis: redisNoDecr, now: NOON });
    expect(result).toMatchObject({ refunded: false, reason: 'unsupported', backend: 'redis' });
  });

  it('refunds via the DB counter with the optimistic-concurrency shape', async () => {
    const db = fakeDb(4);
    const result = await refundEbayDailyCall(
      db as unknown as Parameters<typeof refundEbayDailyCall>[0],
      { redis: null, now: NOON, units: 1 }
    );
    expect(result).toMatchObject({ refunded: true, used: 3, backend: 'db' });
    expect(db.__getCalls()).toBe(3);
  });

  it('refunding zero units (no reservation spent) is a no-op', async () => {
    const redis = fakeRedis(4);
    const result = await refundEbayDailyCall(null, { redis, now: NOON, units: 0 });
    expect(result).toMatchObject({ refunded: false, reason: 'no-reservation' });
    expect(redis.store.get('sb-ebay-daily:2026-11-12')).toBe(4);
  });

  it('fails open (unavailable) when no counter exists at all', async () => {
    const result = await refundEbayDailyCall(null, { redis: null, now: NOON });
    expect(result).toMatchObject({ refunded: false, reason: 'unavailable', backend: 'unavailable' });
  });

  it('the eBay refresh refunds reservations when the search ultimately fails', () => {
    const src = repoFile('services', 'ebay-refresh.ts');
    expect(src).toContain('refundEbayDailyCall');
    expect(src).toContain('reservedUnits');
    expect(src).toContain('budgetRefunded');
    expect(src).toContain('skippedUnknownCurrencyCurrencies');
    expect(src).toContain('markProductSuccessfullyUpdated');
    // A failed search must not keep the budget: the refund call
    // sits on the failure path (search not ok after retries).
    expect(src).toContain('await refundReserved()');
  });
});

// ---------------------------------------------------------------------------
// Item 5 — chain-level retry
// ---------------------------------------------------------------------------

describe('chain-level retry (item 5)', () => {
  it('retries failed steps once, after the backoff, and reports recovery', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const result = await retryFailedRefreshSteps(
      ['refresh'],
      async () => {
        attempts += 1;
        // The step failed on the first pass (that is why it is in
        // the retry list); the single retry now succeeds.
        return { status: 'ok' as const, result: null };
      },
      { sleep: async (ms) => void sleeps.push(ms) }
    );
    expect(attempts).toBe(1);
    expect(sleeps).toEqual([CHAIN_RETRY_DELAY_MS]);
    expect(result.retried).toEqual(['refresh']);
    expect(result.recovered).toEqual(['refresh']);
    expect(result.stillFailed).toEqual([]);
    expect(result.outcomes.get('refresh')?.status).toBe('ok');
    expect(CHAIN_RETRY_MAX_ATTEMPTS).toBe(2);
  });

  it('a step that still fails stays failed (bounded: exactly one retry)', async () => {
    let calls = 0;
    const result = await retryFailedRefreshSteps(
      ['alerts'],
      async () => {
        calls += 1;
        return { status: 'failed' as const, result: null, error: 'still down' };
      },
      { delayMs: 0 }
    );
    expect(calls).toBe(1);
    expect(result.stillFailed).toEqual(['alerts']);
    expect(result.recovered).toEqual([]);
  });

  it('no failed steps means no sleep and no retry', async () => {
    const sleeps: number[] = [];
    const result = await retryFailedRefreshSteps([], async () => null, {
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(sleeps).toEqual([]);
    expect(result.retried).toEqual([]);
  });

  it('a throwing rerun is recorded as still failed, never propagated', async () => {
    const result = await retryFailedRefreshSteps(
      ['digest'],
      async () => {
        throw new Error('rerun crashed');
      },
      { delayMs: 0 }
    );
    expect(result.stillFailed).toEqual(['digest']);
  });

  it('the refresh route wires the retry and records it', () => {
    const src = repoFile('app', 'api', 'v1', 'prices', 'refresh', 'route.ts');
    expect(src).toContain('retryFailedRefreshSteps');
    expect(src).toContain('chainRetry');
    expect(src).toContain('attempts = CHAIN_RETRY_MAX_ATTEMPTS');
    expect(src).toContain('CHAIN-LEVEL RETRY');
    expect(src).toContain('currencyAssumedUsd: 0');
  });
});

// ---------------------------------------------------------------------------
// Item 2 — DLQ persistence + admin list/inspect
// ---------------------------------------------------------------------------

describe('dead-letter queue persistence + admin surface (item 2)', () => {
  function fakeErrorLogClient(opts: { missingTable?: boolean } = {}) {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    return {
      inserts,
      from(table: string) {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push({ table, row });
            if (opts.missingTable) {
              return Promise.resolve({ error: { code: '42P01', message: 'relation does not exist' } });
            }
            return Promise.resolve({ error: null });
          },
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: opts.missingTable
                    ? null
                    : [
                        {
                          id: 'log-1',
                          created_at: '2026-11-13T10:00:00.000Z',
                          message: 'Job moved to dead-letter queue',
                          meta: {
                            jobId: 'sync-1',
                            jobType: 'price.refresh',
                            attempts: 3,
                            error: 'provider down',
                            failedAt: '2026-11-13T10:00:00.000Z',
                            data: { productId: 'p1' },
                          },
                        },
                      ],
                  error: opts.missingTable
                    ? { code: '42P01', message: 'relation does not exist' }
                    : null,
                }),
              }),
            }),
          }),
        };
      },
    };
  }

  it('persistDeadLetterEntry writes a queue.dlq error_log row', async () => {
    const db = fakeErrorLogClient();
    const outcome = await persistDeadLetterEntry(
      db as unknown as Parameters<typeof persistDeadLetterEntry>[0],
      {
        id: 'sync-1',
        type: 'price.refresh',
        data: { productId: 'p1' },
        error: 'provider down',
        attempts: 3,
        failedAt: '2026-11-13T10:00:00.000Z',
      }
    );
    expect(outcome).toBe('inserted');
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].table).toBe('error_log');
    expect(db.inserts[0].row.route).toBe('queue.dlq');
    expect(db.inserts[0].row.meta).toMatchObject({
      jobId: 'sync-1',
      jobType: 'price.refresh',
      attempts: 3,
      error: 'provider down',
    });
  });

  it('persist reports missing-table (never throws) before migration 048', async () => {
    const db = fakeErrorLogClient({ missingTable: true });
    const outcome = await persistDeadLetterEntry(
      db as unknown as Parameters<typeof persistDeadLetterEntry>[0],
      {
        id: 'sync-2',
        type: 'price.refresh',
        data: {},
        error: 'x',
        attempts: 1,
        failedAt: '2026-11-13T10:00:00.000Z',
      }
    );
    expect(outcome).toBe('missing-table');
  });

  it('insertErrorLogRow itself tolerates a missing table', async () => {
    const db = fakeErrorLogClient({ missingTable: true });
    const outcome = await insertErrorLogRow(
      db as unknown as Parameters<typeof insertErrorLogRow>[0],
      { level: 'error', message: 'm', route: 'queue.dlq', meta: {} }
    );
    expect(outcome).toBe('missing-table');
  });

  it('listDeadLetterFailures maps persisted rows and flags a missing table', async () => {
    const db = fakeErrorLogClient();
    const listed = await listDeadLetterFailures(
      db as unknown as Parameters<typeof listDeadLetterFailures>[0]
    );
    expect(listed.tableMissing).toBe(false);
    expect(listed.failures).toHaveLength(1);
    expect(listed.failures[0]).toMatchObject({
      jobId: 'sync-1',
      jobType: 'price.refresh',
      attempts: 3,
      error: 'provider down',
    });

    const missing = await listDeadLetterFailures(
      fakeErrorLogClient({ missingTable: true }) as unknown as Parameters<
        typeof listDeadLetterFailures
      >[0]
    );
    expect(missing).toEqual({ failures: [], tableMissing: true });
  });

  it('the admin dead-letter route exists, is admin-guarded, and lists both halves', () => {
    const src = repoFile('app', 'api', 'v1', 'admin', 'jobs', 'dead-letter', 'route.ts');
    expect(src).toContain('requireAdmin');
    expect(src).toContain('getDeadLetterQueue()');
    expect(src).toContain('listDeadLetterFailures');
    expect(src).toContain("params.get('id')");
    expect(src).toContain('durability');
    expect(src).toContain('tableMissing');
  });

  it('recordDeadLetter persists best-effort (queue never blocks on the write)', () => {
    const src = repoFile('lib', 'workers', 'queue.ts');
    expect(src).toContain('persistDeadLetterEntry');
    expect(src).toContain('void persistDeadLetterEntryBestEffort(entry)');
  });
});

// ---------------------------------------------------------------------------
// Item 7 — residual re-stamp paths R1–R3
// ---------------------------------------------------------------------------

describe('residual re-stamp paths R1–R3 (item 7)', () => {
  it('R1: ingestion stamps the FETCH time, never insert-time; without one it stamps nothing on update', () => {
    expect(resolveIngestFetchedAt({ fetchedAt: '2026-11-13T08:00:00.000Z' })).toBe(
      '2026-11-13T08:00:00.000Z'
    );
    expect(resolveIngestFetchedAt({})).toBeNull();
    expect(resolveIngestFetchedAt({ fetchedAt: 'not-a-date' })).toBeNull();
    expect(resolveIngestFetchedAt()).toBeNull();
    const src = repoFile('services', 'pipeline', 'ingestion.ts');
    expect(src).toContain('...(fetchedAt ? { data_freshness: fetchedAt } : {})');
    expect(src).not.toContain('data_freshness: new Date().toISOString()');
    expect(src).toContain('ingestBatch(');
    expect(src).toContain('options?: IngestOptions');
  });

  it('R2: intake approve stamps the PREVIEW time, never approve-time', () => {
    const src = repoFile('app', 'api', 'v1', 'admin', 'intake', 'route.ts');
    expect(src).not.toContain('approvedAt');
    expect(src).toContain('checkedAt');
    expect(src).toContain('fetchedAt: z.string().optional()');
    expect(src).toContain('data_freshness: checkedAt');
    // The eBay admin page carries the preview time into approve.
    const page = repoFile('app', 'admin', 'intake', 'ebay', 'page.tsx');
    expect(page).toContain('fetchedAt: searchResult.fetchedAt');
  });

  it('R2: an eBay verification without a carried preview time has verified_at null, not approve-time', () => {
    expect(priceVerificationForIntakeSource('ebay-browse-api', null)).toEqual({
      priceVerificationStatus: 'verified',
      priceSource: 'ebay-browse-api',
      priceVerifiedAt: null,
    });
    expect(
      priceVerificationForIntakeSource('ebay-browse-api', '2026-11-13T08:00:00.000Z')
    ).toEqual({
      priceVerificationStatus: 'verified',
      priceSource: 'ebay-browse-api',
      priceVerifiedAt: '2026-11-13T08:00:00.000Z',
    });
    expect(priceVerificationForIntakeSource('manual-intake', '2026-11-13T08:00:00.000Z')).toEqual({
      priceVerificationStatus: 'unverified',
      priceSource: 'manual-intake',
      priceVerifiedAt: null,
    });
  });

  it('R3: a re-read price row records the merchant row write time as observed_at, never now', async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const client = {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    // Explicit null observed_at is preserved as NULL (unknown),
    // not defaulted to recorded_at.
    const { error } = await insertPriceHistoryRow(
      client as unknown as Parameters<typeof insertPriceHistoryRow>[0],
      {
        product_id: 'p1',
        retailer_id: 'r1',
        price: 90,
        currency: 'USD',
        availability: 'in_stock',
        recorded_at: '2026-11-13T10:00:00.000Z',
        source: null,
        observed_at: null,
        suspicious_change: false,
      }
    );
    expect(error).toBeNull();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].observed_at).toBeNull();
    expect(inserts[0].recorded_at).toBe('2026-11-13T10:00:00.000Z');

    // Undefined observed_at keeps the old default (recorded_at).
    const { error: error2 } = await insertPriceHistoryRow(
      client as unknown as Parameters<typeof insertPriceHistoryRow>[0],
      {
        product_id: 'p1',
        retailer_id: 'r1',
        price: 91,
        currency: 'USD',
        availability: 'in_stock',
        recorded_at: '2026-11-13T10:00:00.000Z',
        source: 'live',
      }
    );
    expect(error2).toBeNull();
    expect(inserts[1].observed_at).toBe('2026-11-13T10:00:00.000Z');

    const src = repoFile('services', 'price-refresh.ts');
    expect(src).toContain('lowest.updated_at');
    expect(src).toContain('observed_at: observedAt');
    expect(src).not.toContain('observed_at: nowIso');
  });
});

// ---------------------------------------------------------------------------
// Item 8 — BullMQ code claims corrected (code only, never docs)
// ---------------------------------------------------------------------------

describe('BullMQ code claims (item 8)', () => {
  it('the queue header no longer claims a BullMQ integration', () => {
    const src = repoFile('lib', 'workers', 'queue.ts');
    expect(src).not.toContain('BullMQ integration with synchronous fallback');
    expect(src).not.toContain('Jobs are enqueued to BullMQ queues');
    expect(src).toContain('synchronous in-process ONLY');
    expect(src).toContain('bullmq` package is NOT installed');
  });

  it('processors and background-job code no longer describe a BullMQ-backed queue', () => {
    const processors = repoFile('lib', 'workers', 'processors.ts');
    expect(processors).toContain('There is no BullMQ package installed');
    expect(processors).not.toContain('shared between the synchronous queue (in-process)');
    const jobs = repoFile('services', 'ai-background-jobs.ts');
    expect(jobs).not.toContain('becomes truly asynchronous with no code change');
    expect(jobs).toContain('would need the `bullmq`');
    const dataRefresh = repoFile('app', 'api', 'v1', 'data', 'refresh', 'route.ts');
    expect(dataRefresh).not.toContain('When Redis/BullMQ is');
  });

  it('the BullMQ adapter class is kept but labelled dead code (not silently deleted)', () => {
    const src = repoFile('lib', 'workers', 'queue.ts');
    expect(src).toContain('class BullMQQueue');
    expect(src).toContain('DEAD CODE today');
  });
});

// ---------------------------------------------------------------------------
// Item 6 budget cap constant sanity
// ---------------------------------------------------------------------------

describe('eBay budget constants (item 6, unchanged guard)', () => {
  it('the daily cap is still 4,500 (90% of the 5,000 free tier)', () => {
    expect(EBAY_DAILY_BUDGET_CAP).toBe(4_500);
  });
});
