/**
 * Section 18, item 70 (audit §1 #44) — a REAL 429 through a route
 * handler, not a unit test of the bucket helper.
 *
 * Before this file, rate-limit coverage was static (a source grep)
 * plus a unit test of the in-memory bucket in lib/api/middleware,
 * and quota 429s were tested at the `enforceApiQuota` helper —
 * never via an HTTP route call. The Upstash Redis path has no
 * test at all (no Redis in the test env) and still has none here:
 * this file drives the IN-MEMORY bucket path (Upstash is
 * unconfigured in tests, so `rateLimitResponse` falls back to it).
 *
 * Route chosen: POST /api/v1/subscriptions/checkout — limit
 * 10/min/IP, and the rate-limit check runs BEFORE auth, so an
 * unauthenticated caller still consumes the bucket: the first 10
 * requests reach `requireAuth` and answer 401, the 11th is
 * stopped by the limiter with 429. That proves the 429 comes
 * from the route's limiter, not from auth.
 *
 * Honest gap, pinned here rather than papered over: the route
 * does NOT set a `Retry-After` header. `rateLimited()` puts the
 * reset time in the body instead (`error.details.resetAt`, ISO
 * timestamp). The test asserts exactly that — 429 + the generic
 * envelope + `details.resetAt` present + no `Retry-After`
 * header — so a future change that adds the header will fail
 * here and must update this test deliberately.
 *
 * No rate-limit behaviour was changed to make this pass. Each
 * test uses a fresh fake IP so the module-level bucket map (one
 * per test file in vitest's per-file module registry) cannot
 * leak between tests.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
}));

// Imported after the mocks so the route uses the fakes.
import { POST } from '@/app/api/v1/subscriptions/checkout/route';

let ipCounter = 0;
let testIp = '';
function checkoutRequest() {
  return new NextRequest('http://localhost/api/v1/subscriptions/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-real-ip': testIp,
    },
    body: JSON.stringify({ plan: 'premium' }),
  });
}

describe('POST /api/v1/subscriptions/checkout — real 429 through the route', () => {
  beforeEach(() => {
    // One fresh IP per test: the same IP for every call inside a
    // test (that is what fills one bucket), a different IP per
    // test (so tests cannot pollute each other via the
    // module-level bucket map).
    ipCounter += 1;
    testIp = `203.0.113.${200 + ipCounter}`;
  });

  it('returns 429 with the generic error envelope on the 11th call in a minute (limit 10/min/IP)', async () => {
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 11; i++) {
      const res = await POST(checkoutRequest());
      statuses.push(res.status);
      last = res;
    }
    // The first 10 reach auth and fail there (no session in tests);
    // the limiter — not auth — stops the 11th.
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);

    const body = (await (last as Response).json()) as {
      success: boolean;
      error: { code: string; message: string; details?: { resetAt?: string } };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toBe('Too many requests. Please try again later.');
    // No internal detail leaks: the message is the generic one.
    expect(body.error.message).not.toContain('checkout');
    expect(body.error.message).not.toContain('203.0.113');
    // The reset time travels in the body, not in a header.
    expect(typeof body.error.details?.resetAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.error.details?.resetAt as string))).toBe(false);
    expect((last as Response).headers.get('retry-after')).toBeNull();
  });

  it('a different IP gets its own bucket (the 429 is per-IP, not global)', async () => {
    // Exhaust IP A.
    for (let i = 0; i < 11; i++) await POST(checkoutRequest());
    expect((await POST(checkoutRequest())).status).toBe(429);
    // IP B (a fresh address) is untouched: it reaches auth.
    testIp = `198.51.100.${100 + ipCounter}`;
    const res = await POST(checkoutRequest());
    expect(res.status).toBe(401);
  });
});
