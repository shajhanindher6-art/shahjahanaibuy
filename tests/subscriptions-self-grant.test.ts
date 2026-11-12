/**
 * Subscriptions self-grant bypass tests (Section 15, P2-4).
 *
 * The bug: POST /api/v1/subscriptions used to let any authenticated
 * user upsert their own row with ANY plan string + status 'active'
 * whenever Stripe was unconfigured. lib/api-quota.ts getTierForUserId()
 * trusts that row, so a user could grant themselves plan 'team',
 * status 'active' and receive the 100,000/day Team quota, and the
 * billing page rendered them as paid.
 *
 * The fix (route + migration 037): a direct upsert may ONLY ever set
 * plan 'free'. Any other plan is rejected with 400 — with the
 * checkout message when Stripe is configured (existing behaviour)
 * and a plain rejection when it is not. Paid status may only ever
 * come via the Stripe webhook (services/stripe.ts
 * syncSubscriptionFromStripe), which these tests simulate by seeding
 * the fake table directly, bypassing the route.
 *
 * Route tests run against a mocked Supabase client (in-memory
 * subscriptions table); no DB, no network, no real Stripe keys —
 * the Stripe-configured branch is toggled through a mocked
 * isStripeConfigured, exactly as the route reads it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { getTierForUserId, resolveTierFromSubscription } from '@/lib/api-quota';

type SubRow = Record<string, unknown>;

// --- In-memory subscriptions table shared by both mocked clients ---
const fakeDb = vi.hoisted(() => ({
  rows: new Map<string, SubRow>(),
  stripeConfigured: false,
  stripeLiveMode: false,
  launchApproved: false,
}));

function makeFakeClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'test-user-1' } },
        error: null,
      }),
    },
    from: (_table: string) => ({
      select: (_cols?: string) => ({
        eq: (_col: string, value: string) => ({
          maybeSingle: async () => ({
            data: fakeDb.rows.get(value) ?? null,
            error: null,
          }),
        }),
      }),
      update: (updates: SubRow) => ({
        eq: (_col: string, value: string) => ({
          select: (_cols?: string) => ({
            maybeSingle: async () => {
              const existing = fakeDb.rows.get(value);
              if (!existing) return { data: null, error: { message: 'no row' } };
              const next = { ...existing, ...updates };
              fakeDb.rows.set(value, next);
              return { data: next, error: null };
            },
          }),
        }),
      }),
      insert: (row: SubRow) => ({
        select: (_cols?: string) => ({
          maybeSingle: async () => {
            const next = { ...row };
            fakeDb.rows.set(String(next.user_id), next);
            return { data: next, error: null };
          },
        }),
      }),
    }),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => makeFakeClient(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => makeFakeClient(),
}));

vi.mock('@/services/stripe', () => ({
  isStripeConfigured: () => fakeDb.stripeConfigured,
}));

// Section 15 P2-5: the GET meta (paymentsLive / stripeConfigured)
// reads the live-mode derivation from '@/lib/stripe'. Mock only
// the two derivation functions; everything else keeps the real
// module so no other importer breaks.
vi.mock('@/lib/stripe', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/stripe')>();
  return {
    ...orig,
    isStripeLiveMode: () => fakeDb.stripeLiveMode,
    isStripeLiveLaunchApproved: () => fakeDb.launchApproved,
  };
});

// Imported after the mocks so the route and quota lookup use the fakes.
import { GET, POST } from '@/app/api/v1/subscriptions/route';

let ipCounter = 0;
function postRequest(body: unknown) {
  ipCounter += 1;
  return new NextRequest('http://localhost/api/v1/subscriptions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': `203.0.113.${100 + ipCounter}`,
    },
    body: JSON.stringify(body),
  });
}

function getRequest() {
  ipCounter += 1;
  return new NextRequest('http://localhost/api/v1/subscriptions', {
    method: 'GET',
    headers: { 'x-real-ip': `203.0.113.${100 + ipCounter}` },
  });
}

/** Seed a row exactly as the Stripe webhook's upsert would write it. */
function seedWebhookRow(plan: string, status: string) {
  fakeDb.rows.set('test-user-1', {
    user_id: 'test-user-1',
    plan,
    status,
    stripe_customer_id: 'cus_fake',
    stripe_subscription_id: 'sub_fake',
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    cancel_at_period_end: false,
  });
}

describe('POST /api/v1/subscriptions — self-grant bypass closed (Stripe unconfigured)', () => {
  beforeEach(() => {
    fakeDb.rows.clear();
    fakeDb.stripeConfigured = false;
    fakeDb.stripeLiveMode = false;
    fakeDb.launchApproved = false;
  });

  it("rejects plan 'team' with 400 and creates no row", async () => {
    const res = await POST(postRequest({ plan: 'team' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/checkout/i);
    expect(fakeDb.rows.size).toBe(0);
  });

  it("rejects plan 'premium' with 400 and creates no row", async () => {
    const res = await POST(postRequest({ plan: 'premium' }));
    expect(res.status).toBe(400);
    expect(fakeDb.rows.size).toBe(0);
  });

  it("rejects legacy plan 'pro' and garbage plans with 400", async () => {
    for (const plan of ['pro', 'enterprise', 'gold', 'FREE', ' free', '']) {
      const res = await POST(postRequest({ plan }));
      expect(res.status).toBe(400);
      expect(fakeDb.rows.size).toBe(0);
    }
  });

  it('rejects a missing plan with 400 (existing validation preserved)', async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(fakeDb.rows.size).toBe(0);
  });

  it('a rejected POST leaves a pre-existing paid row untouched', async () => {
    seedWebhookRow('team', 'active');
    const res = await POST(postRequest({ plan: 'team' }));
    expect(res.status).toBe(400);
    // The row is still there — only a POST plan 'free' (or the owner
    // cleanup in migration 037) may downgrade it, never the bypass.
    expect(fakeDb.rows.get('test-user-1')).toMatchObject({ plan: 'team', status: 'active' });
  });

  it("accepts plan 'free' for a new user and stores it as canceled, never active", async () => {
    const res = await POST(postRequest({ plan: 'free' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ plan: 'free', status: 'canceled' });
    expect(fakeDb.rows.get('test-user-1')).toMatchObject({ plan: 'free', status: 'canceled' });
  });

  it("accepts plan 'free' with cancelAtPeriodEnd as canceling, never active", async () => {
    const res = await POST(postRequest({ plan: 'free', cancelAtPeriodEnd: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ plan: 'free', status: 'canceling' });
  });

  it("downgrades an existing webhook-granted paid row to free on POST plan 'free'", async () => {
    seedWebhookRow('team', 'active');
    const res = await POST(postRequest({ plan: 'free' }));
    expect(res.status).toBe(200);
    expect(fakeDb.rows.get('test-user-1')).toMatchObject({ plan: 'free', status: 'canceled' });
    // And the downgraded row resolves back to the free tier.
    expect(await getTierForUserId('test-user-1')).toBe('free');
  });

  it('GET still returns the stored row', async () => {
    seedWebhookRow('free', 'canceled');
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ plan: 'free', status: 'canceled' });
  });

  it('GET meta reports paymentsLive false + stripeConfigured false (billing banner source)', async () => {
    seedWebhookRow('free', 'canceled');
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta).toEqual({ paymentsLive: false, stripeConfigured: false });
  });
});

describe('POST /api/v1/subscriptions — Stripe configured branch preserved', () => {
  beforeEach(() => {
    fakeDb.rows.clear();
    fakeDb.stripeConfigured = true;
    fakeDb.stripeLiveMode = false;
    fakeDb.launchApproved = false;
  });

  it("rejects plan 'team' with 400 and the checkout message, creating no row", async () => {
    const res = await POST(postRequest({ plan: 'team' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('/api/v1/subscriptions/checkout');
    expect(fakeDb.rows.size).toBe(0);
  });

  it("still accepts plan 'free' when Stripe is configured", async () => {
    const res = await POST(postRequest({ plan: 'free' }));
    expect(res.status).toBe(200);
    expect(fakeDb.rows.get('test-user-1')).toMatchObject({ plan: 'free', status: 'canceled' });
  });

  it('GET meta reports stripeConfigured true but paymentsLive false (test mode is not live)', async () => {
    seedWebhookRow('free', 'canceled');
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta).toEqual({ paymentsLive: false, stripeConfigured: true });
  });
});

describe('GET /api/v1/subscriptions — paymentsLive meta (Section 15, P2-5)', () => {
  beforeEach(() => {
    fakeDb.rows.clear();
    fakeDb.stripeConfigured = true;
  });

  it('reports paymentsLive true only with a live key AND launch approval', async () => {
    seedWebhookRow('free', 'canceled');
    fakeDb.stripeLiveMode = true;
    fakeDb.launchApproved = true;
    const res = await GET(getRequest());
    const body = await res.json();
    expect(body.meta).toEqual({ paymentsLive: true, stripeConfigured: true });
  });

  it('reports paymentsLive false with a live key but no launch approval', async () => {
    seedWebhookRow('free', 'canceled');
    fakeDb.stripeLiveMode = true;
    fakeDb.launchApproved = false;
    const res = await GET(getRequest());
    const body = await res.json();
    expect(body.meta).toEqual({ paymentsLive: false, stripeConfigured: true });
  });
});

describe('webhook-written paid rows still resolve to the paid tier', () => {
  beforeEach(() => {
    fakeDb.rows.clear();
    fakeDb.stripeConfigured = false;
  });

  it("a webhook-written plan 'team' + status 'active' row resolves to team (100k/day)", async () => {
    seedWebhookRow('team', 'active');
    expect(await getTierForUserId('test-user-1')).toBe('team');
  });

  it("webhook-written 'pro' maps to premium, 'premium'/'family' to their tiers", async () => {
    seedWebhookRow('pro', 'active');
    expect(await getTierForUserId('test-user-1')).toBe('premium');
    seedWebhookRow('premium', 'active');
    expect(await getTierForUserId('test-user-1')).toBe('premium');
    seedWebhookRow('family', 'active');
    expect(await getTierForUserId('test-user-1')).toBe('family');
  });

  it('a canceled paid row falls back to free', async () => {
    seedWebhookRow('team', 'canceled');
    expect(await getTierForUserId('test-user-1')).toBe('free');
  });

  it('resolveTierFromSubscription fails closed for unknown plans', () => {
    expect(resolveTierFromSubscription('team', 'active')).toBe('team');
    expect(resolveTierFromSubscription('enterprise', 'active')).toBe('free');
    expect(resolveTierFromSubscription('team', 'past_due')).toBe('free');
  });
});

describe('migration 037 — subscriptions plan/status CHECK (written, NOT applied)', () => {
  const migrationPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'supabase',
    'migrations',
    '20261112090000_037_subscriptions_plan_check.sql'
  );

  it('exists and is marked DO NOT APPLY YET', () => {
    const text = fs.readFileSync(migrationPath, 'utf8');
    expect(text).toContain('DO NOT APPLY YET');
    expect(text).toContain('037');
  });

  it('adds a plan CHECK allowing exactly free/pro/premium/family/team, NOT VALID', () => {
    const text = fs.readFileSync(migrationPath, 'utf8');
    expect(text).toContain('ADD CONSTRAINT subscriptions_plan_check');
    for (const plan of ['free', 'pro', 'premium', 'family', 'team']) {
      expect(text).toContain(`'${plan}'`);
    }
    expect(text).toContain('NOT VALID');
  });

  it('adds a status CHECK allowing Stripe statuses plus canceling, NOT VALID', () => {
    const text = fs.readFileSync(migrationPath, 'utf8');
    expect(text).toContain('ADD CONSTRAINT subscriptions_status_check');
    for (const status of [
      'active',
      'trialing',
      'past_due',
      'canceled',
      'incomplete',
      'incomplete_expired',
      'unpaid',
      'paused',
      'canceling',
    ]) {
      expect(text).toContain(`'${status}'`);
    }
  });

  it('documents the NOT VALID choice and the owner cleanup/validate steps', () => {
    const text = fs.readFileSync(migrationPath, 'utf8');
    expect(text).toContain('WHY NOT VALID');
    expect(text).toContain('VALIDATE CONSTRAINT subscriptions_plan_check');
    expect(text).toContain('VALIDATE CONSTRAINT subscriptions_status_check');
  });

  it('the route source carries the whitelist guard and no longer has the old unguarded branch', () => {
    const routePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'app',
      'api',
      'v1',
      'subscriptions',
      'route.ts'
    );
    const text = fs.readFileSync(routePath, 'utf8');
    expect(text).toContain("if (plan !== 'free')");
    expect(text).toContain('Paid plans are only available through Stripe checkout');
    expect(text).not.toContain("isStripeConfigured() && plan !== 'free'");
  });
});
