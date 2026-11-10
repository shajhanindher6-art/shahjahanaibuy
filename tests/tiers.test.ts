import { describe, expect, it } from 'vitest';
import {
  TIERS,
  availabilityLabel,
  getTier,
  isConciergeIncluded,
  isPriceLockIncluded,
} from '@/lib/tiers';
import {
  PRICE_LOCK_GUARANTEE_DAYS,
  evaluatePriceLock,
  getPriceLockConfig,
  requestPriceLock,
} from '@/lib/price-lock';

describe('TIERS', () => {
  it('defines exactly Free / Premium / Family / Team', () => {
    expect(TIERS.map((t) => t.id)).toEqual(['free', 'premium', 'family', 'team']);
  });

  it('keeps Premium at the live $9.99/month price', () => {
    const premium = getTier('premium');
    expect(premium?.priceLabel).toBe('$9.99');
    expect(premium?.priceStatus).toBe('live');
    expect(premium?.availability).toBe('available');
  });

  it('does not invent a Family price — it is to be announced', () => {
    const family = getTier('family');
    expect(family?.priceLabel).toBe('To be announced');
    expect(family?.priceStatus).toBe('to_be_announced');
    expect(family?.availability).toBe('planned');
    expect(availabilityLabel(family!)).toContain('to be announced');
  });

  it('prices Team as custom / contact sales', () => {
    expect(getTier('team')?.priceStatus).toBe('custom');
  });

  it('returns null for an unknown tier', () => {
    expect(getTier('business' as never)).toBeNull();
  });

  it('includes price-lock on Premium/Family/Team only', () => {
    expect(isPriceLockIncluded('free')).toBe(false);
    expect(isPriceLockIncluded('premium')).toBe(true);
    expect(isPriceLockIncluded('family')).toBe(true);
    expect(isPriceLockIncluded('team')).toBe(true);
  });

  it('includes concierge on Team only', () => {
    expect(isConciergeIncluded('free')).toBe(false);
    expect(isConciergeIncluded('premium')).toBe(false);
    expect(isConciergeIncluded('family')).toBe(false);
    expect(isConciergeIncluded('team')).toBe(true);
  });
});

describe('price-lock (env-gated, dormant without Stripe)', () => {
  it('uses a 30-day guarantee window', () => {
    expect(PRICE_LOCK_GUARANTEE_DAYS).toBe(30);
  });

  it('rejects the Free tier and invalid prices', () => {
    expect(evaluatePriceLock({ tierId: 'free', priceCents: 99900 }).eligible).toBe(false);
    expect(evaluatePriceLock({ tierId: 'premium', priceCents: 0 }).eligible).toBe(false);
    expect(evaluatePriceLock({ tierId: 'premium', priceCents: -1 }).eligible).toBe(false);
    expect(evaluatePriceLock({ tierId: 'premium', priceCents: 99900 }).eligible).toBe(true);
  });

  it('reports dormant when Stripe is not configured', () => {
    // tests/setup.ts sets placeholder Supabase vars but no Stripe key.
    expect(getPriceLockConfig().stripeConfigured).toBe(false);
    const result = requestPriceLock({ tierId: 'premium', priceCents: 99900 });
    expect(result.status).toBe('dormant');
    expect(result.eligible).toBe(true);
    expect(result.reason).toContain('not active yet');
  });

  it('never claims a lock for an ineligible tier', () => {
    const result = requestPriceLock({ tierId: 'free', priceCents: 99900 });
    expect(result.status).toBe('dormant');
    expect(result.eligible).toBe(false);
  });
});
