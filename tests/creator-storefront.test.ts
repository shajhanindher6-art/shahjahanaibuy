import { describe, expect, it } from 'vitest';
import { isValidCreatorSlug } from '@/lib/creator-storefront';
import { badgeForVerifiedDeals, badgeLabel, computeRevenueShare } from '@/lib/creator-rewards';
import { isDealVerified } from '@/services/community-deals';

describe('isValidCreatorSlug', () => {
  it('accepts lowercase slugs of 2–64 chars', () => {
    expect(isValidCreatorSlug('deals-by-ana')).toBe(true);
    expect(isValidCreatorSlug('ab')).toBe(true);
    expect(isValidCreatorSlug('creator1')).toBe(true);
    expect(isValidCreatorSlug('x'.repeat(64))).toBe(true);
  });

  it('rejects bad slugs', () => {
    expect(isValidCreatorSlug('a')).toBe(false);
    expect(isValidCreatorSlug('')).toBe(false);
    expect(isValidCreatorSlug('x'.repeat(65))).toBe(false);
    expect(isValidCreatorSlug('UPPER')).toBe(false);
    expect(isValidCreatorSlug('has space')).toBe(false);
    expect(isValidCreatorSlug('-leading')).toBe(false);
    expect(isValidCreatorSlug('trailing-')).toBe(false);
    expect(isValidCreatorSlug('under_score')).toBe(false);
    expect(isValidCreatorSlug(undefined)).toBe(false);
    expect(isValidCreatorSlug(42)).toBe(false);
  });
});

describe('storefront badge derivation', () => {
  it('derives the badge from the verified-deal count, never from votes', () => {
    expect(badgeForVerifiedDeals(0)).toBe('none');
    expect(badgeForVerifiedDeals(1)).toBe('bronze');
    expect(badgeForVerifiedDeals(5)).toBe('silver');
    expect(badgeForVerifiedDeals(15)).toBe('gold');
    expect(badgeForVerifiedDeals(30)).toBe('platinum');
    expect(badgeLabel('gold')).toBe('Gold Contributor');
    expect(badgeLabel('none')).toBe('No badge yet');
  });
});

describe('storefront deal verification (verified-approved only)', () => {
  const base = {
    product_id: 'p1',
    merchant_id: 'm1',
    price: 100,
    is_verified: false,
  };

  it('admits an admin-verified deal', () => {
    expect(isDealVerified({ ...base, is_verified: true }, [])).toBe(true);
  });

  it('admits a price-matched deal (within 5% of the merchant price)', () => {
    expect(
      isDealVerified(base, [{ merchant_id: 'm1', product_id: 'p1', price: 102 }])
    ).toBe(true);
  });

  it('excludes a deal whose price does not match any merchant price', () => {
    expect(
      isDealVerified(base, [{ merchant_id: 'm1', product_id: 'p1', price: 200 }])
    ).toBe(false);
    expect(isDealVerified(base, [])).toBe(false);
  });

  it('excludes a deal with no product, merchant, or price link', () => {
    expect(isDealVerified({ ...base, product_id: null }, [])).toBe(false);
    expect(isDealVerified({ ...base, merchant_id: null }, [])).toBe(false);
    expect(isDealVerified({ ...base, price: null }, [])).toBe(false);
  });
});

describe('storefront revenue share display', () => {
  it('computes no revenue share while the owner has not configured it', () => {
    // CREATOR_REVENUE_SHARE_PERCENT is unset in tests: the
    // storefront displays nothing about revenue share.
    expect(computeRevenueShare({ affiliateRevenueCents: 10000 })).toBeNull();
  });
});
