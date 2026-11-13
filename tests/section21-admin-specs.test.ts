/**
 * Sections 21–25, Stage C (B1) + Stage K (K12) — admin spec
 * correction route tests.
 *
 * The spec-write path (`writeProductSpecs`,
 * services/product-attributes.ts) had a real API + a real admin UI
 * but ZERO tests: a regression in the PATCH handler, the template
 * validation, or the audit write would have shipped silently.
 * These tests pin, against a mocked Supabase boundary (no DB, no
 * network), the real handlers:
 * - GET /api/v1/admin/products/[id]/specs: 401 anon / 403
 *   non-admin / 404 unknown product / 200 with specs +
 *   template keys for an admin;
 * - PATCH: 401 anon / 422 on an unknown spec key or an empty
 *   correction / 200 applying a valid laptop correction, with the
 *   `product_specs_update` audit row recorded;
 * - `validateSpecCorrection` (pure): the template gate itself.
 *
 * The fake service client is table-aware: `products` returns the
 * fixture row via `.maybeSingle()`, every other read resolves to
 * no rows, and inserts/deletes resolve to no error — so the write
 * path runs end to end through the real service functions.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/v1/admin/products/[id]/specs/route';
import { validateSpecCorrection } from '@/services/admin-products';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { roles?: { name?: string | null; permissions?: string[] } | null } | null,
  serviceAvailable: true,
  product: null as Record<string, unknown> | null,
  auditInserts: [] as Array<Record<string, unknown>>,
}));

const LAPTOP_PRODUCT = {
  id: 'prod-1',
  name: 'Test Laptop',
  slug: 'test-laptop',
  description: 'A test laptop',
  brand: 'TestBrand',
  category: 'laptop',
  image_url: null,
  gtin: null,
  confidence_score: 50,
  data_freshness: 'stale',
  created_at: '2026-11-02T00:00:00.000Z',
  updated_at: '2026-11-02T00:00:00.000Z',
  status: 'published',
  price_verification_status: 'unverified',
  price_verified_at: null,
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getUser: async () =>
        state.user ? { data: { user: state.user }, error: null } : { data: { user: null }, error: null },
    },
  }),
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
  'gt',
  'gte',
  'update',
  'delete',
] as const;

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => {
    if (!state.serviceAvailable) return null;
    return {
      from: (table: string) => {
        const chain: Record<string, unknown> = {
          then: (resolve: (value: unknown) => void) =>
            resolve({ data: [], error: null, count: 0 }),
          // Only the profiles role lookup uses .single().
          single: async () => ({ data: state.profile, error: null }),
          // Only the products lookup uses .maybeSingle().
          maybeSingle: async () => ({
            data: table === 'products' ? state.product : null,
            error: null,
          }),
          insert: (...args: unknown[]) => {
            if (table === 'admin_audit_logs') {
              state.auditInserts.push(args[0] as Record<string, unknown>);
            }
            return chain;
          },
        };
        for (const method of CHAIN_METHODS) {
          chain[method] = (..._args: unknown[]) => chain;
        }
        return chain;
      },
    };
  },
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

function specsRequest(path: string, ip: string, method: 'GET' | 'PATCH', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      'x-forwarded-for': ip,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const PARAMS = { params: { id: 'prod-1' } };

beforeEach(() => {
  state.user = null;
  state.profile = null;
  state.serviceAvailable = true;
  state.product = null;
  state.auditInserts = [];
});

function asAdmin() {
  state.user = { id: 'admin-1' };
  state.profile = { roles: { name: 'admin', permissions: ['*'] } };
}

describe('GET /api/v1/admin/products/[id]/specs — route guard + read (K12)', () => {
  it('anonymous user → 401 UNAUTHORIZED, no data', async () => {
    const res = await GET(specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.21', 'GET'), PARAMS);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; data?: unknown; error?: { code?: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNAUTHORIZED');
    expect(body.data).toBeUndefined();
  });

  it('signed-in non-admin user → 403 FORBIDDEN, no data', async () => {
    state.user = { id: 'user-1' };
    state.profile = { roles: { name: 'user' } };
    const res = await GET(specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.22', 'GET'), PARAMS);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; data?: unknown; error?: { code?: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(body.data).toBeUndefined();
  });

  it('admin + unknown product → 404, no data', async () => {
    asAdmin();
    const res = await GET(specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.23', 'GET'), PARAMS);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; data?: unknown };
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('admin + known laptop product → 200 with specs + laptop template keys', async () => {
    asAdmin();
    state.product = LAPTOP_PRODUCT;
    const res = await GET(specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.24', 'GET'), PARAMS);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data?: { specs?: unknown[]; templateKeys?: string[]; attributionMissing?: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data?.specs).toEqual([]);
    expect(body.data?.templateKeys).toEqual([
      'processor',
      'ram',
      'storage',
      'display',
      'graphics',
      'battery',
      'os',
    ]);
    expect(body.data?.attributionMissing).toBe(false);
  });

  it('service client missing → 500, never a pass-through', async () => {
    asAdmin();
    state.serviceAvailable = false;
    const res = await GET(specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.25', 'GET'), PARAMS);
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/v1/admin/products/[id]/specs — correction (K12)', () => {
  it('anonymous user → 401 UNAUTHORIZED', async () => {
    const res = await PATCH(
      specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.26', 'PATCH', {
        entries: [{ key: 'ram', value: '16', unit: 'GB' }],
      }),
      PARAMS
    );
    expect(res.status).toBe(401);
  });

  it('admin + unknown product → 404, nothing written', async () => {
    asAdmin();
    const res = await PATCH(
      specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.27', 'PATCH', {
        entries: [{ key: 'ram', value: '16', unit: 'GB' }],
      }),
      PARAMS
    );
    expect(res.status).toBe(404);
    expect(state.auditInserts).toHaveLength(0);
  });

  it('admin + unknown spec key → 422, nothing written, nothing audited', async () => {
    asAdmin();
    state.product = LAPTOP_PRODUCT;
    const res = await PATCH(
      specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.28', 'PATCH', {
        entries: [{ key: 'wingspan', value: '2m' }],
      }),
      PARAMS
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { success: boolean; error?: { code?: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(state.auditInserts).toHaveLength(0);
  });

  it('admin + empty correction → 422', async () => {
    asAdmin();
    state.product = LAPTOP_PRODUCT;
    const res = await PATCH(
      specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.29', 'PATCH', {}),
      PARAMS
    );
    expect(res.status).toBe(422);
  });

  it('admin + valid laptop correction → 200, replaced key + audit row', async () => {
    asAdmin();
    state.product = LAPTOP_PRODUCT;
    const res = await PATCH(
      specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.30', 'PATCH', {
        entries: [{ key: 'ram', value: '16', unit: 'GB' }],
        source: 'manual-intake',
      }),
      PARAMS
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data?: { replacedKeys?: string[]; removedKeys?: string[]; specs?: unknown[] };
    };
    expect(body.success).toBe(true);
    expect(body.data?.replacedKeys).toEqual(['ram']);
    expect(body.data?.removedKeys).toEqual([]);
    expect(body.data?.specs).toEqual([]);
    // The correction is audited as product_specs_update.
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0].action).toBe('product_specs_update');
    expect(state.auditInserts[0].target_type).toBe('product');
    expect(state.auditInserts[0].target_id).toBe('prod-1');
    expect(state.auditInserts[0].admin_id).toBe('admin-1');
  });

  it('admin + delete-only correction → 200, removed key + audit row', async () => {
    asAdmin();
    state.product = LAPTOP_PRODUCT;
    const res = await PATCH(
      specsRequest('/api/v1/admin/products/prod-1/specs', '203.0.113.31', 'PATCH', {
        deleteKeys: ['battery'],
      }),
      PARAMS
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data?: { replacedKeys?: string[]; removedKeys?: string[] };
    };
    expect(body.success).toBe(true);
    expect(body.data?.replacedKeys).toEqual([]);
    expect(body.data?.removedKeys).toEqual(['battery']);
    expect(state.auditInserts).toHaveLength(1);
    expect(state.auditInserts[0].action).toBe('product_specs_update');
  });
});

describe('validateSpecCorrection — pure template gate (K12)', () => {
  it('accepts a valid laptop entry with an allowed unit', () => {
    const result = validateSpecCorrection('laptop', {
      entries: [{ key: 'ram', value: '16', unit: 'GB' }],
      source: 'manual-intake',
    });
    expect(result.error).toBeUndefined();
    expect(result.correction).toEqual({
      entries: [{ key: 'ram', value: '16', unit: 'GB' }],
      deleteKeys: [],
      source: 'manual-intake',
    });
  });

  it('rejects a key with no template for the category', () => {
    const result = validateSpecCorrection('laptop', {
      entries: [{ key: 'wingspan', value: '2m' }],
    });
    expect(result.correction).toBeNull();
    expect(result.error).toMatch(/wingspan/);
  });

  it('rejects a disallowed unit', () => {
    const result = validateSpecCorrection('laptop', {
      entries: [{ key: 'ram', value: '16', unit: 'TB' }],
    });
    expect(result.correction).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('rejects an empty correction', () => {
    const result = validateSpecCorrection('laptop', {});
    expect(result.correction).toBeNull();
    expect(result.error).toMatch(/entries/);
  });

  it('accepts a delete-only correction', () => {
    const result = validateSpecCorrection('laptop', { deleteKeys: ['battery'] });
    expect(result.error).toBeUndefined();
    expect(result.correction).toEqual({ entries: [], deleteKeys: ['battery'], source: null });
  });
});
