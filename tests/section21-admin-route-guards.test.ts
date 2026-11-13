/**
 * Sections 21–25, Stage K (K1) — route-guard tests for the Section 20
 * admin routes. 0 test files referenced `admin/products` or
 * `admin/data-quality` before this file.
 *
 * Contract under test (real handlers / real layout, mocked Supabase
 * boundary only — same pattern as tests/require-admin-deny.test.ts):
 *
 *   Pages (/admin/products, /admin/ingestion-failures) sit under
 *   app/admin/layout.tsx, so the guard is tested on the REAL layout:
 *     anonymous user            → throws NEXT_REDIRECT to
 *       /sign-in?reason=session-expired (no content renders)
 *     signed-in non-admin user  → NEXT_REDIRECT to /dashboard
 *     signed-in, service client missing → NEXT_REDIRECT to
 *       /dashboard (fail closed)
 *     signed-in admin user      → children render, no redirect
 *
 *   API routes (GET /api/v1/admin/data-quality,
 *   GET /api/v1/admin/products) use `requireAdmin`, which answers
 *   JSON — not a redirect — by design:
 *     anonymous user            → 401 UNAUTHORIZED, no data
 *     signed-in non-admin user  → 403 FORBIDDEN, no data
 *     signed-in admin user      → 200 with the real payload
 *     service client missing    → 500 (admin check unavailable)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getDataQuality } from '@/app/api/v1/admin/data-quality/route';
import { GET as getAdminProducts } from '@/app/api/v1/admin/products/route';
import { GET as getAdminUsers } from '@/app/api/v1/admin/users/route';
import AdminLayout from '@/app/admin/layout';

function readRepo(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

type ProfileRow = { roles?: { name?: string | null; permissions?: string[] } | null } | null;

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as ProfileRow,
  serviceAvailable: true,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    // GET /api/v1/admin/users passes this client to getAllUsers
    // (services/admin.ts), which reads `profiles` through it — so
    // the mock must be a faithful client with .from, not just
    // auth.getUser (a real Supabase client always has .from).
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
      single: async () => ({ data: state.profile, error: null }),
    };
    for (const method of CHAIN_METHODS) {
      chain[method] = (..._args: unknown[]) => chain;
    }
    return {
      auth: {
        getUser: async () => ({ data: { user: state.user }, error: null }),
      },
      from: (_table: string) => chain,
    };
  },
}));

const CHAIN_METHODS = [
  'select',
  'eq',
  'neq',
  'is',
  'or',
  'order',
  'range',
  'limit',
  'in',
  'lt',
  'lte',
  'gte',
  'maybeSingle',
  'update',
  'insert',
  'delete',
] as const;

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => {
    if (!state.serviceAvailable) return null;
    const chain: Record<string, unknown> = {
      // Awaiting the chain resolves to an empty read (no rows, no
      // error) for every table the admin routes read.
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
      // Only the profiles role lookup uses .single().
      single: async () => ({ data: state.profile, error: null }),
    };
    for (const method of CHAIN_METHODS) {
      chain[method] = (..._args: unknown[]) => chain;
    }
    return {
      from: (_table: string) => chain,
    };
  },
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

function adminRequest(path: string, ip: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

beforeEach(() => {
  state.user = null;
  state.profile = null;
  state.serviceAvailable = true;
});

describe('GET /api/v1/admin/data-quality — route guard (K1)', () => {
  it('anonymous user → 401 UNAUTHORIZED, no data', async () => {
    const res = await getDataQuality(adminRequest('/api/v1/admin/data-quality', '203.0.113.11'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success: boolean;
      data?: unknown;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNAUTHORIZED');
    expect(body.data).toBeUndefined();
  });

  it('signed-in non-admin user → 403 FORBIDDEN, no data', async () => {
    state.user = { id: 'user-1' };
    state.profile = { roles: { name: 'user' } };
    const res = await getDataQuality(adminRequest('/api/v1/admin/data-quality', '203.0.113.12'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      success: boolean;
      data?: unknown;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(body.data).toBeUndefined();
  });

  it('signed-in admin user → 200 with the data-quality summary', async () => {
    state.user = { id: 'admin-1' };
    state.profile = { roles: { name: 'admin', permissions: ['*'] } };
    const res = await getDataQuality(adminRequest('/api/v1/admin/data-quality', '203.0.113.13'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data?: { verification?: { verified: number; unverified: number } };
    };
    expect(body.success).toBe(true);
    expect(body.data?.verification).toEqual({ verified: 0, unverified: 0, stale: 0, unknown: 0 });
  });

  it('service client missing → 500, never a pass-through', async () => {
    state.user = { id: 'admin-1' };
    state.profile = { roles: { name: 'admin', permissions: ['*'] } };
    state.serviceAvailable = false;
    const res = await getDataQuality(adminRequest('/api/v1/admin/data-quality', '203.0.113.14'));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/v1/admin/products — route guard (K1)', () => {
  it('anonymous user → 401 UNAUTHORIZED, no data', async () => {
    const res = await getAdminProducts(adminRequest('/api/v1/admin/products', '203.0.113.15'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success: boolean;
      data?: unknown;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNAUTHORIZED');
    expect(body.data).toBeUndefined();
  });

  it('signed-in non-admin user → 403 FORBIDDEN, no data', async () => {
    state.user = { id: 'user-1' };
    state.profile = { roles: { name: 'user' } };
    const res = await getAdminProducts(adminRequest('/api/v1/admin/products', '203.0.113.16'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      success: boolean;
      data?: unknown;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(body.data).toBeUndefined();
  });

  it('signed-in admin user → 200 with the product list', async () => {
    state.user = { id: 'admin-1' };
    state.profile = { roles: { name: 'admin', permissions: ['*'] } };
    const res = await getAdminProducts(adminRequest('/api/v1/admin/products', '203.0.113.17'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data?: { products?: unknown[]; total?: number };
    };
    expect(body.success).toBe(true);
    expect(body.data?.products).toEqual([]);
    expect(body.data?.total).toBe(0);
  });
});

describe('GET /api/v1/admin/users — route guard (Sections 21–25, Stage G, G-P1-1)', () => {
  it('anonymous user → 401 UNAUTHORIZED, no user data', async () => {
    const res = await getAdminUsers(adminRequest('/api/v1/admin/users', '203.0.113.21'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success: boolean;
      data?: unknown;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNAUTHORIZED');
    expect(body.data).toBeUndefined();
  });

  it('signed-in non-admin user → 403 FORBIDDEN, no user data', async () => {
    state.user = { id: 'user-1' };
    state.profile = { roles: { name: 'user' } };
    const res = await getAdminUsers(adminRequest('/api/v1/admin/users', '203.0.113.22'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      success: boolean;
      data?: unknown;
      error?: { code?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(body.data).toBeUndefined();
  });

  it('signed-in admin user → 200 with the user list and no secret fields', async () => {
    state.user = { id: 'admin-1' };
    state.profile = { roles: { name: 'admin', permissions: ['*'] } };
    const res = await getAdminUsers(adminRequest('/api/v1/admin/users', '203.0.113.23'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data?: Array<Record<string, unknown>>;
      meta?: { total?: number; page?: number; pageSize?: number };
    };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta?.total).toBe(0);
    // No credential material may ever ride along with a user list.
    const serialized = JSON.stringify(body).toLowerCase();
    for (const forbidden of ['password', 'hash', 'token', 'secret', 'service_role']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('app/admin/users/page.tsx — read-only admin users page (G-P1-1)', () => {
  it('exists under the server-guarded /admin layout', () => {
    expect(existsSync(join(process.cwd(), 'app/admin/users/page.tsx'))).toBe(true);
  });

  it('is server-guarded (layout + its own role re-check) and reads via getAllUsers with the admin id', () => {
    const page = readRepo('app/admin/users/page.tsx');
    // Own server-side re-check — never frontend-only hiding.
    expect(page).toContain('fetchProfileRoleName');
    expect(page).toContain("redirect('/sign-in?reason=session-expired')");
    expect(page).toContain("redirect('/dashboard')");
    // Same existing data source as the API route, defense-in-depth
    // admin id passed so the service re-checks the role.
    expect(page).toContain('getAllUsers');
    expect(page).toContain('adminUserId: user.id');
  });

  it('renders only safe fields and states the read-only / owner-gated scope', () => {
    const page = readRepo('app/admin/users/page.tsx');
    expect(page).toContain('full_name');
    expect(page).toContain('email');
    expect(page).toContain('role');
    expect(page).toContain('created_at');
    // Read-only by design; role changes are owner-gated (047).
    expect(page).toMatch(/read-only/i);
    expect(page).toContain('047');
    // No credential material anywhere on the page.
    for (const forbidden of ['password', 'hash', 'token', 'service_role', 'SUPABASE_SERVICE_ROLE_KEY']) {
      expect(page).not.toContain(forbidden);
    }
  });

  it('shows an honest empty state and never invents rows', () => {
    const page = readRepo('app/admin/users/page.tsx');
    expect(page).toContain('No users found.');
    expect(page).toContain('no rows are invented');
  });
});

describe('app/admin/layout.tsx — page guard for /admin/products + /admin/ingestion-failures (K1)', () => {
  it('anonymous user → NEXT_REDIRECT to /sign-in, no content', async () => {
    state.user = null;
    await expect(AdminLayout({ children: 'probe' })).rejects.toThrow(
      'NEXT_REDIRECT:/sign-in?reason=session-expired'
    );
  });

  it('signed-in non-admin user → NEXT_REDIRECT to /dashboard', async () => {
    state.user = { id: 'user-1' };
    state.profile = { roles: { name: 'user' } };
    await expect(AdminLayout({ children: 'probe' })).rejects.toThrow(
      'NEXT_REDIRECT:/dashboard'
    );
  });

  it('signed-in user with no profile → NEXT_REDIRECT to /dashboard (fail closed)', async () => {
    state.user = { id: 'user-1' };
    state.profile = null;
    await expect(AdminLayout({ children: 'probe' })).rejects.toThrow(
      'NEXT_REDIRECT:/dashboard'
    );
  });

  it('service client missing → NEXT_REDIRECT to /dashboard (fail closed)', async () => {
    state.user = { id: 'admin-1' };
    state.profile = { roles: { name: 'admin', permissions: ['*'] } };
    state.serviceAvailable = false;
    await expect(AdminLayout({ children: 'probe' })).rejects.toThrow(
      'NEXT_REDIRECT:/dashboard'
    );
  });

  it('signed-in admin user → children render, no redirect', async () => {
    state.user = { id: 'admin-1' };
    state.profile = { roles: { name: 'admin', permissions: ['*'] } };
    const element = (await AdminLayout({ children: 'probe' })) as unknown as {
      props: { children: unknown };
    };
    expect(element.props.children).toBe('probe');
  });
});
