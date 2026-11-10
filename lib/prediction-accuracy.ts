/**
 * Prediction accuracy tracking (Section 4, item 8).
 *
 * Pure logic only — no database, no network. The recorder route
 * (app/api/v1/predictions/outcomes) stores rows; this module decides
 * what "correct" means and when the dashboard is allowed to show a
 * percentage at all.
 *
 * Honesty rule: accuracy is a claim about the past. Until enough
 * resolved outcomes exist, the dashboard must say "not enough history
 * yet" — never a percentage computed from a handful of rows. Recorded
 * price history today spans ~30 days (Oct 3 → Nov 2, 2026), so the
 * honest state today is "not enough history yet".
 */

/** A prediction said a drop was likely when its probability was >= 50%. */
export const DROP_PROBABILITY_THRESHOLD = 50;

/** Minimum resolved outcomes before an accuracy % may be published. */
export const ACCURACY_MIN_RESOLVED = 20;

/** A predicted lowest price counts as "close" when within 5% of actual. */
export const PRICE_TOLERANCE_FRACTION = 0.05;

export type PredictionOutcomeStatus = 'pending' | 'correct' | 'incorrect' | 'expired';

export interface PredictionOutcomeInput {
  /** Discount probability recorded with the prediction (0–100). */
  discountProbability: number;
  /** Price at the moment the prediction was made, or null if unknown. */
  priceAtPrediction: number | null;
  /** Lowest recorded price inside the horizon, or null if not yet known. */
  actualLowestPrice: number | null;
  /** Lowest price the prediction expected, or null if it made none. */
  predictedLowestPrice: number | null;
}

export interface ResolvedPredictionOutcome {
  status: Exclude<PredictionOutcomeStatus, 'pending'>;
  /** True when the prediction said a drop was likely. */
  predictedDrop: boolean;
  /** True when a real drop happened inside the horizon. */
  actualDrop: boolean;
  /**
   * True when the predicted lowest price landed within tolerance of the
   * actual lowest price; null when no lowest price was predicted or no
   * actual price is known yet.
   */
  priceWithinTolerance: boolean | null;
}

/**
 * Resolve one prediction against what actually happened.
 *
 * Returns null while the outcome is still unknown (no actual lowest
 * price recorded yet) — the caller keeps the row 'pending' in that
 * case instead of guessing.
 */
export function resolvePredictionOutcome(
  input: PredictionOutcomeInput
): ResolvedPredictionOutcome | null {
  const { discountProbability, priceAtPrediction, actualLowestPrice, predictedLowestPrice } = input;

  if (actualLowestPrice === null || actualLowestPrice === undefined) return null;
  if (priceAtPrediction === null || priceAtPrediction === undefined) return null;

  const predictedDrop = discountProbability >= DROP_PROBABILITY_THRESHOLD;
  const actualDrop = actualLowestPrice < priceAtPrediction;
  const correct = predictedDrop === actualDrop;

  let priceWithinTolerance: boolean | null = null;
  if (predictedLowestPrice !== null && predictedLowestPrice !== undefined && predictedLowestPrice > 0) {
    const diff = Math.abs(actualLowestPrice - predictedLowestPrice) / predictedLowestPrice;
    priceWithinTolerance = diff <= PRICE_TOLERANCE_FRACTION;
  }

  return {
    status: correct ? 'correct' : 'incorrect',
    predictedDrop,
    actualDrop,
    priceWithinTolerance,
  };
}

export interface AccuracyOutcomeRow {
  status: PredictionOutcomeStatus;
  horizonDays: number;
}

export interface HorizonAccuracy {
  horizonDays: number;
  resolved: number;
  correct: number;
  /** Null until this horizon alone has enough resolved outcomes. */
  accuracyPercent: number | null;
}

export interface AccuracySummary {
  totalRecorded: number;
  resolved: number;
  correct: number;
  incorrect: number;
  pending: number;
  expired: number;
  /**
   * Overall accuracy %, or null until ACCURACY_MIN_RESOLVED outcomes
   * have resolved. Null is the honest state — never 0, never a guess.
   */
  accuracyPercent: number | null;
  hasEnoughHistory: boolean;
  status: 'not-enough-history' | 'ready';
  byHorizon: HorizonAccuracy[];
}

/** One-decimal percentage, or null when the denominator is zero. */
export function percentOrNull(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Summarize recorded outcomes into the dashboard view-model.
 * Pure: pass in rows from `prediction_outcomes`, get the summary.
 */
export function summarizeAccuracy(outcomes: AccuracyOutcomeRow[]): AccuracySummary {
  let resolved = 0;
  let correct = 0;
  let incorrect = 0;
  let pending = 0;
  let expired = 0;

  const byHorizonMap = new Map<number, { resolved: number; correct: number }>();

  for (const row of outcomes) {
    const bucket = byHorizonMap.get(row.horizonDays) ?? { resolved: 0, correct: 0 };
    byHorizonMap.set(row.horizonDays, bucket);
    if (row.status === 'correct') {
      resolved++;
      correct++;
      bucket.resolved++;
      bucket.correct++;
    } else if (row.status === 'incorrect') {
      resolved++;
      incorrect++;
      bucket.resolved++;
    } else if (row.status === 'pending') {
      pending++;
    } else {
      expired++;
    }
  }

  const hasEnoughHistory = resolved >= ACCURACY_MIN_RESOLVED;
  const byHorizon: HorizonAccuracy[] = [...byHorizonMap.entries()]
    .map(([horizonDays, counts]) => ({
      horizonDays,
      resolved: counts.resolved,
      correct: counts.correct,
      accuracyPercent:
        counts.resolved >= ACCURACY_MIN_RESOLVED
          ? percentOrNull(counts.correct, counts.resolved)
          : null,
    }))
    .sort((a, b) => a.horizonDays - b.horizonDays);

  return {
    totalRecorded: outcomes.length,
    resolved,
    correct,
    incorrect,
    pending,
    expired,
    accuracyPercent: hasEnoughHistory ? percentOrNull(correct, resolved) : null,
    hasEnoughHistory,
    status: hasEnoughHistory ? 'ready' : 'not-enough-history',
    byHorizon,
  };
}

/** Plain-language line the dashboard shows under the headline number. */
export function accuracySummaryLine(summary: AccuracySummary): string {
  if (!summary.hasEnoughHistory) {
    return (
      `Not enough history yet — ${summary.resolved} of ${ACCURACY_MIN_RESOLVED} ` +
      `resolved predictions needed before an accuracy percentage can be published. ` +
      `${summary.pending} prediction${summary.pending === 1 ? '' : 's'} still waiting for ` +
      `their horizon to pass.`
    );
  }
  return (
    `${summary.accuracyPercent}% of ${summary.resolved} resolved predictions were correct ` +
    `(${summary.correct} correct, ${summary.incorrect} incorrect).`
  );
}
