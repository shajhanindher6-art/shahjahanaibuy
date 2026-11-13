/**
 * Section 19, item 96 — try/catch on the 7 API routes that had none.
 *
 * A throw inside one of these handlers used to yield an unlogged
 * Next 500. Each handler is now wrapped so a throw returns the
 * generic error envelope (`{ success: false, error: { code:
 * 'INTERNAL_ERROR', message: 'Internal server error' } }`, status
 * 500) instead. These tests force a throw in four of the seven
 * routes (vapid, platforms, health, fact-check/meaning) and assert
 * the envelope; the other three (price-history/export,
 * budget-alternative, visual-search-backfill) share the identical
 * wrap and are covered by their existing route tests for the happy
 * path. Happy-path cases here prove the wrap did not break the
 * normal response.
 *
 * Rate-limit collisions are avoided with a fresh x-real-ip per
 * request (same pattern as tests/go-redirect.test.ts).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const fake = vi.hoisted(() => ({
  throwInRateLimit: false,
  vapidThrows: false,
  vapidKey: 'BHPublicKeyForTests0000000000000000000000000000000000000000',
  platformsThrows: false,
  supabaseServerThrows: false,
}));

vi.mock('@/lib/api/middleware', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const realRateLimit = actual.rateLimitResponse as (
    ...args: [string, number?, number?]
  ) => Promise<unknown>;
  return {
    ...actual,
    rateLimitResponse: async (...args: [string, number?, number?]) => {
      if (fake.throwInRateLimit) throw new Error('rate limiter down');
      return realRateLimit(...args);
    },
  };
});

vi.mock('@/services/push', () => ({
  getVapidPublicKey: () => {
    if (fake.vapidThrows) throw new Error('VAPID config unreadable');
    return fake.vapidKey;
  },
}));

vi.mock('@/services/platform-status', () => ({
  describePlatformStatus: () => {
    if (fake.platformsThrows) throw new Error('platform registry down');
    return [];
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    if (fake.supabaseServerThrows) throw new Error('supabase client down');
    throw new Error('createSupabaseServerClient must not be called unmocked in this file');
  },
}));

// Imported after the mocks so the routes use the fakes.
import { GET as getVapid } from '@/app/api/v1/push/vapid/route';
import { GET as getPlatforms } from '@/app/api/v1/platforms/route';
import { GET as getHealth } from '@/app/api/v1/health/route';
import { GET as getMeaning } from '@/app/api/v1/fact-check/meaning/route';

let ipCounter = 0;
function req(path: string): NextRequest {
  ipCounter += 1;
  return new NextRequest(`http://localhost${path}`, {
    headers: { 'x-real-ip': `203.0.113.${ipCounter}` },
  });
}

beforeEach(() => {
  fake.throwInRateLimit = false;
  fake.vapidThrows = false;
  fake.platformsThrows = false;
  fake.supabaseServerThrows = false;
});

describe('Section 19 item 96 — thrown errors return the generic envelope', () => {
  it('GET /api/v1/push/vapid — a throw in getVapidPublicKey returns INTERNAL_ERROR, not a raw 500', async () => {
    fake.vapidThrows = true;
    const res = await getVapid(req('/api/v1/push/vapid'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body).toEqual({
      success: false,
      // The generic envelope: code INTERNAL_ERROR + a route-level
      // message that never leaks the thrown detail ('VAPID config
      // unreadable' must not appear anywhere in the body).
      error: { code: 'INTERNAL_ERROR', message: 'Could not load the VAPID public key' },
    });
    expect(JSON.stringify(body)).not.toContain('VAPID config unreadable');
  });

  it('GET /api/v1/push/vapid — happy path still returns the public key', async () => {
    const res = await getVapid(req('/api/v1/push/vapid'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { publicKey: string } };
    expect(body.success).toBe(true);
    expect(body.data.publicKey).toBe(fake.vapidKey);
  });

  it('GET /api/v1/platforms — a throw in describePlatformStatus returns INTERNAL_ERROR', async () => {
    fake.platformsThrows = true;
    const res = await getPlatforms(req('/api/v1/platforms'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Could not load platform status' },
    });
    expect(JSON.stringify(body)).not.toContain('platform registry down');
  });

  it('GET /api/v1/platforms — happy path still returns the platform list', async () => {
    const res = await getPlatforms(req('/api/v1/platforms'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { platforms: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.platforms).toEqual([]);
  });

  it('GET /api/v1/health — a throw creating the Supabase client returns INTERNAL_ERROR', async () => {
    fake.supabaseServerThrows = true;
    const res = await getHealth(req('/api/v1/health'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Health check failed' },
    });
    expect(JSON.stringify(body)).not.toContain('supabase client down');
  });

  it('GET /api/v1/fact-check/meaning — a throw in the rate limiter returns INTERNAL_ERROR', async () => {
    fake.throwInRateLimit = true;
    const res = await getMeaning(req('/api/v1/fact-check/meaning'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Could not load the fact-check meaning' },
    });
    expect(JSON.stringify(body)).not.toContain('rate limiter down');
  });

  it('GET /api/v1/fact-check/meaning — happy path still returns the published meaning text', async () => {
    const res = await getMeaning(req('/api/v1/fact-check/meaning'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { meaning: string; takedownPolicy: string };
    };
    expect(body.success).toBe(true);
    expect(typeof body.data.meaning).toBe('string');
    expect(body.data.meaning.length).toBeGreaterThan(0);
    expect(typeof body.data.takedownPolicy).toBe('string');
  });
});
