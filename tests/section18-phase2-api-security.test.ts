/**
 * Section 18, Phase 2 — API security & reliability (audit §12
 * items 48, 49, 51, 55, 11, 12; §1 #33, #34, #36, #75, #58, #59).
 *
 * - 48 health honesty: degraded → 503 (was 200), auth check
 *   inspects the getUser error AND the null-user case, Stripe-down
 *   counts toward degraded.
 * - 49 monitoring 503: uptime/incidents answer 503 on a DB/table
 *   error, 200 with the honest empty summary only when the query
 *   succeeds with no rows. (/status is a page, not an API handler
 *   — its rendering is intentionally unchanged.)
 * - 51 PII log fix: the Resend-unconfigured send logs the
 *   recipient under the masked `toEmail` key, never in plaintext.
 * - 55 dynamic error messages: eco-coach / smart-home /
 *   warranty-claims / checkout / portal / geo-click return only
 *   the generic envelope; the backend detail is logged
 *   server-side, never in the response body.
 * - 11 refresh loadError: sanitizeRefreshStepLoadError returns a
 *   generic string and logs the detail server-side. (Call-site
 *   wiring in the refresh route is left for the coordinator —
 *   the route file is owned by the Wave 2 performance worker.)
 * - 12 referral click dedupe: cookie + code+IP window; a repeat
 *   click does not increment again.
 *
 * Route handlers are hit for real with the Supabase/service
 * boundaries mocked; the logger/Sentry boundaries are real
 * (Sentry capture is mocked, DSN unset, so logApiError is a
 * structured log line only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  supabaseClient: null as unknown,
  serviceClient: null as unknown,
  stripeClient: null as unknown,
  saveEcoBudget: vi.fn(),
  createSmartHomeRule: vi.fn(),
  trackWarrantyClaim: vi.fn(),
  createCheckoutSession: vi.fn(),
  createCustomerPortalSession: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

vi.mock('@/lib/api/middleware', () => ({
  logApiRequest: () => {},
  rateLimitResponse: async () => null,
  getClientIp: (request: NextRequest) =>
    request.headers.get('x-real-ip') ?? '127.0.0.1',
  requireAuth: async () => ({ userId: 'user-1' }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => mocks.supabaseClient,
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => mocks.serviceClient,
}));

vi.mock('@/lib/stripe', () => ({
  getStripe: () => mocks.stripeClient,
  isStripeLiveModeBlocked: () => false,
  isStripeLiveMode: () => false,
  isStripeLiveLaunchApproved: () => false,
}));

vi.mock('@/services/stripe', () => ({
  createCheckoutSession: mocks.createCheckoutSession,
  createCustomerPortalSession: mocks.createCustomerPortalSession,
  isStripeConfigured: () => true,
}));

vi.mock('@/lib/eco-coach', () => ({
  budgetStatus: () => null,
  currentMonth: () => '2026-11',
  getCoachNoteForProduct: async () => null,
  getEcoBudget: async () => ({ budget: null, enabled: false }),
  getMonthlyCarbonSpend: async () => ({ totalKg: 0, purchaseCount: 0 }),
  isValidMonth: (m: unknown) =>
    typeof m === 'string' && /^\d{4}-\d{2}$/.test(m),
  normalizeBudgetKg: (v: unknown) =>
    typeof v === 'number' && v > 0 ? v : null,
  saveEcoBudget: mocks.saveEcoBudget,
}));

vi.mock('@/lib/smart-home-agent', () => ({
  createSmartHomeRule: mocks.createSmartHomeRule,
  getPendingConfirmations: async () => [],
  getSmartHomeRules: async () => ({ rules: [], enabled: false }),
  isValidDeviceLabel: (v: unknown) =>
    typeof v === 'string' && v.length >= 1 && v.length <= 100,
  isValidProductSlug: (v: unknown) =>
    typeof v === 'string' && /^[a-z0-9-]+$/.test(v),
  isValidTrigger: (v: unknown) =>
    typeof v === 'string' && v.length >= 1 && v.length <= 80,
}));

vi.mock('@/lib/warranty-claim-helper', () => ({
  getVaultItemsForClaims: async () => ({ items: [], enabled: false }),
  getWarrantyClaims: async () => ({ claims: [], enabled: false }),
  isValidClaimStatus: () => true,
  trackWarrantyClaim: mocks.trackWarrantyClaim,
}));

vi.mock('@/services/affiliate-geo', () => ({
  isTrackableClickHost: () => true,
  resolveGeoCountryOrNull: () => null,
}));

vi.mock('@/lib/stores', () => ({
  LOCAL_STORES: [],
  GLOBAL_STORES: [],
}));

import { checkHealth } from '@/services/health';
import { GET as healthGET } from '@/app/api/v1/health/route';
import { GET as uptimeGET } from '@/app/api/v1/monitoring/uptime/route';
import { GET as incidentsGET } from '@/app/api/v1/monitoring/incidents/route';
import { POST as referralClickPOST } from '@/app/api/v1/referrals/click/route';
import { POST as geoClickPOST } from '@/app/api/v1/affiliate/geo-click/route';
import { POST as ecoCoachPOST } from '@/app/api/v1/tools/eco-coach/route';
import { POST as smartHomePOST } from '@/app/api/v1/tools/smart-home/route';
import { POST as warrantyPOST } from '@/app/api/v1/tools/warranty-claims/route';
import { POST as checkoutPOST } from '@/app/api/v1/subscriptions/checkout/route';
import { POST as portalPOST } from '@/app/api/v1/subscriptions/portal/route';
import { sendEmail } from '@/services/email';
import { env } from '@/lib/config/env';
import {
  sanitizeRefreshStepLoadError,
  REFRESH_STEP_LOAD_ERROR_MESSAGE,
} from '@/services/refresh-run';
import {
  REFERRAL_CLICK_DEDUPE_WINDOW_MS,
  clearReferralClickDedupe,
  isDuplicateReferralClick,
  recordReferralClickDedupe,
  referralClickCookieName,
} from '@/lib/referral-dedupe';

// --- fakes ---------------------------------------------------------------

function healthSupabase({
  dbError = null as { message: string } | null,
  user = { id: 'user-1' } as { id: string } | null,
  authError = null as { message: string } | null,
} = {}) {
  return {
    from: () => ({
      select: () => ({
        limit: async () =>
          dbError ? { error: dbError } : { error: null, data: [{ id: 'p1' }] },
      }),
    }),
    auth: {
      getUser: async () => ({ data: { user }, error: authError }),
    },
  };
}

function monitoringSupabase(
  checks: { data: unknown[] | null; error: { message: string; code?: string } | null },
  incidents: { data: unknown[] | null; error: { message: string; code?: string } | null }
) {
  return {
    from: (table: string) => ({
      select: () => ({
        order: () => ({
          limit: async () =>
            table === 'uptime_checks' ? checks : incidents,
        }),
      }),
    }),
  };
}

function referralService() {
  const calls = { inserts: 0, updates: 0 };
  return {
    calls,
    client: {
      from: (table: string) => {
        if (table === 'referral_links') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'link-1', click_count: 5 },
                }),
              }),
            }),
            update: () => ({
              eq: async () => {
                calls.updates += 1;
                return { error: null };
              },
            }),
          };
        }
        if (table === 'referral_clicks') {
          return {
            insert: async () => {
              calls.inserts += 1;
              return { error: null };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
  };
}

function postRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// --- item 48: health honesty -------------------------------------------

describe('item 48 — health honesty (audit §1 #33)', () => {
  let savedStripeKey: string | undefined;

  beforeEach(() => {
    savedStripeKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    mocks.stripeClient = null;
  });

  afterEach(() => {
    if (savedStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedStripeKey;
    mocks.stripeClient = null;
  });

  it('healthy when DB + auth are up and Stripe is not configured', async () => {
    const health = await checkHealth(healthSupabase() as never);
    expect(health.status).toBe('healthy');
    expect(health.checks.auth).toEqual({ status: 'up' });
    expect(health.checks.stripe).toEqual({ status: 'not_configured' });
  });

  it('auth is down when getUser returns user:null with no error (anonymous call)', async () => {
    const health = await checkHealth(
      healthSupabase({ user: null }) as never
    );
    expect(health.checks.auth).toEqual({ status: 'down' });
    expect(health.status).toBe('degraded');
  });

  it('auth is down when getUser returns an error', async () => {
    const health = await checkHealth(
      healthSupabase({ authError: { message: 'bad jwt' } }) as never
    );
    expect(health.checks.auth).toEqual({ status: 'down' });
    expect(health.status).toBe('degraded');
  });

  it('Stripe-down counts toward degraded (was excluded)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_health_tests_only';
    mocks.stripeClient = {
      balance: {
        retrieve: async () => {
          throw new Error('stripe unreachable');
        },
      },
    };
    const health = await checkHealth(healthSupabase() as never);
    expect(health.checks.stripe).toEqual({ status: 'down' });
    expect(health.status).toBe('degraded');
  });

  it('all-down is unhealthy', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_health_tests_only';
    mocks.stripeClient = {
      balance: {
        retrieve: async () => {
          throw new Error('stripe unreachable');
        },
      },
    };
    const health = await checkHealth(
      healthSupabase({
        dbError: { message: 'db down' },
        user: null,
        authError: { message: 'auth down' },
      }) as never
    );
    expect(health.status).toBe('unhealthy');
  });

  it('GET /api/v1/health returns 200 when healthy', async () => {
    mocks.supabaseClient = healthSupabase();
    const res = await healthGET(
      new NextRequest('http://localhost/api/v1/health')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('healthy');
  });

  it('GET /api/v1/health returns 503 when degraded (anon auth → down)', async () => {
    mocks.supabaseClient = healthSupabase({ user: null });
    const res = await healthGET(
      new NextRequest('http://localhost/api/v1/health')
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.data.status).toBe('degraded');
  });

  it('GET /api/v1/health returns 503 when unhealthy', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_health_tests_only';
    mocks.stripeClient = {
      balance: {
        retrieve: async () => {
          throw new Error('stripe unreachable');
        },
      },
    };
    mocks.supabaseClient = healthSupabase({
      dbError: { message: 'db down' },
      user: null,
      authError: { message: 'auth down' },
    });
    const res = await healthGET(
      new NextRequest('http://localhost/api/v1/health')
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

// --- item 49: monitoring 503 --------------------------------------------

describe('item 49 — monitoring 503 on DB/table failure (audit §1 #34)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('uptime: empty tables with no error → 200 honest empty summary', async () => {
    mocks.supabaseClient = monitoringSupabase(
      { data: [], error: null },
      { data: [], error: null }
    );
    const res = await uptimeGET(
      new NextRequest('http://localhost/api/v1/monitoring/uptime')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.overall).toBe('unknown');
    expect(body.data.uptime.uptimePercent).toBeNull();
  });

  it('uptime: table-missing error → 503 with a generic message, detail logged server-side', async () => {
    mocks.supabaseClient = monitoringSupabase(
      {
        data: null,
        // A real PostgrestError extends Error — build the fake
        // the same way so logApiError extracts its message.
        error: Object.assign(
          new Error('relation "uptime_checks" does not exist'),
          { code: '42P01' }
        ),
      },
      { data: [], error: null }
    );
    const res = await uptimeGET(
      new NextRequest('http://localhost/api/v1/monitoring/uptime')
    );
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('Monitoring data is unavailable');
    expect(text).not.toContain('uptime_checks');
    expect(errorSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')).toContain(
      'uptime_checks'
    );
  });

  it('uptime: a throw in the handler → 503, not a 200 empty summary', async () => {
    mocks.supabaseClient = {
      from: () => {
        throw new Error('connection refused');
      },
    };
    const res = await uptimeGET(
      new NextRequest('http://localhost/api/v1/monitoring/uptime')
    );
    expect(res.status).toBe(503);
  });

  it('incidents: empty table with no error → 200 with []', async () => {
    mocks.supabaseClient = monitoringSupabase(
      { data: [], error: null },
      { data: [], error: null }
    );
    const res = await incidentsGET(
      new NextRequest('http://localhost/api/v1/monitoring/incidents')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: [] });
  });

  it('incidents: table-missing error → 503, not a 200 with []', async () => {
    mocks.supabaseClient = monitoringSupabase(
      { data: [], error: null },
      {
        data: null,
        // A real PostgrestError extends Error — build the fake
        // the same way so logApiError extracts its message.
        error: Object.assign(
          new Error('relation "uptime_incidents" does not exist'),
          { code: '42P01' }
        ),
      }
    );
    const res = await incidentsGET(
      new NextRequest('http://localhost/api/v1/monitoring/incidents')
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('uptime_incidents');
  });
});

// --- item 51: PII log fix ------------------------------------------------

describe('item 51 — recipient email is masked in logs (audit §1 #36)', () => {
  it('the Resend-unconfigured send logs [REDACTED], never the address', async () => {
    expect(env.resendApiKey).toBeFalsy();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const result = await sendEmail(
        { to: 'customer@example.com', subject: 'Hi', html: '<p>Hi</p>' },
        'welcome'
      );
      expect(result).toEqual({
        success: false,
        error: 'Email provider not configured',
      });
      const logged = infoSpy.mock.calls
        .map((c) => c.map(String).join(' '))
        .join('\n');
      expect(logged).toContain('[REDACTED]');
      expect(logged).not.toContain('customer@example.com');
    } finally {
      infoSpy.mockRestore();
    }
  });
});

// --- item 55: dynamic error messages -------------------------------------

describe('item 55 — no internal message leaks in responses (audit §1 #75)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.supabaseClient = {};
    mocks.saveEcoBudget.mockReset();
    mocks.createSmartHomeRule.mockReset();
    mocks.trackWarrantyClaim.mockReset();
    mocks.createCheckoutSession.mockReset();
    mocks.createCustomerPortalSession.mockReset();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function loggedText() {
    return errorSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
  }

  it('eco-coach POST: backend message logged server-side, generic envelope to the client', async () => {
    mocks.saveEcoBudget.mockResolvedValue({
      error: { code: '42P01', message: 'relation "eco_budgets" does not exist' },
    });
    const res = await ecoCoachPOST(
      postRequest('http://localhost/api/v1/tools/eco-coach', {
        month: '2026-11',
        budgetKg: 50,
      })
    );
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('Failed to save the carbon budget');
    expect(text).not.toContain('eco_budgets');
    expect(loggedText()).toContain('eco_budgets');
  });

  it('smart-home POST: backend message logged server-side, generic envelope to the client', async () => {
    mocks.createSmartHomeRule.mockResolvedValue({
      error: { code: '42P01', message: 'relation "smart_home_rules" does not exist' },
    });
    const res = await smartHomePOST(
      postRequest('http://localhost/api/v1/tools/smart-home', {
        deviceLabel: 'Lamp',
        productSlug: 'test-product',
        trigger: 'low stock',
      })
    );
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('Failed to create the smart-home rule');
    expect(text).not.toContain('smart_home_rules');
    expect(loggedText()).toContain('smart_home_rules');
  });

  it('warranty-claims POST: backend message logged server-side, generic envelope to the client', async () => {
    mocks.trackWarrantyClaim.mockResolvedValue({
      error: { code: '42P01', message: 'relation "warranty_claims" does not exist' },
    });
    const res = await warrantyPOST(
      postRequest('http://localhost/api/v1/tools/warranty-claims', {
        productSlug: 'test-product',
      })
    );
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('Failed to track the warranty claim');
    expect(text).not.toContain('warranty_claims');
    expect(loggedText()).toContain('warranty_claims');
  });

  it('checkout POST: Stripe service error logged server-side, generic envelope to the client', async () => {
    mocks.supabaseClient = {
      auth: {
        getUser: async () => ({ data: { user: { email: 'buyer@example.com' } } }),
      },
    };
    mocks.createCheckoutSession.mockResolvedValue({
      error: 'Stripe blew up on price_123 in table subscriptions',
    });
    const res = await checkoutPOST(
      postRequest('http://localhost/api/v1/subscriptions/checkout', {
        plan: 'premium',
      })
    );
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('Failed to create checkout session');
    expect(text).not.toContain('price_123');
    expect(text).not.toContain('subscriptions');
    expect(loggedText()).toContain('price_123');
  });

  it('portal POST: Stripe service error logged server-side, generic envelope to the client', async () => {
    mocks.supabaseClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { stripe_customer_id: 'cus_1' },
              error: null,
            }),
          }),
        }),
      }),
    };
    mocks.createCustomerPortalSession.mockResolvedValue({
      error: 'portal exploded for cus_1',
    });
    const res = await portalPOST(
      postRequest('http://localhost/api/v1/subscriptions/portal', {})
    );
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('Failed to create portal session');
    expect(text).not.toContain('cus_1');
    expect(loggedText()).toContain('cus_1');
  });

  it('geo-click: insert error stays in the server log; the beacon still answers success', async () => {
    mocks.serviceClient = {
      from: () => ({
        insert: async () => ({
          error: {
            code: '42P01',
            message: 'relation "affiliate_geo_clicks" does not exist',
          },
        }),
      }),
    };
    const res = await geoClickPOST(
      postRequest('http://localhost/api/v1/affiliate/geo-click', {
        targetUrl: 'https://example.com/product',
        productSlug: 'test-product',
        retailerName: 'Example',
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { tracked: false } });
    expect(JSON.stringify(body)).not.toContain('affiliate_geo_clicks');
    expect(loggedText()).toContain('affiliate_geo_clicks');
  });
});

// --- item 11: refresh loadError generic -----------------------------------

describe('item 11 — refresh step loadError is generic (audit §1 #58)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function warnedText() {
    return warnSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
  }

  it('a raw PostgREST error becomes the generic message', () => {
    const out = sanitizeRefreshStepLoadError('merchant_products', {
      code: '42P01',
      message: 'relation "merchant_products" does not exist',
    });
    expect(out).toBe(REFRESH_STEP_LOAD_ERROR_MESSAGE);
    expect(out).toBe('Failed to load step data');
    expect(out).not.toContain('merchant_products');
    expect(out).not.toContain('42P01');
  });

  it('an Error instance becomes the generic message', () => {
    const out = sanitizeRefreshStepLoadError(
      'alerts',
      new Error('column "product_id" does not exist')
    );
    expect(out).toBe('Failed to load step data');
    expect(out).not.toContain('product_id');
  });

  it('a missing-rows error becomes the generic message', () => {
    expect(sanitizeRefreshStepLoadError('availability_history', null)).toBe(
      'Failed to load step data'
    );
  });

  it('the detail is still logged server-side', () => {
    sanitizeRefreshStepLoadError('merchant_products', {
      code: '42P01',
      message: 'relation "merchant_products" does not exist',
    });
    expect(warnedText()).toContain('merchant_products');
    expect(warnedText()).toContain('42P01');
  });

  it('the refresh route wires the helper at all four loadError sites (no raw table/column text)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'app/api/v1/prices/refresh/route.ts'),
      'utf8'
    );
    expect(src).toContain('sanitizeRefreshStepLoadError(table, error)');
    expect(src).toContain('sanitizeRefreshStepLoadError(table, err)');
    expect(src).toContain("sanitizeRefreshStepLoadError('merchant_products', merchantError)");
    expect(src).toContain(
      "sanitizeRefreshStepLoadError('availability_history', historyError)"
    );
    // No raw Supabase error text may reach a loadError assignment.
    expect(src).not.toContain('`${table}: ${error.message}`');
    expect(src).not.toContain('`${table}: ${String(err)}`');
    expect(src).not.toContain('`merchant_products:');
    expect(src).not.toContain('`availability_history:');
  });
});

// --- item 12: referral click dedupe ---------------------------------------

describe('item 12 — referral click dedupe (audit §1 #59)', () => {
  const CODE = 'sb-abcdefghij';
  const IP = '203.0.113.10';

  beforeEach(() => {
    clearReferralClickDedupe();
    mocks.serviceClient = referralService().client;
  });

  it('code+IP window: first click counts, a repeat inside the window does not', () => {
    const now = 1_000_000;
    expect(isDuplicateReferralClick(CODE, IP, false, now)).toBe(false);
    recordReferralClickDedupe(CODE, IP, now);
    expect(isDuplicateReferralClick(CODE, IP, false, now + 60_000)).toBe(true);
    expect(
      isDuplicateReferralClick(
        CODE,
        IP,
        false,
        now + REFERRAL_CLICK_DEDUPE_WINDOW_MS + 1
      )
    ).toBe(false);
  });

  it('the dedupe cookie alone marks a repeat click as a duplicate', () => {
    expect(isDuplicateReferralClick(CODE, IP, true)).toBe(true);
    expect(isDuplicateReferralClick(CODE, '203.0.113.99', false)).toBe(false);
  });

  it('route: first click tracks and sets the dedupe cookie', async () => {
    const svc = referralService();
    mocks.serviceClient = svc.client;
    const res = await referralClickPOST(
      postRequest(
        'http://localhost/api/v1/referrals/click',
        { code: CODE },
        { 'x-real-ip': IP }
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { tracked: true } });
    expect(svc.calls.inserts).toBe(1);
    expect(svc.calls.updates).toBe(1);
    expect(res.cookies.get(referralClickCookieName(CODE))?.value).toBe('1');
  });

  it('route: same code+IP without the cookie does not increment again', async () => {
    const svc = referralService();
    mocks.serviceClient = svc.client;
    const first = await referralClickPOST(
      postRequest(
        'http://localhost/api/v1/referrals/click',
        { code: CODE },
        { 'x-real-ip': IP }
      )
    );
    expect((await first.json()).data.tracked).toBe(true);
    const second = await referralClickPOST(
      postRequest(
        'http://localhost/api/v1/referrals/click',
        { code: CODE },
        { 'x-real-ip': IP }
      )
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      success: true,
      data: { tracked: false },
    });
    expect(svc.calls.inserts).toBe(1);
  });

  it('route: the dedupe cookie alone blocks a repeat click', async () => {
    const svc = referralService();
    mocks.serviceClient = svc.client;
    const res = await referralClickPOST(
      postRequest(
        'http://localhost/api/v1/referrals/click',
        { code: CODE },
        {
          'x-real-ip': IP,
          Cookie: `${referralClickCookieName(CODE)}=1`,
        }
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { tracked: false },
    });
    expect(svc.calls.inserts).toBe(0);
  });

  it('route: a different IP (no cookie) still tracks', async () => {
    const svc = referralService();
    mocks.serviceClient = svc.client;
    const res = await referralClickPOST(
      postRequest(
        'http://localhost/api/v1/referrals/click',
        { code: CODE },
        { 'x-real-ip': '203.0.113.55' }
      )
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.tracked).toBe(true);
    expect(svc.calls.inserts).toBe(1);
  });
});
