/**
 * AI admin control-center route tests (Section 19, Phase 7, §12 #71).
 *
 * GET /api/v1/admin/ai — the REAL requireAdmin runs (mocked Supabase
 * boundary only, same pattern as tests/require-admin-deny.test.ts);
 * the Phase 1 engine surface is stubbed at the providers/usage
 * module boundary so the test never spends quota or imports the
 * full adapter tree. The accuracy + error reads run for real
 * against the fake service client.
 *
 * Contract under test:
 *   unsigned user            → 401
 *   signed-in non-admin user → 403
 *   signed-in admin user     → 200 with { providers, usage, accuracy, errors }
 *   tables missing (032/048 unapplied) → accuracy/errors report
 *     tableMissing instead of failing the response.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/admin/ai/route';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { roles?: { name?: string | null } } | null,
  outcomes: { data: [] as Array<Record<string, unknown>>, error: null as { code?: string; message?: string } | null },
  errorLog: { data: [] as Array<Record<string, unknown>>, error: null as { code?: string; message?: string } | null },
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: state.profile, error: null }),
            }),
          }),
        };
      }
      if (table === 'prediction_outcomes') {
        return {
          select: () => ({
            order: () => ({
              limit: async () => state.outcomes,
            }),
          }),
        };
      }
      // error_log
      return {
        select: () => ({
          order: () => ({
            limit: async () => state.errorLog,
          }),
        }),
      };
    },
  }),
}));

vi.mock('@/services/ai-engine/providers', () => ({
  getAiEngine: () => ({
    validate: () => [
      {
        key: 'deterministic-summary',
        name: 'Deterministic summary',
        kind: 'deterministic',
        capabilities: ['summarize'],
        available: true,
        status: 'available',
        detail: 'Deterministic template over recorded data — always available.',
      },
      {
        key: 'serpapi',
        name: 'SerpAPI',
        kind: 'live',
        capabilities: ['web-search'],
        available: false,
        status: 'disabled',
        detail: 'Not configured — no key set; calls fall back honestly and spend no quota.',
      },
    ],
  }),
}));

vi.mock('@/services/ai-engine/usage', () => ({
  // Section 21–25, Stage J, J-P2-6 — the route reads the async
  // summary (shared budgets when Upstash is configured, memory
  // fallback otherwise); the mock provides both shapes.
  getAiUsageSummary: () => ({
    generatedAt: '2026-11-12T23:00:00.000Z',
    note: 'In-memory per-instance counters (reset on deploy; not shared across instances).',
    providers: [],
    capabilities: [],
    budgets: [{ key: 'serpapi', used: 0, budget: 5, remaining: 5, exhausted: false }],
  }),
  getAiUsageSummaryAsync: async () => ({
    generatedAt: '2026-11-12T23:00:00.000Z',
    note: 'In-memory per-instance counters (reset on deploy; not shared across instances).',
    providers: [],
    capabilities: [],
    budgets: [{ key: 'serpapi', used: 0, budget: 5, remaining: 5, exhausted: false }],
  }),
}));

function adminAiRequest() {
  return new NextRequest('http://localhost/api/v1/admin/ai', { method: 'GET' });
}

describe('GET /api/v1/admin/ai (§12 #71)', () => {
  beforeEach(() => {
    state.user = null;
    state.profile = null;
    state.outcomes = { data: [], error: null };
    state.errorLog = { data: [], error: null };
  });

  it('unsigned user → 401', async () => {
    const res = await GET(adminAiRequest());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('signed-in non-admin user → 403', async () => {
    state.user = { id: 'user-regular-1' };
    state.profile = { roles: { name: 'user' } };
    const res = await GET(adminAiRequest());
    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('admin → 200 with providers, usage, accuracy and errors shape', async () => {
    state.user = { id: 'user-admin-1' };
    state.profile = { roles: { name: 'admin' } };
    const res = await GET(adminAiRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        providers: Array<{ key: string; status: string }>;
        usage: { note: string; budgets: Array<{ key: string }> };
        accuracy: { tableMissing: boolean; summary: { resolved: number; accuracyPercent: number | null } };
        errors: { tableMissing: boolean; total: number };
        serviceUnavailable: boolean;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.providers).toHaveLength(2);
    expect(body.data.providers[1]?.status).toBe('disabled');
    expect(body.data.usage.budgets[0]?.key).toBe('serpapi');
    expect(body.data.accuracy.tableMissing).toBe(false);
    expect(body.data.accuracy.summary.accuracyPercent).toBeNull();
    expect(body.data.errors.tableMissing).toBe(false);
    expect(body.data.errors.total).toBe(0);
    expect(body.data.serviceUnavailable).toBe(false);
  });

  it('admin, tables missing (032/048 unapplied) → tableMissing flags, still 200', async () => {
    state.user = { id: 'user-admin-1' };
    state.profile = { roles: { name: 'admin' } };
    state.outcomes = { data: null as unknown as [], error: { code: 'PGRST205', message: 'Could not find the table' } };
    state.errorLog = { data: null as unknown as [], error: { code: '42P01', message: 'relation does not exist' } };
    const res = await GET(adminAiRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        accuracy: { tableMissing: boolean };
        errors: { tableMissing: boolean };
      };
    };
    expect(body.data.accuracy.tableMissing).toBe(true);
    expect(body.data.errors.tableMissing).toBe(true);
  });
});
