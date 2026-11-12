/**
 * Section 18, item 75 (audit §1 #81) — route-level tests for
 * DELETE /api/v1/account.
 *
 * Before this file nothing mentioned the route or
 * lib/account-deletion.ts in any test (grep: 0 hits). The
 * service-role client and `auth.admin.deleteUser` are mocked at
 * the boundary; NO real account is ever deleted.
 *
 * Behaviour pinned here (as coded — nothing was changed to make
 * these pass):
 * - unauthenticated → 401
 * - missing / wrong confirmation → 422 VALIDATION_ERROR (see
 *   note below — the brief for this item said "400", but the
 *   route returns `validationError()`, which is 422 by design
 *   in lib/api/responses.ts; the tests assert the real 422 and
 *   the coordinator was told, rather than changing the route
 *   to match the brief)
 * - `{ confirmation: "DELETE" }` → 200, `deleted: true`,
 *   `auth.admin.deleteUser` called with the user's id
 * - a second DELETE within the hour for the same user → 429
 *   (the 1/hour destructive-action limit)
 * - no service-role key → 503, nothing deleted
 * - auth delete failing after the rows went → 500 with the
 *   honest "rows deleted, sign-in account not deleted" message
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const fakeAuth = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

const fakeService = vi.hoisted(() => ({
  available: true,
  failDeleteUser: false,
  deletedTables: [] as string[],
  deleteUserCalls: [] as string[],
}));

function makeServiceClient() {
  const auth = {
    admin: {
      deleteUser: async (userId: string) => {
        fakeService.deleteUserCalls.push(userId);
        if (fakeService.failDeleteUser) {
          return { error: { message: 'fake-test-only auth delete failure' } };
        }
        return { error: null };
      },
    },
  };
  const from = (table: string) => {
    let mode: 'select' | 'delete' | null = null;
    const builder: Record<string, unknown> = {
      select: () => {
        mode = 'select';
        return builder;
      },
      delete: () => {
        mode = 'delete';
        return builder;
      },
      eq: () => builder,
      in: () => builder,
      then: (resolve: (v: unknown) => void) => {
        if (mode === 'delete') {
          fakeService.deletedTables.push(table);
          resolve({ error: null });
        } else {
          // wishlist select path: the user has no wishlists.
          resolve({ data: [], error: null });
        }
      },
    };
    return builder;
  };
  return { from, auth };
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: fakeAuth.user }, error: null }),
    },
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () =>
    fakeService.available ? makeServiceClient() : null,
}));

// Imported after the mocks so the route uses the fakes.
import { DELETE } from '@/app/api/v1/account/route';

let userCounter = 0;
function deleteRequest(body: unknown) {
  userCounter += 1;
  // Fresh user per call: the 1/hour bucket is keyed by user id,
  // so reusing one user across tests would 429 the later ones.
  const userId = `test-user-${userCounter}`;
  fakeAuth.user = { id: userId };
  return {
    req: new NextRequest('http://localhost/api/v1/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    userId,
  };
}

function deleteRequestAs(userId: string, body: unknown) {
  fakeAuth.user = { id: userId };
  return new NextRequest('http://localhost/api/v1/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('DELETE /api/v1/account — route level', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeService.available = true;
    fakeService.failDeleteUser = false;
    fakeService.deletedTables = [];
    fakeService.deleteUserCalls = [];
    fakeAuth.user = null;
  });

  it('rejects unauthenticated callers with 401 and deletes nothing', async () => {
    fakeAuth.user = null;
    const res = await DELETE(
      new NextRequest('http://localhost/api/v1/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      })
    );
    expect(res.status).toBe(401);
    expect(fakeService.deleteUserCalls).toHaveLength(0);
    expect(fakeService.deletedTables).toHaveLength(0);
  });

  it('rejects a missing confirmation with 422 (validationError, not 400) and deletes nothing', async () => {
    const { req } = deleteRequest({});
    const res = await DELETE(req);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('type DELETE to confirm');
    expect(fakeService.deleteUserCalls).toHaveLength(0);
    expect(fakeService.deletedTables).toHaveLength(0);
  });

  it('rejects a wrong confirmation ("delete", lowercase) with 422 and deletes nothing', async () => {
    const { req } = deleteRequest({ confirmation: 'delete' });
    const res = await DELETE(req);
    expect(res.status).toBe(422);
    expect(fakeService.deleteUserCalls).toHaveLength(0);
  });

  it('deletes the account on the exact confirmation: 200, deleted:true, auth user deleted last', async () => {
    const { req, userId } = deleteRequest({ confirmation: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { deleted: boolean; deletedTables: string[]; skippedTables: string[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);
    expect(body.data.skippedTables).toEqual([]);
    expect(body.data.deletedTables).toContain('profiles');
    expect(body.data.deletedTables).toContain('alerts');
    expect(fakeService.deleteUserCalls).toEqual([userId]);
  });

  it('enforces the 1/hour limit: a second DELETE for the same user → 429', async () => {
    const userId = 'test-user-rate-limit';
    const first = await DELETE(deleteRequestAs(userId, { confirmation: 'DELETE' }));
    expect(first.status).toBe(200);
    const second = await DELETE(deleteRequestAs(userId, { confirmation: 'DELETE' }));
    expect(second.status).toBe(429);
    const body = (await second.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.error.code).toBe('RATE_LIMITED');
    // The auth user was deleted exactly once, not twice.
    expect(fakeService.deleteUserCalls).toEqual([userId]);
  });

  it('answers 503 and deletes nothing when the service-role client is unavailable', async () => {
    fakeService.available = false;
    const { req } = deleteRequest({ confirmation: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.message).toContain('Nothing was deleted');
    expect(fakeService.deleteUserCalls).toHaveLength(0);
    expect(fakeService.deletedTables).toHaveLength(0);
  });

  it('reports honestly when the rows went but the auth delete failed → 500, no fake success', async () => {
    fakeService.failDeleteUser = true;
    const { req, userId } = deleteRequest({ confirmation: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toContain('deleting the sign-in account itself failed');
    expect(fakeService.deleteUserCalls).toEqual([userId]);
    expect(fakeService.deletedTables.length).toBeGreaterThan(0);
  });
});
