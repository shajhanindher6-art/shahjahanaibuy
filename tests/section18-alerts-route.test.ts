/**
 * Section 18, item 73 (audit §1 #47) — route-level tests for
 * POST /api/v1/alerts.
 *
 * Before this file the route existed but no test imported or
 * invoked it; creation was tested at lib level only (local
 * alerts, the Free 5-alert cap, guest merge). The DB boundary
 * is mocked at the module level (fake Supabase client +
 * fake services/alerts); no real database or network is touched.
 *
 * Behaviour pinned here (as coded — nothing was changed to make
 * these pass):
 * - unauthenticated → 401
 * - invalid alertType → 400, generic envelope
 * - no productId / unknown slug → 400
 * - Free cap reached → 403 with an upgrade hint, and the insert
 *   never runs
 * - valid create → 201 with the created alert
 * - create failure (service returns null) → 500, generic message
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type FakeUser = { id: string } | null;

const fakeAuth = vi.hoisted(() => ({
  user: null as FakeUser,
}));

const fakeAlerts = vi.hoisted(() => ({
  createAlert: vi.fn(),
  checkAlertCap: vi.fn(),
  getAlerts: vi.fn(),
  countAlerts: vi.fn(),
}));

const fakeProducts = vi.hoisted(() => ({
  bySlug: new Map<string, { id: string }>([['macbook-air', { id: 'prod-macbook' }]]),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: fakeAuth.user }, error: null }),
    },
  }),
}));

vi.mock('@/services/alerts', () => ({
  getAlerts: (...args: unknown[]) => fakeAlerts.getAlerts(...args),
  countAlerts: (...args: unknown[]) => fakeAlerts.countAlerts(...args),
  checkAlertCap: (...args: unknown[]) => fakeAlerts.checkAlertCap(...args),
  createAlert: (...args: unknown[]) => fakeAlerts.createAlert(...args),
}));

vi.mock('@/lib/api-quota', () => ({
  BILLING_URL: '/pricing',
  getTierForUserId: async () => 'free',
  getUpgradeTier: () => 'premium',
}));

vi.mock('@/services/products', () => ({
  getCachedProductBySlug: async (_client: unknown, slug: string) =>
    fakeProducts.bySlug.get(slug) ?? null,
}));

// Imported after the mocks so the route uses the fakes.
import { GET, POST } from '@/app/api/v1/alerts/route';

let ipCounter = 0;
function alertRequest(body: unknown, method = 'POST') {
  ipCounter += 1;
  return new NextRequest('http://localhost/api/v1/alerts', {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': `203.0.113.${ipCounter}`,
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

const createdAlert = {
  id: 'alert-1',
  userId: 'test-user-1',
  productId: 'prod-macbook',
  alertType: 'price_drop',
  conditionValue: 999,
  channel: 'email',
  active: true,
};

describe('POST /api/v1/alerts — route level', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeAuth.user = { id: 'test-user-1' };
    fakeAlerts.createAlert.mockResolvedValue(createdAlert);
    fakeAlerts.checkAlertCap.mockResolvedValue({
      allowed: true,
      current: 2,
      max: 5,
      tier: 'free',
    });
    fakeAlerts.getAlerts.mockResolvedValue([createdAlert]);
    fakeAlerts.countAlerts.mockResolvedValue(2);
  });

  it('rejects unauthenticated callers with 401 and creates nothing', async () => {
    fakeAuth.user = null;
    const res = await POST(
      alertRequest({ productSlug: 'macbook-air', alertType: 'price_drop' })
    );
    expect(res.status).toBe(401);
    expect(fakeAlerts.createAlert).not.toHaveBeenCalled();
  });

  it('creates an alert by slug → 201 with the created alert', async () => {
    const res = await POST(
      alertRequest({
        productSlug: 'macbook-air',
        alertType: 'price_drop',
        conditionValue: 999,
        channel: 'email',
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ id: 'alert-1', alertType: 'price_drop' });
    expect(fakeAlerts.createAlert).toHaveBeenCalledTimes(1);
    const input = fakeAlerts.createAlert.mock.calls[0][2] as Record<string, unknown>;
    expect(input.productId).toBe('prod-macbook');
    expect(input.alertType).toBe('price_drop');
    expect(input.conditionValue).toBe(999);
  });

  it('creates an alert by productId directly (no slug lookup)', async () => {
    const res = await POST(
      alertRequest({ productId: 'prod-macbook', alertType: 'deal' })
    );
    expect(res.status).toBe(201);
    expect(fakeAlerts.createAlert).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown alertType with 400 (Zod enum error) and the generic envelope', async () => {
    const res = await POST(
      alertRequest({ productSlug: 'macbook-air', alertType: 'carrier_pigeon' })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
    // Section 18 Phase 2 item 10 (security worker, landed while
    // this file was being written): alertType is a Zod enum now,
    // so the 400 carries Zod's message, not the old manual one.
    expect(body.error.message).toContain('Invalid enum value');
    expect(body.error.message).toContain("'price_drop'");
    expect(fakeAlerts.createAlert).not.toHaveBeenCalled();
  });

  it('rejects a missing product with 400 (no productId, no slug)', async () => {
    const res = await POST(alertRequest({ alertType: 'price_drop' }));
    expect(res.status).toBe(400);
    expect(fakeAlerts.createAlert).not.toHaveBeenCalled();
  });

  it('rejects an unknown slug with 400 (slug resolves to nothing)', async () => {
    const res = await POST(
      alertRequest({ productSlug: 'no-such-product', alertType: 'price_drop' })
    );
    expect(res.status).toBe(400);
    expect(fakeAlerts.createAlert).not.toHaveBeenCalled();
  });

  it('enforces the Free 5-alert cap at the route: 6th alert → 403 with upgrade hint, no insert', async () => {
    fakeAlerts.checkAlertCap.mockResolvedValue({
      allowed: false,
      current: 5,
      max: 5,
      tier: 'free',
    });
    const res = await POST(
      alertRequest({ productSlug: 'macbook-air', alertType: 'price_drop' })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string; details?: Record<string, unknown> };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('up to 5 price alerts');
    expect(body.error.details).toMatchObject({ limit: 5, current: 5 });
    expect(fakeAlerts.createAlert).not.toHaveBeenCalled();
  });

  it('a failed insert answers 500 with a generic message (no internals leak)', async () => {
    fakeAlerts.createAlert.mockResolvedValue(null);
    const res = await POST(
      alertRequest({ productSlug: 'macbook-air', alertType: 'price_drop' })
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Failed to create alert');
  });

  it('GET lists the user alerts with the tier meta (route-level sanity)', async () => {
    const res = await GET(alertRequest(null, 'GET'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: unknown[];
      meta?: { maxAlerts?: number; alertCount?: number };
    };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta?.maxAlerts).toBe(5);
    expect(body.meta?.alertCount).toBe(2);
  });
});
