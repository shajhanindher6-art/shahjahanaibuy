import { describe, expect, it } from 'vitest';
import {
  EBAY_DAILY_BUDGET_CAP,
  getEbayBudgetDateKey,
  getEbayDailyBudget,
  getSecondsUntilUtcMidnight,
  reserveEbayDailyCall,
  type EbayBudgetRedis,
} from '@/services/ebay-budget';

// Section 15, P3-5 / P3-6 — daily-budget guard. Fake Redis + a
// minimal fake Supabase client; no network, no database, no real
// credentials anywhere.

function fakeRedis(initial = 0): EbayBudgetRedis & {
  store: Map<string, number>;
  expireCalls: Array<{ key: string; at: number }>;
} {
  const store = new Map<string, number>();
  if (initial > 0) store.set('sb-ebay-daily:2026-11-12', initial);
  const expireCalls: Array<{ key: string; at: number }> = [];
  return {
    store,
    expireCalls,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async incr(key: string) {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    async expireat(key: string, at: number) {
      expireCalls.push({ key, at });
      return true;
    },
  };
}

const NOON = new Date('2026-11-12T12:00:00.000Z');

/** Minimal fake Supabase client for the ebay_daily_usage table. */
function fakeDb(initialCalls: number | null) {
  let calls: number | null = initialCalls;
  let missingTable = false;
  const client = {
    __setMissingTable(value: boolean) {
      missingTable = value;
    },
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
                  if (missingTable) {
                    return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
                  }
                  return { data: calls === null ? null : { calls }, error: null };
                },
              };
            },
          };
        },
        insert(row: { usage_date: string; calls: number }) {
          if (missingTable) {
            return { error: { code: '42P01', message: 'relation does not exist' } };
          }
          if (calls !== null) {
            return { error: { code: '23505', message: 'duplicate key' } };
          }
          calls = row.calls;
          return { error: null };
        },
        update(patch: { calls: number; updated_at: string }) {
          return {
            eq() {
              return {
                eq(_field: string, expected: number) {
                  return {
                    async select() {
                      if (missingTable) {
                        return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
                      }
                      if (calls === null || calls !== expected) {
                        // Concurrent increment won the race: no rows.
                        return { data: [], error: null };
                      }
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

describe('getEbayBudgetDateKey / getSecondsUntilUtcMidnight', () => {
  it('keys by UTC date, not local date', () => {
    expect(getEbayBudgetDateKey(new Date('2026-11-12T23:59:59.000Z'))).toBe('2026-11-12');
    expect(getEbayBudgetDateKey(new Date('2026-11-13T00:00:01.000Z'))).toBe('2026-11-13');
  });

  it('expires at the next UTC midnight', () => {
    expect(getSecondsUntilUtcMidnight(new Date('2026-11-12T12:00:00.000Z'))).toBe(12 * 3600);
    expect(getSecondsUntilUtcMidnight(new Date('2026-11-12T23:59:59.000Z'))).toBe(1);
  });
});

describe('reserveEbayDailyCall with Redis', () => {
  it('allows the first call and sets a TTL to UTC midnight', async () => {
    const redis = fakeRedis();
    const result = await reserveEbayDailyCall(null, { redis, now: NOON });
    expect(result).toMatchObject({
      allowed: true,
      used: 1,
      remaining: EBAY_DAILY_BUDGET_CAP - 1,
      limit: EBAY_DAILY_BUDGET_CAP,
      backend: 'redis',
      dateKey: '2026-11-12',
    });
    expect(redis.expireCalls).toHaveLength(1);
    expect(redis.expireCalls[0].key).toBe('sb-ebay-daily:2026-11-12');
    // Midnight UTC 2026-11-13 = 2026-11-13T00:00:00Z.
    expect(redis.expireCalls[0].at).toBe(
      Math.floor(Date.parse('2026-11-13T00:00:00.000Z') / 1000)
    );
  });

  it('denies at the cap without spending another call', async () => {
    const redis = fakeRedis(EBAY_DAILY_BUDGET_CAP);
    const result = await reserveEbayDailyCall(null, { redis, now: NOON });
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(EBAY_DAILY_BUDGET_CAP);
    expect(result.remaining).toBe(0);
    expect(redis.store.get('sb-ebay-daily:2026-11-12')).toBe(EBAY_DAILY_BUDGET_CAP);
  });

  it('counts successive reservations', async () => {
    const redis = fakeRedis();
    await reserveEbayDailyCall(null, { redis, now: NOON });
    const second = await reserveEbayDailyCall(null, { redis, now: NOON });
    expect(second.used).toBe(2);
    // Only the first reservation sets the TTL.
    expect(redis.expireCalls).toHaveLength(1);
  });
});

describe('reserveEbayDailyCall with the DB fallback', () => {
  it('inserts the first row of the day and increments afterwards', async () => {
    const db = fakeDb(null);
    const first = await reserveEbayDailyCall(
      db as unknown as Parameters<typeof reserveEbayDailyCall>[0],
      { redis: null, now: NOON }
    );
    expect(first).toMatchObject({ allowed: true, used: 1, backend: 'db' });
    const second = await reserveEbayDailyCall(
      db as unknown as Parameters<typeof reserveEbayDailyCall>[0],
      { redis: null, now: NOON }
    );
    expect(second).toMatchObject({ allowed: true, used: 2, backend: 'db' });
    expect(db.__getCalls()).toBe(2);
  });

  it('denies at the cap without incrementing', async () => {
    const db = fakeDb(EBAY_DAILY_BUDGET_CAP);
    const result = await reserveEbayDailyCall(
      db as unknown as Parameters<typeof reserveEbayDailyCall>[0],
      { redis: null, now: NOON }
    );
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(db.__getCalls()).toBe(EBAY_DAILY_BUDGET_CAP);
  });

  it('fails open when the counter table is missing (migration 041 unapplied)', async () => {
    const db = fakeDb(null);
    db.__setMissingTable(true);
    const result = await reserveEbayDailyCall(
      db as unknown as Parameters<typeof reserveEbayDailyCall>[0],
      { redis: null, now: NOON }
    );
    expect(result).toMatchObject({
      allowed: true,
      used: null,
      remaining: null,
      backend: 'unavailable',
    });
  });

  it('fails open when no counter exists at all', async () => {
    const result = await reserveEbayDailyCall(null, { redis: null, now: NOON });
    expect(result).toMatchObject({ allowed: true, backend: 'unavailable' });
  });
});

describe('getEbayDailyBudget', () => {
  it('reads the remaining budget without reserving', async () => {
    const redis = fakeRedis(10);
    const result = await getEbayDailyBudget(null, { redis, now: NOON });
    expect(result).toMatchObject({
      allowed: true,
      used: 10,
      remaining: EBAY_DAILY_BUDGET_CAP - 10,
      backend: 'redis',
    });
    expect(redis.store.get('sb-ebay-daily:2026-11-12')).toBe(10);
  });

  it('reports unknown when no counter exists', async () => {
    const result = await getEbayDailyBudget(null, { redis: null, now: NOON });
    expect(result).toMatchObject({ used: null, remaining: null, backend: 'unavailable' });
  });
});
