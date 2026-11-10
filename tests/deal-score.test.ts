import { describe, expect, it } from 'vitest';
import { computeDealScore, computeDealScoreFromPrediction } from '@/lib/deal-score';

describe('computeDealScore (canonical formula, verbatim from the product page)', () => {
  it('rewards a price at its recorded low with no drop expected', () => {
    // 100 − 0×0.4 + (999/999)×30 + 100×0.3 = 160 → clamped to 100.
    expect(
      computeDealScore({
        discountProbability: 0,
        currentPrice: 999,
        lowestPrice: 999,
        confidenceScore: 100,
      })
    ).toBe(100);
  });

  it('scores a mid-range case exactly (no clamping)', () => {
    // 100 − 95×0.4 + (400/1000)×30 + 0×0.3 = 100 − 38 + 12 + 0 = 74.
    expect(
      computeDealScore({
        discountProbability: 95,
        currentPrice: 1000,
        lowestPrice: 400,
        confidenceScore: 0,
      })
    ).toBe(74);
  });

  it('lowers the score when a future drop is likely', () => {
    // 100 − 90×0.4 + (500/1000)×30 + 20×0.3 = 100 − 36 + 15 + 6 = 85.
    expect(
      computeDealScore({
        discountProbability: 90,
        currentPrice: 1000,
        lowestPrice: 500,
        confidenceScore: 20,
      })
    ).toBe(85);
  });

  it('uses the +20 price term when current/lowest price is missing', () => {
    // 100 − 95×0.4 + 20 + 10×0.3 = 100 − 38 + 20 + 3 = 85.
    expect(
      computeDealScore({
        discountProbability: 95,
        currentPrice: null,
        lowestPrice: null,
        confidenceScore: 10,
      })
    ).toBe(85);
    // A zero current price must not divide by zero — same +20 term.
    expect(
      computeDealScore({
        discountProbability: 95,
        currentPrice: 0,
        lowestPrice: 400,
        confidenceScore: 10,
      })
    ).toBe(85);
  });

  it('rounds to the nearest integer', () => {
    // 100 − 33×0.4 + (700/1000)×30 + 33×0.3 = 100 − 13.2 + 21 + 9.9 = 117.7 → 100 (clamped).
    // Unclamped rounding case: 100 − 80×0.4 + (600/1000)×30 + 45×0.3
    // = 100 − 32 + 18 + 13.5 = 99.5 → 100 (Math.round rounds .5 up).
    expect(
      computeDealScore({
        discountProbability: 80,
        currentPrice: 1000,
        lowestPrice: 600,
        confidenceScore: 45,
      })
    ).toBe(100);
    // 100 − 95×0.4 + (333/1000)×30 + 7×0.3 = 100 − 38 + 9.99 + 2.1 = 74.09 → 74.
    expect(
      computeDealScore({
        discountProbability: 95,
        currentPrice: 1000,
        lowestPrice: 333,
        confidenceScore: 7,
      })
    ).toBe(74);
  });

  it('never returns a score for missing or non-finite inputs', () => {
    expect(computeDealScore(null)).toBeNull();
    expect(computeDealScore(undefined)).toBeNull();
    expect(
      computeDealScore({
        discountProbability: Number.NaN,
        currentPrice: 999,
        lowestPrice: 999,
        confidenceScore: 50,
      })
    ).toBeNull();
    expect(
      computeDealScore({
        discountProbability: 10,
        currentPrice: 999,
        lowestPrice: 999,
        confidenceScore: Number.NaN,
      })
    ).toBeNull();
    expect(
      computeDealScore({
        discountProbability: Number.POSITIVE_INFINITY,
        currentPrice: 999,
        lowestPrice: 999,
        confidenceScore: 50,
      })
    ).toBeNull();
  });
});

describe('computeDealScoreFromPrediction', () => {
  it('passes a predictions-API object through unchanged', () => {
    expect(
      computeDealScoreFromPrediction({
        discountProbability: 95,
        currentPrice: 1000,
        lowestPrice: 400,
        confidenceScore: 0,
      })
    ).toBe(74);
  });

  it('returns null when there is no prediction', () => {
    expect(computeDealScoreFromPrediction(null)).toBeNull();
    expect(computeDealScoreFromPrediction(undefined)).toBeNull();
  });
});
