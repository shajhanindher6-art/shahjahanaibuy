import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LOCAL_ALERTS_STORAGE_KEY,
  loadLocalAlerts,
  type LocalPriceAlert,
} from '@/lib/local-alerts';
import { buildPriceDropDigest } from '@/lib/price-drop-digest';
import {
  badgeForVerifiedDeals,
  badgeLabel,
  nextBadge,
  pointsForDeal,
  computeRevenueShare,
  getCreatorRevenueShareConfig,
} from '@/lib/creator-rewards';
import {
  validatePollQuestion,
  validatePollOptions,
} from '@/lib/wishlist-polls';
import { parseBudgetFinderParams } from '@/services/guided-finder';
import { pushSubscribeFailureMessage } from '@/components/home/push-opt-in-prompt';
import { isPushSupported } from '@/lib/push-client';

// Section 12, Chunk E — retention completions. These tests prove
// the honest-completion rules without a browser or a database:
// the guest digest is built only from on-device watched products
// + recorded price history; the push prompt never claims push
// works when it is not configured; referral credit is points and
// badges only — never money; poll creation validates before it
// ever calls the API; the Budget Finder URL a shared link copies
// restores the same results.

function memoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      store = {};
    },
    getItem: (key: string) => store[key] ?? null,
    key: (index: number) => Object.keys(store)[index] ?? null,
    removeItem: (key: string) => {
      delete store[key];
    },
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };
}

const NOW = new Date('2026-11-11T12:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

function guestAlert(partial: Partial<LocalPriceAlert>): LocalPriceAlert {
  return {
    id: 'alert-1',
    productId: 'prod-1',
    productName: 'MacBook Air 13',
    targetPrice: 900,
    alertType: 'price_drop',
    channel: 'local',
    createdAt: iso(NOW - 2 * DAY),
    ...partial,
  };
}

describe('guest-mode price-drop digest (on-device watched data)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the guest watched products from localStorage', () => {
    expect(loadLocalAlerts()).toEqual([]);
    localStorage.setItem(
      LOCAL_ALERTS_STORAGE_KEY,
      JSON.stringify([guestAlert({}), guestAlert({ id: 'alert-2', productId: 'prod-2', productName: 'Pixel 8' })])
    );
    const watched = loadLocalAlerts();
    expect(watched).toHaveLength(2);
    expect(watched.map((a) => a.productId)).toEqual(['prod-1', 'prod-2']);
  });

  it('builds a digest deal from recorded history for a watched product', () => {
    const digest = buildPriceDropDigest(
      [{ productId: 'prod-1', productName: 'MacBook Air 13' }],
      [
        { productId: 'prod-1', price: 1000, recordedAt: iso(NOW - 20 * DAY) },
        { productId: 'prod-1', price: 1000, recordedAt: iso(NOW - 10 * DAY) },
        { productId: 'prod-1', price: 800, recordedAt: iso(NOW - 1 * DAY) },
      ],
      'weekly',
      NOW
    );
    expect(digest.watchedCount).toBe(1);
    expect(digest.deals).toHaveLength(1);
    expect(digest.deals[0].productId).toBe('prod-1');
    expect(digest.deals[0].currentPrice).toBe(800);
    expect(digest.deals[0].percentBelowAverage).toBeCloseTo(20, 5);
    expect(digest.deals[0].reason).toContain('20.0% below its 30-day average');
  });

  it('shows no deals for a watched product with no recorded history', () => {
    const digest = buildPriceDropDigest(
      [{ productId: 'prod-1', productName: 'MacBook Air 13' }],
      [],
      'weekly',
      NOW
    );
    expect(digest.watchedCount).toBe(1);
    expect(digest.deals).toEqual([]);
  });

  it('shows no deals when the price did not drop below its average', () => {
    const digest = buildPriceDropDigest(
      [{ productId: 'prod-1', productName: 'MacBook Air 13' }],
      [
        { productId: 'prod-1', price: 1000, recordedAt: iso(NOW - 10 * DAY) },
        { productId: 'prod-1', price: 1050, recordedAt: iso(NOW - 1 * DAY) },
      ],
      'weekly',
      NOW
    );
    expect(digest.deals).toEqual([]);
  });

  it('never includes a product the guest does not watch', () => {
    const digest = buildPriceDropDigest(
      [{ productId: 'prod-1', productName: 'MacBook Air 13' }],
      [
        { productId: 'prod-2', price: 100, recordedAt: iso(NOW - 10 * DAY) },
        { productId: 'prod-2', price: 50, recordedAt: iso(NOW - 1 * DAY) },
      ],
      'weekly',
      NOW
    );
    expect(digest.deals).toEqual([]);
  });

  it('is empty (watchedCount 0) when the guest saved no alerts on this device', () => {
    const digest = buildPriceDropDigest([], [], 'weekly', NOW);
    expect(digest.watchedCount).toBe(0);
    expect(digest.deals).toEqual([]);
  });
});

describe('push opt-in prompt honesty', () => {
  it('says "not configured yet" for the no-key failure — never pretends push works', () => {
    expect(pushSubscribeFailureMessage('no-key')).toContain('not configured yet');
  });

  it('explains every failure reason honestly', () => {
    expect(pushSubscribeFailureMessage('unsupported')).toContain('not supported');
    expect(pushSubscribeFailureMessage('denied')).toContain('blocked');
    expect(pushSubscribeFailureMessage('server')).toContain('Could not save');
    expect(pushSubscribeFailureMessage('unknown')).toContain(
      "couldn't turn on push alerts"
    );
  });

  it('no failure message ever claims the visitor is subscribed', () => {
    for (const reason of ['unsupported', 'denied', 'no-key', 'server', 'unknown'] as const) {
      expect(pushSubscribeFailureMessage(reason).toLowerCase()).not.toContain('subscribed');
      expect(pushSubscribeFailureMessage(reason).toLowerCase()).not.toContain('you are on');
    }
  });

  it('push is unsupported where there is no window (server / node)', () => {
    expect(isPushSupported()).toBe(false);
  });
});

describe('referral credit display honesty (non-monetary only)', () => {
  it('awards points only for verified deals', () => {
    expect(pointsForDeal(true)).toBe(10);
    expect(pointsForDeal(false)).toBe(0);
  });

  it('maps verified-deal counts to the badge ladder', () => {
    expect(badgeForVerifiedDeals(0)).toBe('none');
    expect(badgeForVerifiedDeals(1)).toBe('bronze');
    expect(badgeForVerifiedDeals(5)).toBe('silver');
    expect(badgeForVerifiedDeals(15)).toBe('gold');
    expect(badgeForVerifiedDeals(30)).toBe('platinum');
    expect(badgeLabel('silver')).toBe('Silver Contributor');
    expect(nextBadge(5)?.badge).toBe('gold');
    expect(nextBadge(30)).toBeNull();
  });

  it('badge labels never contain a monetary amount', () => {
    for (const n of [0, 1, 5, 15, 30]) {
      expect(badgeLabel(badgeForVerifiedDeals(n))).not.toContain('$');
    }
  });

  it('revenue share is unconfigured without the env var — no payout is ever computed', () => {
    delete process.env.CREATOR_REVENUE_SHARE_PERCENT;
    expect(getCreatorRevenueShareConfig()).toEqual({ configured: false, percent: null });
    expect(computeRevenueShare({ affiliateRevenueCents: 10000 })).toBeNull();
  });
});

describe('wishlist poll creation validation (client-side, before the API)', () => {
  it('accepts a real question with at least two distinct products', () => {
    expect(validatePollQuestion('Which laptop should I get?')).toBeNull();
    expect(validatePollOptions(['prod-1', 'prod-2'])).toEqual({
      productIds: ['prod-1', 'prod-2'],
    });
  });

  it('rejects a missing/short question and fewer than two options', () => {
    expect(validatePollQuestion('')).not.toBeNull();
    expect(validatePollQuestion('ab')).not.toBeNull();
    expect(validatePollOptions(['prod-1'])).toEqual({
      error: expect.stringContaining('At least 2 different'),
    });
    expect(validatePollOptions([])).toEqual({
      error: expect.stringContaining('At least 2 different'),
    });
  });
});

describe('Budget Finder share button (shareable URL)', () => {
  it('the URL the share button copies restores the same category + budget', () => {
    const shared = '/tools/budget-finder?category=laptop&budget=1000';
    const url = new URL(shared, 'https://example.com');
    const parsed = parseBudgetFinderParams({
      category: url.searchParams.get('category') ?? undefined,
      budget: url.searchParams.get('budget') ?? undefined,
    });
    expect(parsed.category).toBe('laptop');
    expect(parsed.budgetUsd).toBe(1000);
    expect(parsed.budgetError).toBeNull();
  });

  it('an invalid budget in a shared URL is rejected, not silently fixed', () => {
    const parsed = parseBudgetFinderParams({ category: 'laptop', budget: 'abc' });
    expect(parsed.budgetError).not.toBeNull();
  });
});
