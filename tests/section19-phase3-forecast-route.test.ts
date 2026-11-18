/**
 * Section 19, Phase 3 (§12 #35) — forecast API horizon parameter.
 *
 * GET /api/v1/forecast/[productId]?horizon=14 → forecasts for the
 * 14-day horizon only, backtest for 14 days. An horizon outside
 * 7 / 14 / 30 / 60 / 90 → 400. No parameter → the [7, 30, 90]
 * defaults (unchanged).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const DAY_MS = 24 * 60 * 60 * 1000;
// Fixture re-based to relative dates (was frozen at 2026-10-01…11-10):
// same 10-day spacing and 5-point shape, last point 1 day ago, so
// the 7-day staleness gate never withholds the forecast once the
// calendar moves past the fixture (first failed 2026-11-18, same
// class as the 2026-11-16 #29 incident). Absolute dates here would
// be a time-bomb again. 5 points: the Section 20 (§12 #46) forecast
// minimum — 4 points would return 'not-enough-history'.
const PRICE_ROWS = [100, 95, 90, 85, 80].map((price, i) => ({
  price,
  recorded_at: new Date(Date.now() - (41 - i * 10) * DAY_MS).toISOString(),
}));

type Row = Record<string, unknown>;

function makePriceHistoryClient() {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (
      onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) =>
      Promise.resolve({ data: PRICE_ROWS as Row[], error: null }).then(
        onFulfilled,
        onRejected
      ),
  };
  return { from: (_table: string) => builder };
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => makePriceHistoryClient(),
}));

vi.mock('@/services/products', () => ({
  getProductById: async () => ({
    id: 'prod-1',
    name: 'Test Product',
    slug: 'test-product',
    category: 'Laptops',
  }),
  getProductBySlug: async () => ({
    id: 'prod-1',
    name: 'Test Product',
    slug: 'test-product',
    category: 'Laptops',
  }),
}));

// Imported after the mocks so the route uses the fakes.
import { GET } from '@/app/api/v1/forecast/[productId]/route';

let ipCounter = 0;
function req(path: string) {
  ipCounter += 1;
  return new NextRequest(`http://localhost${path}`, {
    headers: { 'x-real-ip': `203.0.113.${ipCounter}` },
  });
}

describe('GET /api/v1/forecast/[productId] — horizon parameter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('?horizon=14 returns predictions for the 14-day horizon only', async () => {
    const res = await GET(req('/api/v1/forecast/test-product?horizon=14'), {
      params: { productId: 'test-product' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        status: string;
        forecasts: Array<{ horizonDays: number }>;
        backtest: { horizonDays: number };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.forecasts).toHaveLength(1);
    expect(body.data.forecasts[0].horizonDays).toBe(14);
    expect(body.data.backtest.horizonDays).toBe(14);
  });

  it('?horizon=60 returns predictions for the 60-day horizon only', async () => {
    const res = await GET(req('/api/v1/forecast/test-product?horizon=60'), {
      params: { productId: 'test-product' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { forecasts: Array<{ horizonDays: number }> };
    };
    expect(body.data.forecasts).toHaveLength(1);
    expect(body.data.forecasts[0].horizonDays).toBe(60);
  });

  it('no horizon → the [7, 30, 90] defaults, 30-day backtest', async () => {
    const res = await GET(req('/api/v1/forecast/test-product'), {
      params: { productId: 'test-product' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        forecasts: Array<{ horizonDays: number }>;
        backtest: { horizonDays: number };
      };
    };
    expect(body.data.forecasts.map((f) => f.horizonDays)).toEqual([7, 30, 90]);
    expect(body.data.backtest.horizonDays).toBe(30);
  });

  it('?horizon=45 → 400 with the generic error envelope', async () => {
    const res = await GET(req('/api/v1/forecast/test-product?horizon=45'), {
      params: { productId: 'test-product' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('7, 14, 30, 60, 90');
  });

  it('?horizon=abc → 400', async () => {
    const res = await GET(req('/api/v1/forecast/test-product?horizon=abc'), {
      params: { productId: 'test-product' },
    });
    expect(res.status).toBe(400);
  });
});
