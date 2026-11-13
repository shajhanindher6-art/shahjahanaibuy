/**
 * Sections 21–25, Stage G, G-P2-1 — admin-slice validation adoption.
 *
 * Every admin mutation route now runs its body through the shared
 * `validateBody` gate (lib/api/validation.ts) before its own
 * checks. These tests pin, against mocked boundaries (no DB, no
 * network), the real handlers:
 * - an invalid body returns 400 (never 500, never silent accept);
 * - the route's own messages / statuses for SEMANTIC errors are
 *   preserved (e.g. community-deal 'action must be one of…',
 *   specs 422 for an unknown key, products 422 for an unknown
 *   field — the gate only rejects TYPE/SHAPE/BOUNDS errors);
 * - valid bodies still succeed (coercible numbers still accepted,
 *   fractional newsletter/ebay limits still floored, not rejected).
 *
 * DELETE /api/v1/admin/products/[id] is deliberately NOT covered
 * here: it takes no body, so there is nothing to validate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  productRow: null as Record<string, unknown> | null,
  merchantRow: null as Record<string, unknown> | null,
  dealRow: null as Record<string, unknown> | null,
  auditInserts: [] as Array<Record<string, unknown>>,
}));

const LAPTOP_PRODUCT = {
  id: 'prod-1',
  name: 'Test Laptop',
  slug: 'test-laptop',
  description: 'A test laptop',
  brand: 'TestBrand',
  category: 'laptop',
  image_url: null,
  gtin: null,
  confidence_score: 50,
  data_freshness: 'stale',
  created_at: '2026-11-02T00:00:00.000Z',
  updated_at: '2026-11-02T00:00:00.000Z',
  status: 'published',
  price_verification_status: 'unverified',
  price_verified_at: null,
};

const MERCHANT_ROW = {
  id: 'm-1',
  name: 'Amazon',
  slug: 'amazon',
  website_url: 'https://amazon.com',
  return_window_days: 30,
  warranty_months: 12,
  reputation_score: 4.5,
  return_policy_url: 'https://amazon.com/returns',
  warranty_policy_url: null,
  policy_verified_at: null,
  policy_verified_by: null,
  is_verified_merchant: false,
  merchant_verified_at: null,
  merchant_verified_until: null,
};

const DEAL_ROW = {
  id: 'deal-1',
  user_id: 'user-1',
  author_name: 'Admin',
  product_id: null,
  product_name: 'Test Deal',
  merchant_id: null,
  merchant_name: null,
  price: 99,
  deal_text: 'Great deal',
  coupon_code: null,
  source_url: null,
  status: 'approved',
  is_verified: false,
  created_at: '2026-11-12T00:00:00.000Z',
};

const CHAIN_METHODS = [
  'select',
  'eq',
  'neq',
  'is',
  'or',
  'order',
  'range',
  'limit',
  'in',
  'lt',
  'lte',
  'gt',
  'gte',
  'update',
  'delete',
] as const;

vi.mock('@/lib/api/middleware', () => ({
  logApiRequest: () => undefined,
  requireAdmin: async () => ({ userId: 'admin-1' }),
  rateLimitResponse: async () => null,
  getClientIp: () => '1.2.3.4',
}));

vi.mock('@/lib/admin-permissions', () => ({
  requirePermission: async () => ({ userId: 'admin-1' }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: [], error: null, count: 0 }),
        single: async () => ({
          data:
            table === 'merchants'
              ? state.merchantRow
              : table === 'community_deals'
                ? state.dealRow
                : table === 'products'
                  ? state.productRow
                  : null,
          error: null,
        }),
        maybeSingle: async () => ({
          data:
            table === 'products'
              ? state.productRow
              : table === 'merchants'
                ? state.merchantRow
                : null,
          error: null,
        }),
        insert: (...args: unknown[]) => {
          if (table === 'admin_audit_logs') {
            state.auditInserts.push(args[0] as Record<string, unknown>);
          }
          return chain;
        },
      };
      for (const method of CHAIN_METHODS) {
        chain[method] = (..._args: unknown[]) => chain;
      }
      return chain;
    },
  }),
}));

vi.mock('@/lib/config/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/admin', () => ({
  recordAdminAction: vi.fn(async () => undefined),
}));

vi.mock('@/services/ai-background-jobs', () => ({
  enqueueAiVisualAnalysis: async () => ({ jobId: 'job-1' }),
}));

vi.mock('@/lib/workers/queue', () => ({
  getJobResult: () => null,
}));

vi.mock('@/services/newsletter-send', () => ({
  clampNewsletterSendLimit: (value: number) =>
    Math.min(500, Math.max(1, Math.floor(value))),
  sendNewsletterToSubscribers: async () => ({
    ok: true,
    sent: 1,
    failed: 0,
    total: 1,
    skippedUnsubscribed: 0,
  }),
}));

vi.mock('@/services/ebay-browse', () => ({
  isEbayConfigured: () => false,
  searchEbayListings: async () => ({ ok: true, listings: [] }),
}));

vi.mock('@/services/ebay-budget', () => ({
  getEbayDailyBudget: async () => ({ used: 0, remaining: 4500, limit: 4500 }),
  reserveEbayDailyCall: async () => ({
    allowed: true,
    used: 1,
    remaining: 4499,
    limit: 4500,
  }),
}));

vi.mock('@/services/ebay-intake', () => ({
  EBAY_INTAKE_SOURCE: 'ebay-browse-api',
  EBAY_MERCHANT_SLUG: 'ebay',
  reviewEbayIntakeRows: () => ({
    review: { valid: 0, issues: [] },
    rows: [],
    ebayDuplicates: [],
    skippedItems: [],
    provenance: {},
  }),
}));

vi.mock('@/app/api/v1/admin/intake/route', () => ({
  loadCatalogContext: async () => ({
    products: [],
    slugs: new Set(),
    gtins: new Set(),
    nameBrandKeys: new Set(),
  }),
}));

vi.mock('@/services/visual-search', () => ({
  isVectorSearchConfigured: () => true,
  embedText: async () => ({ ok: true, value: [] }),
  productEmbeddingText: () => 'test',
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: () => 'event-1',
  captureException: () => 'event-2',
  flush: async () => true,
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

function apiRequest(
  method: string,
  url: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
) {
  return new NextRequest(url, {
    method,
    headers: {
      'x-forwarded-for': '203.0.113.99',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function errorBody(res: Response) {
  const json = (await res.json()) as {
    success: boolean;
    error?: { code?: string; message?: string };
  };
  return json;
}

beforeEach(() => {
  state.productRow = { ...LAPTOP_PRODUCT };
  state.merchantRow = { ...MERCHANT_ROW };
  state.dealRow = { ...DEAL_ROW };
  state.auditInserts = [];
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/ai/jobs
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/ai/jobs — validateBody gate (G-P2-1)', () => {
  it('limit out of range (99) → 400, never 500', async () => {
    const { POST } = await import('@/app/api/v1/admin/ai/jobs/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/ai/jobs', {
        caption: 'a laptop',
        limit: 99,
      }),
    );
    expect(res.status).toBe(400);
    expect((await errorBody(res)).success).toBe(false);
  });

  it('imageUrl of the wrong type → 400', async () => {
    const { POST } = await import('@/app/api/v1/admin/ai/jobs/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/ai/jobs', {
        imageUrl: 123,
      }),
    );
    expect(res.status).toBe(400);
  });

  it('neither imageUrl nor caption → 400 with the route’s own message', async () => {
    const { POST } = await import('@/app/api/v1/admin/ai/jobs/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/ai/jobs', {}),
    );
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error?.message).toContain('Provide a public image URL');
  });

  it('valid caption body still enqueues (202 queued)', async () => {
    const { POST } = await import('@/app/api/v1/admin/ai/jobs/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/ai/jobs', {
        caption: 'a laptop',
      }),
    );
    expect(res.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/community-deals/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/admin/community-deals/[id] — validateBody gate (G-P2-1)', () => {
  it('action of the wrong type (number) → 400', async () => {
    const { PATCH } = await import(
      '@/app/api/v1/admin/community-deals/[id]/route'
    );
    const res = await PATCH(
      apiRequest(
        'PATCH',
        'http://localhost/api/v1/admin/community-deals/deal-1',
        { action: 5 },
      ),
      { params: { id: 'deal-1' } },
    );
    expect(res.status).toBe(400);
  });

  it('unknown string action keeps the route’s own 400 message', async () => {
    const { PATCH } = await import(
      '@/app/api/v1/admin/community-deals/[id]/route'
    );
    const res = await PATCH(
      apiRequest(
        'PATCH',
        'http://localhost/api/v1/admin/community-deals/deal-1',
        { action: 'explode' },
      ),
      { params: { id: 'deal-1' } },
    );
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error?.message).toContain('action must be one of');
  });

  it('valid approve still succeeds (200)', async () => {
    const { PATCH } = await import(
      '@/app/api/v1/admin/community-deals/[id]/route'
    );
    const res = await PATCH(
      apiRequest(
        'PATCH',
        'http://localhost/api/v1/admin/community-deals/deal-1',
        { action: 'approve' },
      ),
      { params: { id: 'deal-1' } },
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/ebay/preview
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/ebay/preview — validateBody gate (G-P2-1)', () => {
  it('limit of the wrong type (string) → 400', async () => {
    const { POST } = await import('@/app/api/v1/admin/ebay/preview/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/ebay/preview', {
        q: 'laptop',
        limit: '5',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('items entry with a non-string itemId → 400', async () => {
    const { POST } = await import('@/app/api/v1/admin/ebay/preview/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/ebay/preview', {
        q: 'laptop',
        items: [{ itemId: 123, brand: 'Acme' }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('missing q keeps the route’s own 400 message', async () => {
    const { POST } = await import('@/app/api/v1/admin/ebay/preview/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/ebay/preview', {}),
    );
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error?.message).toContain('Search query is required');
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/merchants/[slug]/verify
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/merchants/[slug]/verify — validateBody gate (G-P2-1)', () => {
  it('negative returnWindowDays → 400', async () => {
    const { POST } = await import(
      '@/app/api/v1/admin/merchants/[slug]/verify/route'
    );
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/merchants/amazon/verify', {
        action: 'record',
        returnWindowDays: -1,
      }),
      { params: { slug: 'amazon' } },
    );
    expect(res.status).toBe(400);
  });

  it('non-numeric returnWindowDays → 400', async () => {
    const { POST } = await import(
      '@/app/api/v1/admin/merchants/[slug]/verify/route'
    );
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/merchants/amazon/verify', {
        action: 'record',
        returnWindowDays: 'soon',
      }),
      { params: { slug: 'amazon' } },
    );
    expect(res.status).toBe(400);
  });

  it('reputationScore above 5 → 400', async () => {
    const { POST } = await import(
      '@/app/api/v1/admin/merchants/[slug]/verify/route'
    );
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/merchants/amazon/verify', {
        action: 'record',
        reputationScore: 6,
      }),
      { params: { slug: 'amazon' } },
    );
    expect(res.status).toBe(400);
  });

  it('unknown action keeps the route’s own 400 message', async () => {
    const { POST } = await import(
      '@/app/api/v1/admin/merchants/[slug]/verify/route'
    );
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/merchants/amazon/verify', {
        action: 'explode',
      }),
      { params: { slug: 'amazon' } },
    );
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error?.message).toContain('action must be one of');
  });

  it('numeric-string returnWindowDays is still coerced (200 record)', async () => {
    const { POST } = await import(
      '@/app/api/v1/admin/merchants/[slug]/verify/route'
    );
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/merchants/amazon/verify', {
        action: 'record',
        returnWindowDays: '30',
        warrantyMonths: '12',
      }),
      { params: { slug: 'amazon' } },
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/newsletter/send
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/newsletter/send — validateBody gate (G-P2-1)', () => {
  it('limit of the wrong type (string) → 400', async () => {
    const { POST } = await import('@/app/api/v1/admin/newsletter/send/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/newsletter/send', {
        limit: '50',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('fractional limit still succeeds (floored by the clamp, not rejected)', async () => {
    const { POST } = await import('@/app/api/v1/admin/newsletter/send/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/newsletter/send', {
        limit: 2.5,
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/products/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/admin/products/[id] — validateBody gate (G-P2-1)', () => {
  it('name of the wrong type (number) → 400', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/products/[id]/route');
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/admin/products/prod-1', {
        name: 123,
      }),
      { params: { id: 'prod-1' } },
    );
    expect(res.status).toBe(400);
  });

  it('gtin with a bad check digit → 400 (GS1 gate)', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/products/[id]/route');
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/admin/products/prod-1', {
        gtin: '4006381333932',
      }),
      { params: { id: 'prod-1' } },
    );
    expect(res.status).toBe(400);
  });

  it('unknown field still reaches the service → 422 (gate passes the ORIGINAL body, not stripped data)', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/products/[id]/route');
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/admin/products/prod-1', {
        name: 'Renamed',
        bogusField: 'x',
      }),
      { params: { id: 'prod-1' } },
    );
    expect(res.status).toBe(422);
    const body = await errorBody(res);
    expect(body.error?.message).toContain('cannot be edited here');
  });

  it('valid patch still succeeds (200)', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/products/[id]/route');
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/admin/products/prod-1', {
        name: 'Renamed Laptop',
      }),
      { params: { id: 'prod-1' } },
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/products/[id]/specs
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/admin/products/[id]/specs — validateBody gate (G-P2-1)', () => {
  it('entries of the wrong type (string) → 400', async () => {
    const { PATCH } = await import(
      '@/app/api/v1/admin/products/[id]/specs/route'
    );
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/admin/products/prod-1/specs', {
        entries: 'ram: 16GB',
      }),
      { params: { id: 'prod-1' } },
    );
    expect(res.status).toBe(400);
  });

  it('entry with a non-string key → 400', async () => {
    const { PATCH } = await import(
      '@/app/api/v1/admin/products/[id]/specs/route'
    );
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/admin/products/prod-1/specs', {
        entries: [{ key: 42, value: '16' }],
      }),
      { params: { id: 'prod-1' } },
    );
    expect(res.status).toBe(400);
  });

  it('unknown spec key still reaches the service → 422 (not swallowed by the gate)', async () => {
    const { PATCH } = await import(
      '@/app/api/v1/admin/products/[id]/specs/route'
    );
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/admin/products/prod-1/specs', {
        entries: [{ key: 'wingspan', value: '2m' }],
      }),
      { params: { id: 'prod-1' } },
    );
    expect(res.status).toBe(422);
  });

  it('empty correction still → 422 (required-ness stays in the service)', async () => {
    const { PATCH } = await import(
      '@/app/api/v1/admin/products/[id]/specs/route'
    );
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/admin/products/prod-1/specs', {}),
      { params: { id: 'prod-1' } },
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/sentry-test
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/sentry-test — validateBody gate (G-P2-1)', () => {
  const OLD_DSN = process.env.SENTRY_DSN;

  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://test@test.ingest.sentry.io/1';
  });

  afterEach(() => {
    if (OLD_DSN === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = OLD_DSN;
  });

  it('kind of the wrong type (number) → 400', async () => {
    const { POST } = await import('@/app/api/v1/admin/sentry-test/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/sentry-test', {
        kind: 123,
      }),
    );
    expect(res.status).toBe(400);
  });

  it('unknown kind keeps the route’s own 400 message', async () => {
    const { POST } = await import('@/app/api/v1/admin/sentry-test/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/sentry-test', {
        kind: 'smoke',
      }),
    );
    expect(res.status).toBe(400);
    const body = await errorBody(res);
    expect(body.error?.message).toContain('kind must be');
  });

  it('valid kind still sends (200)', async () => {
    const { POST } = await import('@/app/api/v1/admin/sentry-test/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/sentry-test', {
        kind: 'message',
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/visual-search-backfill
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/visual-search-backfill — validateBody gate (G-P2-1)', () => {
  it('force of the wrong type (string) → 400', async () => {
    const { POST } = await import(
      '@/app/api/v1/admin/visual-search-backfill/route'
    );
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/visual-search-backfill', {
        force: 'yes',
      }),
    );
    expect(res.status).toBe(400);
  });
});
