/**
 * Past weekly digests read API tests (Section 15, B12).
 *
 * Digests were write-only: generateWeeklyDigest inserts into
 * `weekly_digests` and nothing ever read them back. GET
 * /api/v1/digests is the read side — no migration needed
 * (migration 009 already grants SELECT TO authenticated USING
 * auth.uid() = user_id), and the query is additionally scoped to
 * the caller's own user_id. Route tests run against a mocked
 * Supabase client (in-memory weekly_digests table); no DB, no
 * network. The dashboard archive UI is a later worker's (C2
 * saved searches owns app/dashboard/page.tsx) — this endpoint is
 * what it will read from.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getPastDigests } from '@/services/notifications';

type DigestRow = Record<string, unknown>;

// --- In-memory weekly_digests table ------------------------------------
const fakeDb = vi.hoisted(() => ({
  rows: [] as DigestRow[],
  authedUserId: 'user-1' as string | null,
}));

function seedRows() {
  fakeDb.rows = [
    {
      id: 'd-newest',
      user_id: 'user-1',
      week_start: '2026-11-09',
      week_end: '2026-11-15',
      top_deals: [{ title: 'Deal A' }],
      price_drops: [],
      search_summary: [],
      sent_at: null,
      created_at: '2026-11-15T00:00:00.000Z',
    },
    {
      id: 'd-older',
      user_id: 'user-1',
      week_start: '2026-11-02',
      week_end: '2026-11-08',
      top_deals: [],
      price_drops: [{ product_id: 'p1' }],
      search_summary: [{ query: 'laptop' }],
      sent_at: '2026-11-08T00:00:00.000Z',
      created_at: '2026-11-08T00:00:00.000Z',
    },
    {
      id: 'd-other-user',
      user_id: 'user-2',
      week_start: '2026-11-09',
      week_end: '2026-11-15',
      top_deals: [],
      price_drops: [],
      search_summary: [],
      sent_at: null,
      created_at: '2026-11-15T00:00:00.000Z',
    },
  ];
}

function makeFakeClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: fakeDb.authedUserId ? { id: fakeDb.authedUserId } : null },
        error: null,
      }),
    },
    from: (_table: string) => {
      const state: { userId?: string; limit?: number } = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (_col: string, value: string) => {
          state.userId = value;
          return chain;
        },
        order: () => chain,
        limit: (n: number) => {
          state.limit = n;
          return chain;
        },
        then: (resolve: (value: unknown) => void) => {
          let rows = fakeDb.rows.filter((r) => r.user_id === state.userId);
          rows = [...rows].sort((a, b) =>
            String(b.week_start).localeCompare(String(a.week_start))
          );
          if (typeof state.limit === 'number') rows = rows.slice(0, state.limit);
          resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => makeFakeClient(),
}));

// Imported after the mock so the route uses the fake client.
import { GET } from '@/app/api/v1/digests/route';

let ipCounter = 0;
function digestRequest(limit?: string) {
  ipCounter += 1;
  const url = `http://localhost/api/v1/digests${limit !== undefined ? `?limit=${limit}` : ''}`;
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': `203.0.113.${ipCounter}` },
  });
}

describe('getPastDigests (Section 15, B12)', () => {
  beforeEach(() => {
    seedRows();
  });

  it('returns only the caller\'s digests, newest week first, mapped to camelCase', async () => {
    const digests = await getPastDigests(makeFakeClient(), 'user-1');
    expect(digests).toHaveLength(2);
    expect(digests[0].id).toBe('d-newest');
    expect(digests[0].weekStart).toBe('2026-11-09');
    expect(digests[0].weekEnd).toBe('2026-11-15');
    expect(digests[0].topDeals).toEqual([{ title: 'Deal A' }]);
    expect(digests[1].id).toBe('d-older');
    expect(digests[1].sentAt).toBe('2026-11-08T00:00:00.000Z');
    expect(digests[1].userId).toBe('user-1');
  });

  it('returns [] for a user with no digests', async () => {
    const digests = await getPastDigests(makeFakeClient(), 'user-nobody');
    expect(digests).toEqual([]);
  });

  it('clamps the limit to 1–100', async () => {
    expect((await getPastDigests(makeFakeClient(), 'user-1', 1))).toHaveLength(1);
    expect((await getPastDigests(makeFakeClient(), 'user-1', 500))).toHaveLength(2);
  });
});

describe('GET /api/v1/digests (Section 15, B12)', () => {
  beforeEach(() => {
    seedRows();
    fakeDb.authedUserId = 'user-1';
  });

  it('returns the signed-in user\'s past digests with a total', async () => {
    const res = await GET(digestRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('d-newest');
    expect(body.meta.total).toBe(2);
    expect(body.meta.limit).toBe(20);
  });

  it('never returns another user\'s digests', async () => {
    const res = await GET(digestRequest());
    const body = await res.json();
    expect(body.data.map((d: DigestRow) => d.id)).not.toContain('d-other-user');
  });

  it('honours ?limit= (and clamps a bad value to the default)', async () => {
    const limited = await GET(digestRequest('1'));
    const limitedBody = await limited.json();
    expect(limitedBody.data).toHaveLength(1);
    expect(limitedBody.meta.limit).toBe(1);

    const bad = await GET(digestRequest('abc'));
    const badBody = await bad.json();
    expect(badBody.data).toHaveLength(2);
    expect(badBody.meta.limit).toBe(20);
  });

  it('rejects anonymous callers with 401', async () => {
    fakeDb.authedUserId = null;
    const res = await GET(digestRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
