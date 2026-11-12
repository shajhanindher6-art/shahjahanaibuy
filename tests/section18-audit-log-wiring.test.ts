/**
 * Section 18, items 14–15 — audit-log wiring + append-only.
 *
 * Item 14: every admin mutation calls `recordAdminAction` (mocked at
 * the services/admin boundary — no live DB). The helper itself never
 * throws (see the `recordAdminAction` describe block, which exercises
 * the REAL helper via importActual against a throwing client), so a
 * logging failure can never fail the admin action.
 * Item 15: migration 017 grants only INSERT on admin_audit_logs —
 * no UPDATE/DELETE policy (SQL-text assertion, the established
 * pattern for migration files here).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const auditSpy = vi.hoisted(() =>
  vi.fn(
    async (
      _supabase: unknown,
      _adminId: string,
      _action: string,
      _targetType: string,
      _targetId: string | null,
      _details: Record<string, unknown> | null,
      _ip: string | null
    ) => undefined
  )
);

const loggerSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const newsletterStub = vi.hoisted(() => ({
  result: {
    ok: true,
    sent: 2,
    failed: 0,
    total: 2,
    skippedUnsubscribed: 0,
  } as Record<string, unknown>,
}));

const fakeDb = vi.hoisted(() => ({
  merchantRow: {
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
  } as Record<string, unknown> | null,
  dealRow: {
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
  } as Record<string, unknown> | null,
  catalogRows: [
    {
      id: 'p-1',
      slug: 'acme-widget',
      name: 'Acme Widget',
      brand: 'Acme',
      description: 'A widget',
    },
    {
      id: 'p-9',
      slug: 'existing-product',
      name: 'Existing Product',
      brand: 'Acme',
      description: 'Already embedded',
    },
  ] as Array<Record<string, unknown>>,
  embeddedIds: ['p-9'] as string[],
  auditInserts: [] as Array<Record<string, unknown>>,
  auditInsertError: null as { message: string } | null,
  client: null as unknown,
}));

vi.mock('@/lib/api/middleware', () => ({
  logApiRequest: () => undefined,
  requireAdmin: async () => ({ userId: 'admin-1' }),
  rateLimitResponse: async () => null,
  getClientIp: () => '1.2.3.4',
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => fakeDb.client,
}));

vi.mock('@/lib/config/logger', () => ({
  logger: loggerSpies,
}));

vi.mock('@/services/admin', () => ({
  recordAdminAction: auditSpy,
}));

vi.mock('@/services/newsletter-send', () => ({
  sendNewsletterToSubscribers: async () => newsletterStub.result,
}));

vi.mock('@/services/visual-search', () => ({
  isVectorSearchConfigured: () => true,
  embedText: async () => ({ ok: true, value: [0.1, 0.2] }),
  productEmbeddingText: () => 'MacBook Air 13 Apple Light laptop',
}));

vi.mock('@/lib/price-accuracy', () => ({
  accuracyScore: () => ({
    score: null,
    sampleCount: 0,
    matchCount: 0,
    mismatchCount: 0,
    caution: false,
    insufficientSamples: true,
    status: 'insufficient',
  }),
  getAccuracySamples: async () => [],
}));

vi.mock('@/lib/merchant-trust', () => ({
  computeTrustGrade: () => ({
    grade: null,
    score: null,
    missing: ['returnWindowDays', 'warrantyMonths', 'reputationScore'],
    breakdown: null,
    reasons: ['Not enough data'],
  }),
}));

vi.mock('@/lib/verified-merchants', () => ({
  VERIFIED_MERCHANT_RECHECK_DAYS: 90,
  meetsVerifiedMerchantStandards: () => ({
    eligible: false,
    unmet: ['Price accuracy: no checkout audits recorded yet.'],
  }),
}));

function buildFakeService() {
  const makeBuilder = (table: string) => {
    const state: {
      inserted: Record<string, unknown> | null;
      updated: Record<string, unknown> | null;
      upserted: Record<string, unknown> | null;
    } = { inserted: null, updated: null, upserted: null };
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.is = () => chain;
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.insert = (payload: Record<string, unknown>) => {
      state.inserted = payload;
      return chain;
    };
    chain.update = (payload: Record<string, unknown>) => {
      state.updated = payload;
      return chain;
    };
    chain.upsert = (payload: Record<string, unknown>) => {
      state.upserted = payload;
      return chain;
    };
    chain.delete = () => chain;
    chain.maybeSingle = async () => {
      if (table === 'merchants') return { data: fakeDb.merchantRow, error: null };
      return { data: null, error: null };
    };
    chain.single = async () => {
      if (state.inserted) {
        if (table === 'products') return { data: { id: 'p-1' }, error: null };
        if (table === 'admin_audit_logs') {
          return { data: null, error: fakeDb.auditInsertError };
        }
        return { data: null, error: null };
      }
      if (state.updated) {
        if (table === 'merchants') return { data: fakeDb.merchantRow, error: null };
        if (table === 'community_deals') return { data: fakeDb.dealRow, error: null };
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };
    chain.then = (resolve: (v: unknown) => void) => {
      if (state.inserted) {
        if (table === 'admin_audit_logs') {
          if (fakeDb.auditInsertError) {
            resolve({ data: null, error: fakeDb.auditInsertError });
            return;
          }
          fakeDb.auditInserts.push(state.inserted);
        }
        resolve({ data: null, error: null });
        return;
      }
      if (state.upserted) {
        resolve({ data: null, error: null });
        return;
      }
      if (state.updated) {
        resolve({ data: null, error: null });
        return;
      }
      if (table === 'products') {
        resolve({ data: fakeDb.catalogRows, error: null });
        return;
      }
      if (table === 'product_embeddings') {
        resolve({
          data: fakeDb.embeddedIds.map((id) => ({ product_id: id })),
          error: null,
        });
        return;
      }
      if (table === 'merchants') {
        resolve({ data: [{ id: 'm-1', slug: 'amazon', name: 'Amazon' }], error: null });
        return;
      }
      if (table === 'currencies') {
        resolve({ data: [{ id: 'c-1', code: 'USD' }], error: null });
        return;
      }
      resolve({ data: [], error: null });
    };
    return chain;
  };
  return { from: (table: string) => makeBuilder(table) };
}

fakeDb.client = buildFakeService() as never;

function apiRequest(method: string, url: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  auditSpy.mockClear();
  loggerSpies.error.mockClear();
  loggerSpies.warn.mockClear();
  fakeDb.auditInserts = [];
  fakeDb.auditInsertError = null;
  fakeDb.embeddedIds = ['p-9'];
  newsletterStub.result = {
    ok: true,
    sent: 2,
    failed: 0,
    total: 2,
    skippedUnsubscribed: 0,
  };
});

// ---------------------------------------------------------------------------
// Item 14 — merchants verify
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/merchants/[slug]/verify — audit wiring', () => {
  it("logs 'record' with the recorded fields", async () => {
    const { POST } = await import('@/app/api/v1/admin/merchants/[slug]/verify/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/merchants/amazon/verify', {
        action: 'record',
        returnWindowDays: 30,
        warrantyMonths: 12,
      }),
      { params: { slug: 'amazon' } }
    );
    expect(res.status).toBe(200);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const call = auditSpy.mock.calls[0] as unknown[];
    expect(call[1]).toBe('admin-1');
    expect(call[2]).toBe('merchant_verify_record');
    expect(call[3]).toBe('merchant');
    expect(call[4]).toBe('m-1');
    expect(call[5]).toMatchObject({ slug: 'amazon', action: 'record' });
    expect(call[6]).toBe('1.2.3.4');
  });

  it("logs 'revoke'", async () => {
    const { POST } = await import('@/app/api/v1/admin/merchants/[slug]/verify/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/merchants/amazon/verify', {
        action: 'revoke',
      }),
      { params: { slug: 'amazon' } }
    );
    expect(res.status).toBe(200);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0]?.[2]).toBe('merchant_verify_revoke');
  });

  it("logs a 'verify' attempt even when the badge is not granted", async () => {
    const { POST } = await import('@/app/api/v1/admin/merchants/[slug]/verify/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/merchants/amazon/verify', {
        action: 'verify',
        returnWindowDays: 30,
      }),
      { params: { slug: 'amazon' } }
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect((json.data as Record<string, unknown>).verified).toBe(false);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0]?.[2]).toBe('merchant_verify_attempt');
    expect(auditSpy.mock.calls[0]?.[5]).toMatchObject({ verified: false });
  });
});

// ---------------------------------------------------------------------------
// Item 14 — community-deals moderation
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/admin/community-deals/[id] — audit wiring', () => {
  it('logs approve with the applied patch', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/community-deals/[id]/route');
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/admin/community-deals/deal-1', {
        action: 'approve',
      }),
      { params: { id: 'deal-1' } }
    );
    expect(res.status).toBe(200);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const call = auditSpy.mock.calls[0] as unknown[];
    expect(call[1]).toBe('admin-1');
    expect(call[2]).toBe('community_deal_moderate');
    expect(call[3]).toBe('community_deal');
    expect(call[4]).toBe('deal-1');
    expect(call[5]).toMatchObject({ action: 'approve', status: 'approved' });
    expect(call[6]).toBe('1.2.3.4');
  });

  it('logs reject with the applied patch', async () => {
    const { PATCH } = await import('@/app/api/v1/admin/community-deals/[id]/route');
    const res = await PATCH(
      apiRequest('PATCH', 'http://localhost/api/v1/admin/community-deals/deal-1', {
        action: 'reject',
      }),
      { params: { id: 'deal-1' } }
    );
    expect(res.status).toBe(200);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0]?.[2]).toBe('community_deal_moderate');
    expect(auditSpy.mock.calls[0]?.[5]).toMatchObject({ action: 'reject', status: 'rejected' });
  });
});

// ---------------------------------------------------------------------------
// Item 14 — newsletter send
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/newsletter/send — audit wiring', () => {
  it('logs a successful send run with the honest counts', async () => {
    const { POST } = await import('@/app/api/v1/admin/newsletter/send/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/newsletter/send', { limit: 50 })
    );
    expect(res.status).toBe(200);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const call = auditSpy.mock.calls[0] as unknown[];
    expect(call[1]).toBe('admin-1');
    expect(call[2]).toBe('newsletter_send');
    expect(call[3]).toBe('newsletter');
    expect(call[4]).toBeNull();
    expect(call[5]).toMatchObject({ sent: 2, failed: 0, total: 2, ok: true });
  });

  it('logs a partial send (send-failed) — the run happened', async () => {
    newsletterStub.result = {
      ok: false,
      reason: 'send-failed',
      sent: 1,
      failed: 1,
      total: 2,
      skippedUnsubscribed: 0,
    };
    const { POST } = await import('@/app/api/v1/admin/newsletter/send/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/newsletter/send', {})
    );
    expect(res.status).toBe(200);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0]?.[5]).toMatchObject({
      sent: 1,
      failed: 1,
      reason: 'send-failed',
    });
  });

  it('does NOT log load-failed — no send was attempted', async () => {
    newsletterStub.result = {
      ok: false,
      reason: 'load-failed',
      sent: 0,
      failed: 0,
      total: 0,
      skippedUnsubscribed: 0,
    };
    const { POST } = await import('@/app/api/v1/admin/newsletter/send/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/newsletter/send', {})
    );
    expect(res.status).toBe(200);
    expect(auditSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Item 14 — visual-search backfill
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/visual-search-backfill — audit wiring', () => {
  it('logs the backfill run once, with embedded/failed counts', async () => {
    const { POST } = await import('@/app/api/v1/admin/visual-search-backfill/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/visual-search-backfill', {})
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect((json.data as Record<string, unknown>).embedded).toBe(1);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const call = auditSpy.mock.calls[0] as unknown[];
    expect(call[1]).toBe('admin-1');
    expect(call[2]).toBe('visual_search_backfill');
    expect(call[3]).toBe('product_embeddings');
    expect(call[4]).toBeNull();
    expect(call[5]).toMatchObject({ total: 2, alreadyEmbedded: 1, embedded: 1, failed: 0 });
  });
});

// ---------------------------------------------------------------------------
// Item 14 — intake: audit-insert failure is visible via the logger,
// while the request still succeeds (behaviour unchanged).
// ---------------------------------------------------------------------------

describe('POST /api/v1/admin/intake approve — audit loss is visible', () => {
  it('still returns 200 with the insert, but logs the audit failure', async () => {
    fakeDb.auditInsertError = { message: 'audit insert boom' };
    const { POST } = await import('@/app/api/v1/admin/intake/route');
    const res = await POST(
      apiRequest('POST', 'http://localhost/api/v1/admin/intake', {
        action: 'approve',
        rows: [
          {
            rowNumber: 2,
            name: 'MacBook Air 13',
            slug: 'macbook-air-13',
            brand: 'Apple',
            category: 'Laptops',
            price: '999',
            currency: 'USD',
            merchant: 'amazon',
          },
        ],
        includeRowNumbers: [],
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect((json.data as Record<string, unknown>).inserted).toEqual(['macbook-air-13']);
    expect(loggerSpies.error).toHaveBeenCalledWith(
      'catalog intake: audit log insert failed',
      expect.objectContaining({ source: 'manual-intake', insertedCount: 1 })
    );
  });
});

// ---------------------------------------------------------------------------
// Item 14 — the helper itself never throws (real implementation).
// ---------------------------------------------------------------------------

describe('recordAdminAction — never breaks the caller', () => {
  it('resolves (never throws) when the insert throws, and logs it', async () => {
    const actual = await vi.importActual<typeof import('@/services/admin')>(
      '@/services/admin'
    );
    const throwingClient = {
      from: () => ({
        insert: () => {
          throw new Error('db down');
        },
      }),
    };
    await expect(
      actual.recordAdminAction(
        throwingClient as never,
        'admin-1',
        'test_action',
        'merchant',
        'm-1',
        null,
        '1.2.3.4'
      )
    ).resolves.toBeUndefined();
    expect(loggerSpies.error).toHaveBeenCalledWith(
      'recordAdminAction: unexpected error',
      expect.objectContaining({ error: expect.stringContaining('db down') })
    );
  });
});

// ---------------------------------------------------------------------------
// Item 15 — migration 017: admin_audit_logs is append-only.
// ---------------------------------------------------------------------------

describe('migration 017 — audit log append-only (SQL text)', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261105190000_017_admin_only_catalog_writes.sql'),
    'utf8'
  );

  it('grants only INSERT on admin_audit_logs', () => {
    expect(sql).toContain('CREATE POLICY insert_admin_audit_logs');
  });

  it('has NO UPDATE or DELETE policy on admin_audit_logs', () => {
    expect(sql).not.toContain('CREATE POLICY update_admin_audit_logs');
    expect(sql).not.toContain('CREATE POLICY delete_admin_audit_logs');
  });

  it('still drops any pre-existing UPDATE/DELETE policies on re-apply', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS update_admin_audit_logs ON admin_audit_logs');
    expect(sql).toContain('DROP POLICY IF EXISTS delete_admin_audit_logs ON admin_audit_logs');
  });

  it('documents the append-only intent in the file', () => {
    expect(sql).toMatch(/APPEND-ONLY/i);
  });
});
