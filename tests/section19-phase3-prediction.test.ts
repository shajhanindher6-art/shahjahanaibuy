/**
 * Section 19, Phase 3 — prediction + buy-or-wait (§12 #28–#35).
 *
 * #28 legacy engine guard (< 5 points → no expected lowest price)
 * #29 OLS confidence on flat/thin series (low band, ~25% cap)
 * #32 TRACK PRICE + COMPARE ALTERNATIVES engine verdicts
 * #33 budget input into the buy-wait verdict
 * #34 outcomes auto-recorder (fail-safe without migration 032)
 * #35 configurable prediction periods (horizons 7/14/30/60/90)
 *
 * #30 (badge minimum 2 → 5) is covered in
 * tests/price-prediction-badge.test.ts; #31 (exact-date removal)
 * is covered in tests/section19-phase3-best-time-to-buy.test.tsx.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  computeForecast,
  backtestForecast,
  isAllowedForecastHorizon,
  FORECAST_HORIZONS,
  type ForecastPoint,
} from '@/lib/forecast';
import { predictBuyVsWait, type BuyWaitPoint } from '@/services/buy-wait-prediction';
import {
  recordPredictionOutcome,
  resolvePendingPredictionOutcomes,
} from '@/services/prediction-outcomes';
import type { AnySupabaseClient } from '@/lib/supabase/types';

// The legacy-engine tests exercise predictPriceDrop, which
// fire-and-forgets the outcomes recorder. The recorder builds its
// own service-role client — mock that to null so no real client
// (and no network) is ever touched here. The #34 tests below
// always pass an explicit stub client, so the mock never matters
// for them.
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => null,
}));

import { predictPriceDrop } from '@/services/ai-predictions';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 9, 1);

function day(n: number): string {
  return new Date(BASE + n * DAY_MS).toISOString();
}

function fpoint(price: number, dayOffset: number): ForecastPoint {
  return { price, recordedAt: day(dayOffset) };
}

/** Buy-wait points ending `daysAgoLast` days before now (fresh by default). */
function bwpoints(prices: number[], daysAgoLast = 1): BuyWaitPoint[] {
  const last = Date.now() - daysAgoLast * DAY_MS;
  return prices.map((price, i) => ({
    price,
    recordedAt: new Date(last - (prices.length - 1 - i) * 10 * DAY_MS).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// #28 — legacy engine below 5 points
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Minimal PostgREST-style stub for predictPriceDrop's queries. */
function stubPredictionSupabase(priceRows: Array<{ price: number; recorded_at: string }>): AnySupabaseClient {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    gt: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (
      onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve({ data: priceRows as Row[], error: null }).then(onFulfilled, onRejected),
  };
  return { from: (_table: string) => builder } as unknown as AnySupabaseClient;
}

describe('#28 — legacy engine guard below 5 points', () => {
  it('4 points → insufficient-data: no expected lowest price, no "0% probability" claim', async () => {
    const rows = [1100, 1050, 1000, 990].map((price, i) => ({
      price,
      recorded_at: day(i * 10),
    }));
    const result = await predictPriceDrop(stubPredictionSupabase(rows), 'prod-4pts');
    expect(result).not.toBeNull();
    expect(result!.dataPoints).toBe(4);
    expect(result!.discountProbability).toBe(0);
    expect(result!.expectedLowestPrice).toBeNull();
    expect(result!.explanation).toContain('Not enough price history to predict a discount');
    expect(result!.explanation).toContain('only 4 recorded prices');
    expect(result!.explanation).not.toContain('expected lowest price');
    expect(result!.explanation).not.toContain('0% probability');
  });

  it('6 points → expected lowest price is emitted', async () => {
    const rows = [1100, 1050, 1000, 1020, 1010, 990].map((price, i) => ({
      price,
      recorded_at: day(i * 10),
    }));
    const result = await predictPriceDrop(stubPredictionSupabase(rows), 'prod-6pts');
    expect(result).not.toBeNull();
    expect(result!.dataPoints).toBe(6);
    expect(result!.expectedLowestPrice).toBe(1000);
    expect(result!.explanation).toContain('expected lowest price');
  });

  it('0 rows → null (the existing refusal is unchanged)', async () => {
    const result = await predictPriceDrop(stubPredictionSupabase([]), 'prod-0pts');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #29 — OLS confidence on flat/thin series
// ---------------------------------------------------------------------------

describe('#29 — OLS confidence on flat/thin series', () => {
  it('flat 4-point series → low band: 21% / 16% / 9% (was 76 / 71 / 64)', () => {
    const result = computeForecast([
      fpoint(100, 0),
      fpoint(100, 10),
      fpoint(100, 20),
      fpoint(100, 30),
    ]);
    expect(result.status).toBe('ok');
    // Flatness is weak evidence, not strong: R² counts as 0, and
    // thin history caps confidence at 25% (the buy-wait cap).
    expect(result.forecasts.map((f) => f.confidencePct)).toEqual([21, 16, 9]);
    for (const f of result.forecasts) {
      expect(f.confidencePct).toBeLessThan(40);
      expect(f.direction).toBe('flat');
      // The range math is untouched: centre 100, non-degenerate.
      expect(f.central).toBe(100);
      expect(f.low).toBeLessThan(100);
      expect(f.high).toBeGreaterThan(100);
    }
  });

  it('flat 20-point series → still low band (flatness never earns confidence)', () => {
    const points = Array.from({ length: 20 }, (_, i) => fpoint(100, i * 2));
    const result = computeForecast(points);
    expect(result.forecasts.map((f) => f.confidencePct)).toEqual([30, 25, 18]);
    for (const f of result.forecasts) {
      expect(f.confidencePct).toBeLessThan(40);
    }
  });

  it('2-point exact fit → capped at 25% and longer horizons score lower', () => {
    const result = computeForecast([fpoint(100, 0), fpoint(90, 10)]);
    expect(result.forecasts[0].confidencePct).toBe(25);
    expect(result.forecasts[2].confidencePct).toBeLessThan(
      result.forecasts[0].confidencePct
    );
    expect(result.forecasts[2].confidencePct).toBe(13);
  });

  it('non-flat 4-point series with a perfect fit → capped at 25% too', () => {
    const result = computeForecast([
      fpoint(100, 0),
      fpoint(95, 10),
      fpoint(90, 20),
      fpoint(85, 30),
    ]);
    for (const f of result.forecasts) {
      expect(f.confidencePct).toBeLessThanOrEqual(25);
    }
    // The range math is untouched: 30-day centre is still 70.
    expect(result.forecasts.find((f) => f.horizonDays === 30)!.central).toBe(70);
  });

  it('the stale doc example is now real: flat 4-point 7d reads "21% confidence (low)"', () => {
    const result = computeForecast([
      fpoint(100, 0),
      fpoint(100, 10),
      fpoint(100, 20),
      fpoint(100, 30),
    ]);
    expect(result.forecasts[0].confidencePct).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// #32 / #33 — buy-wait engine verdicts + budget (+ freshness note)
// ---------------------------------------------------------------------------

describe('#32 — TRACK PRICE + COMPARE ALTERNATIVES as engine verdicts', () => {
  it('thin history + near (not at) the low → track_price', () => {
    const prediction = predictBuyVsWait(bwpoints([1100, 1050, 1000, 1030]));
    expect(prediction.recommendation).toBe('track_price');
    expect(prediction.reason).toContain('Track the price');
    expect(prediction.reason).toContain('$1030.00');
    expect(prediction.reason).toContain('$1000.00');
    expect(prediction.lowConfidence).toBe(true);
  });

  it('cheaper alternative (≥5% cheaper) → compare_alternatives', () => {
    const prediction = predictBuyVsWait(bwpoints([1000, 1010, 1020, 1030, 1040, 1050]), {
      cheaperAlternativePrice: 900,
    });
    expect(prediction.recommendation).toBe('compare_alternatives');
    expect(prediction.reason).toContain('Compare alternatives');
    expect(prediction.reason).toContain('$900.00');
    expect(prediction.reason).toContain('$150.00');
  });

  it('a small alternative gap (<5%) does not trigger compare', () => {
    const prediction = predictBuyVsWait(bwpoints([1000, 1010, 1020, 1030, 1040, 1050]), {
      cheaperAlternativePrice: 1030,
    });
    expect(prediction.recommendation).toBe('wait');
  });

  it('no options → the old verdicts are unchanged', () => {
    expect(predictBuyVsWait(bwpoints([1099, 1049, 999, 999])).recommendation).toBe(
      'buy_now'
    );
    expect(predictBuyVsWait(bwpoints([999, 1049, 1099, 1099])).recommendation).toBe(
      'wait'
    );
    expect(predictBuyVsWait(bwpoints([500])).recommendation).toBe('not_enough_data');
  });
});

describe('#33 — budget input into the buy-wait verdict', () => {
  it('price above budget → wait with the gap stated, never buy_now', () => {
    const prediction = predictBuyVsWait(bwpoints([1100, 1050, 1000, 990]), {
      budgetUsd: 900,
    });
    // 990 is at its recorded low — without a budget this would be
    // buy_now. Above budget it must not be.
    expect(prediction.recommendation).toBe('wait');
    expect(prediction.budgetGapUsd).toBe(90);
    expect(prediction.reason).toContain('above your budget by $90.00');
    expect(prediction.reason).toContain('your budget: $900.00');
    expect(prediction.reason).not.toMatch(/^Buy Now/);
  });

  it('price within budget → verdict unchanged', () => {
    const prediction = predictBuyVsWait(bwpoints([1100, 1050, 1000, 990]), {
      budgetUsd: 1200,
    });
    expect(prediction.recommendation).toBe('buy_now');
    expect(prediction.budgetGapUsd).toBeNull();
  });

  it('no budget supplied → behaviour unchanged', () => {
    const prediction = predictBuyVsWait(bwpoints([1100, 1050, 1000, 990]));
    expect(prediction.recommendation).toBe('buy_now');
    expect(prediction.budgetGapUsd).toBeNull();
  });
});

describe('buy-wait freshness qualification (§12 #20 note)', () => {
  it('stale latest price → verdict qualified with the age', () => {
    const prediction = predictBuyVsWait(bwpoints([1099, 1049, 999, 999], 10));
    expect(prediction.priceStale).toBe(true);
    expect(prediction.daysSinceLastPrice).toBe(10);
    expect(prediction.reason).toContain('10 days old');
    expect(prediction.reason).toContain('based on stale data');
    // The verdict itself still stands — it is qualified, not suppressed.
    expect(prediction.recommendation).toBe('buy_now');
  });

  it('fresh latest price → not stale, no qualification', () => {
    const prediction = predictBuyVsWait(bwpoints([1099, 1049, 999, 999], 1));
    expect(prediction.priceStale).toBe(false);
    expect(prediction.daysSinceLastPrice).toBe(1);
    expect(prediction.reason).not.toContain('stale data');
  });
});

// ---------------------------------------------------------------------------
// #34 — outcomes auto-recorder (fail-safe without migration 032)
// ---------------------------------------------------------------------------

/** In-memory fake Supabase client for the outcomes recorder. */
function fakeOutcomesClient(opts: {
  outcomes?: Row[];
  history?: Row[];
  missingTable?: boolean;
  throwing?: boolean;
}): AnySupabaseClient {
  const tables: Record<string, Row[]> = {
    prediction_outcomes: [...(opts.outcomes ?? [])],
    price_history: [...(opts.history ?? [])],
  };

  const missingError = () => ({
    data: null,
    error: { code: 'PGRST205', message: 'Could not find the table' },
  });

  function builder(table: string) {
    let rows = [...(tables[table] ?? [])];
    let pendingUpdate: Row | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return b;
      },
      gte: (col: string, val: string) => {
        rows = rows.filter((r) => String(r[col]) >= val);
        return b;
      },
      lte: (col: string, val: string) => {
        rows = rows.filter((r) => String(r[col]) <= val);
        return b;
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        const asc = o?.ascending !== false;
        rows = [...rows].sort((x, y) =>
          asc
            ? String(x[col]).localeCompare(String(y[col]))
            : String(y[col]).localeCompare(String(x[col]))
        );
        return b;
      },
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return b;
      },
      maybeSingle: async () => {
        if (opts.throwing) throw new Error('boom');
        if (opts.missingTable) return missingError();
        return { data: rows[0] ?? null, error: null };
      },
      insert: async (row: Row) => {
        if (opts.throwing) throw new Error('boom');
        if (opts.missingTable) return missingError();
        const inserted = {
          ...row,
          id: `id-${tables[table].length + 1}`,
          predicted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };
        tables[table].push(inserted);
        return { data: inserted, error: null };
      },
      update: (patch: Row) => {
        pendingUpdate = patch;
        return b;
      },
      then: (
        onFulfilled?: (value: { data: Row[] | null; error: unknown }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        if (opts.throwing) {
          return Promise.reject(new Error('boom')).then(onFulfilled, onRejected);
        }
        if (opts.missingTable) {
          return Promise.resolve(missingError()).then(onFulfilled, onRejected);
        }
        if (pendingUpdate) {
          for (const row of tables[table]) {
            if (rows.includes(row)) Object.assign(row, pendingUpdate);
          }
          pendingUpdate = null;
          return Promise.resolve({ data: null, error: null }).then(
            onFulfilled,
            onRejected
          );
        }
        return Promise.resolve({ data: rows, error: null }).then(
          onFulfilled,
          onRejected
        );
      },
    };
    return b;
  }

  return { from: (table: string) => builder(table) } as unknown as AnySupabaseClient;
}

describe('#34 — outcomes auto-recorder', () => {
  it('records a pending outcome, then dedupes the same product/day', async () => {
    const client = fakeOutcomesClient({});
    const input = {
      productId: '11111111-1111-4111-8111-111111111111',
      discountProbability: 80,
      priceAtPrediction: 1000,
      predictedLowestPrice: 900,
    };
    const first = await recordPredictionOutcome(input, client);
    expect(first.status).toBe('recorded');
    const second = await recordPredictionOutcome(input, client);
    expect(second.status).toBe('already-recorded');
  });

  it('missing table (032 unapplied) → missing-table, never throws', async () => {
    const client = fakeOutcomesClient({ missingTable: true });
    const result = await recordPredictionOutcome(
      {
        productId: '11111111-1111-4111-8111-111111111111',
        discountProbability: 80,
        priceAtPrediction: 1000,
        predictedLowestPrice: 900,
      },
      client
    );
    expect(result.status).toBe('missing-table');

    const resolved = await resolvePendingPredictionOutcomes(client);
    expect(resolved.ok).toBe(true);
    expect(resolved.reason).toBe('table-missing');
    expect(resolved.checked).toBe(0);
  });

  it('a throwing client → skipped, never throws', async () => {
    const client = fakeOutcomesClient({ throwing: true });
    const result = await recordPredictionOutcome(
      {
        productId: '11111111-1111-4111-8111-111111111111',
        discountProbability: 80,
        priceAtPrediction: 1000,
        predictedLowestPrice: 900,
      },
      client
    );
    expect(result.status).toBe('skipped');
    const resolved = await resolvePendingPredictionOutcomes(client);
    expect(resolved.ok).toBe(false);
  });

  it('resolves a due outcome against the recorded lowest price', async () => {
    const predictedAt = new Date(Date.now() - 40 * DAY_MS).toISOString();
    const client = fakeOutcomesClient({
      outcomes: [
        {
          id: 'out-1',
          product_id: '22222222-2222-4222-8222-222222222222',
          predicted_at: predictedAt,
          horizon_days: 30,
          discount_probability: 80,
          price_at_prediction: 1000,
          predicted_lowest_price: 900,
          outcome: 'pending',
        },
        {
          id: 'out-2',
          product_id: '22222222-2222-4222-8222-222222222222',
          predicted_at: new Date(Date.now() - 5 * DAY_MS).toISOString(),
          horizon_days: 30,
          discount_probability: 80,
          price_at_prediction: 1000,
          predicted_lowest_price: 900,
          outcome: 'pending',
        },
      ],
      history: [
        { product_id: '22222222-2222-4222-8222-222222222222', price: 980, recorded_at: new Date(Date.now() - 20 * DAY_MS).toISOString() },
        { product_id: '22222222-2222-4222-8222-222222222222', price: 950, recorded_at: new Date(Date.now() - 15 * DAY_MS).toISOString() },
      ],
    });
    const result = await resolvePendingPredictionOutcomes(client);
    expect(result.checked).toBe(2);
    expect(result.resolved).toBe(1);
    expect(result.stillPending).toBe(1);
    expect(result.failed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #35 — configurable prediction periods
// ---------------------------------------------------------------------------

describe('#35 — configurable prediction periods', () => {
  const points: ForecastPoint[] = [
    fpoint(100, 0),
    fpoint(95, 10),
    fpoint(90, 20),
    fpoint(85, 30),
  ];

  it('defaults stay [7, 30, 90]', () => {
    expect(FORECAST_HORIZONS).toEqual([7, 30, 90]);
    expect(computeForecast(points).forecasts.map((f) => f.horizonDays)).toEqual([
      7, 30, 90,
    ]);
  });

  it('custom horizon returns predictions for that horizon only', () => {
    const result = computeForecast(points, Date.now(), [14]);
    expect(result.forecasts).toHaveLength(1);
    expect(result.forecasts[0].horizonDays).toBe(14);
    const multi = computeForecast(points, Date.now(), [14, 60]);
    expect(multi.forecasts.map((f) => f.horizonDays)).toEqual([14, 60]);
  });

  it('invalid horizon throws a RangeError (the API turns it into a 400)', () => {
    expect(() => computeForecast(points, Date.now(), [45])).toThrow(RangeError);
    expect(() => computeForecast(points, Date.now(), [0])).toThrow(RangeError);
    expect(() => backtestForecast(points, 45)).toThrow(RangeError);
  });

  it('backtest accepts the new horizons', () => {
    const report = backtestForecast(points, 14, new Date(day(31)).getTime());
    expect(report.horizonDays).toBe(14);
  });

  it('isAllowedForecastHorizon admits 7/14/30/60/90 and nothing else', () => {
    for (const h of [7, 14, 30, 60, 90]) expect(isAllowedForecastHorizon(h)).toBe(true);
    for (const h of [0, 1, 10, 45, 120, 7.5, Number.NaN]) {
      expect(isAllowedForecastHorizon(h)).toBe(false);
    }
  });
});
