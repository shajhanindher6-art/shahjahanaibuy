/**
 * Section 18, item 72 (audit §1 #46), part 3 — route tests for
 * POST /api/v1/subscriptions/checkout and
 * POST /api/v1/subscriptions/portal.
 *
 * Before this file no test imported either route (grep: 0 hits).
 * Stripe is MOCKED at the services boundary — no live Stripe
 * call is ever made, no real checkout session is created.
 *
 * Contracts pinned here (as coded):
 * - checkout, valid request → 200 { url } (the Stripe Checkout
 *   URL); the plan is normalised ('pro' → 'premium') before it
 *   reaches Stripe
 * - checkout, unauthenticated → 401; unknown plan → 400;
 *   Stripe unconfigured → 400; live mode blocked → 503;
 *   Stripe returning { error } → 500
 * - portal, valid request → 200 { url }; no subscription row →
 *   400 'No active subscription found'; unauthenticated → 401
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const fakeSession = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
  subscriptionRow: null as { stripe_customer_id: string } | null,
}));

const fakeStripe = vi.hoisted(() => ({
  configured: true,
  liveBlocked: false,
  createCheckoutSession: vi.fn(),
  createCustomerPortalSession: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: fakeSession.user }, error: null }),
    },
    from: (_table: string) => ({
      select: (_cols?: string) => ({
        eq: (_col: string, _value: string) => ({
          maybeSingle: async () => ({
            data: fakeSession.subscriptionRow,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/services/stripe', () => ({
  isStripeConfigured: () => fakeStripe.configured,
  createCheckoutSession: (...args: unknown[]) =>
    fakeStripe.createCheckoutSession(...args),
  createCustomerPortalSession: (...args: unknown[]) =>
    fakeStripe.createCustomerPortalSession(...args),
}));

vi.mock('@/lib/stripe', () => ({
  isStripeLiveModeBlocked: () => fakeStripe.liveBlocked,
}));

// Imported after the mocks so the routes use the fakes.
import { POST as checkoutPOST } from '@/app/api/v1/subscriptions/checkout/route';
import { POST as portalPOST } from '@/app/api/v1/subscriptions/portal/route';

let ipCounter = 0;
function req(path: string, body: unknown) {
  ipCounter += 1;
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': `203.0.113.${ipCounter}`,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/subscriptions/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSession.user = { id: 'test-user-1', email: 'buyer@example.test' };
    fakeSession.subscriptionRow = null;
    fakeStripe.configured = true;
    fakeStripe.liveBlocked = false;
    fakeStripe.createCheckoutSession.mockResolvedValue({
      url: 'https://checkout.stripe.test/session-test',
    });
    fakeStripe.createCustomerPortalSession.mockResolvedValue({
      url: 'https://billing.stripe.test/portal-test',
    });
  });

  it('creates a checkout session for a valid plan → 200 with the Stripe URL', async () => {
    const res = await checkoutPOST(
      req('/api/v1/subscriptions/checkout', { plan: 'premium' })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { url: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.url).toBe('https://checkout.stripe.test/session-test');
    expect(fakeStripe.createCheckoutSession).toHaveBeenCalledWith(
      'test-user-1',
      'buyer@example.test',
      'premium'
    );
  });

  it("normalises the deprecated 'pro' alias to 'premium' before calling Stripe", async () => {
    const res = await checkoutPOST(
      req('/api/v1/subscriptions/checkout', { plan: 'pro' })
    );
    expect(res.status).toBe(200);
    expect(fakeStripe.createCheckoutSession).toHaveBeenCalledWith(
      'test-user-1',
      'buyer@example.test',
      'premium'
    );
  });

  it('rejects unauthenticated callers with 401 and calls Stripe never', async () => {
    fakeSession.user = null;
    const res = await checkoutPOST(
      req('/api/v1/subscriptions/checkout', { plan: 'premium' })
    );
    expect(res.status).toBe(401);
    expect(fakeStripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown plan with 400', async () => {
    const res = await checkoutPOST(
      req('/api/v1/subscriptions/checkout', { plan: 'enterprise' })
    );
    expect(res.status).toBe(400);
    expect(fakeStripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('answers 400 when Stripe is not configured (never a fake checkout URL)', async () => {
    fakeStripe.configured = false;
    const res = await checkoutPOST(
      req('/api/v1/subscriptions/checkout', { plan: 'premium' })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { message: string };
    };
    expect(body.error.message).toContain('Stripe is not configured');
    expect(fakeStripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('answers 503 when live mode is blocked (live key without launch approval)', async () => {
    fakeStripe.liveBlocked = true;
    const res = await checkoutPOST(
      req('/api/v1/subscriptions/checkout', { plan: 'premium' })
    );
    expect(res.status).toBe(503);
    expect(fakeStripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('answers 500 when Stripe reports an error creating the session', async () => {
    fakeStripe.createCheckoutSession.mockResolvedValue({
      error: 'fake-test-only Stripe failure',
    });
    const res = await checkoutPOST(
      req('/api/v1/subscriptions/checkout', { plan: 'premium' })
    );
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/subscriptions/portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSession.user = { id: 'test-user-1', email: 'buyer@example.test' };
    fakeSession.subscriptionRow = { stripe_customer_id: 'cus_test123' };
    fakeStripe.configured = true;
    fakeStripe.liveBlocked = false;
    fakeStripe.createCustomerPortalSession.mockResolvedValue({
      url: 'https://billing.stripe.test/portal-test',
    });
  });

  it('creates a portal session for a subscribed user → 200 with the portal URL', async () => {
    const res = await portalPOST(req('/api/v1/subscriptions/portal', {}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { url: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.url).toBe('https://billing.stripe.test/portal-test');
    expect(fakeStripe.createCustomerPortalSession).toHaveBeenCalledWith(
      'cus_test123'
    );
  });

  it('rejects unauthenticated callers with 401 and calls Stripe never', async () => {
    fakeSession.user = null;
    const res = await portalPOST(req('/api/v1/subscriptions/portal', {}));
    expect(res.status).toBe(401);
    expect(fakeStripe.createCustomerPortalSession).not.toHaveBeenCalled();
  });

  it('answers 400 when the user has no subscription row', async () => {
    fakeSession.subscriptionRow = null;
    const res = await portalPOST(req('/api/v1/subscriptions/portal', {}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { message: string };
    };
    expect(body.error.message).toContain('No active subscription found');
    expect(fakeStripe.createCustomerPortalSession).not.toHaveBeenCalled();
  });

  it('answers 503 when live mode is blocked', async () => {
    fakeStripe.liveBlocked = true;
    const res = await portalPOST(req('/api/v1/subscriptions/portal', {}));
    expect(res.status).toBe(503);
    expect(fakeStripe.createCustomerPortalSession).not.toHaveBeenCalled();
  });
});
