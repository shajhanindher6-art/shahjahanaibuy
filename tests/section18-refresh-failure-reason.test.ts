/**
 * Section 18, item 47 — refresh failure reason (audit §1 #32).
 *
 * `markProductRefreshFailed` (services/freshness.ts) stores the
 * failure reason as an `error_log` row (`route='prices.refresh'`,
 * `meta.productId` + `meta.reason`) via the shared best-effort
 * writer, and `listRefreshFailures` (services/error-log-admin.ts)
 * reads those rows back as the failed-products list for
 * /admin/refresh-runs. Against mocked Supabase clients (no DB, no
 * network): the reason is stored, the product row is still marked
 * failed, a missing error_log table (migration 048 unapplied) is
 * tolerated, and non-product rows under the same route are filtered
 * out of the list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { markProductRefreshFailed } from '@/services/freshness';
import { listRefreshFailures } from '@/services/error-log-admin';
import type { AnySupabaseClient } from '@/lib/supabase/types';

type Row = Record<string, unknown>;

function fakeFreshnessClient(opts: {
  errorLogError?: { code?: string; message?: string } | null;
  errorLogThrows?: boolean;
} = {}) {
  const updates: Array<{ table: string; row: Row }> = [];
  const inserts: Array<{ table: string; row: Row }> = [];
  const client = {
    from: (table: string) => ({
      update: (row: Row) => {
        updates.push({ table, row });
        return { eq: async () => ({ error: null }) };
      },
      insert: async (row: Row) => {
        inserts.push({ table, row });
        if (opts.errorLogThrows) throw new Error('insert exploded');
        return { error: opts.errorLogError ?? null };
      },
    }),
  } as unknown as AnySupabaseClient;
  return { client, updates, inserts };
}

function fakeListClient(result: {
  data: unknown;
  error: { code?: string; message?: string } | null;
}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => result,
          }),
        }),
      }),
    }),
  } as unknown as AnySupabaseClient;
}

describe('markProductRefreshFailed stores the reason', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('marks the product failed AND writes the reason to error_log', async () => {
    const { client, updates, inserts } = fakeFreshnessClient();
    await markProductRefreshFailed(client, 'prod-1', {
      reason: 'price_history insert failed: duplicate key',
      productName: 'MacBook Air',
      productSlug: 'macbook-air',
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('products');
    expect(updates[0].row.refresh_status).toBe('failed');
    const nextRefresh = new Date(updates[0].row.next_refresh_at as string).getTime();
    expect(nextRefresh - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(nextRefresh - Date.now()).toBeLessThanOrEqual(16 * 60 * 1000);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('error_log');
    expect(inserts[0].row).toMatchObject({
      level: 'error',
      message: 'Product refresh failed',
      route: 'prices.refresh',
    });
    const meta = inserts[0].row.meta as Row;
    expect(meta.productId).toBe('prod-1');
    expect(meta.reason).toBe('price_history insert failed: duplicate key');
    expect(meta.productName).toBe('MacBook Air');
    expect(meta.productSlug).toBe('macbook-air');
  });

  it('still writes a row (without a reason) when no failure detail is passed', async () => {
    const { client, inserts } = fakeFreshnessClient();
    await markProductRefreshFailed(client, 'prod-2');
    expect(inserts).toHaveLength(1);
    const meta = inserts[0].row.meta as Row;
    expect(meta.productId).toBe('prod-2');
    expect(meta.reason).toBeUndefined();
  });

  it('tolerates a missing error_log table (048 unapplied) and a throwing insert', async () => {
    const missing = fakeFreshnessClient({
      errorLogError: { code: '42P01', message: 'relation "error_log" does not exist' },
    });
    await expect(
      markProductRefreshFailed(missing.client, 'prod-3', { reason: 'x' })
    ).resolves.toBeUndefined();
    expect(missing.updates).toHaveLength(1);
    const throwing = fakeFreshnessClient({ errorLogThrows: true });
    await expect(
      markProductRefreshFailed(throwing.client, 'prod-3', { reason: 'x' })
    ).resolves.toBeUndefined();
    expect(throwing.updates).toHaveLength(1);
  });
});

describe('listRefreshFailures', () => {
  it('returns only rows with a productId, newest first, with reason/name/slug', async () => {
    const client = fakeListClient({
      data: [
        {
          id: 'f-1',
          created_at: '2026-11-12T10:00:00.000Z',
          message: 'Product refresh failed',
          meta: {
            productId: 'prod-1',
            reason: 'eBay search failed (rate-limited) after 3 attempts',
            productName: 'MacBook Air',
            productSlug: 'macbook-air',
          },
        },
        {
          id: 'f-2',
          created_at: '2026-11-12T09:00:00.000Z',
          message: 'boom',
          meta: { status: 500 },
        },
        {
          id: 'f-3',
          created_at: '2026-11-12T08:00:00.000Z',
          message: 'Product refresh failed',
          meta: { productId: 'prod-2', reason: 'merchant_products insert failed: nope' },
        },
      ],
      error: null,
    });
    const result = await listRefreshFailures(client);
    expect(result.tableMissing).toBe(false);
    expect(result.error).toBeUndefined();
    // The plain API-error row (no productId) is filtered out.
    expect(result.failures.map((f) => f.id)).toEqual(['f-1', 'f-3']);
    expect(result.failures[0]).toMatchObject({
      productId: 'prod-1',
      productName: 'MacBook Air',
      productSlug: 'macbook-air',
      reason: 'eBay search failed (rate-limited) after 3 attempts',
    });
    expect(result.failures[1].productName).toBeNull();
    expect(result.failures[1].reason).toBe('merchant_products insert failed: nope');
  });

  it('returns tableMissing when error_log does not exist (PGRST205 — migration 048 unapplied)', async () => {
    const client = fakeListClient({
      data: null,
      error: { code: 'PGRST205', message: 'Could not find the table' },
    });
    const result = await listRefreshFailures(client);
    expect(result.tableMissing).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('reports a non-missing-table read error instead of an empty list', async () => {
    const client = fakeListClient({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    const result = await listRefreshFailures(client);
    expect(result.tableMissing).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.error).toBe('permission denied');
  });
});
