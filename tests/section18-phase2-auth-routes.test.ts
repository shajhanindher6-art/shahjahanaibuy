/**
 * Section 18, Phase 2 — route-level behaviour (audit §1 #11, #12, #13):
 * CSRF 403s, Zod 400s, and the rate-limited reset proxy.
 *
 * The REAL route handlers run; only the Supabase boundary and the
 * Stripe/services layer are faked. Each test uses its own
 * `x-real-ip` so the in-memory rate-limit buckets never leak
 * between tests (the reset-proxy limit is 5/min/IP — the 429 test
 * deliberately spends one IP's whole budget).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  resetPasswordCalls: [] as string[],
  checkoutCalls: [] as Array<{ userId: string; email: string; plan: string }>,
  alertInserts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: 'test-user-1', email: 'test@example.com' } },
        error: null,
      }),
      resetPasswordForEmail: async (email: string) => {
        state.resetPasswordCalls.push(email);
        return { data: {}, error: null };
      },
    },
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    from: (_table: string) => ({
      select: (_cols?: string) => ({
        eq: (_col: string, _value: string) => ({
          single: async () => ({
            data: { role_id: 'role-admin', roles: { name: 'admin' } },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/services/alerts', () => ({
  checkAlertCap: async () => ({ allowed: true, max: 5, current: 0 }),
  countAlerts: async () => 0,
  getAlerts: async () => [],
  createAlert: async (_client: unknown, userId: string, input: Record<string, unknown>) => {
    state.alertInserts.push({ userId, ...input });
    return { id: 'alert-1', user_id: userId, ...input };
  },
}));

vi.mock('@/lib/api-quota', () => ({
  getTierForUserId: async () => 'free',
  getUpgradeTier: () => 'premium',
  BILLING_URL: '/pricing',
}));

vi.mock('@/lib/tiers', () => ({
  getMaxAlerts: () => 5,
  getTier: () => ({ name: 'Free' }),
  // lib/pricing-config (imported by the checkout route) calls this
  // via normalizePlanKey — the mock must provide it.
  normalizeTierId: (value: unknown, fallback = 'free') => {
    if (value === 'pro') return 'premium';
    return ['free', 'premium', 'family', 'team'].includes(value as string)
      ? (value as string)
      : fallback;
  },
}));

vi.mock('@/services/products', () => ({
  getCachedProductBySlug: async () => ({ id: 'prod-1' }),
}));

vi.mock('@/services/stripe', () => ({
  isStripeConfigured: () => true,
  createCheckoutSession: async (userId: string, email: string, plan: string) => {
    state.checkoutCalls.push({ userId, email, plan });
    return { url: 'https://checkout.stripe.test/session-1' };
  },
}));

vi.mock('@/lib/stripe', () => ({
  isStripeLiveModeBlocked: () => false,
  isStripeLiveMode: () => false,
  isStripeLiveLaunchApproved: () => false,
}));

function post(
  url: string,
  body: unknown,
  opts?: { origin?: string | null; ip?: string }
): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-real-ip': opts?.ip ?? '10.0.0.1',
  };
  if (opts?.origin) headers.origin = opts.origin;
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.resetPasswordCalls = [];
  state.checkoutCalls = [];
  state.alertInserts = [];
});

// ---------------------------------------------------------------------------
// Item 8 + 10 — POST /api/v1/alerts
// ---------------------------------------------------------------------------
describe('POST /api/v1/alerts — CSRF + Zod', () => {
  it('mismatched Origin → 403 (before auth/validation)', async () => {
    const { POST } = await import('@/app/api/v1/alerts/route');
    const res = await POST(
      post('http://localhost/api/v1/alerts', { productId: 'prod-1', alertType: 'price_drop' }, {
        origin: 'https://evil.example',
        ip: '10.0.1.1',
      })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('FORBIDDEN');
    expect(state.alertInserts).toHaveLength(0);
  });

  it('matching Origin + valid body → 201', async () => {
    const { POST } = await import('@/app/api/v1/alerts/route');
    const res = await POST(
      post('http://localhost/api/v1/alerts', { productId: 'prod-1', alertType: 'price_drop' }, {
        origin: 'http://localhost',
        ip: '10.0.1.2',
      })
    );
    expect(res.status).toBe(201);
    expect(state.alertInserts).toHaveLength(1);
  });

  it('absent Origin (non-browser client) + valid body → 201', async () => {
    const { POST } = await import('@/app/api/v1/alerts/route');
    const res = await POST(
      post('http://localhost/api/v1/alerts', { productSlug: 'macbook-air', alertType: 'deal' }, {
        ip: '10.0.1.3',
      })
    );
    expect(res.status).toBe(201);
  });

  it('bad alertType → 400', async () => {
    const { POST } = await import('@/app/api/v1/alerts/route');
    const res = await POST(
      post('http://localhost/api/v1/alerts', { productId: 'prod-1', alertType: 'bogus' }, {
        ip: '10.0.1.4',
      })
    );
    expect(res.status).toBe(400);
    expect(state.alertInserts).toHaveLength(0);
  });

  it('string conditionValue → 400 (was silently dropped before)', async () => {
    const { POST } = await import('@/app/api/v1/alerts/route');
    const res = await POST(
      post(
        'http://localhost/api/v1/alerts',
        { productId: 'prod-1', alertType: 'price_drop', conditionValue: '99' },
        { ip: '10.0.1.5' }
      )
    );
    expect(res.status).toBe(400);
  });

  it('bad channel → 400 (was silently dropped before)', async () => {
    const { POST } = await import('@/app/api/v1/alerts/route');
    const res = await POST(
      post(
        'http://localhost/api/v1/alerts',
        { productId: 'prod-1', alertType: 'price_drop', channel: 'sms' },
        { ip: '10.0.1.6' }
      )
    );
    expect(res.status).toBe(400);
  });

  it('neither productId nor productSlug → 400', async () => {
    const { POST } = await import('@/app/api/v1/alerts/route');
    const res = await POST(
      post('http://localhost/api/v1/alerts', { alertType: 'deal' }, { ip: '10.0.1.7' })
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Item 8 + 10 — POST /api/v1/subscriptions/checkout
// ---------------------------------------------------------------------------
describe('POST /api/v1/subscriptions/checkout — CSRF + Zod', () => {
  it('mismatched Origin → 403', async () => {
    const { POST } = await import('@/app/api/v1/subscriptions/checkout/route');
    const res = await POST(
      post('http://localhost/api/v1/subscriptions/checkout', { plan: 'premium' }, {
        origin: 'https://evil.example',
        ip: '10.0.2.1',
      })
    );
    expect(res.status).toBe(403);
    expect(state.checkoutCalls).toHaveLength(0);
  });

  it('unknown plan → 400', async () => {
    const { POST } = await import('@/app/api/v1/subscriptions/checkout/route');
    const res = await POST(
      post('http://localhost/api/v1/subscriptions/checkout', { plan: 'diamond' }, {
        ip: '10.0.2.2',
      })
    );
    expect(res.status).toBe(400);
    expect(state.checkoutCalls).toHaveLength(0);
  });

  it('missing plan → 400', async () => {
    const { POST } = await import('@/app/api/v1/subscriptions/checkout/route');
    const res = await POST(
      post('http://localhost/api/v1/subscriptions/checkout', {}, { ip: '10.0.2.3' })
    );
    expect(res.status).toBe(400);
  });

  it('non-string plan → 400', async () => {
    const { POST } = await import('@/app/api/v1/subscriptions/checkout/route');
    const res = await POST(
      post('http://localhost/api/v1/subscriptions/checkout', { plan: 123 }, { ip: '10.0.2.4' })
    );
    expect(res.status).toBe(400);
  });

  it('valid plan → 200 with checkout URL (incl. deprecated "pro" alias)', async () => {
    const { POST } = await import('@/app/api/v1/subscriptions/checkout/route');
    const res = await POST(
      post('http://localhost/api/v1/subscriptions/checkout', { plan: 'pro' }, {
        ip: '10.0.2.5',
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.data as Record<string, unknown>).url).toBe(
      'https://checkout.stripe.test/session-1'
    );
    expect(state.checkoutCalls[0]?.plan).toBe('premium');
  });
});

// ---------------------------------------------------------------------------
// Item 8 + 10 — POST /api/v1/admin/intake (bad envelope only; the
// approve success path is covered by section17-stage-c /
// section18-audit-log-wiring)
// ---------------------------------------------------------------------------
describe('POST /api/v1/admin/intake — CSRF + Zod envelope', () => {
  it('mismatched Origin → 403', async () => {
    const { POST } = await import('@/app/api/v1/admin/intake/route');
    const res = await POST(
      post('http://localhost/api/v1/admin/intake', { action: 'preview', csv: 'name,slug' }, {
        origin: 'https://evil.example',
        ip: '10.0.3.1',
      })
    );
    expect(res.status).toBe(403);
  });

  it('unknown action → 400', async () => {
    const { POST } = await import('@/app/api/v1/admin/intake/route');
    const res = await POST(
      post('http://localhost/api/v1/admin/intake', { action: 'explode' }, { ip: '10.0.3.2' })
    );
    expect(res.status).toBe(400);
  });

  it('unknown source → 400', async () => {
    const { POST } = await import('@/app/api/v1/admin/intake/route');
    const res = await POST(
      post(
        'http://localhost/api/v1/admin/intake',
        { action: 'preview', csv: 'name,slug\nx,y', source: 'bogus-source' },
        { ip: '10.0.3.3' }
      )
    );
    expect(res.status).toBe(400);
  });

  it('non-array rows → 400', async () => {
    const { POST } = await import('@/app/api/v1/admin/intake/route');
    const res = await POST(
      post(
        'http://localhost/api/v1/admin/intake',
        { action: 'approve', rows: 'not-an-array' },
        { ip: '10.0.3.4' }
      )
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Item 2 — POST /api/v1/auth/reset-password (rate-limited proxy)
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/reset-password — proxy + rate limit', () => {
  it('valid email → 200 generic success, Supabase called once', async () => {
    const { POST } = await import('@/app/api/v1/auth/reset-password/route');
    const res = await POST(
      post('http://localhost/api/v1/auth/reset-password', { email: 'user@example.com' }, {
        ip: '10.0.4.1',
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.data as Record<string, unknown>).message).toContain('reset link has been sent');
    expect(state.resetPasswordCalls).toEqual(['user@example.com']);
  });

  it('invalid email → 400, Supabase NOT called', async () => {
    const { POST } = await import('@/app/api/v1/auth/reset-password/route');
    const res = await POST(
      post('http://localhost/api/v1/auth/reset-password', { email: 'not-an-email' }, {
        ip: '10.0.4.2',
      })
    );
    expect(res.status).toBe(400);
    expect(state.resetPasswordCalls).toHaveLength(0);
  });

  it('missing email → 400', async () => {
    const { POST } = await import('@/app/api/v1/auth/reset-password/route');
    const res = await POST(
      post('http://localhost/api/v1/auth/reset-password', {}, { ip: '10.0.4.3' })
    );
    expect(res.status).toBe(400);
  });

  it('6th request in a minute from one IP → 429', async () => {
    const { POST } = await import('@/app/api/v1/auth/reset-password/route');
    const ip = '10.0.4.9';
    for (let i = 0; i < 5; i++) {
      const res = await POST(
        post('http://localhost/api/v1/auth/reset-password', { email: 'user@example.com' }, { ip })
      );
      expect(res.status).toBe(200);
    }
    const limited = await POST(
      post('http://localhost/api/v1/auth/reset-password', { email: 'user@example.com' }, { ip })
    );
    expect(limited.status).toBe(429);
  });
});
