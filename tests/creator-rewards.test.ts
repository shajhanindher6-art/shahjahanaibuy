import { describe, expect, it, afterEach } from 'vitest';
import {
  POINTS_PER_VERIFIED_DEAL,
  badgeForVerifiedDeals,
  badgeLabel,
  computeRevenueShare,
  getCreatorRevenueShareConfig,
  nextBadge,
  pointsForDeal,
  rankLeaderboard,
  type LeaderboardEntry,
} from '@/lib/creator-rewards';

describe('pointsForDeal', () => {
  it('awards 10 points only for a verified deal', () => {
    expect(pointsForDeal(true)).toBe(POINTS_PER_VERIFIED_DEAL);
    expect(pointsForDeal(false)).toBe(0);
  });
});

describe('badgeForVerifiedDeals', () => {
  it('walks the ladder by verified-deal count', () => {
    expect(badgeForVerifiedDeals(0)).toBe('none');
    expect(badgeForVerifiedDeals(1)).toBe('bronze');
    expect(badgeForVerifiedDeals(4)).toBe('bronze');
    expect(badgeForVerifiedDeals(5)).toBe('silver');
    expect(badgeForVerifiedDeals(15)).toBe('gold');
    expect(badgeForVerifiedDeals(30)).toBe('platinum');
    expect(badgeForVerifiedDeals(100)).toBe('platinum');
  });

  it('never awards a badge for zero or invalid counts', () => {
    expect(badgeForVerifiedDeals(-1)).toBe('none');
    expect(badgeForVerifiedDeals(NaN)).toBe('none');
  });

  it('labels badges, including the no-badge state', () => {
    expect(badgeLabel('none')).toBe('No badge yet');
    expect(badgeLabel('gold')).toBe('Gold Contributor');
  });

  it('reports the next badge and null at the top', () => {
    expect(nextBadge(0)?.badge).toBe('bronze');
    expect(nextBadge(5)?.badge).toBe('gold');
    expect(nextBadge(30)).toBeNull();
  });
});

describe('rankLeaderboard', () => {
  const entry = (overrides: Partial<LeaderboardEntry>): LeaderboardEntry => ({
    userId: 'user-1',
    displayName: 'A',
    points: 10,
    verifiedDeals: 1,
    badge: 'bronze',
    ...overrides,
  });

  it('ranks by points desc, then verified deals desc', () => {
    const ranked = rankLeaderboard([
      entry({ userId: 'c', points: 10, verifiedDeals: 1 }),
      entry({ userId: 'a', points: 50, verifiedDeals: 5 }),
      entry({ userId: 'b', points: 10, verifiedDeals: 3 }),
    ]);
    expect(ranked.map((e) => e.userId)).toEqual(['a', 'b', 'c']);
  });

  it('drops entries with no points and no verified deals', () => {
    const ranked = rankLeaderboard([
      entry({ userId: 'a', points: 0, verifiedDeals: 0 }),
      entry({ userId: 'b', points: 10, verifiedDeals: 1 }),
    ]);
    expect(ranked.map((e) => e.userId)).toEqual(['b']);
  });

  it('breaks exact ties deterministically by user id', () => {
    const ranked = rankLeaderboard([
      entry({ userId: 'z', points: 10, verifiedDeals: 1 }),
      entry({ userId: 'a', points: 10, verifiedDeals: 1 }),
    ]);
    expect(ranked.map((e) => e.userId)).toEqual(['a', 'z']);
  });
});

describe('creator revenue share (env-gated)', () => {
  const KEY = 'CREATOR_REVENUE_SHARE_PERCENT';
  const saved = process.env[KEY];

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('is unconfigured when the env var is unset', () => {
    delete process.env[KEY];
    expect(getCreatorRevenueShareConfig()).toEqual({ configured: false, percent: null });
    expect(computeRevenueShare({ affiliateRevenueCents: 10000 })).toBeNull();
  });

  it('computes a 20% share of revenue in whole cents', () => {
    process.env[KEY] = '20';
    expect(getCreatorRevenueShareConfig()).toEqual({ configured: true, percent: 20 });
    expect(computeRevenueShare({ affiliateRevenueCents: 10000 })).toBe(2000);
    expect(computeRevenueShare({ affiliateRevenueCents: 999 })).toBe(199);
  });

  it('rejects invalid percents and non-positive revenue', () => {
    process.env[KEY] = '150';
    expect(computeRevenueShare({ affiliateRevenueCents: 10000 })).toBeNull();
    process.env[KEY] = '10';
    expect(computeRevenueShare({ affiliateRevenueCents: 0 })).toBeNull();
    expect(computeRevenueShare({ affiliateRevenueCents: -5 })).toBeNull();
    expect(computeRevenueShare({ affiliateRevenueCents: 10000, sharePercent: 0 })).toBeNull();
  });
});
