/**
 * Digest generation honesty tests (Section 15, P4-2).
 *
 * generateWeeklyDigest + generateWeeklyDigestsForPremiumUsers
 * against an in-memory Supabase client; no DB, no network.
 * Asserts the core fix: a digest whose row was NOT stored is
 * never counted, and the refresh-chain helper only generates
 * when a week has passed since the last stored digest.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  generateWeeklyDigest,
  generateWeeklyDigestsForPremiumUsers,
  buildDigestEmail,
  DIGEST_PLANS,
} from '@/services/notifications';

type Row = Record<string, unknown>;

const fakeDb = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  insertErrorTables: new Set<string>(),
  failUsers: new Set<string>(),
  selectErrorTables: new Set<string>(),
}));

function seedTables() {
  fakeDb.tables = {
    deals: [
      {
        id: 'deal-1',
        title: 'Deal A',
        discount_type: 'percentage',
        discount_value: 20,
        end_at: null,
        active: true,
        deleted_at: null,
        created_at: new Date().toISOString(),
      },
    ],
    price_alert_history: [],
    search_history: [],
    weekly_digests: [] as Row[],
    notification_queue: [] as Row[],
    notifications: [] as Row[],
    subscriptions: [
      { user_id: 'user-premium', plan: 'premium', status: 'active' },
      { user_id: 'user-legacy-pro', plan: 'pro', status: 'active' },
      { user_id: 'user-free', plan: 'free', status: 'active' },
      { user_id: 'user-canceled', plan: 'premium', status: 'canceled' },
    ] as Row[],
  };
}

function makeClient() {
  return {
    from: (table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      let limitN: number | undefined;
      let orderBy: { col: string; asc: boolean } | null = null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, value: unknown) => {
          filters.push((r) => r[col] === value);
          return chain;
        },
        in: (col: string, values: unknown[]) => {
          filters.push((r) => values.includes(r[col]));
          return chain;
        },
        is: (col: string, value: unknown) => {
          filters.push((r) => (value === null ? r[col] == null : r[col] === value));
          return chain;
        },
        gte: () => chain,
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderBy = { col, asc: opts?.ascending !== false };
          return chain;
        },
        limit: (n: number) => {
          limitN = n;
          return chain;
        },
        insert: async (row: Row) => {
          if (fakeDb.insertErrorTables.has(table)) {
            return { error: { code: '42501', message: 'denied' }, data: null };
          }
          if (
            table === 'weekly_digests' &&
            typeof row.user_id === 'string' &&
            fakeDb.failUsers.has(row.user_id)
          ) {
            return { error: { code: '42501', message: 'denied' }, data: null };
          }
          (fakeDb.tables[table] ??= []).push({ ...row });
          return { error: null, data: [row] };
        },
        then: (resolve: (value: unknown) => void) => {
          if (fakeDb.selectErrorTables.has(table)) {
            resolve({ data: null, error: { code: 'PGRST205', message: 'table not found' } });
            return;
          }
          let rows = [...(fakeDb.tables[table] ?? [])].filter((r) =>
            filters.every((f) => f(r))
          );
          if (orderBy) {
            const { col, asc } = orderBy;
            rows = rows.sort((a, b) => {
              const cmp = String(a[col] ?? '').localeCompare(String(b[col] ?? ''));
              return asc ? cmp : -cmp;
            });
          }
          if (limitN !== undefined) rows = rows.slice(0, limitN);
          resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('generateWeeklyDigest honesty (P4-2)', () => {
  beforeEach(() => {
    seedTables();
    fakeDb.insertErrorTables = new Set();
    fakeDb.failUsers = new Set();
    fakeDb.selectErrorTables = new Set();
  });

  it('stores the digest row and queues the notification', async () => {
    const digest = await generateWeeklyDigest(makeClient(), 'user-premium');
    expect(digest).not.toBeNull();
    expect(digest?.topDeals).toHaveLength(1);
    expect(fakeDb.tables.weekly_digests).toHaveLength(1);
    expect(fakeDb.tables.weekly_digests[0].user_id).toBe('user-premium');
    expect(fakeDb.tables.notification_queue).toHaveLength(1);
  });

  it('returns null when the digest row was NOT stored (never counted as generated)', async () => {
    fakeDb.insertErrorTables.add('weekly_digests');
    const digest = await generateWeeklyDigest(makeClient(), 'user-premium');
    expect(digest).toBeNull();
    expect(fakeDb.tables.weekly_digests).toHaveLength(0);
    expect(fakeDb.tables.notification_queue).toHaveLength(0);
  });

  it('still returns the stored digest when only the queue insert fails', async () => {
    fakeDb.insertErrorTables.add('notification_queue');
    const digest = await generateWeeklyDigest(makeClient(), 'user-premium');
    expect(digest).not.toBeNull();
    expect(fakeDb.tables.weekly_digests).toHaveLength(1);
    expect(fakeDb.tables.notification_queue).toHaveLength(0);
  });

  it('buildDigestEmail is exported for the newsletter sender (P4-4 reuse)', () => {
    const body = buildDigestEmail(
      [{ title: 'Deal A', discount_value: 20, discount_type: 'percentage' }],
      [],
      []
    );
    expect(body).toContain('Deal A');
    expect(body).toContain('20% off');
  });
});

describe('generateWeeklyDigestsForPremiumUsers weekly cadence (P4-2)', () => {
  beforeEach(() => {
    seedTables();
    fakeDb.insertErrorTables = new Set();
    fakeDb.failUsers = new Set();
    fakeDb.selectErrorTables = new Set();
  });

  it('generates for premium AND legacy pro, skips free and canceled', async () => {
    const result = await generateWeeklyDigestsForPremiumUsers(makeClient());
    expect(result.due).toBe(true);
    expect(result.total).toBe(2);
    expect(result.generated).toBe(2);
    expect(result.failed).toBe(0);
    expect(fakeDb.tables.weekly_digests.map((r) => r.user_id).sort()).toEqual([
      'user-legacy-pro',
      'user-premium',
    ]);
  });

  it('DIGEST_PLANS covers premium plus the legacy pro key', () => {
    expect([...DIGEST_PLANS].sort()).toEqual(['premium', 'pro']);
  });

  it('skips when a digest was stored within the last 7 days', async () => {
    fakeDb.tables.weekly_digests.push({
      user_id: 'user-premium',
      week_start: '2026-11-09',
      week_end: '2026-11-15',
      created_at: new Date().toISOString(),
    });
    const result = await generateWeeklyDigestsForPremiumUsers(makeClient());
    expect(result.due).toBe(false);
    expect(result.generated).toBe(0);
    expect(result.skipped).toContain('last 7 days');
    expect(fakeDb.tables.weekly_digests).toHaveLength(1);
  });

  it('generates again when the last digest is over 7 days old', async () => {
    fakeDb.tables.weekly_digests.push({
      user_id: 'user-premium',
      week_start: '2026-11-02',
      week_end: '2026-11-08',
      created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = await generateWeeklyDigestsForPremiumUsers(makeClient());
    expect(result.due).toBe(true);
    expect(result.generated).toBe(2);
  });

  it('counts per-user failures instead of counting them as generated', async () => {
    fakeDb.failUsers.add('user-legacy-pro');
    const result = await generateWeeklyDigestsForPremiumUsers(makeClient());
    expect(result.due).toBe(true);
    expect(result.generated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(2);
  });

  it('skips honestly (not failed) when the digest tables are missing', async () => {
    fakeDb.selectErrorTables.add('weekly_digests');
    const result = await generateWeeklyDigestsForPremiumUsers(makeClient());
    expect(result.due).toBe(false);
    expect(result.generated).toBe(0);
    expect(result.skipped).toContain('migration 009');
  });
});
