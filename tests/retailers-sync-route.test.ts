import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/retailers/sync/route';

// Retailers Delta — POST /api/retailers/sync route tests.
// The admin middleware, the Supabase service client and the
// provider registry are mocked at the boundary; the route's own
// validation + normalization wiring runs for real. No live keys,
// no network, no writes anywhere.

type FakeProvider = {
  key: string;
  available: boolean;
  reason: string | null;
  getNotConfiguredReason: () => string | null;
  search: (request: { query: string; limit?: number }) => Promise<Array<Record<string, unknown>>>;
};

const state = vi.hoisted(() => ({
  isAdmin: true,
  products: [
    { id: 'p1', name: 'MacBook Air 13', slug: 'macbook-air-13' },
    { id: 'p2', name: 'Galaxy S24 Ultra', slug: 'galaxy-s24-ultra' },
  ] as Array<{ id: string; name: string; slug: string }>,
  productsError: null as { message: string } | null,
  serviceAvailable: true,
  providers: {} as Record<string, FakeProvider | undefined>,
}));

function fakeProvider(partial: Partial<FakeProvider> & { key: string }): FakeProvider {
  const provider: FakeProvider = {
    available: true,
    reason: null,
    getNotConfiguredReason: () => null,
    search: async () => [],
    ...partial,
  };
  // The reason method reads the final reason (like the real providers).
  return { ...provider, getNotConfiguredReason: () => provider.reason };
}

vi.mock('@/lib/api/middleware', () => ({
  logApiRequest: () => {},
  requireAdmin: async () => {
    if (!state.isAdmin) {
      return {
        error: new Response(
          JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } }),
          { status: 403 },
        ),
      };
    }
    return { userId: 'admin-1' };
  },
  rateLimitResponse: async () => null,
  getClientIp: () => '1.2.3.4',
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => {
    if (!state.serviceAvailable) return null;
    return {
      from: (_table: string) => ({
        select: (_cols: string) => ({
          order: (_col: string, _opts?: unknown) => ({
            limit: async (_n: number) => ({ data: state.products, error: state.productsError }),
          }),
        }),
      }),
    };
  },
}));

vi.mock('@/services/providers/registry', () => ({
  getProviderRegistry: () => ({
    getForRetailer: (slug: string) => {
      const p = state.providers[slug];
      return p && p.available ? p : undefined;
    },
    get: (key: string) => state.providers[key],
  }),
}));

const WALMART_HIT = {
  externalId: 'wm-123',
  retailerSlug: 'walmart',
  name: 'MacBook Air 13-inch Laptop M4',
  price: 999,
  currency: 'USD',
  availability: 'in_stock',
};

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/retailers/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/retailers/sync', () => {
  beforeEach(() => {
    state.isAdmin = true;
    state.serviceAvailable = true;
    state.productsError = null;
    state.products = [
      { id: 'p1', name: 'MacBook Air 13', slug: 'macbook-air-13' },
      { id: 'p2', name: 'Galaxy S24 Ultra', slug: 'galaxy-s24-ultra' },
    ];
    state.providers = {};
  });

  it('non-admin is rejected with 403', async () => {
    state.isAdmin = false;
    const response = await POST(postRequest({ retailer: 'walmart' }));
    expect(response.status).toBe(403);
  });

  it('an unavailable provider returns 200 with not-configured + its reason (never a 500)', async () => {
    state.providers.walmart = fakeProvider({
      key: 'walmart',
      available: false,
      reason: 'Walmart has no live price integration: no affiliate credentials are configured.',
    });
    const response = await POST(postRequest({ retailer: 'walmart', limit: 2 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.retailers).toHaveLength(1);
    expect(body.data.retailers[0]).toMatchObject({
      retailer: 'walmart',
      status: 'not-configured',
    });
    expect(body.data.retailers[0].reason).toMatch(/no live price integration/);
    expect(body.data.retailers[0].productsChecked).toBe(0);
  });

  it('happy path: matched + not-found outcomes with normalized fields, nothing written', async () => {
    state.providers.walmart = fakeProvider({
      key: 'walmart',
      search: async ({ query }) =>
        query.includes('MacBook') ? [WALMART_HIT] : [],
    });
    const response = await POST(postRequest({ retailer: 'walmart', limit: 2 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    const [retailer] = body.data.retailers;
    expect(retailer.status).toBe('ok');
    expect(retailer.productsChecked).toBe(2);
    expect(retailer.matched).toBe(1);
    const [macbook, galaxy] = retailer.results;
    expect(macbook.outcome).toBe('matched');
    expect(macbook.normalized).toMatchObject({
      slug: 'macbook-air-13-inch-laptop-m4',
      name: 'MacBook Air 13-inch Laptop M4',
      price: 999,
      currency: 'USD',
      availability: 'in_stock',
      externalId: 'wm-123',
      retailerSlug: 'walmart',
    });
    expect(galaxy.outcome).toBe('not-found');
    expect(galaxy.normalized).toBeNull();
  });

  it('an invalid provider hit is reported as invalid, not matched', async () => {
    state.providers.ebay = fakeProvider({
      key: 'ebay',
      // Missing price + bad GTIN: validation must reject it.
      search: async () => [
        {
          externalId: 'v1|9|0',
          retailerSlug: 'ebay',
          name: 'Broken listing',
          price: -5,
          currency: 'USD',
          availability: 'unknown',
          gtin: 'not-a-gtin',
        },
      ],
    });
    const response = await POST(postRequest({ retailer: 'ebay', limit: 1 }));
    const body = await response.json();
    expect(body.data.retailers[0].results[0].outcome).toBe('invalid');
    expect(body.data.retailers[0].matched).toBe(0);
  });

  it('a provider search failure is a per-product error outcome, not a failed route', async () => {
    state.providers.walmart = fakeProvider({
      key: 'walmart',
      search: async () => {
        throw new Error('Walmart request failed (HTTP 500)');
      },
    });
    const response = await POST(postRequest({ retailer: 'walmart', limit: 2 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.retailers[0].status).toBe('ok');
    expect(body.data.retailers[0].results).toHaveLength(2);
    expect(body.data.retailers[0].results[0].outcome).toBe('error');
    expect(body.data.retailers[0].results[0].error).toMatch(/HTTP 500/);
  });

  it('no retailer runs all four; unknown retailer is a 400', async () => {
    state.providers.walmart = fakeProvider({ key: 'walmart' });
    state.providers.ebay = fakeProvider({ key: 'ebay' });
    state.providers.bestbuy = fakeProvider({ key: 'bestbuy' });
    state.providers.amazon = fakeProvider({ key: 'amazon' });
    const all = await POST(postRequest({}));
    const allBody = await all.json();
    expect(allBody.data.retailers.map((r: { retailer: string }) => r.retailer)).toEqual([
      'walmart',
      'ebay',
      'bestbuy',
      'amazon',
    ]);

    const bad = await POST(postRequest({ retailer: 'target' }));
    expect(bad.status).toBe(400);
  });

  it('limit clamps to 50; a non-number limit is a 400', async () => {
    state.providers.walmart = fakeProvider({ key: 'walmart' });
    const clamped = await POST(postRequest({ retailer: 'walmart', limit: 100 }));
    const clampedBody = await clamped.json();
    expect(clampedBody.data.limit).toBe(50);

    const bad = await POST(postRequest({ retailer: 'walmart', limit: 'ten' }));
    expect(bad.status).toBe(400);
  });

  it('a products read failure is a 500 (server error, not a provider state)', async () => {
    state.productsError = { message: 'relation "products" does not exist' };
    const response = await POST(postRequest({ retailer: 'walmart' }));
    expect(response.status).toBe(500);
  });
});
