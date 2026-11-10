/**
 * Rate-limit coverage (S2#7).
 *
 * Three layers:
 * 1. Static coverage: every exported handler under app/api (route.ts
 *    files) must call rateLimitResponse in its own body. This fails the
 *    build if a new route is added without a limit, so the coverage
 *    in docs/rate-limits.md stays honest.
 * 2. Unit: the in-memory fallback bucket (lib/api/middleware.ts)
 *    allows up to the limit, then blocks, then resets.
 * 3. Unit: the Redis window conversion + the unconfigured-Redis
 *    path (checkRateLimitDistributed returns null → caller falls
 *    back to in-memory, never fail-closed).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRateLimit } from '@/lib/api/middleware';
import {
  windowMsToDuration,
  checkRateLimitDistributed,
  isRedisRateLimitConfigured,
} from '@/lib/api/rate-limit';

const API_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'app',
  'api'
);

function* walkRouteFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkRouteFiles(full);
    else if (entry.name === 'route.ts') yield full;
  }
}

const HANDLER_RE =
  /export async function (GET|POST|PUT|PATCH|DELETE)\s*\(/g;

function handlersIn(text: string): Array<{ method: string; start: number; end: number }> {
  const found = [...text.matchAll(HANDLER_RE)].map((m) => ({
    method: m[1],
    start: m.index ?? 0,
  }));
  return found.map((h, i) => ({
    ...h,
    end: i + 1 < found.length ? found[i + 1].start : text.length,
  }));
}

describe('rate-limit coverage (static)', () => {
  it('every API route handler calls rateLimitResponse', () => {
    const missing: string[] = [];
    let total = 0;
    for (const file of walkRouteFiles(API_ROOT)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const h of handlersIn(text)) {
        total++;
        if (!text.slice(h.start, h.end).includes('rateLimitResponse(')) {
          missing.push(`${path.relative(API_ROOT, file)} ${h.method}`);
        }
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('the unauthenticated writes are limited first (affiliate/click, analytics/events)', () => {
    for (const rel of ['v1/affiliate/click/route.ts', 'v1/analytics/events/route.ts']) {
      const text = fs.readFileSync(path.join(API_ROOT, rel), 'utf8');
      expect(text).toContain('rateLimitResponse(');
    }
  });

  it('the Sentry test route is admin-gated and limited', () => {
    const text = fs.readFileSync(
      path.join(API_ROOT, 'v1/admin/sentry-test/route.ts'),
      'utf8'
    );
    expect(text).toContain('requireAdmin(request)');
    expect(text).toContain('rateLimitResponse(');
    expect(text).toContain('Sentry.captureMessage');
    expect(text).toContain('Sentry.captureException');
    expect(text).toContain('Sentry.flush(');
  });
});

describe('checkRateLimit (in-memory fallback bucket)', () => {
  it('allows up to the limit, then blocks', () => {
    const id = `test-bucket-${Date.now()}-${Math.random()}`;
    const first = checkRateLimit(id, 2, 60_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    const second = checkRateLimit(id, 2, 60_000);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    const third = checkRateLimit(id, 2, 60_000);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('resets after the window expires', async () => {
    const id = `test-bucket-reset-${Date.now()}-${Math.random()}`;
    checkRateLimit(id, 1, 20);
    expect(checkRateLimit(id, 1, 20).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(checkRateLimit(id, 1, 20).allowed).toBe(true);
  });

  it('keeps separate buckets per identifier', () => {
    const a = `test-a-${Date.now()}-${Math.random()}`;
    const b = `test-b-${Date.now()}-${Math.random()}`;
    checkRateLimit(a, 1, 60_000);
    expect(checkRateLimit(a, 1, 60_000).allowed).toBe(false);
    expect(checkRateLimit(b, 1, 60_000).allowed).toBe(true);
  });
});

describe('Redis sliding window (lib/api/rate-limit.ts)', () => {
  it('converts windows to Upstash durations', () => {
    expect(windowMsToDuration(60_000)).toBe('1 m');
    expect(windowMsToDuration(120_000)).toBe('2 m');
    expect(windowMsToDuration(3_600_000)).toBe('1 h');
    expect(windowMsToDuration(45_000)).toBe('45 s');
    expect(windowMsToDuration(0)).toBe('1 s');
  });

  it('returns null when Redis is not configured (fail-open to in-memory)', async () => {
    // No UPSTASH_* env vars in tests, so the distributed check must
    // report "not configured" instead of throwing or blocking.
    expect(isRedisRateLimitConfigured()).toBe(false);
    const result = await checkRateLimitDistributed('test-key', 10, 60_000);
    expect(result).toBeNull();
  });
});
