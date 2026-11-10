import { describe, expect, it } from 'vitest';
import {
  daysUntilRenewal,
  findCheaperAlternative,
  findOverlaps,
  isRarelyUsed,
  monthlyCost,
  normalizeSubscriptionName,
  renewalReminders,
  renewalStatus,
  totalMonthlyCost,
  type ConsumerSubscription,
} from '@/lib/subscription-manager';

const NOW = new Date('2026-11-10T12:00:00Z');

function sub(overrides: Partial<ConsumerSubscription> = {}): ConsumerSubscription {
  return {
    id: 'sub-1',
    userId: 'user-1',
    name: 'Netflix',
    priceUsd: 15.49,
    billingInterval: 'monthly',
    renewalDate: '2026-11-15',
    category: 'Streaming',
    isActive: true,
    lastUsedAt: '2026-11-09',
    createdAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

describe('monthlyCost', () => {
  it('passes monthly prices through and converts yearly ÷ 12', () => {
    expect(monthlyCost(15.49, 'monthly')).toBe(15.49);
    expect(monthlyCost(120, 'yearly')).toBe(10);
    expect(monthlyCost(119.88, 'yearly')).toBe(9.99);
  });

  it('returns 0 for invalid prices — never a guessed cost', () => {
    expect(monthlyCost(0, 'monthly')).toBe(0);
    expect(monthlyCost(-5, 'monthly')).toBe(0);
    expect(monthlyCost(Number.NaN, 'monthly')).toBe(0);
  });
});

describe('totalMonthlyCost', () => {
  it('rolls up active subscriptions only, converting yearly ones', () => {
    const subs = [
      sub({ id: 'a', priceUsd: 15.49, billingInterval: 'monthly' }),
      sub({ id: 'b', name: 'Spotify', priceUsd: 120, billingInterval: 'yearly' }),
      sub({ id: 'c', name: 'Old', priceUsd: 99, billingInterval: 'monthly', isActive: false }),
    ];
    expect(totalMonthlyCost(subs)).toBe(25.49);
  });

  it('is 0 with no active subscriptions', () => {
    expect(totalMonthlyCost([])).toBe(0);
    expect(totalMonthlyCost([sub({ isActive: false })])).toBe(0);
  });
});

describe('daysUntilRenewal', () => {
  it('counts whole days to the renewal date', () => {
    expect(daysUntilRenewal('2026-11-15', NOW)).toBe(5);
    expect(daysUntilRenewal('2026-11-10', NOW)).toBe(0);
    expect(daysUntilRenewal('2026-11-05', NOW)).toBe(-5);
  });

  it('returns null when no renewal date is recorded', () => {
    expect(daysUntilRenewal(null, NOW)).toBeNull();
    expect(daysUntilRenewal('not-a-date', NOW)).toBeNull();
  });
});

describe('renewalStatus', () => {
  it('classifies overdue, due-soon, upcoming and no-date', () => {
    expect(renewalStatus(sub({ renewalDate: '2026-11-05' }), NOW)).toBe('overdue');
    expect(renewalStatus(sub({ renewalDate: '2026-11-17' }), NOW)).toBe('due-soon');
    expect(renewalStatus(sub({ renewalDate: '2026-11-18' }), NOW)).toBe('upcoming');
    expect(renewalStatus(sub({ renewalDate: null }), NOW)).toBe('no-date');
  });
});

describe('renewalReminders', () => {
  it('returns due-soon and overdue active subscriptions, soonest first', () => {
    const subs = [
      sub({ id: 'a', name: 'A', renewalDate: '2026-12-01' }),
      sub({ id: 'b', name: 'B', renewalDate: '2026-11-12' }),
      sub({ id: 'c', name: 'C', renewalDate: '2026-11-01' }),
      sub({ id: 'd', name: 'D', renewalDate: '2026-11-11', isActive: false }),
    ];
    expect(renewalReminders(subs, NOW).map((row) => row.id)).toEqual(['c', 'b']);
  });
});

describe('normalizeSubscriptionName', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeSubscriptionName('Netflix')).toBe('netflix');
    expect(normalizeSubscriptionName('  Netflix! ')).toBe('netflix');
    expect(normalizeSubscriptionName('Amazon Prime Video')).toBe('amazon prime video');
  });
});

describe('findOverlaps', () => {
  it('flags two active subscriptions with the same normalised name', () => {
    const subs = [
      sub({ id: 'a', name: 'Netflix' }),
      sub({ id: 'b', name: 'netflix ' }),
      sub({ id: 'c', name: 'Spotify' }),
    ];
    const groups = findOverlaps(subs);
    expect(groups).toHaveLength(1);
    expect(groups[0].normalizedName).toBe('netflix');
    expect(groups[0].subscriptions.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('does not flag different services or inactive duplicates', () => {
    const subs = [
      sub({ id: 'a', name: 'Netflix' }),
      sub({ id: 'b', name: 'Netflix Premium' }),
      sub({ id: 'c', name: 'Netflix', isActive: false }),
    ];
    expect(findOverlaps(subs)).toEqual([]);
  });
});

describe('isRarelyUsed', () => {
  it('flags last use more than 90 days ago', () => {
    expect(isRarelyUsed(sub({ lastUsedAt: '2026-08-11' }), NOW)).toBe(true);
    expect(isRarelyUsed(sub({ lastUsedAt: '2026-08-12' }), NOW)).toBe(false);
    expect(isRarelyUsed(sub({ lastUsedAt: '2026-11-09' }), NOW)).toBe(false);
  });

  it('never flags when last use is unknown', () => {
    expect(isRarelyUsed(sub({ lastUsedAt: null }), NOW)).toBe(false);
  });
});

describe('findCheaperAlternative', () => {
  it('returns the cheapest strictly-cheaper recorded alternative', () => {
    const result = findCheaperAlternative(sub({ priceUsd: 15.49, billingInterval: 'monthly' }), [
      { name: 'Basic Plan', monthlyPriceUsd: 9.99 },
      { name: 'Budget Plan', monthlyPriceUsd: 6.99 },
      { name: 'Same Price', monthlyPriceUsd: 15.49 },
      { name: 'Pricier', monthlyPriceUsd: 19.99 },
    ]);
    expect(result).toEqual({ name: 'Budget Plan', monthlyPriceUsd: 6.99 });
  });

  it('returns null when no cheaper alternative is recorded — never an invented one', () => {
    expect(findCheaperAlternative(sub(), [])).toBeNull();
    expect(
      findCheaperAlternative(sub(), [{ name: 'Pricier', monthlyPriceUsd: 19.99 }])
    ).toBeNull();
  });
});
