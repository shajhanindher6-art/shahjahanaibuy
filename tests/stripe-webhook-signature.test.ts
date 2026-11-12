/**
 * Stripe webhook signature verification tests (Section 18, item 66,
 * audit §1 #7).
 *
 * GAP: no test ever called `stripe.webhooks.constructEvent` or
 * asserted a bad signature → 400 — `constructEvent` appeared only
 * in `app/api/webhooks/stripe/route.ts:60`. The 400-on-bad-signature
 * path was code-only, unproven even in tests.
 *
 * These tests hit the REAL route handler with a REAL Stripe SDK
 * instance (offline HMAC verification only — no network, no live
 * keys): the signing secret is an obvious test-only fake
 * (`whsec_test_...`), the Stripe secret key is a fake test key, the
 * webhook handler (`processWebhookEvent`) and the Supabase service
 * client are mocked at the boundary. A valid signature must reach
 * the handler path (200 + `processWebhookEvent` called with the
 * verified event); a bad, tampered, or missing signature must be
 * rejected with 400 before the handler ever runs.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';
import { NextRequest } from 'next/server';

// Obvious test-only fake secrets — never real keys, never live.
// Held in vi.hoisted so the vi.mock factories below (which are
// hoisted above this line) may reference them.
const { TEST_WEBHOOK_SECRET, TEST_STRIPE_KEY } = vi.hoisted(() => ({
  TEST_WEBHOOK_SECRET: 'whsec_test_fake_secret_for_signature_tests_only',
  TEST_STRIPE_KEY: 'sk_test_fake_key_for_signature_tests_only',
}));

const mocks = vi.hoisted(() => ({
  processWebhookEvent: vi.fn(async () => undefined),
}));

// The route reads the webhook secret from the env layer, which is
// evaluated at import time — mock the layer so the route sees the
// test-only fake secret without touching process.env for real.
vi.mock('@/lib/config/env', () => ({
  env: { stripeWebhookSecret: TEST_WEBHOOK_SECRET },
}));

// Real Stripe SDK instance (constructed with a fake test key):
// `webhooks.constructEvent` / `generateTestHeaderString` are pure
// offline HMAC operations, so signature verification is genuinely
// exercised — not stubbed out.
vi.mock('@/lib/stripe', async () => {
  const { default: StripeSdk } = await import('stripe');
  const stripe = new StripeSdk(TEST_STRIPE_KEY, {
    apiVersion: '2023-10-16',
    typescript: true,
  });
  return {
    getStripe: () => stripe,
    isStripeConfigured: () => true,
    isStripeLiveMode: () => false,
    isStripeLiveLaunchApproved: () => false,
  };
});

vi.mock('@/services/stripe', () => ({
  processWebhookEvent: mocks.processWebhookEvent,
}));

vi.mock('@/lib/supabase/service', () => ({
  // The handler is mocked, so the client is never used — it only
  // has to exist so the route does not take its 503 branch.
  createSupabaseServiceClient: () => ({}),
}));

// Imported after the mocks so the route uses the fakes above.
import { POST } from '@/app/api/webhooks/stripe/route';

// A second real-SDK instance, used ONLY to sign test payloads.
const signingStripe = new Stripe(TEST_STRIPE_KEY, {
  apiVersion: '2023-10-16',
  typescript: true,
});

const EVENT_PAYLOAD = JSON.stringify({
  id: 'evt_test_signature_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_signature_1',
      object: 'checkout.session',
      customer: 'cus_test_1',
      subscription: 'sub_test_1',
    },
  },
});

let ipCounter = 0;
function webhookRequest(payload: string, signature: string | null) {
  ipCounter += 1;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Unique IP per request so the route's 120/min/IP bucket can
    // never interfere with the signature assertions.
    'x-real-ip': `203.0.113.${200 + ipCounter}`,
  };
  if (signature !== null) headers['stripe-signature'] = signature;
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers,
    body: payload,
  });
}

function sign(payload: string, secret: string = TEST_WEBHOOK_SECRET): string {
  return signingStripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
}

describe('POST /api/webhooks/stripe — Stripe signature verification', () => {
  beforeEach(() => {
    mocks.processWebhookEvent.mockClear();
  });

  it('a valid signature reaches the handler path (200 + processWebhookEvent called)', async () => {
    const res = await POST(webhookRequest(EVENT_PAYLOAD, sign(EVENT_PAYLOAD)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { received: true } });
    expect(mocks.processWebhookEvent).toHaveBeenCalledTimes(1);
    const [, event] = mocks.processWebhookEvent.mock.calls[0] as unknown as [
      unknown,
      { id: string; type: string },
    ];
    expect(event).toMatchObject({
      id: 'evt_test_signature_1',
      type: 'checkout.session.completed',
    });
  });

  it('a tampered payload (signed body ≠ sent body) → 400 and the handler never runs', async () => {
    const tampered = EVENT_PAYLOAD.replace('evt_test_signature_1', 'evt_test_forged_1');
    expect(tampered).not.toBe(EVENT_PAYLOAD);
    const res = await POST(webhookRequest(tampered, sign(EVENT_PAYLOAD)));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/invalid signature/i);
    expect(mocks.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('a signature made with the wrong secret → 400 and the handler never runs', async () => {
    const res = await POST(
      webhookRequest(EVENT_PAYLOAD, sign(EVENT_PAYLOAD, 'whsec_test_wrong_secret'))
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/invalid signature/i);
    expect(mocks.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('a garbage signature string → 400 and the handler never runs', async () => {
    const res = await POST(webhookRequest(EVENT_PAYLOAD, 't=123,v=not-a-real-signature'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(mocks.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('a missing signature header → 400 and the handler never runs', async () => {
    const res = await POST(webhookRequest(EVENT_PAYLOAD, null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/missing.*signature/i);
    expect(mocks.processWebhookEvent).not.toHaveBeenCalled();
  });
});
