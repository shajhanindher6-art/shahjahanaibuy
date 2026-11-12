import { describe, expect, it } from 'vitest';
import {
  TIERS,
  availabilityLabel,
  getMaxAlerts,
  getTier,
  isAlertCapReached,
  isConciergeIncluded,
  isPriceLockIncluded,
  normalizeTierId,
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

  it('keeps Premium at the planned $9.99/month price — NOT live (Section 15 P2-5)', () => {
    const premium = getTier('premium');
    expect(premium?.priceLabel).toBe('$9.99');
    expect(premium?.priceStatus).toBe('planned');
    expect(premium?.availability).toBe('planned');
    expect(availabilityLabel(premium!)).toContain('Planned');
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

  it('caps Free at 5 price alerts — canonical per Section 12', () => {
    expect(getTier('free')?.maxAlerts).toBe(5);
    expect(getMaxAlerts('free')).toBe(5);
    expect(isAlertCapReached('free', 4)).toBe(false);
    expect(isAlertCapReached('free', 5)).toBe(true);
    expect(isAlertCapReached('free', 6)).toBe(true);
  });

  it('gives Premium / Family / Team unlimited alerts', () => {
    // Premium advertises "Unlimited price alerts"; Family and Team
    // advertise "Everything in Premium".
    expect(getMaxAlerts('premium')).toBeNull();
    expect(getMaxAlerts('family')).toBeNull();
    expect(getMaxAlerts('team')).toBeNull();
    expect(isAlertCapReached('premium', 100)).toBe(false);
    expect(isAlertCapReached('team', 100)).toBe(false);
  });

  it('fails closed to the Free cap for an unknown tier', () => {
    expect(getMaxAlerts('business' as never)).toBe(5);
    expect(isAlertCapReached('business' as never, 5)).toBe(true);
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

describe('normalizeTierId (Section 15 P2-2 legacy plan-key compat)', () => {
  it("maps the legacy 'pro' key onto 'premium'", () => {
    expect(normalizeTierId('pro')).toBe('premium');
  });

  it('passes canonical TierIds through unchanged', () => {
    expect(normalizeTierId('free')).toBe('free');
    expect(normalizeTierId('premium')).toBe('premium');
    expect(normalizeTierId('family')).toBe('family');
    expect(normalizeTierId('team')).toBe('team');
  });

  it('fails closed to free (or the given fallback) for unknown values', () => {
    expect(normalizeTierId('enterprise')).toBe('free');
    expect(normalizeTierId(null)).toBe('free');
    expect(normalizeTierId(undefined)).toBe('free');
    expect(normalizeTierId('enterprise', 'premium')).toBe('premium');
  });
});
