/**
 * Guided-finder Deal Score gate tests (Section 17, Stage E, item 2).
 *
 * loadGuidedCandidates used to call raw computeDealScore() with null
 * prices and no data-points check, so every guided pick with an
 * unexpired ai_predictions row scored 100/100 — the live catalog's
 * 4 points → discount probability 0, confidence 20 → 100 − 0 + 20
 * + 6 = 126, clamped to 100. The fix routes the call through
 * dealScoreForDisplay with the point count read back from the
 * existing ai_predictions.price_data_range jsonb (same plumbing as
 * services/ai-predictions.ts getCachedPrediction — no migration).
 * Below 5 points, or with no count at all, the pick's dealScore is
 * null (withheld), never 100. The formula itself is untouched.
 *
 * Tests run against mocked getProducts / enrichProducts and a fake
 * Supabase client (in-memory ai_predictions rows); no DB, no network.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/products', () => ({
  getProducts: vi.fn(),
}));
vi.mock('@/services/personal-assistant', () => ({
  enrichProducts: vi.fn(),
}));

import { getProducts } from '@/services/products';
import { enrichProducts } from '@/services/personal-assistant';
import { loadGuidedCandidates } from '@/services/guided-finder';

const mockedGetProducts = vi.mocked(getProducts);
const mockedEnrichProducts = vi.mocked(enrichProducts);

function predictionRow(overrides: Record<string, unknown>) {
  return {
    product_id: 'prod-1',
    discount_probability: 0,
    confidence_score: 20,
    price_data_range: { dataPoints: 4 },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Fake Supabase client serving only the ai_predictions query. */
function makeClient(predictionRows: Array<Record<string, unknown>>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    in: () => chain,
    gt: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: predictionRows, error: null }),
  };
  return {
    from: () => chain,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function setup(predictionRows: Array<Record<string, unknown>>) {
  mockedGetProducts.mockResolvedValue({
    products: [
      {
        id: 'prod-1',
        name: 'MacBook Air',
        slug: 'macbook-air',
        brand: 'Apple',
        category: 'Laptops',
        imageUrl: null,
        confidenceScore: 50,
        description: 'Lightweight laptop',
      },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  mockedEnrichProducts.mockResolvedValue([
    {
      id: 'prod-1',
      name: 'MacBook Air',
      slug: 'macbook-air',
      brand: 'Apple',
      category: 'Laptops',
      price: 999,
      bestRetailer: { name: 'Amazon', compareAt: 1099 },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);
  return makeClient(predictionRows);
}

describe('loadGuidedCandidates Deal Score gate (Section 17, Stage E)', () => {
  it('withholds the score (null, not 100) when the prediction rests on 4 points', async () => {
    const candidates = await loadGuidedCandidates(setup([predictionRow({})]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].dealScore).toBeNull();
  });

  it('shows the score once the prediction rests on 5+ points', async () => {
    const candidates = await loadGuidedCandidates(
      setup([predictionRow({ price_data_range: { dataPoints: 6 } })])
    );
    expect(candidates).toHaveLength(1);
    // 100 − 0×0.4 + 20 (null prices) + 20×0.3 = 126, clamped to 100.
    expect(candidates[0].dealScore).toBe(100);
  });

  it('withholds the score when the cached row carries no point count (pre-B1 row)', async () => {
    const candidates = await loadGuidedCandidates(
      setup([predictionRow({ price_data_range: null })])
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].dealScore).toBeNull();
  });

  it('has no score when there is no unexpired prediction row', async () => {
    const candidates = await loadGuidedCandidates(setup([]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].dealScore).toBeNull();
  });
});
