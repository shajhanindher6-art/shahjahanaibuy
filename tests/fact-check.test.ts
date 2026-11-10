import { describe, expect, it } from 'vitest';
import { runAutomatedChecks } from '@/lib/fact-check';
import { computeAccuracy, accuracyScore, type AccuracySample } from '@/lib/price-accuracy';

function sample(overrides: Partial<AccuracySample> = {}): AccuracySample {
  return {
    id: 'sample-1',
    merchantId: 'merchant-1',
    productId: null,
    listingPrice: 999,
    checkoutPrice: 999,
    currency: 'USD',
    checkedAt: '2026-11-10T00:00:00.000Z',
    sampleSource: 'manual',
    notes: null,
    ...overrides,
  };
}

describe('runAutomatedChecks', () => {
  it('passes a clean deal: matching checkout, real discount, enough history, no caution', () => {
    const result = runAutomatedChecks({
      listingPrice: 999,
      compareAtPrice: 1099,
      checkoutPrice: 999,
      historyLowest: 999,
      historyPoints: 12,
      merchantCaution: false,
    });
    expect(result.overall).toBe('pass');
    expect(result.checks.map((c) => c.outcome)).toEqual(['pass', 'pass', 'pass', 'pass']);
  });

  it('fails when checkout does not match the listing price', () => {
    const result = runAutomatedChecks({
      listingPrice: 999,
      compareAtPrice: 1099,
      checkoutPrice: 1099,
      historyLowest: 999,
      historyPoints: 12,
      merchantCaution: false,
    });
    expect(result.overall).toBe('fail');
    expect(result.checks.find((c) => c.key === 'price_match')?.outcome).toBe('fail');
  });

  it('fails when the listing is above the compare-at price (false discount)', () => {
    const result = runAutomatedChecks({
      listingPrice: 1199,
      compareAtPrice: 1099,
      checkoutPrice: 1199,
      historyLowest: 999,
      historyPoints: 12,
      merchantCaution: false,
    });
    expect(result.overall).toBe('fail');
    expect(result.checks.find((c) => c.key === 'discount_real')?.outcome).toBe('fail');
  });

  it('fails when the price is far above the recent lowest', () => {
    const result = runAutomatedChecks({
      listingPrice: 1300,
      compareAtPrice: 1400,
      checkoutPrice: 1300,
      historyLowest: 999,
      historyPoints: 12,
      merchantCaution: false,
    });
    expect(result.checks.find((c) => c.key === 'discount_real')?.outcome).toBe('fail');
    expect(result.overall).toBe('fail');
  });

  it('fails on a merchant Caution flag even when prices check out', () => {
    const result = runAutomatedChecks({
      listingPrice: 999,
      compareAtPrice: 1099,
      checkoutPrice: 999,
      historyLowest: 999,
      historyPoints: 12,
      merchantCaution: true,
    });
    expect(result.checks.find((c) => c.key === 'merchant_reliability')?.outcome).toBe('fail');
    expect(result.overall).toBe('fail');
  });

  it('is inconclusive — never a pass — when no checkout sample exists', () => {
    const result = runAutomatedChecks({
      listingPrice: 999,
      compareAtPrice: 1099,
      checkoutPrice: null,
      historyLowest: 999,
      historyPoints: 12,
      merchantCaution: false,
    });
    expect(result.checks.find((c) => c.key === 'price_match')?.outcome).toBe('inconclusive');
    // The discount check passes on its own, but overall stays
    // inconclusive: a pass needs BOTH substantive price checks.
    expect(result.overall).toBe('inconclusive');
  });

  it('is inconclusive on thin history (not a failure)', () => {
    const result = runAutomatedChecks({
      listingPrice: 999,
      compareAtPrice: 1099,
      checkoutPrice: 999,
      historyLowest: 999,
      historyPoints: 2,
      merchantCaution: false,
    });
    expect(result.checks.find((c) => c.key === 'history_depth')?.outcome).toBe('inconclusive');
    expect(result.overall).toBe('pass');
  });

  it('is fully inconclusive when nothing but a listing price is known', () => {
    const result = runAutomatedChecks({ listingPrice: 999 });
    expect(result.overall).toBe('inconclusive');
    // Only the reliability check passes (no Caution flag) — and a
    // pass never rests on that check alone.
    expect(result.checks.find((c) => c.key === 'merchant_reliability')?.outcome).toBe('pass');
    expect(result.checks.find((c) => c.key === 'price_match')?.outcome).toBe('inconclusive');
    expect(result.checks.find((c) => c.key === 'discount_real')?.outcome).toBe('inconclusive');
  });
});

describe('computeAccuracy', () => {
  it('matches identical prices and prices within 1%', () => {
    expect(computeAccuracy({ listingPrice: 999, checkoutPrice: 999 }).matches).toBe(true);
    expect(computeAccuracy({ listingPrice: 1000, checkoutPrice: 1009 }).matches).toBe(true);
    expect(computeAccuracy({ listingPrice: 1000, checkoutPrice: 991 }).matches).toBe(true);
  });

  it('does not match prices differing by more than 1%', () => {
    const result = computeAccuracy({ listingPrice: 999, checkoutPrice: 1099 });
    expect(result.matches).toBe(false);
    expect(result.difference).toBe(100);
    expect(result.differencePct).toBeCloseTo(10.01, 1);
  });
});

describe('accuracyScore', () => {
  it('returns null with no samples — "No audits yet", never a guessed score', () => {
    const result = accuracyScore([]);
    expect(result.score).toBeNull();
    expect(result.status).toBe('insufficient');
    expect(result.caution).toBe(false);
    expect(result.insufficientSamples).toBe(true);
  });

  it('scores 100% when every recorded sample matches', () => {
    const result = accuracyScore([sample(), sample({ id: 's2' })]);
    expect(result.score).toBe(100);
    expect(result.matchCount).toBe(2);
    expect(result.status).toBe('insufficient'); // only 2 samples — too few to judge
    expect(result.caution).toBe(false);
  });

  it('never raises Caution below 5 samples, even at 0% accuracy', () => {
    const bad = [sample({ id: 's1', checkoutPrice: 1200 }), sample({ id: 's2', checkoutPrice: 1200 })];
    const result = accuracyScore(bad);
    expect(result.score).toBe(0);
    expect(result.caution).toBe(false);
    expect(result.status).toBe('insufficient');
  });

  it('raises Caution at <95% with 5+ samples', () => {
    const samples = [
      sample({ id: 's1' }),
      sample({ id: 's2' }),
      sample({ id: 's3' }),
      sample({ id: 's4' }),
      sample({ id: 's5', checkoutPrice: 1200 }),
    ];
    const result = accuracyScore(samples);
    expect(result.score).toBe(80);
    expect(result.caution).toBe(true);
    expect(result.status).toBe('caution');
  });

  it('is ok at exactly 95% with 5+ samples (20 samples, 1 mismatch)', () => {
    const samples = Array.from({ length: 20 }, (_, i) =>
      sample({ id: `s${i}`, checkoutPrice: i === 0 ? 1200 : 999 })
    );
    const result = accuracyScore(samples);
    expect(result.score).toBe(95);
    expect(result.caution).toBe(false);
    expect(result.status).toBe('ok');
  });
});
