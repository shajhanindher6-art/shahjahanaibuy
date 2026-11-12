/**
 * Section 17, Stage D — public [slug] quota enforcement (§4 #4)
 * + refresh-chain pipeline wiring + price_refresh_runs ledger.
 *
 * Item 1: the detail endpoint validated the API key but never
 * called enforceApiQuota, so a valid key could hammer it without
 * quota counting. These route tests run the handler for real
 * (real enforceApiQuota + real default quota store, in-memory
 * fallback in tests) with only the key lookup, the server
 * client and the product fetch mocked — and prove the count
 * landed by probing the same store bucket afterwards.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  defaultQuotaStore,
  enforceApiQuota,
} from '@/lib/api-quota';
import type { ValidatedApiKey } from '@/lib/api-keys';

const quotaCalls = vi.hoisted(() => ({
  calls: [] as Array<{ keyInfo: ValidatedApiKey | null }>,
}));

vi.mock('@/lib/api-keys', () => ({
  extractApiKey: (headers: Headers) => headers.get('x-api-key')?.trim() || null,
  validateApiKey: async (key: string) =>
    key === 'sbk_live_validkey000000000000000001'
      ? { userId: 'user-1', keyPrefix: 'sbk_live_validkey000000000000000001', scopes: ['products:read'] }
      : null,
}));

vi.mock('@/lib/api-quota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-quota')>();
  return {
    ...actual,
    enforceApiQuota: async (
      request: Parameters<typeof enforceApiQuota>[0],
      options?: Parameters<typeof enforceApiQuota>[1]
    ) => {
      quotaCalls.calls.push({ keyInfo: options?.keyInfo ?? null });
      return actual.enforceApiQuota(request, options);
    },
  };
});

const priceHistoryChain = {
  select: () => priceHistoryChain,
  eq: () => priceHistoryChain,
  order: () => priceHistoryChain,
  limit: () => priceHistoryChain,
  maybeSingle: async () => ({
    data: { price: 999, recorded_at: '2026-11-02T07:13:52Z' },
    error: null,
  }),
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: () => priceHistoryChain,
  }),
}));

vi.mock('@/services/products', () => ({
  getProductBySlug: async (_supabase: unknown, slug: string) =>
    slug === 'macbook-air'
      ? { id: 'p1', slug: 'macbook-air', name: 'MacBook Air', brand: 'Apple' }
      : null,
}));

import { GET as getPublicProduct } from '@/app/api/v1/public/products/[slug]/route';

function slugRequest(slug: string, apiKey?: string, ip = '203.0.113.99'): NextRequest {
  const headers: Record<string, string> = { 'x-real-ip': ip };
  if (apiKey) headers['x-api-key'] = apiKey;
  return new NextRequest(`http://localhost/api/v1/public/products/${slug}`, {
    method: 'GET',
    headers,
  });
}

beforeEach(() => {
  quotaCalls.calls = [];
});

describe('Stage D item 1 — public products [slug] quota enforcement', () => {
  it('counts a valid key against its quota (same pattern as the list route)', async () => {
    const res = await getPublicProduct(
      slugRequest('macbook-air', 'sbk_live_validkey000000000000000001'),
      { params: { slug: 'macbook-air' } }
    );
    expect(res.status).toBe(200);
    // The route called enforceApiQuota exactly once, with the
    // validated key — the call the sibling list route makes.
    expect(quotaCalls.calls).toHaveLength(1);
    expect(quotaCalls.calls[0].keyInfo?.userId).toBe('user-1');
    expect(quotaCalls.calls[0].keyInfo?.keyPrefix).toBe(
      'sbk_live_validkey000000000000000001'
    );
    // The count really landed: probing the same key bucket through
    // the real default store reports used: 2 (route call + probe).
    const probe = await defaultQuotaStore.checkAndIncrement(
      'key:sbk_live_validkey000000000000000001',
      1000,
      'free'
    );
    expect(probe.used).toBe(2);
  });

  it('counts anonymous callers against the per-IP daily bucket', async () => {
    const res = await getPublicProduct(
      slugRequest('macbook-air'),
      { params: { slug: 'macbook-air' } }
    );
    expect(res.status).toBe(200);
    expect(quotaCalls.calls).toHaveLength(1);
    expect(quotaCalls.calls[0].keyInfo).toBeNull();
    const probe = await defaultQuotaStore.checkAndIncrement(
      'anon:203.0.113.99',
      100,
      'free'
    );
    expect(probe.used).toBe(2);
  });

  it('an invalid key is still 401 and never reaches the quota gate', async () => {
    const res = await getPublicProduct(
      slugRequest('macbook-air', 'sbk_live_boguskey000000000000000002'),
      { params: { slug: 'macbook-air' } }
    );
    expect(res.status).toBe(401);
    expect(quotaCalls.calls).toHaveLength(0);
  });

  it('an unknown slug is still 404 after the quota gate', async () => {
    const res = await getPublicProduct(
      slugRequest('no-such-product', 'sbk_live_validkey000000000000000001'),
      { params: { slug: 'no-such-product' } }
    );
    expect(res.status).toBe(404);
    expect(quotaCalls.calls).toHaveLength(1);
  });
});
