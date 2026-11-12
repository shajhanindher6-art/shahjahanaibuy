/**
 * Section 18, item 71 (audit §1 #45) — bad-input → 400 route
 * tests. Every test asserts the generic error envelope
 * (`{ success: false, error: { code, message } }`) and that no
 * internal detail leaks into the message.
 *
 * NOTE ON THE BRIEF'S PREMISE (updated while writing): the brief
 * described "the three Zod-adopted routes from the security
 * worker — intake, alerts, checkout". When this file was started,
 * none of the three used Zod; WHILE it was being written, the
 * Phase 2 item-10 worker landed `validateBody` Zod schemas in
 * intake and alerts (the test run caught it: the 400s came back
 * with Zod's "Invalid enum value" messages, and the two
 * assertions were updated to the real messages rather than the
 * code being touched). Checkout is still manual-check as of this
 * tree state; subscriptions Zod coverage lives in
 * tests/subscriptions-zod-validation.test.ts. These tests assert
 * the 400 contract (status + generic envelope), so they hold
 * whichever validator a route uses.
 *
 * Alert bad-input cases live in tests/section18-alerts-route.test.ts
 * (item 73), not here, so no case is asserted twice.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------- Shared fakes ----------

const fakeSession = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
}));

const fakeStripe = vi.hoisted(() => ({
  configured: true,
  liveBlocked: false,
  createCheckoutSession: vi.fn(),
}));

const fakeWishlists = vi.hoisted(() => ({
  createWishlist: vi.fn(),
}));

function adminProfileRow() {
  return { role_id: 'role-admin', roles: { name: 'admin' } };
}

function makeServiceClient() {
  // Chainable PostgREST-style builder used by requireAdmin
  // (profiles select → .single()) and by the intake route.
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    single: async () => ({ data: adminProfileRow(), error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return { from: (_table: string) => builder };
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: fakeSession.user }, error: null }),
    },
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => makeServiceClient(),
}));

vi.mock('@/services/stripe', () => ({
  isStripeConfigured: () => fakeStripe.configured,
  createCheckoutSession: (...args: unknown[]) =>
    fakeStripe.createCheckoutSession(...args),
  createCustomerPortalSession: async () => ({
    url: 'https://billing.stripe.test/portal-test',
  }),
}));

vi.mock('@/lib/stripe', () => ({
  isStripeLiveModeBlocked: () => fakeStripe.liveBlocked,
}));

vi.mock('@/services/wishlists', () => ({
  getWishlists: async () => [],
  createWishlist: (...args: unknown[]) => fakeWishlists.createWishlist(...args),
}));

// Imported after the mocks so the routes use the fakes.
import { POST as intakePOST } from '@/app/api/v1/admin/intake/route';
import { POST as checkoutPOST } from '@/app/api/v1/subscriptions/checkout/route';
import { POST as wishlistsPOST } from '@/app/api/v1/wishlists/route';

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

type ErrorBody = {
  success: boolean;
  error: { code: string; message: string };
};

async function errorBody(res: Response): Promise<ErrorBody> {
  return (await res.json()) as ErrorBody;
}

function expectGeneric400(body: ErrorBody) {
  expect(body.success).toBe(false);
  expect(body.error.code).toBe('BAD_REQUEST');
  // No internals leak: no table/column names, no stack, no SQL.
  expect(body.error.message).not.toMatch(/column|table|SELECT|Error:|at\s+\w+\s+\(/);
}

// ---------- Intake (admin; Zod envelope + manual checks) ----------

describe('POST /api/v1/admin/intake — bad input → 400', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSession.user = { id: 'admin-1' };
  });

  it('rejects a non-object JSON body (array) with 400', async () => {
    const res = await intakePOST(req('/api/v1/admin/intake', ['preview']));
    expect(res.status).toBe(400);
    expectGeneric400(await errorBody(res));
  });

  it('rejects an unknown intake source with 400', async () => {
    const res = await intakePOST(
      req('/api/v1/admin/intake', { action: 'preview', csv: 'name,brand\nX,Y', source: 'scraped-web' })
    );
    expect(res.status).toBe(400);
    expectGeneric400(await errorBody(res));
  });

  it('rejects an unknown action with 400 (Zod enum error)', async () => {
    const res = await intakePOST(req('/api/v1/admin/intake', { action: 'explode' }));
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expectGeneric400(body);
    // Section 18 Phase 2 item 10 (security worker, landed while
    // this file was being written): the action is a Zod enum now.
    expect(body.error.message).toContain('Invalid enum value');
    expect(body.error.message).toContain("'preview' | 'approve'");
  });

  it('rejects a preview with empty CSV with 400', async () => {
    const res = await intakePOST(
      req('/api/v1/admin/intake', { action: 'preview', csv: '   ' })
    );
    expect(res.status).toBe(400);
    expectGeneric400(await errorBody(res));
  });

  it('rejects an approve with no rows with 400', async () => {
    const res = await intakePOST(req('/api/v1/admin/intake', { action: 'approve' }));
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expectGeneric400(body);
    expect(body.error.message).toContain('Approve requires');
  });

  it('rejects a non-admin (no session) with 401 before any validation runs', async () => {
    fakeSession.user = null;
    const res = await intakePOST(req('/api/v1/admin/intake', { action: 'explode' }));
    expect(res.status).toBe(401);
  });
});

// ---------- Checkout (manual plan check) ----------

describe('POST /api/v1/subscriptions/checkout — bad input → 400', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSession.user = { id: 'test-user-1', email: 'buyer@example.test' };
    fakeStripe.configured = true;
    fakeStripe.liveBlocked = false;
    fakeStripe.createCheckoutSession.mockResolvedValue({
      url: 'https://checkout.stripe.test/session-test',
    });
  });

  it('rejects a missing plan with 400', async () => {
    const res = await checkoutPOST(req('/api/v1/subscriptions/checkout', {}));
    expect(res.status).toBe(400);
    expectGeneric400(await errorBody(res));
    expect(fakeStripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown plan with 400', async () => {
    const res = await checkoutPOST(
      req('/api/v1/subscriptions/checkout', { plan: 'enterprise' })
    );
    expect(res.status).toBe(400);
    expectGeneric400(await errorBody(res));
    expect(fakeStripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects a non-string plan (123) with 400', async () => {
    const res = await checkoutPOST(
      req('/api/v1/subscriptions/checkout', { plan: 123 })
    );
    expect(res.status).toBe(400);
    expect(fakeStripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller with 401 before plan validation', async () => {
    fakeSession.user = null;
    const res = await checkoutPOST(
      req('/api/v1/subscriptions/checkout', { plan: 'enterprise' })
    );
    expect(res.status).toBe(401);
    expect(fakeStripe.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ---------- Wishlists (manual name check, high-traffic) ----------

describe('POST /api/v1/wishlists — bad input → 400', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeSession.user = { id: 'test-user-1' };
    fakeWishlists.createWishlist.mockResolvedValue({
      id: 'wl-1',
      name: 'Test list',
    });
  });

  it('rejects a missing name with 400', async () => {
    const res = await wishlistsPOST(req('/api/v1/wishlists', {}));
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expectGeneric400(body);
    expect(body.error.message).toContain('name is required');
    expect(fakeWishlists.createWishlist).not.toHaveBeenCalled();
  });

  it('rejects a blank name with 400', async () => {
    const res = await wishlistsPOST(req('/api/v1/wishlists', { name: '   ' }));
    expect(res.status).toBe(400);
    expect(fakeWishlists.createWishlist).not.toHaveBeenCalled();
  });

  it('rejects a non-string name (123) with 400', async () => {
    const res = await wishlistsPOST(req('/api/v1/wishlists', { name: 123 }));
    expect(res.status).toBe(400);
    expect(fakeWishlists.createWishlist).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller with 401 before name validation', async () => {
    fakeSession.user = null;
    const res = await wishlistsPOST(req('/api/v1/wishlists', {}));
    expect(res.status).toBe(401);
    expect(fakeWishlists.createWishlist).not.toHaveBeenCalled();
  });
});
