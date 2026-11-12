/**
 * Digest / process endpoint tests (Section 15, P4-2) + source
 * locks for the rest of W5A (P4-5, P4-6, P2-5 stragglers).
 *
 * Route tests mock the service-role client and the notification
 * services; no DB, no network. Asserts the endpoints run on the
 * service client (never the anon-key server client), count only
 * stored digests, and match the canonical 'premium' plan with
 * legacy 'pro' compat.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';

const fakeDb = vi.hoisted(() => ({
  subs: [] as Array<{ user_id: string }>,
  inArgs: [] as unknown[],
  noServiceClient: false,
  generateResults: new Map<string, unknown>(),
  processResult: { processed: 3, sent: 2, failed: 1 },
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => {
    if (fakeDb.noServiceClient) return null;
    return {
      from: (table: string) => {
        if (table !== 'subscriptions') {
          throw new Error(`unexpected table ${table}`);
        }
        const chain: Record<string, unknown> = {
          select: () => chain,
          in: (_col: string, values: unknown[]) => {
            fakeDb.inArgs.push(values);
            return chain;
          },
          eq: () => chain,
          then: (resolve: (value: unknown) => void) => {
            resolve({ data: fakeDb.subs, error: null });
          },
        };
        return chain;
      },
    };
  },
}));

vi.mock('@/services/notifications', () => ({
  DIGEST_PLANS: ['premium', 'pro'],
  generateWeeklyDigest: async (_supabase: unknown, userId: string) => {
    if (!fakeDb.generateResults.has(userId)) return { topDeals: [], priceDrops: [], searchSummary: [] };
    return fakeDb.generateResults.get(userId);
  },
}));

vi.mock('@/services/notification-dispatch', () => ({
  processNotificationQueue: async () => fakeDb.processResult,
}));

// Imported after the mocks so the routes use the fake clients.
import { POST as digestPOST } from '@/app/api/v1/notifications/digest/route';
import { POST as processPOST } from '@/app/api/v1/notifications/process/route';

const CRON_SECRET = 'test-cron-secret';

let ipCounter = 0;
function authedRequest(path: string) {
  ipCounter += 1;
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
      'x-forwarded-for': `203.0.113.${ipCounter}`,
    },
  });
}

function readSource(rel: string): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', rel),
    'utf8'
  );
}

describe('POST /api/v1/notifications/digest (P4-2)', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    fakeDb.subs = [{ user_id: 'u1' }, { user_id: 'u2' }];
    fakeDb.inArgs = [];
    fakeDb.noServiceClient = false;
    fakeDb.generateResults = new Map([
      ['u1', { topDeals: [], priceDrops: [], searchSummary: [] }],
      ['u2', null],
    ]);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('counts only stored digests and reports failures', async () => {
    const res = await digestPOST(authedRequest('/api/v1/notifications/digest'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.generated).toBe(1);
    expect(body.data.failed).toBe(1);
    expect(body.data.total).toBe(2);
  });

  it('matches premium with legacy pro compat (never pro-only)', async () => {
    await digestPOST(authedRequest('/api/v1/notifications/digest'));
    expect(fakeDb.inArgs).toHaveLength(1);
    expect(fakeDb.inArgs[0]).toEqual(['premium', 'pro']);
  });

  it('fails closed without CRON_SECRET and on a wrong secret', async () => {
    delete process.env.CRON_SECRET;
    const noSecret = await digestPOST(authedRequest('/api/v1/notifications/digest'));
    expect(noSecret.status).toBe(500);

    process.env.CRON_SECRET = CRON_SECRET;
    ipCounter += 1;
    const wrong = new NextRequest('http://localhost/api/v1/notifications/digest', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wrong',
        'x-forwarded-for': `203.0.113.${ipCounter}`,
      },
    });
    expect((await digestPOST(wrong)).status).toBe(401);
  });

  it('fails fast without the service-role key instead of silently generating zero', async () => {
    fakeDb.noServiceClient = true;
    const res = await digestPOST(authedRequest('/api/v1/notifications/digest'));
    expect(res.status).toBe(500);
    expect((await res.json()).error.message).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('runs on the service client, is force-dynamic, and has no pro-only filter', () => {
    const text = readSource('app/api/v1/notifications/digest/route.ts');
    expect(text).toContain('createSupabaseServiceClient');
    expect(text).not.toContain('createSupabaseServerClient');
    expect(text).toContain("export const dynamic = 'force-dynamic'");
    expect(text).not.toContain(".eq('plan', 'pro')");
    expect(text).toContain('DIGEST_PLANS');
  });
});

describe('POST /api/v1/notifications/process (P4-2)', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
    fakeDb.noServiceClient = false;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('drains the queue through the service client and returns its result', async () => {
    const res = await processPOST(authedRequest('/api/v1/notifications/process'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ processed: 3, sent: 2, failed: 1 });
  });

  it('fails fast without the service-role key', async () => {
    fakeDb.noServiceClient = true;
    const res = await processPOST(authedRequest('/api/v1/notifications/process'));
    expect(res.status).toBe(500);
  });

  it('runs on the service client and is force-dynamic', () => {
    const text = readSource('app/api/v1/notifications/process/route.ts');
    expect(text).toContain('createSupabaseServiceClient');
    expect(text).not.toContain('createSupabaseServerClient');
    expect(text).not.toContain('generateWeeklyDigest');
    expect(text).toContain("export const dynamic = 'force-dynamic'");
  });
});

describe('refresh chain digest step (P4-2)', () => {
  it('the refresh route runs the weekly digest step with per-step isolation and no second scheduler', () => {
    const text = readSource('app/api/v1/prices/refresh/route.ts');
    expect(text).toContain('generateWeeklyDigestsForPremiumUsers');
    expect(text).toContain('digest: summarizeStep(digest, {');
    expect(text).toContain('digest: digest.result');
    expect(text).toContain("'digest',");
    // The digest rides the single 6-hourly refresh — no new cron.
    expect(text).toContain('no second cron');
    expect(text).not.toContain('cron.add');
  });
});

describe('Stripe void-send fix (P4-5)', () => {
  it('both webhook email sends check their result and log failures', () => {
    const text = readSource('services/stripe.ts');
    expect(text).not.toContain('void sendSubscriptionEmail');
    expect(text).not.toContain('void sendInvoiceEmail');
    expect(text).toContain('sendSubscriptionEmail(customerEmail, plan,');
    expect(text).toContain('Subscription email failed');
    expect(text).toContain('Invoice email failed');
  });
});

describe('price-alert-dialog copy qualifier (P4-6)', () => {
  it('both email promises carry the "depends on email being configured" qualifier', () => {
    const text = readSource('components/products/price-alert-dialog.tsx');
    const hits = text.match(/if email delivery is configured/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain(
      "we&apos;ll email you when it triggers, if email delivery is configured"
    );
  });
});

describe('P2-5 stragglers', () => {
  it('tiers-section header no longer calls $9.99 the live price', () => {
    const text = readSource('components/pricing/tiers-section.tsx');
    expect(text).not.toContain('keeps the live $9.99/month price');
    expect(text).toContain('PLANNED price, not a live');
  });

  it('layout JSON-LD has no hardcoded chargeable figure', () => {
    const text = readSource('app/layout.tsx');
    expect(text).not.toContain("highPrice: '9.99'");
    expect(text).not.toContain('AggregateOffer');
    expect(text).toContain("'@type': 'Offer'");
    expect(text).toContain("price: '0'");
    expect(text).toContain('no live charge yet');
  });
});
