/**
 * Single pricing config (Section 15, P2-1 / P2-2 / P2-7 / P2-8).
 *
 * - PRICE_IDS come from env and are nullable; nothing is
 *   purchasable by default (no price IDs, no launch approval).
 * - getPriceDisplay returns a *planned* label, never a hardcoded
 *   dollar figure presented as a live charge.
 * - Trial / Starter are configurable options, OFF by default.
 * - No $-amount literal appears in the checkout paths except via
 *   the pricing config (P2-8 source-scan test at the bottom).
 *
 * Env-dependent cases re-import the module with a fresh env
 * (vi.resetModules + dynamic import), same pattern as
 * tests/stripe-live-guard.test.ts. No real key or price ID is
 * used anywhere — only fake `price_...` placeholders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLAN_CONFIG, type PlanKey } from '@/services/stripe';
import {
  PRICE_IDS,
  getPriceDisplay,
  getPriceIdForTier,
  getStarterPriceDisplay,
  getTrialDays,
  isPurchasable,
  isStarterConfigured,
  isTrialOffered,
  normalizePlanKey,
} from '@/lib/pricing-config';

type PricingConfig = typeof import('@/lib/pricing-config');

async function loadPricingConfig(): Promise<PricingConfig> {
  vi.resetModules();
  return (await import('@/lib/pricing-config')) as PricingConfig;
}

describe('pricing config defaults (no Stripe price env)', () => {
  it('has no price IDs configured', () => {
    expect(PRICE_IDS.premium).toBeNull();
    expect(PRICE_IDS.family).toBeNull();
    expect(PRICE_IDS.team).toBeNull();
    expect(PRICE_IDS.starter).toBeNull();
    expect(getPriceIdForTier('premium')).toBeNull();
  });

  it('nothing is purchasable without a price ID and launch approval', () => {
    expect(isPurchasable('premium')).toBe(false);
    expect(isPurchasable('family')).toBe(false);
    expect(isPurchasable('team')).toBe(false);
    expect(isPurchasable('starter')).toBe(false);
  });

  it('labels Premium as a planned price, never a live charge', () => {
    expect(getPriceDisplay('premium')).toContain('$9.99');
    expect(getPriceDisplay('premium')).toContain('planned');
    expect(getPriceDisplay('premium')).toContain('not a live charge');
    expect(getPriceDisplay('free')).toBe('$0 forever');
  });

  it('Starter is off by default and never states a dollar figure', () => {
    expect(isStarterConfigured()).toBe(false);
    expect(getStarterPriceDisplay()).not.toMatch(/\$\d/);
    expect(getStarterPriceDisplay()).toContain('planned');
  });

  it('trial defaults to 0 days (no trial)', () => {
    expect(getTrialDays()).toBe(0);
    expect(isTrialOffered()).toBe(false);
  });
});

describe('PLAN_CONFIG (Section 15 P2-2 tier-key unification)', () => {
  it("has 'premium' as the canonical key with the legacy 'pro' alias", () => {
    expect(Object.keys(PLAN_CONFIG)).toContain('premium');
    expect(Object.keys(PLAN_CONFIG)).toContain('pro');
    expect((PLAN_CONFIG.pro as { priceId: string | null }).priceId).toBe(
      (PLAN_CONFIG.premium as { priceId: string | null }).priceId
    );
    expect(PLAN_CONFIG.premium.name).toBe('Premium');
    const key: PlanKey = 'premium';
    expect(PLAN_CONFIG[key].name).toBe('Premium');
  });

  it("normalizes the legacy 'pro' key onto 'premium'", () => {
    expect(normalizePlanKey('pro')).toBe('premium');
    expect(normalizePlanKey('premium')).toBe('premium');
    expect(normalizePlanKey('enterprise')).toBe('free');
  });
});

describe('pricing config with env set (dynamic import)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of [
      'STRIPE_PREMIUM_PRICE_ID',
      'STRIPE_PRO_PRICE_ID',
      'STRIPE_FAMILY_PRICE_ID',
      'STRIPE_STARTER_PRICE_ID',
      'STRIPE_TRIAL_DAYS',
      'STRIPE_LIVE_LAUNCHED',
    ]) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.resetModules();
  });

  it('prefers STRIPE_PREMIUM_PRICE_ID; the old name works as a deprecated alias', async () => {
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro_alias';
    let config = await loadPricingConfig();
    expect(config.PRICE_IDS.premium).toBe('price_pro_alias');

    process.env.STRIPE_PREMIUM_PRICE_ID = 'price_premium_new';
    config = await loadPricingConfig();
    expect(config.PRICE_IDS.premium).toBe('price_premium_new');
  });

  it('isPurchasable needs BOTH a price ID and launch approval', async () => {
    process.env.STRIPE_PREMIUM_PRICE_ID = 'price_premium';
    let config = await loadPricingConfig();
    expect(config.isPurchasable('premium')).toBe(false);

    process.env.STRIPE_LIVE_LAUNCHED = 'true';
    config = await loadPricingConfig();
    expect(config.isPurchasable('premium')).toBe(true);
    expect(config.getPriceDisplay('premium')).toBe('$9.99 per month');
  });

  it('trial days are honoured only when > 0 AND launch approved', async () => {
    process.env.STRIPE_TRIAL_DAYS = '14';
    let config = await loadPricingConfig();
    expect(config.getTrialDays()).toBe(14);
    expect(config.isTrialOffered()).toBe(false);

    process.env.STRIPE_LIVE_LAUNCHED = 'true';
    config = await loadPricingConfig();
    expect(config.isTrialOffered()).toBe(true);
  });

  it('non-numeric / negative trial days fail closed to 0', async () => {
    for (const raw of ['abc', '-5', '']) {
      process.env.STRIPE_TRIAL_DAYS = raw;
      const config = await loadPricingConfig();
      expect(config.getTrialDays()).toBe(0);
    }
  });

  it('Starter exists only when its price ID is set', async () => {
    let config = await loadPricingConfig();
    expect(config.isStarterConfigured()).toBe(false);
    process.env.STRIPE_STARTER_PRICE_ID = 'price_starter';
    config = await loadPricingConfig();
    expect(config.isStarterConfigured()).toBe(true);
  });
});

describe('no hardcoded $-amount in checkout paths (Section 15 P2-8)', () => {
  // A $-amount may only ever come from the pricing config (which
  // itself holds no amounts — it holds env price IDs and planned
  // labels from lib/tiers.ts). These files must contain no
  // "$9.99" / "$1" style literal and no bare 9.99/4.99 price
  // literal. Real invoice amounts rendered from Stripe data
  // (`${(record.amount_paid / 100).toFixed(2)}`) are data, not a
  // hardcoded price — the `$` there is followed by `{`, not a digit.
  const CHECKOUT_PATH_FILES = [
    'services/stripe.ts',
    'app/api/v1/subscriptions/checkout/route.ts',
    'app/dashboard/billing/page.tsx',
    'lib/pricing-config.ts',
  ];

  for (const file of CHECKOUT_PATH_FILES) {
    it(`${file} contains no hardcoded dollar amount`, () => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/\$\d/);
      expect(source).not.toMatch(/\b(9\.99|4\.99|1\.00)\b/);
    });
  }
});
