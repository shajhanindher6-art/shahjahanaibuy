import { describe, expect, it } from 'vitest';
import {
  computeRegretRisk,
  specOverkillPoints,
} from '@/lib/analytics/regretRisk';

describe('computeRegretRisk', () => {
  it('scores $999 against a $1000 budget as 55 (moderate)', () => {
    const result = computeRegretRisk({
      priceUsd: 999,
      monthlyBudgetUsd: 1000,
      specOverkillPoints: 0,
    });
    expect(result?.score).toBe(55);
    expect(result?.category).toBe('moderate');
    expect(result?.label).toBe('Moderate Risk');
    expect(result?.priceToBudgetRatio).toBe(1);
  });

  it('scores a cheap product against a big budget as low risk', () => {
    const result = computeRegretRisk({
      priceUsd: 200,
      monthlyBudgetUsd: 1000,
      specOverkillPoints: 0,
    });
    expect(result?.score).toBe(23);
    expect(result?.category).toBe('low');
    expect(result?.advice).toContain('Fits budget well');
  });

  it('caps the score at 100 for a price far above budget', () => {
    const result = computeRegretRisk({
      priceUsd: 2000,
      monthlyBudgetUsd: 500,
      specOverkillPoints: 0,
    });
    expect(result?.score).toBe(100);
    expect(result?.category).toBe('high');
  });

  it('adds overkill points to the score', () => {
    const result = computeRegretRisk({
      priceUsd: 999,
      monthlyBudgetUsd: 1000,
      specOverkillPoints: 25,
    });
    expect(result?.score).toBe(80);
    expect(result?.category).toBe('high');
    expect(result?.advice).toContain('unused specs');
  });

  it('returns null without a recorded price or a usable budget', () => {
    expect(
      computeRegretRisk({ priceUsd: null, monthlyBudgetUsd: 1000, specOverkillPoints: 0 })
    ).toBeNull();
    expect(
      computeRegretRisk({ priceUsd: 999, monthlyBudgetUsd: 0, specOverkillPoints: 0 })
    ).toBeNull();
    expect(
      computeRegretRisk({ priceUsd: 999, monthlyBudgetUsd: null, specOverkillPoints: 0 })
    ).toBeNull();
  });
});

describe('specOverkillPoints', () => {
  it('maps the needs-vs-tier gap to 0/10/15/25 points', () => {
    expect(specOverkillPoints({ needsLevel: 'basic', specTier: 'pro' })).toBe(25);
    expect(specOverkillPoints({ needsLevel: 'basic', specTier: 'balanced' })).toBe(10);
    expect(specOverkillPoints({ needsLevel: 'balanced', specTier: 'pro' })).toBe(15);
    expect(specOverkillPoints({ needsLevel: 'pro', specTier: 'pro' })).toBe(0);
    expect(specOverkillPoints({ needsLevel: 'balanced', specTier: 'basic' })).toBe(0);
  });

  it('returns null when no specs were recorded', () => {
    expect(specOverkillPoints({ needsLevel: 'balanced', specTier: null })).toBeNull();
  });
});
