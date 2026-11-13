/**
 * Saved Searches tests (Section 15, C2).
 *
 * Covers: pure validation + re-run URL builder, the service layer
 * (own-only scoping, duplicate name, missing-table degradation),
 * the API route (auth, own-only, CRUD, 50-per-user cap, 503 when
 * migration 039 is unapplied), and migration-file assertions
 * (table, CHECKs, RLS, DO NOT APPLY YET header).
 *
 * Route/service tests run against a mocked Supabase client (an
 * in-memory saved_searches table); no DB, no network.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import {
  MAX_SAVED_SEARCHES,
  buildSavedSearchUrl,
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  validateSavedSearchInput,
} from '@/services/saved-searches';

type SavedRow = Record<string, unknown>;

// --- In-memory saved_searches table --------------------------------------
const fakeDb = vi.hoisted(() => ({
  rows: [] as SavedRow[],
  authedUserId: 'user-1' as string | null,
  tableMissing: false,
  idCounter: 0,
}));

function seedRows() {
  fakeDb.rows = [
    {
      id: 's-newest',
      user_id: 'user-1',
      name: 'Laptops under $1000',
      query: 'q=laptop&max=1000',
      created_at: '2026-11-12T09:00:00.000Z',
      updated_at: '2026-11-12T09:00:00.000Z',
    },
    {
      id: 's-older',
      user_id: 'user-1',
      name: 'Headphones',
      query: 'q=headphones',
      created_at: '2026-11-11T09:00:00.000Z',
      updated_at: '2026-11-11T09:00:00.000Z',
    },
    {
      id: 's-other-user',
      user_id: 'user-2',
      name: 'Not yours',
      query: 'q=tv',
      created_at: '2026-11-12T09:00:00.000Z',
      updated_at: '2026-11-12T09:00:00.000Z',
    },
  ];
  fakeDb.idCounter = 0;
}

const missingTableError = {
  code: '42P01',
  message: 'relation "public.saved_searches" does not exist',
};

function makeFakeClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: fakeDb.authedUserId ? { id: fakeDb.authedUserId } : null },
        error: null,
      }),
    },
    from: (_table: string) => {
      const state: {
        op: 'select' | 'insert' | 'delete';
        userId?: string;
        id?: string;
        insertRow?: Record<string, unknown>;
      } = { op: 'select' };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (_col: string, value: string) => {
          if (_col === 'user_id') state.userId = value;
          if (_col === 'id') state.id = value;
          return chain;
        },
        order: () => chain,
        // Final 100%, F-P2-60 — listSavedSearches caps at .limit(100);
        // the fake query builder must model it (was missing, so the
        // capped query threw and the service failed open to []).
        limit: () => chain,
        insert: (row: Record<string, unknown>) => {
          state.op = 'insert';
          state.insertRow = row;
          return chain;
        },
        delete: () => {
          state.op = 'delete';
          return chain;
        },
        single: async () => {
          if (fakeDb.tableMissing) return { data: null, error: missingTableError };
          if (state.op !== 'insert' || !state.insertRow) {
            return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
          }
          const name = String(state.insertRow.name ?? '');
          const userId = String(state.insertRow.user_id ?? '');
          const duplicate = fakeDb.rows.some(
            (r) => r.user_id === userId && String(r.name).toLowerCase() === name.toLowerCase()
          );
          if (duplicate) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            };
          }
          fakeDb.idCounter += 1;
          const row: SavedRow = {
            id: `s-new-${fakeDb.idCounter}`,
            user_id: userId,
            name,
            query: String(state.insertRow.query ?? ''),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          fakeDb.rows.push(row);
          return { data: row, error: null };
        },
        then: (resolve: (value: unknown) => void) => {
          if (fakeDb.tableMissing) {
            resolve({ data: null, error: missingTableError });
            return;
          }
          if (state.op === 'delete') {
            const before = fakeDb.rows.length;
            fakeDb.rows = fakeDb.rows.filter(
              (r) => !(r.user_id === state.userId && r.id === state.id)
            );
            const deleted = fakeDb.rows.length < before;
            // .select('id') after delete returns the deleted rows.
            resolve({
              data: deleted ? [{ id: state.id }] : [],
              error: null,
            });
            return;
          }
          let rows = fakeDb.rows.filter((r) => r.user_id === state.userId);
          rows = [...rows].sort((a, b) =>
            String(b.created_at).localeCompare(String(a.created_at))
          );
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
import { GET, POST, DELETE } from '@/app/api/v1/saved-searches/route';

let ipCounter = 0;
function savedRequest(
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
  queryString = ''
) {
  ipCounter += 1;
  const url = `http://localhost/api/v1/saved-searches${queryString}`;
  return new NextRequest(url, {
    method,
    headers: {
      'x-forwarded-for': `203.0.113.${ipCounter}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// --- Pure validation + URL builder ----------------------------------------

describe('validateSavedSearchInput (Section 15, C2)', () => {
  it('accepts a name + query string and trims both', () => {
    const result = validateSavedSearchInput({ name: '  Laptops  ', query: 'q=laptop&max=1000' });
    expect(result).toEqual({ ok: true, name: 'Laptops', query: 'q=laptop&max=1000' });
  });

  it('rejects a missing/blank name and a missing/blank query', () => {
    expect(validateSavedSearchInput({ name: '', query: 'q=laptop' }).ok).toBe(false);
    expect(validateSavedSearchInput({ name: 'Laptops', query: '' }).ok).toBe(false);
    expect(validateSavedSearchInput(null).ok).toBe(false);
  });

  it('rejects a name over 100 chars and a query over 2000 chars', () => {
    expect(validateSavedSearchInput({ name: 'x'.repeat(101), query: 'q=a' }).ok).toBe(false);
    expect(validateSavedSearchInput({ name: 'Laptops', query: `q=${'a'.repeat(2000)}` }).ok).toBe(
      false
    );
  });

  it('accepts boundary lengths (100-char name, multi-param query)', () => {
    const result = validateSavedSearchInput({
      name: 'x'.repeat(100),
      query: 'q=laptop&sort=price-asc&page=2',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.query).toBe('q=laptop&sort=price-asc&page=2');
  });
});

describe('buildSavedSearchUrl (Section 15, C2)', () => {
  it('links back to /search with the saved query string', () => {
    expect(buildSavedSearchUrl('q=laptop&sort=price-asc')).toBe('/search?q=laptop&sort=price-asc');
  });
});

// --- Service layer ---------------------------------------------------------

describe('listSavedSearches / createSavedSearch / deleteSavedSearch (Section 15, C2)', () => {
  beforeEach(() => {
    seedRows();
    fakeDb.tableMissing = false;
  });

  it('lists only the caller\'s searches, newest first, mapped to camelCase', async () => {
    const saved = await listSavedSearches(makeFakeClient(), 'user-1');
    expect(saved).toHaveLength(2);
    expect(saved[0].id).toBe('s-newest');
    expect(saved[0].name).toBe('Laptops under $1000');
    expect(saved[0].query).toBe('q=laptop&max=1000');
    expect(saved[0].userId).toBe('user-1');
    expect(saved[1].id).toBe('s-older');
  });

  it('returns [] for a user with no saved searches', async () => {
    expect(await listSavedSearches(makeFakeClient(), 'user-nobody')).toEqual([]);
  });

  it('creates a row and returns it mapped', async () => {
    const result = await createSavedSearch(makeFakeClient(), 'user-1', {
      name: 'Phones',
      query: 'q=phone&sort=price-asc',
    });
    expect('savedSearch' in result && result.savedSearch.name).toBe('Phones');
    expect('savedSearch' in result && result.savedSearch.query).toBe('q=phone&sort=price-asc');
    expect(fakeDb.rows).toHaveLength(4);
  });

  it('reports duplicate for a same name (case-insensitive) for the same user', async () => {
    const result = await createSavedSearch(makeFakeClient(), 'user-1', {
      name: 'laptops under $1000',
      query: 'q=laptop',
    });
    expect(result).toEqual({ error: 'duplicate' });
  });

  it('allows the same name for a different user', async () => {
    const result = await createSavedSearch(makeFakeClient(), 'user-2', {
      name: 'Laptops under $1000',
      query: 'q=laptop',
    });
    expect('savedSearch' in result).toBe(true);
  });

  it('deletes only the caller\'s own row', async () => {
    expect(await deleteSavedSearch(makeFakeClient(), 'user-1', 's-newest')).toBe(true);
    expect(fakeDb.rows.some((r) => r.id === 's-newest')).toBe(false);
    // Another user's row: not deleted, reported as not found.
    expect(await deleteSavedSearch(makeFakeClient(), 'user-1', 's-other-user')).toBe(false);
    expect(fakeDb.rows.some((r) => r.id === 's-other-user')).toBe(true);
    expect(await deleteSavedSearch(makeFakeClient(), 'user-1', 's-missing')).toBe(false);
  });

  it('degrades to [] / missing-table when migration 039 is unapplied — never throws', async () => {
    fakeDb.tableMissing = true;
    expect(await listSavedSearches(makeFakeClient(), 'user-1')).toEqual([]);
    expect(
      await createSavedSearch(makeFakeClient(), 'user-1', { name: 'X', query: 'q=x' })
    ).toEqual({ error: 'missing-table' });
    expect(await deleteSavedSearch(makeFakeClient(), 'user-1', 's-newest')).toBe(false);
  });
});

// --- API route ---------------------------------------------------------------

describe('GET/POST/DELETE /api/v1/saved-searches (Section 15, C2)', () => {
  beforeEach(() => {
    seedRows();
    fakeDb.tableMissing = false;
    fakeDb.authedUserId = 'user-1';
  });

  it('GET returns the caller\'s saved searches with a total', async () => {
    const res = await GET(savedRequest('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('s-newest');
    expect(body.meta.total).toBe(2);
  });

  it('GET never returns another user\'s saved searches', async () => {
    const body = await (await GET(savedRequest('GET'))).json();
    expect(body.data.map((s: SavedRow) => s.id)).not.toContain('s-other-user');
  });

  it('GET rejects anonymous callers with 401', async () => {
    fakeDb.authedUserId = null;
    const res = await GET(savedRequest('GET'));
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
  });

  it('POST creates a saved search (201) and it appears in the next list', async () => {
    const res = await POST(savedRequest('POST', { name: 'Cameras', query: 'q=camera' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Cameras');
    const list = await (await GET(savedRequest('GET'))).json();
    expect(list.data).toHaveLength(3);
  });

  it('POST rejects a blank name with 400 and a duplicate name with 409', async () => {
    const blank = await POST(savedRequest('POST', { name: ' ', query: 'q=x' }));
    expect(blank.status).toBe(400);
    const dup = await POST(
      savedRequest('POST', { name: 'Headphones', query: 'q=headphones' })
    );
    expect(dup.status).toBe(409);
  });

  it('POST enforces the 50-per-user cap with 409', async () => {
    const ownCount = fakeDb.rows.filter((r) => r.user_id === 'user-1').length;
    const toAdd = MAX_SAVED_SEARCHES - ownCount;
    for (let i = 0; i < toAdd; i++) {
      fakeDb.rows.push({
        id: `s-fill-${i}`,
        user_id: 'user-1',
        name: `Fill ${i}`,
        query: 'q=x',
        created_at: '2026-11-01T00:00:00.000Z',
        updated_at: '2026-11-01T00:00:00.000Z',
      });
    }
    const res = await POST(savedRequest('POST', { name: 'One too many', query: 'q=x' }));
    expect(res.status).toBe(409);
  });

  it('POST answers 503 when migration 039 is unapplied', async () => {
    fakeDb.tableMissing = true;
    const res = await POST(savedRequest('POST', { name: 'Laptops', query: 'q=laptop' }));
    expect(res.status).toBe(503);
  });

  it('DELETE removes the caller\'s row (200) and 404s for another user\'s row', async () => {
    const own = await DELETE(savedRequest('DELETE', undefined, '?id=s-newest'));
    expect(own.status).toBe(200);
    expect((await own.json()).data.deleted).toBe(true);
    const other = await DELETE(savedRequest('DELETE', undefined, '?id=s-other-user'));
    expect(other.status).toBe(404);
    const missing = await DELETE(savedRequest('DELETE', undefined, '?id=s-nope'));
    expect(missing.status).toBe(404);
    const noId = await DELETE(savedRequest('DELETE'));
    expect(noId.status).toBe(400);
  });

  it('DELETE rejects anonymous callers with 401', async () => {
    fakeDb.authedUserId = null;
    const res = await DELETE(savedRequest('DELETE', undefined, '?id=s-newest'));
    expect(res.status).toBe(401);
  });
});

// --- Migration 039 file assertions -------------------------------------------

describe('migration 039 saved_searches (Section 15, C2)', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261112092000_039_saved_searches.sql'),
    'utf8'
  );

  it('is marked DO NOT APPLY YET (written, not applied)', () => {
    expect(sql).toContain('DO NOT APPLY YET');
  });

  it('creates the saved_searches table with user_id, name, query and NULL defaults', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.saved_searches');
    expect(sql).toContain('user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(sql).toContain('name text NOT NULL');
    expect(sql).toContain('query text NOT NULL');
    expect(sql).toContain('created_at timestamptz NOT NULL DEFAULT now()');
  });

  it('enforces name/query length CHECKs and one name per user', () => {
    expect(sql).toContain('saved_searches_name_length');
    expect(sql).toContain('saved_searches_query_length');
    expect(sql).toContain('idx_saved_searches_user_name_unique');
    expect(sql).toContain('lower(name)');
  });

  it('enables RLS with own-only SELECT/INSERT/UPDATE/DELETE policies (no anon policy)', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('saved_searches_select_own');
    expect(sql).toContain('saved_searches_insert_own');
    expect(sql).toContain('saved_searches_update_own');
    expect(sql).toContain('saved_searches_delete_own');
    expect(sql).toContain('auth.uid() = user_id');
    expect(sql).not.toMatch(/FOR (SELECT|INSERT|UPDATE|DELETE) TO anon/);
  });
});
