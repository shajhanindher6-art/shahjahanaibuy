import { describe, expect, it } from 'vitest';
import {
  calculateQuotaTier,
  parseQuotaCalls,
  QUOTA_TIERS,
} from '@/lib/api-quota-calculator';

describe('QUOTA_TIERS', () => {
  it('lists the real quotas: anon 100, free 1,000, premium/family 10,000, team 100,000', () => {
    expect(QUOTA_TIERS.map((t) => [t.id, t.quota])).toEqual([
      ['anonymous', 100],
      ['free', 1000],
      ['premium', 10000],
      ['family', 10000],
      ['team', 100000],
    ]);
  });

  it('labels paid prices honestly — Premium is planned, never purchasable', () => {
    const premium = QUOTA_TIERS.find((t) => t.id === 'premium')!;
    expect(premium.priceLabel).toBe('$9.99');
    expect(premium.pricePlanned).toBe(true);
    expect(premium.priceHonesty).toBe('Planned — price to be announced');
    const free = QUOTA_TIERS.find((t) => t.id === 'free')!;
    expect(free.priceLabel).toBe('$0');
    expect(free.pricePlanned).toBe(false);
    const family = QUOTA_TIERS.find((t) => t.id === 'family')!;
    expect(family.priceLabel).toBe('To be announced');
    expect(family.pricePlanned).toBe(true);
    const team = QUOTA_TIERS.find((t) => t.id === 'team')!;
    expect(team.priceLabel).toBe('Custom');
    expect(team.pricePlanned).toBe(true);
  });
});

describe('calculateQuotaTier', () => {
  it('50 calls/day fits anonymous with 50 headroom, next tier Free', () => {
    const calc = calculateQuotaTier(50);
    expect(calc.neededTier?.id).toBe('anonymous');
    expect(calc.headroom).toBe(50);
    expect(calc.nextTier?.id).toBe('free');
    expect(calc.exceedsMax).toBe(false);
  });

  it('exactly 100 calls/day still fits anonymous (quota is inclusive)', () => {
    expect(calculateQuotaTier(100).neededTier?.id).toBe('anonymous');
    expect(calculateQuotaTier(100).headroom).toBe(0);
  });

  it('101 calls/day needs Free with 899 headroom, next tier Premium', () => {
    const calc = calculateQuotaTier(101);
    expect(calc.neededTier?.id).toBe('free');
    expect(calc.headroom).toBe(899);
    expect(calc.nextTier?.id).toBe('premium');
  });

  it('5,000 calls/day needs Premium — Family is never "needed" for quota alone', () => {
    const calc = calculateQuotaTier(5000);
    expect(calc.neededTier?.id).toBe('premium');
    expect(calc.headroom).toBe(5000);
    expect(calc.nextTier?.id).toBe('team');
  });

  it('50,000 calls/day needs Team with 50,000 headroom and no tier above', () => {
    const calc = calculateQuotaTier(50000);
    expect(calc.neededTier?.id).toBe('team');
    expect(calc.headroom).toBe(50000);
    expect(calc.nextTier).toBeNull();
  });

  it('more than 100,000 calls/day exceeds every tier', () => {
    const calc = calculateQuotaTier(100001);
    expect(calc.neededTier).toBeNull();
    expect(calc.headroom).toBeNull();
    expect(calc.nextTier).toBeNull();
    expect(calc.exceedsMax).toBe(true);
  });

  it('0 calls/day fits anonymous', () => {
    expect(calculateQuotaTier(0).neededTier?.id).toBe('anonymous');
  });
});

describe('parseQuotaCalls', () => {
  it('parses integers and floors decimals', () => {
    expect(parseQuotaCalls({ calls: '500' })).toBe(500);
    expect(parseQuotaCalls({ calls: '500.9' })).toBe(500);
    expect(parseQuotaCalls({ calls: ['250', '999'] })).toBe(250);
  });

  it('returns null for missing or invalid input — never a guessed number', () => {
    expect(parseQuotaCalls(undefined)).toBeNull();
    expect(parseQuotaCalls({})).toBeNull();
    expect(parseQuotaCalls({ calls: '' })).toBeNull();
    expect(parseQuotaCalls({ calls: 'abc' })).toBeNull();
    expect(parseQuotaCalls({ calls: '-5' })).toBeNull();
  });
});
