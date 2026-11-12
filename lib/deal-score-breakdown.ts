/**
 * Deal Score Breakdown Explorer — pure helpers for
 * /tools/deal-score-breakdown (Section 16, E4).
 *
 * Shows a product's Deal Score as term-by-term numbers that sum
 * to the displayed score — using the CANONICAL formula in
 * lib/deal-score.ts (computeDealScore), never a re-derived score.
 * The inputs come from the predictions API shape
 * (discountProbability, currentPrice, lowestPrice,
 * confidenceScore, dataPoints).
 *
 * THE FORMULA (verbatim from lib/deal-score.ts):
 *   score = 100 − discountProbability × 0.4
 *         + (currentPrice && lowestPrice ? (lowestPrice / currentPrice) × 30 : 20)
 *         + confidenceScore × 0.3
 *   rounded to the nearest integer, clamped to 0–100.
 *
 * The live catalog scores 100/100 on every product because 4
 * recorded points → discount probability 0, confidence 20 →
 * 100 − 0 + 30 + 6 = 136, clamped to 100. This page shows those
 * real inputs and the raw (unclamped) total, so the 100/100 is
 * explained instead of hidden. The score itself is NOT rebased.
 */

import {
  computeDealScore,
  type DealScoreInput,
  type DealScorePrediction,
} from '@/lib/deal-score';

export interface DealScoreTerm {
  /** Short label, e.g. "Drop-chance term". */
  label: string;
  /** The arithmetic behind the term, e.g. "−0% × 0.4". */
  formula: string;
  /** Signed contribution to the raw total. */
  value: number;
}

export interface DealScoreBreakdown {
  terms: DealScoreTerm[];
  /** Sum of the terms before rounding/clamping. */
  rawTotal: number;
  /** The displayed Deal Score (rounded, clamped 0–100), or null. */
  score: number | null;
  /** True when the raw total was clamped to 0–100. */
  clamped: boolean;
  /** The inputs the terms were computed from. */
  inputs: DealScoreInput;
  /** Recorded price-history points behind the prediction, if known. */
  dataPoints: number | null;
}

/** The price term of the canonical formula, computed identically. */
export function dealScorePriceTerm(
  currentPrice: number | null,
  lowestPrice: number | null
): number {
  return currentPrice && lowestPrice ? (lowestPrice / currentPrice) * 30 : 20;
}

/**
 * Break a Deal Score into its terms. Returns null when the score
 * itself cannot be computed (missing/non-finite inputs) — a
 * missing prediction is "no breakdown", never a synthesized one.
 */
export function breakdownDealScore(
  input: DealScoreInput & { dataPoints?: number | null }
): DealScoreBreakdown | null {
  const score = computeDealScore(input);
  if (score === null) return null;
  const { discountProbability, currentPrice, lowestPrice, confidenceScore } = input;
  const dropTerm = -discountProbability * 0.4;
  const priceTerm = dealScorePriceTerm(currentPrice, lowestPrice);
  const confidenceTerm = confidenceScore * 0.3;
  const rawTotal = 100 + dropTerm + priceTerm + confidenceTerm;
  const priceFormula =
    currentPrice && lowestPrice
      ? `(${lowestPrice} / ${currentPrice}) × 30`
      : 'no current/lowest price → +20 (formula fallback)';
  return {
    terms: [
      {
        label: 'Base',
        formula: 'starting score',
        value: 100,
      },
      {
        label: 'Drop-chance term',
        formula: `−${discountProbability}% × 0.4`,
        value: dropTerm,
      },
      {
        label: 'Price term',
        formula: priceFormula,
        value: priceTerm,
      },
      {
        label: 'Confidence term',
        formula: `${confidenceScore} × 0.3`,
        value: confidenceTerm,
      },
    ],
    rawTotal,
    score,
    clamped: rawTotal < 0 || rawTotal > 100,
    inputs: {
      discountProbability,
      currentPrice,
      lowestPrice,
      confidenceScore,
    },
    dataPoints:
      typeof input.dataPoints === 'number' && Number.isFinite(input.dataPoints)
        ? input.dataPoints
        : null,
  };
}

/** Convenience wrapper for a predictions-API object (or null). */
export function breakdownDealScoreFromPrediction(
  prediction: DealScorePrediction | null | undefined
): DealScoreBreakdown | null {
  if (!prediction) return null;
  return breakdownDealScore(prediction);
}
