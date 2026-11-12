import { describe, expect, it } from 'vitest';
import {
  breakdownDealScore,
  breakdownDealScoreFromPrediction,
  dealScorePriceTerm,
} from '@/lib/deal-score-breakdown';
import { computeDealScore } from '@/lib/deal-score';

describe('dealScorePriceTerm', () => {
  it('matches the canonical formula: (lowest/current) × 30', () => {
    expect(dealScorePriceTerm(1000, 500)).toBe(15);
    expect(dealScorePriceTerm(999, 999)).toBe(30);
  });

  it('falls back to +20 when current/lowest price is missing', () => {
    expect(dealScorePriceTerm(null, null)).toBe(20);
    expect(dealScorePriceTerm(0, 400)).toBe(20);
  });
});

describe('breakdownDealScore', () => {
  it('explains the live 100/100: 4 points → prob 0, confidence 20 → raw 136, clamped to 100', () => {
    // The real inputs behind every product's 100/100 today.
    const breakdown = breakdownDealScore({
      discountProbability: 0,
      currentPrice: 999,
      lowestPrice: 999,
      confidenceScore: 20,
      dataPoints: 4,
    });
    expect(breakdown).not.toBeNull();
    expect(breakdown!.terms).toEqual([
      { label: 'Base', formula: 'starting score', value: 100 },
      { label: 'Drop-chance term', formula: '−0% × 0.4', value: -0 },
      { label: 'Price term', formula: '(999 / 999) × 30', value: 30 },
      { label: 'Confidence term', formula: '20 × 0.3', value: 6 },
    ]);
    expect(breakdown!.rawTotal).toBe(136);
    expect(breakdown!.score).toBe(100);
    expect(breakdown!.clamped).toBe(true);
    expect(breakdown!.dataPoints).toBe(4);
    // Terms sum to the raw total, and the score is the canonical one.
    const sum = breakdown!.terms.reduce((acc, t) => acc + t.value, 0);
    expect(sum).toBe(breakdown!.rawTotal);
    expect(breakdown!.score).toBe(
      computeDealScore({
        discountProbability: 0,
        currentPrice: 999,
        lowestPrice: 999,
        confidenceScore: 20,
      })
    );
  });

  it('terms sum to an unclamped score exactly', () => {
    // 100 − 95×0.4 + (400/1000)×30 + 0×0.3 = 100 − 38 + 12 + 0 = 74.
    const breakdown = breakdownDealScore({
      discountProbability: 95,
      currentPrice: 1000,
      lowestPrice: 400,
      confidenceScore: 0,
      dataPoints: 12,
    });
    expect(breakdown!.rawTotal).toBe(74);
    expect(breakdown!.score).toBe(74);
    expect(breakdown!.clamped).toBe(false);
    const sum = breakdown!.terms.reduce((acc, t) => acc + t.value, 0);
    expect(sum).toBe(74);
  });

  it('uses the +20 price term when prices are missing', () => {
    const breakdown = breakdownDealScore({
      discountProbability: 95,
      currentPrice: null,
      lowestPrice: null,
      confidenceScore: 10,
      dataPoints: 6,
    });
    expect(breakdown!.terms[2].value).toBe(20);
    expect(breakdown!.rawTotal).toBe(85);
    expect(breakdown!.score).toBe(85);
  });

  it('returns null when the score cannot be computed — never a synthesized breakdown', () => {
    expect(
      breakdownDealScore({
        discountProbability: Number.NaN,
        currentPrice: 999,
        lowestPrice: 999,
        confidenceScore: 50,
      })
    ).toBeNull();
    expect(breakdownDealScoreFromPrediction(null)).toBeNull();
    expect(breakdownDealScoreFromPrediction(undefined)).toBeNull();
  });

  it('passes a predictions-API object through unchanged', () => {
    const breakdown = breakdownDealScoreFromPrediction({
      discountProbability: 90,
      currentPrice: 1000,
      lowestPrice: 500,
      confidenceScore: 20,
      dataPoints: 8,
    });
    // 100 − 36 + 15 + 6 = 85.
    expect(breakdown!.score).toBe(85);
    expect(breakdown!.dataPoints).toBe(8);
  });
});
