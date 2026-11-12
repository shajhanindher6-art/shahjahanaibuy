import { describe, expect, it } from 'vitest';
import {
  mergeGuestWishlist,
  mergeGuestAlerts,
  mergeRecentlyViewed,
  mergeRecentSearches,
  formatGuestMergeSummary,
  hasGuestMergeResult,
  emptyGuestMergeResult,
  MAX_RECENT_SEARCHES,
  type GuestMergeResult,
} from '@/lib/guest-merge';

describe('mergeGuestWishlist', () => {
  const guest = [
    { productId: 'p1', slug: 'macbook-air-13', name: 'MacBook Air 13' },
    { productId: 'p2', slug: 'iphone-15', name: 'iPhone 15' },
  ];

  it('dedupes by slug against the signed-in list', () => {
    const { toAdd, alreadyHad } = mergeGuestWishlist(guest, [
      { productId: 'other-id', slug: 'MacBook-Air-13' },
    ]);
    expect(toAdd).toEqual([guest[1]]);
    expect(alreadyHad).toEqual([guest[0]]);
  });

  it('dedupes by productId when the signed-in item has no slug', () => {
    // Server WishlistItem rows carry productId only, no slug.
    const { toAdd, alreadyHad } = mergeGuestWishlist(guest, [
      { productId: 'p2' },
    ]);
    expect(toAdd).toEqual([guest[0]]);
    expect(alreadyHad).toEqual([guest[1]]);
  });

  it('collapses guest-internal duplicates to the first occurrence', () => {
    const { toAdd } = mergeGuestWishlist(
      [...guest, { productId: 'p1', slug: 'macbook-air-13', name: 'MacBook Air 13' }],
      []
    );
    expect(toAdd).toEqual(guest);
  });

  it('empty guest data is a no-op', () => {
    expect(mergeGuestWishlist([], [{ productId: 'p1', slug: 'x' }])).toEqual({
      toAdd: [],
      alreadyHad: [],
    });
  });

  it('skips guest items with neither id nor slug', () => {
    const { toAdd } = mergeGuestWishlist(
      [{ productId: '', slug: '', name: 'Broken' }],
      []
    );
    expect(toAdd).toEqual([]);
  });

  it('is idempotent: merging twice changes nothing', () => {
    const first = mergeGuestWishlist(guest, [{ productId: 'p1', slug: 'macbook-air-13' }]);
    // After the first merge the account holds p1 + the newly added p2.
    const existingAfterFirst = [
      { productId: 'p1', slug: 'macbook-air-13' },
      ...first.toAdd.map((i) => ({ productId: i.productId, slug: i.slug })),
    ];
    const second = mergeGuestWishlist(guest, existingAfterFirst);
    expect(second.toAdd).toEqual([]);
    expect(second.alreadyHad).toEqual(guest);
  });
});

describe('mergeGuestAlerts', () => {
  const guest = [
    { productId: 'p1', alertType: 'price_drop' as const, targetPrice: 800 },
    { productId: 'p1', alertType: 'back_in_stock' as const, targetPrice: null },
    { productId: 'p2', alertType: 'price_drop' as const, targetPrice: 50 },
  ];

  it('dedupes by productId within the same alert type', () => {
    const { toAdd, alreadyHad } = mergeGuestAlerts(guest, [
      { productId: 'p1', alertType: 'price_drop' },
    ]);
    expect(alreadyHad).toEqual([guest[0]]);
    expect(toAdd).toEqual([guest[1], guest[2]]);
  });

  it('keeps a different alert type for the same product', () => {
    const { toAdd } = mergeGuestAlerts(guest, [
      { productId: 'p1', alertType: 'deal' },
    ]);
    expect(toAdd).toEqual(guest);
  });

  it('conflicting entries keep the signed-in one', () => {
    // Same product + same type, different target price: the guest
    // alert is dropped, the signed-in alert is never overwritten.
    const { toAdd, alreadyHad } = mergeGuestAlerts(
      [{ productId: 'p1', alertType: 'price_drop' as const, targetPrice: 700 }],
      [{ productId: 'p1', alertType: 'price_drop' }]
    );
    expect(toAdd).toEqual([]);
    expect(alreadyHad).toHaveLength(1);
  });

  it('empty guest data is a no-op', () => {
    expect(mergeGuestAlerts([], [{ productId: 'p1', alertType: 'price_drop' }])).toEqual({
      toAdd: [],
      alreadyHad: [],
      skippedDueToCap: 0,
    });
  });

  it('caps the merged set at maxAlerts, keeping the most recent guest alerts', () => {
    // Guest storage is oldest-first; with a Free cap of 5 and 4
    // alerts already on the account, only the newest 1 fits.
    const { toAdd, alreadyHad, skippedDueToCap } = mergeGuestAlerts(
      guest,
      [
        { productId: 'x1', alertType: 'price_drop' },
        { productId: 'x2', alertType: 'price_drop' },
        { productId: 'x3', alertType: 'price_drop' },
        { productId: 'x4', alertType: 'price_drop' },
      ],
      { maxAlerts: 5 }
    );
    expect(toAdd).toEqual([guest[2]]);
    expect(alreadyHad).toEqual([]);
    expect(skippedDueToCap).toBe(2);
  });

  it('drops everything when the account is already at the cap', () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({
      productId: `x${i}`,
      alertType: 'price_drop',
    }));
    const { toAdd, skippedDueToCap } = mergeGuestAlerts(guest, existing, {
      maxAlerts: 5,
    });
    expect(toAdd).toEqual([]);
    expect(skippedDueToCap).toBe(3);
  });

  it('does not cap when maxAlerts is null (unlimited tier)', () => {
    const { toAdd, skippedDueToCap } = mergeGuestAlerts(guest, [], {
      maxAlerts: null,
    });
    expect(toAdd).toEqual(guest);
    expect(skippedDueToCap).toBe(0);
  });

  it('counts existing alerts against the cap, not just the new ones', () => {
    // 4 existing + 3 guest, cap 5 → only 1 new alert fits.
    const { toAdd } = mergeGuestAlerts(
      guest,
      [
        { productId: 'x1', alertType: 'price_drop' },
        { productId: 'x2', alertType: 'price_drop' },
        { productId: 'x3', alertType: 'price_drop' },
        { productId: 'x4', alertType: 'price_drop' },
      ],
      { maxAlerts: 5 }
    );
    expect(toAdd).toHaveLength(1);
  });

  it('is idempotent: merging twice changes nothing', () => {
    const first = mergeGuestAlerts(guest, []);
    const existingAfterFirst = first.toAdd.map((a) => ({
      productId: a.productId,
      alertType: a.alertType,
    }));
    const second = mergeGuestAlerts(guest, existingAfterFirst);
    expect(second.toAdd).toEqual([]);
    expect(second.alreadyHad).toEqual(guest);
  });
});

describe('mergeRecentlyViewed', () => {
  const guest = [
    { productId: 'p1', slug: 'macbook-air-13' },
    { productId: 'p2', slug: 'iphone-15' },
  ];

  it('dedupes by slug and collapses guest-internal duplicates', () => {
    const { toRecord, alreadyHad } = mergeRecentlyViewed(
      [...guest, { productId: 'p1', slug: 'macbook-air-13' }],
      [{ productId: 'zzz', slug: 'iphone-15' }]
    );
    expect(toRecord).toEqual([guest[0]]);
    expect(alreadyHad).toEqual([guest[1]]);
  });

  it('empty guest data is a no-op', () => {
    expect(mergeRecentlyViewed([], [])).toEqual({ toRecord: [], alreadyHad: [] });
  });

  it('is idempotent: merging twice changes nothing', () => {
    const first = mergeRecentlyViewed(guest, []);
    const existingAfterFirst = first.toRecord.map((v) => ({
      productId: v.productId,
      slug: v.slug,
    }));
    const second = mergeRecentlyViewed(guest, existingAfterFirst);
    expect(second.toRecord).toEqual([]);
    expect(second.alreadyHad).toEqual(guest);
  });
});

describe('mergeRecentSearches', () => {
  it('keeps guest order first, then existing terms, deduped case-insensitively', () => {
    expect(
      mergeRecentSearches(['MacBook', 'laptop'], ['LAPTOP', 'headphones', 'MacBook'])
    ).toEqual(['MacBook', 'laptop', 'headphones']);
  });

  it('keeps the first occurrence on a case-insensitive duplicate', () => {
    expect(mergeRecentSearches(['iPhone'], ['IPHONE', 'iphone'])).toEqual(['iPhone']);
  });

  it('caps at MAX_RECENT_SEARCHES, guest terms win the slots', () => {
    const guest = Array.from({ length: 6 }, (_, i) => `g${i}`);
    const existing = Array.from({ length: 6 }, (_, i) => `e${i}`);
    const merged = mergeRecentSearches(guest, existing);
    expect(merged).toHaveLength(MAX_RECENT_SEARCHES);
    expect(merged.slice(0, 6)).toEqual(guest);
    expect(merged.slice(6)).toEqual(['e0', 'e1']);
  });

  it('empty guest data returns the existing list unchanged', () => {
    expect(mergeRecentSearches([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(mergeRecentSearches([], [])).toEqual([]);
  });

  it('drops blank terms', () => {
    expect(mergeRecentSearches(['  ', 'laptop'], [''])).toEqual(['laptop']);
  });
});

describe('formatGuestMergeSummary', () => {
  function result(partial: Partial<GuestMergeResult>): GuestMergeResult {
    return { ...emptyGuestMergeResult(), ...partial };
  }

  it('states plainly what was merged', () => {
    expect(
      formatGuestMergeSummary(
        result({ wishlistAdded: 3, alertsAdded: 2, viewsRecorded: 1 })
      )
    ).toBe(
      'Welcome back — we carried over from this device: 3 wishlist items, 2 price alerts, and 1 recently viewed product.'
    );
  });

  it('uses singular forms and omits zero categories', () => {
    expect(formatGuestMergeSummary(result({ wishlistAdded: 1 }))).toBe(
      'Welcome back — we carried over from this device: 1 wishlist item.'
    );
  });

  it('never claims searches moved to the account', () => {
    expect(formatGuestMergeSummary(result({ searchesKept: 2 }))).toBe(
      'Welcome back — your 2 recent searches from this device are still here. Recent searches stay on this device.'
    );
    expect(
      formatGuestMergeSummary(result({ wishlistAdded: 1, searchesKept: 2 }))
    ).toContain('Your recent searches stay on this device.');
  });

  it('returns null when nothing was carried over', () => {
    expect(formatGuestMergeSummary(result({}))).toBeNull();
    expect(
      formatGuestMergeSummary(
        result({ wishlistAlreadyHad: 2, alertsAlreadyHad: 1 })
      )
    ).toBeNull();
  });

  it('names alerts dropped for the tier cap — never silently lost', () => {
    expect(
      formatGuestMergeSummary(
        result({ alertsAdded: 1, alertsSkippedDueToCap: 2, alertsCapLimit: 5 })
      )
    ).toBe(
      'Welcome back — we carried over from this device: 1 price alert. ' +
        '2 price alerts from this device could not be carried over — ' +
        'Your plan allows up to 5 price alerts. ' +
        'Upgrade to Premium for unlimited price alerts: /pricing.'
    );
  });

  it('still reports the cap drop when nothing else was carried over', () => {
    expect(
      formatGuestMergeSummary(
        result({ alertsSkippedDueToCap: 3, alertsCapLimit: 5 })
      )
    ).toContain('3 price alerts from this device could not be carried over');
  });

  it('hasGuestMergeResult matches the summary', () => {
    expect(hasGuestMergeResult(result({}))).toBe(false);
    expect(hasGuestMergeResult(result({ alertsAdded: 1 }))).toBe(true);
    expect(hasGuestMergeResult(result({ searchesKept: 1 }))).toBe(true);
  });
});
