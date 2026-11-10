import { describe, expect, it } from 'vitest';
import {
  ACCURACY_MIN_RESOLVED,
  accuracySummaryLine,
  percentOrNull,
  resolvePredictionOutcome,
  summarizeAccuracy,
} from '@/lib/prediction-accuracy';

describe('resolvePredictionOutcome', () => {
  it('marks a predicted drop that happened as correct', () => {
    const result = resolvePredictionOutcome({
      discountProbability: 70,
      priceAtPrediction: 1000,
      actualLowestPrice: 950,
      predictedLowestPrice: 960,
    });
    expect(result?.status).toBe('correct');
    expect(result?.predictedDrop).toBe(true);
    expect(result?.actualDrop).toBe(true);
    expect(result?.priceWithinTolerance).toBe(true); // 950 vs 960 within 5%
  });

  it('marks a predicted drop that never happened as incorrect', () => {
    const result = resolvePredictionOutcome({
      discountProbability: 80,
      priceAtPrediction: 1000,
      actualLowestPrice: 1000,
      predictedLowestPrice: 900,
    });
    expect(result?.status).toBe('incorrect');
    expect(result?.actualDrop).toBe(false);
  });

  it('marks a correctly predicted no-drop as correct', () => {
    const result = resolvePredictionOutcome({
      discountProbability: 20,
      priceAtPrediction: 999,
      actualLowestPrice: 999,
      predictedLowestPrice: null,
    });
    expect(result?.status).toBe('correct');
    expect(result?.predictedDrop).toBe(false);
    expect(result?.priceWithinTolerance).toBeNull();
  });

  it('treats probability >= 50 as a predicted drop (boundary)', () => {
    const atThreshold = resolvePredictionOutcome({
      discountProbability: 50,
      priceAtPrediction: 100,
      actualLowestPrice: 99,
      predictedLowestPrice: null,
    });
    expect(atThreshold?.predictedDrop).toBe(true);
    const below = resolvePredictionOutcome({
      discountProbability: 49,
      priceAtPrediction: 100,
      actualLowestPrice: 99,
      predictedLowestPrice: null,
    });
    expect(below?.predictedDrop).toBe(false);
  });

  it('returns null (pending) while no actual price is known', () => {
    expect(
      resolvePredictionOutcome({
        discountProbability: 70,
        priceAtPrediction: 1000,
        actualLowestPrice: null,
        predictedLowestPrice: 900,
      })
    ).toBeNull();
  });

  it('returns null when the price at prediction time is unknown', () => {
    expect(
      resolvePredictionOutcome({
        discountProbability: 70,
        priceAtPrediction: null,
        actualLowestPrice: 900,
        predictedLowestPrice: 900,
      })
    ).toBeNull();
  });

  it('flags a predicted lowest price outside the 5% tolerance', () => {
    const result = resolvePredictionOutcome({
      discountProbability: 70,
      priceAtPrediction: 1000,
      actualLowestPrice: 800,
      predictedLowestPrice: 950,
    });
    expect(result?.status).toBe('correct'); // drop happened
    expect(result?.priceWithinTolerance).toBe(false); // 800 vs 950 is > 5% off
  });
});

describe('percentOrNull', () => {
  it('returns null on a zero denominator, never a guessed 0%', () => {
    expect(percentOrNull(0, 0)).toBeNull();
    expect(percentOrNull(5, 0)).toBeNull();
  });

  it('rounds to one decimal', () => {
    expect(percentOrNull(1, 3)).toBe(33.3);
    expect(percentOrNull(3, 4)).toBe(75);
  });
});

describe('summarizeAccuracy', () => {
  it('withholds the percentage until 20 outcomes resolve', () => {
    const outcomes = Array.from({ length: 5 }, () => ({
      status: 'correct' as const,
      horizonDays: 30,
    }));
    const summary = summarizeAccuracy(outcomes);
    expect(summary.hasEnoughHistory).toBe(false);
    expect(summary.status).toBe('not-enough-history');
    expect(summary.accuracyPercent).toBeNull();
    expect(summary.resolved).toBe(5);
    expect(summary.correct).toBe(5);
  });

  it('publishes the percentage once 20 outcomes resolve', () => {
    const outcomes = [
      ...Array.from({ length: 15 }, () => ({ status: 'correct' as const, horizonDays: 30 })),
      ...Array.from({ length: 5 }, () => ({ status: 'incorrect' as const, horizonDays: 30 })),
    ];
    const summary = summarizeAccuracy(outcomes);
    expect(summary.hasEnoughHistory).toBe(true);
    expect(summary.status).toBe('ready');
    expect(summary.accuracyPercent).toBe(75);
    expect(summary.resolved).toBe(20);
  });

  it('reports the honest empty state for zero recorded outcomes', () => {
    const summary = summarizeAccuracy([]);
    expect(summary.totalRecorded).toBe(0);
    expect(summary.accuracyPercent).toBeNull();
    expect(summary.hasEnoughHistory).toBe(false);
    expect(accuracySummaryLine(summary)).toContain('Not enough history yet');
    expect(accuracySummaryLine(summary)).toContain(`0 of ${ACCURACY_MIN_RESOLVED}`);
  });

  it('counts pending and expired separately from resolved', () => {
    const summary = summarizeAccuracy([
      { status: 'correct', horizonDays: 30 },
      { status: 'pending', horizonDays: 30 },
      { status: 'pending', horizonDays: 90 },
      { status: 'expired', horizonDays: 30 },
    ]);
    expect(summary.resolved).toBe(1);
    expect(summary.pending).toBe(2);
    expect(summary.expired).toBe(1);
    expect(summary.totalRecorded).toBe(4);
  });

  it('breaks accuracy down per horizon, withholding thin horizons', () => {
    const outcomes = [
      ...Array.from({ length: 20 }, () => ({ status: 'correct' as const, horizonDays: 30 })),
      ...Array.from({ length: 3 }, () => ({ status: 'correct' as const, horizonDays: 90 })),
    ];
    const summary = summarizeAccuracy(outcomes);
    const h30 = summary.byHorizon.find((h) => h.horizonDays === 30);
    const h90 = summary.byHorizon.find((h) => h.horizonDays === 90);
    expect(h30?.accuracyPercent).toBe(100);
    expect(h90?.accuracyPercent).toBeNull(); // only 3 resolved at 90 days
    expect(h90?.resolved).toBe(3);
  });
});
