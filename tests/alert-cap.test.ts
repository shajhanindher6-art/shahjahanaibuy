/**
 * Unit tests for the signed-in alert cap (Section 15 B14 = P2-3).
 *
 * - Free tier: 5 alerts — a 6th is rejected (allowed: false).
 * - Premium / Family / Team: unlimited — the count is not even read.
 * - A count failure fails OPEN (allowed, current -1) so a DB hiccup
 *   never blocks alert creation.
 *
 * The Supabase client is a small stub: only the `alerts` table with
 * an exact-count head query is needed here.
 */

import { describe, expect, it } from 'vitest';
import { checkAlertCap, countAlerts } from '@/services/alerts';
import type { AnySupabaseClient } from '@/lib/supabase/types';

type Row = Record<string, unknown>;

function alertRow(userId: string, id: string): Row {
  return { id, user_id: userId, product_id: `p-${id}`, alert_type: 'price_drop' };
}

function createStubSupabase(
  tables: Record<string, Row[]>,
  opts: { countError?: string } = {}
): AnySupabaseClient {
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select(_cols?: string, selectOpts?: { count?: string; head?: boolean }) {
        builder._countRequested = selectOpts?.count === 'exact';
        return builder;
      },
      eq(col: string, val: unknown) {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      then(
        onFulfilled?: (value: {
          data: Row[] | null;
          error: { message: string } | null;
          count: number | null;
        }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        if (opts.countError) {
          return Promise.resolve({
            data: null,
            error: { message: opts.countError },
            count: null,
          }).then(onFulfilled, onRejected);
        }
        return Promise.resolve({
          data: rows,
          error: null,
          count: builder._countRequested ? rows.length : null,
        }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };
  return { from: (table: string) => query(table) } as unknown as AnySupabaseClient;
}

function freeUserWith(n: number): AnySupabaseClient {
  const rows = Array.from({ length: n }, (_, i) => alertRow('user-free', `a${i}`));
  return createStubSupabase({ alerts: rows });
}

describe('countAlerts', () => {
  it('counts only the requesting user’s alerts', async () => {
    const supabase = createStubSupabase({
      alerts: [
        ...Array.from({ length: 5 }, (_, i) => alertRow('user-free', `a${i}`)),
        alertRow('user-other', 'b0'),
      ],
    });
    expect(await countAlerts(supabase, 'user-free')).toBe(5);
    expect(await countAlerts(supabase, 'user-other')).toBe(1);
    expect(await countAlerts(supabase, 'user-none')).toBe(0);
  });

  it('returns -1 when the count fails', async () => {
    const supabase = createStubSupabase(
      { alerts: [alertRow('user-free', 'a0')] },
      { countError: 'boom' }
    );
    expect(await countAlerts(supabase, 'user-free')).toBe(-1);
  });
});

describe('checkAlertCap', () => {
  it('allows a Free user below the cap', async () => {
    const result = await checkAlertCap(freeUserWith(4), 'user-free', 'free');
    expect(result).toEqual({ allowed: true, current: 4, max: 5, tier: 'free' });
  });

  it('rejects a Free user at the cap — the 6th alert is a 403', async () => {
    const result = await checkAlertCap(freeUserWith(5), 'user-free', 'free');
    expect(result).toEqual({ allowed: false, current: 5, max: 5, tier: 'free' });
  });

  it('rejects a Free user already over the cap', async () => {
    const result = await checkAlertCap(freeUserWith(7), 'user-free', 'free');
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(7);
  });

  it('never caps Premium / Family / Team — no count is read', async () => {
    for (const tier of ['premium', 'family', 'team'] as const) {
      const result = await checkAlertCap(freeUserWith(50), 'user-free', tier);
      expect(result).toEqual({ allowed: true, current: -1, max: null, tier });
    }
  });

  it('fails open when the count cannot be determined', async () => {
    const supabase = createStubSupabase(
      { alerts: [alertRow('user-free', 'a0')] },
      { countError: 'boom' }
    );
    const result = await checkAlertCap(supabase, 'user-free', 'free');
    expect(result).toEqual({ allowed: true, current: -1, max: 5, tier: 'free' });
  });
});
