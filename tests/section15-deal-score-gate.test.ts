/**
 * Deal Score display gate tests (Section 15, B1).
 *
 * The live catalog has 4 price-history points per product, and the
 * (unchanged) Deal Score formula turns that into 100/100 for every
 * product: 4 points → discount probability 0, confidence 20 →
 * 100 − 0 + 30 + 6 = 136, clamped to 100. The formula is NOT
 * rebased — instead the badge is hidden until the prediction rests
 * on at least DEAL_SCORE_MIN_DATA_POINTS (5) points. The count is
 * plumbed through the existing ai_predictions.price_data_range
 * jsonb (no migration): storePrediction writes it, the
 * predictions API exposes it, and the clients gate on it.
 *
 * Tests run against a mocked Supabase client (in-memory
 * price_history + ai_predictions rows); no DB, no network.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEAL_SCORE_MIN_DATA_POINTS,
  computeDealScoreFromPrediction,
  dealScoreForDisplay,
  shouldShowDealScore,
} from '@/lib/deal-score';
import { predictPriceDrop } from '@/services/ai-predictions';

function priceRow(price: number, dayOffset: number) {
  const base = Date.UTC(2026, 9, 1) + dayOffset * 24 * 60 * 60 * 1000;
  return { price, recorded_at: new Date(base).toISOString() };
}

interface PredictionClientOpts {
  cachedRow: Record<string, unknown> | null;
  priceRows: Array<{ price: number; recorded_at: string }>;
  inserted: Array<Record<string, unknown>>;
}

function makePredictionClient(opts: PredictionClientOpts) {
  const chain = () => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      gt: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: opts.cachedRow, error: null }),
      then: (resolve: (value: unknown) => void) =>
        resolve({ data: opts.priceRows, error: null }),
    };
    return b;
  };
  return {
    from: (table: string) => {
      if (table === 'ai_predictions') {
        return {
          select: () => chain(),
          insert: async (row: Record<string, unknown>) => {
            opts.inserted.push(row);
            return { error: null };
          },
        };
      }
      return chain();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('shouldShowDealScore (Section 15, B1)', () => {
  it('hides the badge with 4 price points (the live catalog shape)', () => {
    expect(DEAL_SCORE_MIN_DATA_POINTS).toBe(5);
    expect(shouldShowDealScore(4)).toBe(false);
  });

  it('shows the badge with 5+ price points', () => {
    expect(shouldShowDealScore(5)).toBe(true);
    expect(shouldShowDealScore(30)).toBe(true);
  });

  it('hides the badge when the point count is unknown (null/undefined)', () => {
    // A prediction from a source that does not carry the count —
    // e.g. a cached row written before B1 — is "not enough data",
    // never a guess.
    expect(shouldShowDealScore(null)).toBe(false);
    expect(shouldShowDealScore(undefined)).toBe(false);
  });
});

describe('dealScoreForDisplay (Section 15, B1)', () => {
  const prediction = {
    discountProbability: 0,
    currentPrice: 999,
    lowestPrice: 999,
    confidenceScore: 20,
  };

  it('returns null for a 4-point prediction even though the formula scores 100', () => {
    // The formula itself is unchanged — it still computes 100 here.
    expect(computeDealScoreFromPrediction({ ...prediction, dataPoints: 4 })).toBe(100);
    // …but the display gate hides it.
    expect(dealScoreForDisplay({ ...prediction, dataPoints: 4 })).toBeNull();
  });

  it('returns the score for a 5-point prediction', () => {
    expect(dealScoreForDisplay({ ...prediction, dataPoints: 5 })).toBe(100);
  });

  it('returns null when dataPoints is missing', () => {
    expect(dealScoreForDisplay(prediction)).toBeNull();
    expect(dealScoreForDisplay(null)).toBeNull();
  });
});

describe('predictPriceDrop dataPoints plumbing (Section 15, B1)', () => {
  it('reports dataPoints = the number of price_history rows (4 → hidden)', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const client = makePredictionClient({
      cachedRow: null,
      priceRows: [priceRow(999, 0), priceRow(949, 10), priceRow(899, 20), priceRow(899, 30)],
      inserted,
    });
    const result = await predictPriceDrop(client, 'product-4-points');
    expect(result).not.toBeNull();
    expect(result?.dataPoints).toBe(4);
    // 4 points → the badge hides, even though the score computes.
    expect(dealScoreForDisplay(result)).toBeNull();
    // The fire-and-forget store runs after the return; wait a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(inserted).toHaveLength(1);
    // Persisted via the EXISTING price_data_range jsonb — no migration.
    expect(inserted[0].price_data_range).toEqual({ dataPoints: 4 });
  });

  it('reports dataPoints = 6 and shows the badge once history grows', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const client = makePredictionClient({
      cachedRow: null,
      priceRows: [
        priceRow(1099, 0),
        priceRow(1049, 5),
        priceRow(999, 10),
        priceRow(949, 15),
        priceRow(899, 20),
        priceRow(899, 25),
      ],
      inserted,
    });
    const result = await predictPriceDrop(client, 'product-6-points');
    expect(result?.dataPoints).toBe(6);
    expect(dealScoreForDisplay(result)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(inserted[0].price_data_range).toEqual({ dataPoints: 6 });
  });

  it('reads dataPoints back from a cached row price_data_range', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const client = makePredictionClient({
      cachedRow: {
        product_id: 'product-cached',
        discount_probability: 0,
        expected_sale_date: null,
        expected_lowest_price: null,
        confidence_score: 20,
        explanation: 'cached',
        price_data_range: { dataPoints: 8 },
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      // No price_history rows at all: a cached hit must not need them.
      priceRows: [],
      inserted,
    });
    const result = await predictPriceDrop(client, 'product-cached');
    expect(result?.dataPoints).toBe(8);
    expect(dealScoreForDisplay(result)).not.toBeNull();
    expect(inserted).toHaveLength(0);
  });

  it('treats a cached row without dataPoints as a cache miss and self-heals', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const client = makePredictionClient({
      // A row written before B1: price_data_range is null, so the
      // cached read must NOT be trusted for the badge gate.
      cachedRow: {
        product_id: 'product-old-row',
        discount_probability: 0,
        expected_sale_date: null,
        expected_lowest_price: null,
        confidence_score: 20,
        explanation: 'old cached row',
        price_data_range: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      priceRows: [
        priceRow(999, 0),
        priceRow(949, 10),
        priceRow(899, 20),
        priceRow(899, 30),
        priceRow(879, 35),
        priceRow(879, 40),
      ],
      inserted,
    });
    const result = await predictPriceDrop(client, 'product-old-row');
    // Recomputed fresh from price_history (6 rows), not the stale cache.
    expect(result?.dataPoints).toBe(6);
    expect(dealScoreForDisplay(result)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(inserted).toHaveLength(1);
    expect(inserted[0].price_data_range).toEqual({ dataPoints: 6 });
  });
});

describe('B1 follow-up — every Deal Score call site gates on dataPoints', () => {
  // The main B1 work gated the product page (product-detail-client).
  // Five call sites still called computeDealScoreFromPrediction
  // directly and showed the meaningless 100/100 for the 4-point
  // catalog. Each must use dealScoreForDisplay instead — the raw
  // formula is only reachable through the gate, plus its own
  // definition in lib/deal-score.ts.
  const CALL_SITES = [
    'app/wishlists/[id]/page.tsx',
    'app/brands/[slug]/page.tsx',
    'app/categories/[slug]/page.tsx',
    'components/products/similar-products.tsx',
    'services/ai-comparison.ts',
  ];

  function readSource(rel: string): string {
    return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  }

  it('all five leftover call sites use dealScoreForDisplay', () => {
    for (const rel of CALL_SITES) {
      const text = readSource(rel);
      expect(text, rel).toContain('dealScoreForDisplay');
      expect(text, rel).not.toContain('computeDealScoreFromPrediction');
    }
  });

  it('no computeDealScoreFromPrediction call remains outside lib/deal-score.ts', () => {
    const dirs = ['app', 'components', 'lib', 'services'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (
            text.includes('computeDealScoreFromPrediction(') &&
            full !== path.join('lib', 'deal-score.ts')
          ) {
            offenders.push(full);
          }
        }
      }
    };
    for (const dir of dirs) walk(dir);
    expect(offenders).toEqual([]);
  });
});
