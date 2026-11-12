/**
 * Referral signup attribution tests (Section 15, B13).
 *
 * Referral links (migration 026) map a random `sb-…` code to its
 * owner; attribution was absent by design until now. These tests
 * run against an in-memory fake Supabase client — no DB, no
 * network — and cover:
 *
 *   - a ref code is carried through signup (parse + store + the
 *     attribute POST carries the exact code);
 *   - unknown / guest-owned / self codes are ignored silently,
 *     never an error and never a row;
 *   - profiles.referred_by is set ONLY with a valid code, and
 *     only when still NULL (never overwritten);
 *   - the signup-count endpoint returns only the caller's own
 *     data (GET /api/v1/referrals?mine=1);
 *   - missing migration 038 degrades to "not available", never a
 *     fake count and never a broken signup.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  attributeReferralSignup,
  countReferralSignups,
} from '@/services/referral-attribution';
import {
  parseReferralCodeFromSearch,
  storePendingReferralCode,
  peekPendingReferralCode,
  clearPendingReferralCode,
  submitReferralAttribution,
} from '@/lib/referral';

// --- In-memory fake database -------------------------------------------
type Row = Record<string, unknown>;

const fakeDb = vi.hoisted(() => ({
  referralLinks: [] as Row[],
  referralSignups: [] as Row[],
  profiles: [] as Row[],
  authedUserId: 'user-new' as string | null,
  serviceAvailable: true,
  missingTable: null as string | null,
}));

function tableRows(table: string): Row[] {
  if (table === 'referral_links') return fakeDb.referralLinks;
  if (table === 'referral_signups') return fakeDb.referralSignups;
  if (table === 'profiles') return fakeDb.profiles;
  throw new Error(`unknown table ${table}`);
}

function missingError(table: string) {
  return {
    code: '42P01',
    message: `relation "public.${table}" does not exist`,
  };
}

/** Minimal thenable query builder: select/eq/is/maybeSingle/insert/update. */
class FakeQuery {
  private table: string;
  private filters: Array<[string, unknown]> = [];
  private nullFilters: string[] = [];
  private op: 'select' | 'update' = 'select';
  private updateValues: Row = {};
  private countMode = false;

  constructor(table: string) {
    this.table = table;
  }

  select(_cols: string, opts?: { count?: string; head?: boolean }) {
    this.op = 'select';
    this.countMode = opts?.count === 'exact' && opts?.head === true;
    return this;
  }

  eq(col: string, value: unknown) {
    this.filters.push([col, value]);
    return this;
  }

  is(col: string, value: unknown) {
    if (value === null) this.nullFilters.push(col);
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  private matches(row: Row): boolean {
    return (
      this.filters.every(([col, value]) => row[col] === value) &&
      this.nullFilters.every((col) => row[col] === null || row[col] === undefined)
    );
  }

  async maybeSingle() {
    if (fakeDb.missingTable === this.table) {
      return { data: null, error: missingError(this.table) };
    }
    const row = tableRows(this.table).find((r) => this.matches(r));
    return { data: row ?? null, error: null };
  }

  async insert(row: Row) {
    if (fakeDb.missingTable === this.table) {
      return { data: null, error: missingError(this.table) };
    }
    if (this.table === 'referral_signups') {
      const dup = fakeDb.referralSignups.some(
        (r) => r.referred_user_id === row.referred_user_id
      );
      if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } };
    }
    tableRows(this.table).push({ ...row });
    return { data: [row], error: null };
  }

  update(values: Row) {
    this.op = 'update';
    this.updateValues = values;
    return this;
  }

  then(
    resolve: (value: unknown) => void,
    reject?: (reason: unknown) => void
  ) {
    try {
      if (fakeDb.missingTable === this.table) {
        resolve({
          data: null,
          error: missingError(this.table),
          count: null,
        });
        return;
      }
      const rows = tableRows(this.table).filter((r) => this.matches(r));
      if (this.op === 'update') {
        rows.forEach((r) => Object.assign(r, this.updateValues));
        resolve({ data: rows, error: null });
        return;
      }
      if (this.countMode) {
        resolve({ data: [], error: null, count: rows.length });
        return;
      }
      resolve({ data: rows, error: null });
    } catch (e) {
      if (reject) reject(e);
    }
  }
}

function makeFakeClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: fakeDb.authedUserId ? { id: fakeDb.authedUserId } : null },
        error: null,
      }),
    },
    from: (table: string) => new FakeQuery(table),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => makeFakeClient(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () =>
    fakeDb.serviceAvailable ? makeFakeClient() : null,
}));

// Imported after the mocks so the routes use the fake clients.
import { POST as attributePost } from '@/app/api/v1/referrals/attribute/route';
import { GET as referralsGet } from '@/app/api/v1/referrals/route';

function seedDb() {
  fakeDb.referralLinks = [
    { code: 'sb-aaaaaaaaaa', user_id: 'user-1' },
    { code: 'sb-bbbbbbbbbb', user_id: 'user-2' },
    { code: 'sb-guestguest', user_id: null },
  ];
  fakeDb.referralSignups = [
    {
      id: 's1',
      referrer_user_id: 'user-1',
      referred_user_id: 'user-a',
      referral_code: 'sb-aaaaaaaaaa',
      created_at: '2026-11-01T00:00:00.000Z',
    },
    {
      id: 's2',
      referrer_user_id: 'user-1',
      referred_user_id: 'user-b',
      referral_code: 'sb-aaaaaaaaaa',
      created_at: '2026-11-02T00:00:00.000Z',
    },
    {
      id: 's3',
      referrer_user_id: 'user-2',
      referred_user_id: 'user-c',
      referral_code: 'sb-bbbbbbbbbb',
      created_at: '2026-11-03T00:00:00.000Z',
    },
  ];
  fakeDb.profiles = [
    { id: 'user-new', email: 'new@example.com', referred_by: null },
    { id: 'user-1', email: 'ref1@example.com', referred_by: null },
    { id: 'user-2', email: 'ref2@example.com', referred_by: null },
    { id: 'user-a', email: 'a@example.com', referred_by: 'user-1' },
    // referred_by already set, but no referral_signups row:
    // attribution must still refuse to overwrite it.
    { id: 'user-d', email: 'd@example.com', referred_by: 'user-2' },
  ];
  fakeDb.authedUserId = 'user-new';
  fakeDb.serviceAvailable = true;
  fakeDb.missingTable = null;
}

let ipCounter = 0;
function apiRequest(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) {
  ipCounter += 1;
  return new NextRequest(`http://localhost${path}`, {
    ...init,
    headers: {
      'x-forwarded-for': `203.0.113.${ipCounter}`,
      ...(init?.headers ?? {}),
    },
  });
}

// --- Service: attributeReferralSignup -----------------------------------
describe('attributeReferralSignup (Section 15, B13)', () => {
  beforeEach(() => {
    seedDb();
  });

  it('attributes a valid code: sets referred_by and inserts one signup row', async () => {
    const result = await attributeReferralSignup(
      makeFakeClient(),
      'user-new',
      'sb-aaaaaaaaaa'
    );
    expect(result).toEqual({ attributed: true });
    const profile = fakeDb.profiles.find((p) => p.id === 'user-new');
    expect(profile?.referred_by).toBe('user-1');
    const rows = fakeDb.referralSignups.filter(
      (r) => r.referred_user_id === 'user-new'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].referrer_user_id).toBe('user-1');
    expect(rows[0].referral_code).toBe('sb-aaaaaaaaaa');
  });

  it('ignores an invalid code silently — never an error, never a row', async () => {
    for (const bad of ['bogus', 'sb-short', '', null, undefined, 123]) {
      const result = await attributeReferralSignup(makeFakeClient(), 'user-new', bad);
      expect(result).toEqual({ attributed: false, reason: 'invalid-code' });
    }
    expect(fakeDb.referralSignups).toHaveLength(3);
    expect(
      fakeDb.profiles.find((p) => p.id === 'user-new')?.referred_by
    ).toBeNull();
  });

  it('ignores an unknown (well-formed but unissued) code silently', async () => {
    const result = await attributeReferralSignup(
      makeFakeClient(),
      'user-new',
      'sb-zzzzzzzzzz'
    );
    expect(result).toEqual({ attributed: false, reason: 'unknown-code' });
    expect(fakeDb.referralSignups).toHaveLength(3);
  });

  it('ignores a guest-owned link — there is no user to attribute to', async () => {
    const result = await attributeReferralSignup(
      makeFakeClient(),
      'user-new',
      'sb-guestguest'
    );
    expect(result).toEqual({ attributed: false, reason: 'guest-code' });
    expect(fakeDb.referralSignups).toHaveLength(3);
  });

  it('ignores a self-referral', async () => {
    const result = await attributeReferralSignup(
      makeFakeClient(),
      'user-1',
      'sb-aaaaaaaaaa'
    );
    expect(result).toEqual({ attributed: false, reason: 'self-referral' });
    expect(fakeDb.referralSignups).toHaveLength(3);
  });

  it('is idempotent: a second attribution writes nothing', async () => {
    expect(
      await attributeReferralSignup(makeFakeClient(), 'user-new', 'sb-aaaaaaaaaa')
    ).toEqual({ attributed: true });
    expect(
      await attributeReferralSignup(makeFakeClient(), 'user-new', 'sb-aaaaaaaaaa')
    ).toEqual({ attributed: false, reason: 'already-attributed' });
    expect(
      fakeDb.referralSignups.filter((r) => r.referred_user_id === 'user-new')
    ).toHaveLength(1);
  });

  it('never overwrites an already-set referred_by', async () => {
    const result = await attributeReferralSignup(
      makeFakeClient(),
      'user-d',
      'sb-aaaaaaaaaa'
    );
    expect(result).toEqual({ attributed: false, reason: 'already-attributed' });
    expect(
      fakeDb.profiles.find((p) => p.id === 'user-d')?.referred_by
    ).toBe('user-2');
    expect(
      fakeDb.referralSignups.filter((r) => r.referred_user_id === 'user-d')
    ).toHaveLength(0);
  });

  it('degrades to not-available when migration 038 has not run — never throws', async () => {
    fakeDb.missingTable = 'referral_signups';
    const result = await attributeReferralSignup(
      makeFakeClient(),
      'user-new',
      'sb-aaaaaaaaaa'
    );
    expect(result).toEqual({ attributed: false, reason: 'not-available' });
    expect(fakeDb.referralSignups).toHaveLength(3);

    fakeDb.missingTable = 'referral_links';
    const result2 = await attributeReferralSignup(
      makeFakeClient(),
      'user-new',
      'sb-aaaaaaaaaa'
    );
    expect(result2).toEqual({ attributed: false, reason: 'not-available' });
  });
});

// --- Service: countReferralSignups ---------------------------------------
describe('countReferralSignups (Section 15, B13)', () => {
  beforeEach(() => {
    seedDb();
  });

  it('counts only the given referrer’s real rows', async () => {
    expect(await countReferralSignups(makeFakeClient(), 'user-1')).toEqual({
      count: 2,
      available: true,
    });
    expect(await countReferralSignups(makeFakeClient(), 'user-2')).toEqual({
      count: 1,
      available: true,
    });
    expect(await countReferralSignups(makeFakeClient(), 'user-nobody')).toEqual({
      count: 0,
      available: true,
    });
  });

  it('reports unavailable when migration 038 has not run — never a guessed 0', async () => {
    fakeDb.missingTable = 'referral_signups';
    expect(await countReferralSignups(makeFakeClient(), 'user-1')).toEqual({
      count: 0,
      available: false,
    });
  });
});

// --- Route: POST /api/v1/referrals/attribute ------------------------------
describe('POST /api/v1/referrals/attribute (Section 15, B13)', () => {
  beforeEach(() => {
    seedDb();
  });

  it('attributes a valid code for the signed-in user', async () => {
    const res = await attributePost(
      apiRequest('/api/v1/referrals/attribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'sb-aaaaaaaaaa' }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ attributed: true });
    expect(
      fakeDb.profiles.find((p) => p.id === 'user-new')?.referred_by
    ).toBe('user-1');
  });

  it('rejects anonymous callers with 401', async () => {
    fakeDb.authedUserId = null;
    const res = await attributePost(
      apiRequest('/api/v1/referrals/attribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'sb-aaaaaaaaaa' }),
      })
    );
    expect(res.status).toBe(401);
    expect(fakeDb.referralSignups).toHaveLength(3);
  });

  it('answers 200 — never an error — for an invalid or unknown code', async () => {
    for (const code of ['bogus', 'sb-zzzzzzzzzz']) {
      const res = await attributePost(
        apiRequest('/api/v1/referrals/attribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.attributed).toBe(false);
    }
    expect(fakeDb.referralSignups).toHaveLength(3);
  });

  it('is idempotent through the route', async () => {
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'sb-aaaaaaaaaa' }),
    };
    const first = await attributePost(
      apiRequest('/api/v1/referrals/attribute', init)
    );
    expect((await first.json()).data).toEqual({ attributed: true });
    const second = await attributePost(
      apiRequest('/api/v1/referrals/attribute', init)
    );
    const secondBody = await second.json();
    expect(secondBody.data).toEqual({
      attributed: false,
      reason: 'already-attributed',
    });
    expect(
      fakeDb.referralSignups.filter((r) => r.referred_user_id === 'user-new')
    ).toHaveLength(1);
  });
});

// --- Route: GET /api/v1/referrals?mine=1 ----------------------------------
describe('GET /api/v1/referrals?mine=1 (Section 15, B13)', () => {
  beforeEach(() => {
    seedDb();
  });

  it('returns only the caller’s own signup count', async () => {
    fakeDb.authedUserId = 'user-1';
    const res = await referralsGet(apiRequest('/api/v1/referrals?mine=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ signups: 2, available: true });

    fakeDb.authedUserId = 'user-2';
    const res2 = await referralsGet(apiRequest('/api/v1/referrals?mine=1'));
    expect((await res2.json()).data).toEqual({ signups: 1, available: true });
  });

  it('never leaks another user’s signups through the count', async () => {
    fakeDb.authedUserId = 'user-nobody';
    const res = await referralsGet(apiRequest('/api/v1/referrals?mine=1'));
    expect((await res.json()).data).toEqual({ signups: 0, available: true });
  });

  it('rejects anonymous callers with 401', async () => {
    fakeDb.authedUserId = null;
    const res = await referralsGet(apiRequest('/api/v1/referrals?mine=1'));
    expect(res.status).toBe(401);
  });

  it('reports unavailable when migration 038 has not run', async () => {
    fakeDb.missingTable = 'referral_signups';
    const res = await referralsGet(apiRequest('/api/v1/referrals?mine=1'));
    expect((await res.json()).data).toEqual({ signups: 0, available: false });
  });

  it('leaves the existing ?code= stats behaviour untouched', async () => {
    fakeDb.referralLinks.push({
      code: 'sb-cccccccccc',
      user_id: 'user-1',
      click_count: 7,
    });
    const res = await referralsGet(
      apiRequest('/api/v1/referrals?code=sb-cccccccccc')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.code).toBe('sb-cccccccccc');
    expect(body.data.clicks).toBe(7);
  });
});

// --- Client helpers: ref code carried through signup ----------------------
describe('ref code carried through signup (Section 15, B13)', () => {
  const store = new Map<string, string>();
  const fakeLocalStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };

  beforeEach(() => {
    store.clear();
    // The helpers are window/localStorage-guarded; give them a
    // window so the store/peek/clear round-trip is exercised.
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: fakeLocalStorage,
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.unstubAllGlobals();
  });

  it('parses ?ref= and stores it; an invalid code is never stored', () => {
    expect(parseReferralCodeFromSearch('?ref=sb-aaaaaaaaaa')).toBe('sb-aaaaaaaaaa');
    storePendingReferralCode('sb-aaaaaaaaaa');
    expect(peekPendingReferralCode()).toBe('sb-aaaaaaaaaa');

    storePendingReferralCode('bogus');
    expect(peekPendingReferralCode()).toBe('sb-aaaaaaaaaa');

    clearPendingReferralCode();
    expect(peekPendingReferralCode()).toBeNull();
  });

  it('submitReferralAttribution POSTs the exact code and maps the answer', async () => {
    type FetchResponse = {
      status: number;
      ok: boolean;
      json: () => Promise<unknown>;
    };
    const fetchMock = vi.fn(
      async (): Promise<FetchResponse> => ({
        status: 200,
        ok: true,
        json: async () => ({ success: true, data: { attributed: true } }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await submitReferralAttribution('sb-aaaaaaaaaa')).toBe('attributed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api/v1/referrals/attribute');
    expect(JSON.parse(String(init.body))).toEqual({ code: 'sb-aaaaaaaaaa' });
  });

  it('submitReferralAttribution treats unknown codes as ignored, 401 and failures as retry', async () => {
    type FetchResponse = {
      status: number;
      ok: boolean;
      json: () => Promise<unknown>;
    };
    const fetchMock = vi.fn(
      async (): Promise<FetchResponse> => ({
        status: 200,
        ok: true,
        json: async () => ({
          success: true,
          data: { attributed: false, reason: 'unknown-code' },
        }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await submitReferralAttribution('sb-zzzzzzzzzz')).toBe('ignored');

    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
      json: async () => ({ success: false }),
    });
    expect(await submitReferralAttribution('sb-aaaaaaaaaa')).toBe('retry');

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await submitReferralAttribution('sb-aaaaaaaaaa')).toBe('retry');

    // Invalid codes never even reach the network.
    fetchMock.mockClear();
    expect(await submitReferralAttribution('bogus')).toBe('ignored');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
