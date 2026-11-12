/**
 * Zod validation on POST /api/v1/subscriptions (Section 17, Stage G,
 * audit §4 #15 — the first app/api caller of lib/api/validation's
 * validateBody).
 *
 * The route used to hand-check the body (`typeof plan !== 'string'`
 * + trim). It now validates against subscriptionUpsertSchema:
 * plan must be a non-empty string, cancelAtPeriodEnd a real boolean
 * when present. The Section 15 self-grant whitelist is untouched:
 * plan 'free' is the only plan a direct upsert may ever set — any
 * other plan still gets 400, with or without Stripe configured.
 *
 * Behaviour notes pinned here: plan is deliberately NOT trimmed, so
 * ' free' still 400s exactly as before; a truthy non-boolean
 * cancelAtPeriodEnd ('yes', 1) now 400s instead of silently acting
 * as "cancel at period end".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';

type SubRow = Record<string, unknown>;

// --- In-memory subscriptions table shared by the mocked clients ---
const fakeDb = vi.hoisted(() => ({
  rows: new Map<string, SubRow>(),
  stripeConfigured: false,
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

vi.mock('@/lib/stripe', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/stripe')>();
  return {
    ...orig,
    isStripeLiveMode: () => false,
    isStripeLiveLaunchApproved: () => false,
  };
});

// Imported after the mocks so the route uses the fakes.
import { POST } from '@/app/api/v1/subscriptions/route';

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

describe('POST /api/v1/subscriptions — Zod body validation', () => {
  beforeEach(() => {
    fakeDb.rows.clear();
    fakeDb.stripeConfigured = false;
  });

  it('rejects a non-string plan (123) with 400 and creates no row', async () => {
    const res = await POST(postRequest({ plan: 123 }));
    expect(res.status).toBe(400);
    expect(fakeDb.rows.size).toBe(0);
  });

  it('rejects a null plan with 400 and creates no row', async () => {
    const res = await POST(postRequest({ plan: null }));
    expect(res.status).toBe(400);
    expect(fakeDb.rows.size).toBe(0);
  });

  it('rejects a missing plan with 400 (existing validation preserved)', async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(fakeDb.rows.size).toBe(0);
  });

  it("rejects a truthy string cancelAtPeriodEnd ('yes') with 400", async () => {
    const res = await POST(postRequest({ plan: 'free', cancelAtPeriodEnd: 'yes' }));
    expect(res.status).toBe(400);
    expect(fakeDb.rows.size).toBe(0);
  });

  it('rejects a numeric cancelAtPeriodEnd (1) with 400', async () => {
    const res = await POST(postRequest({ plan: 'free', cancelAtPeriodEnd: 1 }));
    expect(res.status).toBe(400);
    expect(fakeDb.rows.size).toBe(0);
  });

  it("ignores unknown extra fields and accepts plan 'free'", async () => {
    const res = await POST(postRequest({ plan: 'free', admin: true, tier: 'team' }));
    expect(res.status).toBe(200);
    expect(fakeDb.rows.get('test-user-1')).toMatchObject({ plan: 'free' });
  });

  it("still accepts plan 'free' with a real boolean cancelAtPeriodEnd", async () => {
    const res = await POST(postRequest({ plan: 'free', cancelAtPeriodEnd: false }));
    expect(res.status).toBe(200);
    expect(fakeDb.rows.get('test-user-1')).toMatchObject({
      plan: 'free',
      status: 'canceled',
    });
  });

  it("still rejects plan 'team' with 400 — the self-grant bypass stays closed", async () => {
    const res = await POST(postRequest({ plan: 'team' }));
    expect(res.status).toBe(400);
    expect(fakeDb.rows.size).toBe(0);
  });

  it("still rejects ' free' with 400 — plan is not trimmed", async () => {
    const res = await POST(postRequest({ plan: ' free' }));
    expect(res.status).toBe(400);
    expect(fakeDb.rows.size).toBe(0);
  });
});

describe('subscriptions route validates with the shared Zod helper', () => {
  it('uses validateBody + a Zod object schema, keeping the free-only whitelist', () => {
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
    expect(text).toContain("from '@/lib/api/validation'");
    expect(text).toContain('validateBody(subscriptionUpsertSchema');
    expect(text).toContain('z.object({');
    expect(text).toContain("if (plan !== 'free')");
    expect(text).not.toContain("typeof plan !== 'string'");
  });
});
