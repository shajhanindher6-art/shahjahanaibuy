/**
 * Section 18, Phase 2 — Stripe webhook rate limit (audit §12
 * item 13; §1 #60).
 *
 * The webhook limit was tightened from 120/min/IP to 30/min/IP.
 * This test hits the REAL route handler with the REAL in-memory
 * rate-limit bucket (Upstash unset in tests, so the in-memory
 * fallback applies) and the REAL Stripe SDK for signature
 * verification (offline HMAC only — fake test keys, no network):
 * 30 requests from one IP are answered on their merits (400 for
 * a garbage signature), the 31st is 429.
 *
 * The route source is also asserted statically so a future
 * limit change fails loudly here instead of silently drifting
 * from docs/rate-limits.md (which still says 120 — a doc
 * follow-up for the coordinator, docs are out of scope here).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { TEST_WEBHOOK_SECRET, TEST_STRIPE_KEY } = vi.hoisted(() => ({
  TEST_WEBHOOK_SECRET: 'whsec_test_fake_secret_for_webhook_limit_tests_only',
  TEST_STRIPE_KEY: 'sk_test_fake_key_for_webhook_limit_tests_only',
}));

const mocks = vi.hoisted(() => ({
  processWebhookEvent: vi.fn(async () => undefined),
}));

vi.mock('@/lib/config/env', () => ({
  env: { stripeWebhookSecret: TEST_WEBHOOK_SECRET },
}));

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
  createSupabaseServiceClient: () => ({}),
}));

import { POST } from '@/app/api/webhooks/stripe/route';

const EVENT_PAYLOAD = JSON.stringify({
  id: 'evt_test_limit_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_limit_1', object: 'checkout.session' } },
});

// One fixed IP for the whole bucket test — the in-memory bucket
// is keyed `webhooks.stripe:<ip>`, so every request here shares
// it. No other test file uses this address.
const BUCKET_IP = '203.0.113.77';

function webhookRequest() {
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': BUCKET_IP,
      // Garbage signature: answered 400 on its merits, before
      // the handler ever runs — so the bucket, not Stripe, is
      // what this test measures.
      'stripe-signature': 't=123,v=not-a-real-signature',
    },
    body: EVENT_PAYLOAD,
  });
}

describe('POST /api/webhooks/stripe — 30/min/IP limit (audit §1 #60)', () => {
  beforeEach(() => {
    mocks.processWebhookEvent.mockClear();
  });

  it('the route enforces 30/min/IP in source', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/api/webhooks/stripe/route.ts'),
      'utf8'
    );
    expect(src).toContain('webhooks.stripe:${getClientIp(request)}`, 30)');
    expect(src).not.toContain('`, 120)');
  });

  it('30 requests from one IP are answered, the 31st is 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await POST(webhookRequest());
      statuses.push(res.status);
      // Drain the body so the response is fully consumed.
      await res.text();
    }
    expect(statuses.slice(0, 30)).toEqual(Array(30).fill(400));
    expect(statuses[30]).toBe(429);
    expect(mocks.processWebhookEvent).not.toHaveBeenCalled();
  });
});
