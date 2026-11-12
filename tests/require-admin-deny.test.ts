/**
 * `requireAdmin` deny-path tests (Section 18, item 67, audit §1 #8).
 *
 * GAP: no test ever invoked `requireAdmin` with a non-admin or
 * unsigned user and expected 403/401 — in tests it appeared only as
 * a mock stub or a static source check, so the deny path was never
 * executed.
 *
 * These tests execute the REAL `requireAdmin` from
 * `lib/api/middleware.ts` (no mocking of the middleware itself).
 * Only the boundary is mocked: the Supabase server client (session
 * lookup) and the service-role client (profile/role lookup) are
 * fakes driven by per-test state. The middleware is NOT weakened.
 *
 * Fail-closed contract under test:
 *   unsigned user            → 401
 *   signed-in non-admin user → 403
 *   signed-in, no profile    → 403
 *   signed-in admin user     → passes ({ userId })
 *   service client missing   → 500 (admin check unavailable)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api/middleware';

type ProfileRow = { roles?: { name?: string | null } | Array<{ name?: string | null }> | null } | null;

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as ProfileRow,
  serviceAvailable: true,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => {
    if (!state.serviceAvailable) return null;
    return {
      from: (_table: string) => ({
        select: (_cols: string) => ({
          eq: (_col: string, _value: string) => ({
            single: async () => ({ data: state.profile, error: null }),
          }),
        }),
      }),
    };
  },
}));

function adminRequest() {
  return new NextRequest('http://localhost/api/v1/admin/test', { method: 'GET' });
}

describe('requireAdmin — deny path (real middleware, mocked Supabase boundary)', () => {
  beforeEach(() => {
    state.user = null;
    state.profile = null;
    state.serviceAvailable = true;
  });

  it('unsigned user → 401', async () => {
    state.user = null;
    const result = await requireAdmin(adminRequest());
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(401);
      const body = await result.error.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('signed-in non-admin user → 403', async () => {
    state.user = { id: 'user-regular-1' };
    state.profile = { roles: { name: 'user' } };
    const result = await requireAdmin(adminRequest());
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(403);
      const body = await result.error.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toMatch(/admin/i);
    }
  });

  it('signed-in user with no profile row → 403 (fail closed, never admin)', async () => {
    state.user = { id: 'user-no-profile-1' };
    state.profile = null;
    const result = await requireAdmin(adminRequest());
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(403);
    }
  });

  it('signed-in user with an empty role name → 403 (fail closed)', async () => {
    state.user = { id: 'user-empty-role-1' };
    state.profile = { roles: { name: null } };
    const result = await requireAdmin(adminRequest());
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(403);
    }
  });

  it('service client unavailable → 500, never a pass (fail closed)', async () => {
    state.user = { id: 'user-admin-1' };
    state.profile = { roles: { name: 'admin' } };
    state.serviceAvailable = false;
    const result = await requireAdmin(adminRequest());
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(500);
    }
  });

  it('admin user passes (positive control) → { userId }', async () => {
    state.user = { id: 'user-admin-1' };
    state.profile = { roles: { name: 'admin' } };
    const result = await requireAdmin(adminRequest());
    expect(result).toEqual({ userId: 'user-admin-1' });
  });

  it('admin role via the array embed shape also passes', async () => {
    state.user = { id: 'user-admin-1' };
    state.profile = { roles: [{ name: 'admin' }] };
    const result = await requireAdmin(adminRequest());
    expect(result).toEqual({ userId: 'user-admin-1' });
  });
});
