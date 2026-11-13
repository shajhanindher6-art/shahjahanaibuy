/**
 * Section 19, Phase 2 — time-series anomaly detection (§12 #19;
 * task item 9).
 *
 * analyzeTrust previously had a single narrow price check (≥50%
 * below the category average → caution) and a review-skew check
 * needing ≥10 reviews. These tests pin the three new detections:
 * spike/drop flagging (one recorded step ≥25%), flatline
 * detection (≥3 consecutive identical recordings), and the
 * cross-merchant outlier check (a merchant ≥50% below the
 * cross-merchant median). Every flag names the anomaly type +
 * the evidence, never a cause.
 */

import { describe, expect, it } from 'vitest';
import { analyzeTrust, type TrustInput } from '@/services/trust-signals';

function baseInput(overrides: Partial<TrustInput> = {}): TrustInput {
  return {
    merchantNames: ['Amazon'],
    knownRetailers: ['Amazon', 'Best Buy'],
    totalReviews: 0,
    ratingDistribution: {},
    priceUsd: 999,
    categoryAverageUsd: 1000,
    imageUrl: 'https://example.com/img.jpg',
    ...overrides,
  };
}

describe('analyzeTrust — spike/drop flagging', () => {
  it('flags a single-step drop of ≥25% with the prices and date', () => {
    const result = analyzeTrust(
      baseInput({
        priceHistory: [
          { price: 1200, recordedAt: '2026-10-20T00:00:00.000Z' },
          { price: 800, recordedAt: '2026-11-02T00:00:00.000Z' },
        ],
      })
    );
    expect(result.verdict).toBe('caution');
    expect(
      result.signals.some(
        (s) => s.kind === 'price' && s.detail.includes('drop of 33%')
      )
    ).toBe(true);
    expect(
      result.signals.some((s) => s.detail.includes('$1,200.00') || s.detail.includes('1200'))
    ).toBe(true);
  });

  it('flags a single-step spike of ≥25%', () => {
    const result = analyzeTrust(
      baseInput({
        priceHistory: [
          { price: 800, recordedAt: '2026-10-20T00:00:00.000Z' },
          { price: 1100, recordedAt: '2026-11-02T00:00:00.000Z' },
        ],
      })
    );
    expect(result.verdict).toBe('caution');
    expect(
      result.signals.some((s) => s.kind === 'price' && s.detail.includes('spike of 38%'))
    ).toBe(true);
  });

  it('does not flag ordinary moves below 25%', () => {
    const result = analyzeTrust(
      baseInput({
        priceHistory: [
          { price: 1000, recordedAt: '2026-10-20T00:00:00.000Z' },
          { price: 999, recordedAt: '2026-11-02T00:00:00.000Z' },
        ],
      })
    );
    expect(
      result.signals.some((s) => s.detail.includes('spike') || s.detail.includes('drop of'))
    ).toBe(false);
  });
});

describe('analyzeTrust — flatline detection', () => {
  it('flags 3+ consecutive identical recordings as a flatline', () => {
    const result = analyzeTrust(
      baseInput({
        priceHistory: [
          { price: 1099, recordedAt: '2026-10-20T00:00:00.000Z' },
          { price: 999, recordedAt: '2026-10-27T00:00:00.000Z' },
          { price: 999, recordedAt: '2026-11-02T00:00:00.000Z' },
          { price: 999, recordedAt: '2026-11-09T00:00:00.000Z' },
        ],
      })
    );
    expect(result.verdict).toBe('caution');
    expect(
      result.signals.some((s) => s.kind === 'price' && s.detail.includes('flatline'))
    ).toBe(true);
    expect(
      result.signals.some((s) => s.detail.includes('3 consecutive recordings'))
    ).toBe(true);
  });

  it('reports exactly 2 identical recordings as unknown, not a caution', () => {
    const result = analyzeTrust(
      baseInput({
        priceHistory: [
          { price: 1099, recordedAt: '2026-10-27T00:00:00.000Z' },
          { price: 999, recordedAt: '2026-11-02T00:00:00.000Z' },
          { price: 999, recordedAt: '2026-11-09T00:00:00.000Z' },
        ],
      })
    );
    // 2 identical points: too little to call a flatline — the
    // signal is unknown, so it cannot flip the verdict to caution
    // on its own (0 reviews already cap this input at insufficient).
    expect(
      result.signals.some((s) => s.detail.includes('flatline'))
    ).toBe(false);
    expect(
      result.signals.some(
        (s) => s.unknown === true && s.detail.includes('2 consecutive recordings')
      )
    ).toBe(true);
  });
});

describe('analyzeTrust — cross-merchant outlier check', () => {
  it('flags a merchant ≥50% below the cross-merchant median', () => {
    const result = analyzeTrust(
      baseInput({
        merchantPrices: [
          { merchant: 'Amazon', price: 999 },
          { merchant: 'Best Buy', price: 1049 },
          { merchant: 'BargainHub', price: 400 },
        ],
      })
    );
    expect(result.verdict).toBe('caution');
    expect(
      result.signals.some(
        (s) => s.kind === 'price' && s.detail.includes('BargainHub') && s.detail.includes('below the median')
      )
    ).toBe(true);
  });

  it('does not flag when merchants cluster, and adds no signal with one merchant', () => {
    const clustered = analyzeTrust(
      baseInput({
        merchantPrices: [
          { merchant: 'Amazon', price: 999 },
          { merchant: 'Best Buy', price: 1049 },
        ],
      })
    );
    expect(
      clustered.signals.some((s) => s.detail.includes('below the median'))
    ).toBe(false);

    const single = analyzeTrust(
      baseInput({ merchantPrices: [{ merchant: 'Amazon', price: 999 }] })
    );
    expect(
      single.signals.some((s) => s.detail.includes('median'))
    ).toBe(false);
  });

  it('adds no time-series signals at all when no history is supplied', () => {
    const result = analyzeTrust(baseInput());
    expect(
      result.signals.some(
        (s) => s.detail.includes('spike') || s.detail.includes('flatline') || s.detail.includes('median')
      )
    ).toBe(false);
    // Unchanged behaviour without the new inputs: 0 reviews caps
    // the verdict at insufficient.
    expect(result.verdict).toBe('insufficient');
  });
});
