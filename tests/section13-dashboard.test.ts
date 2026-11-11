import { describe, it, expect } from 'vitest';
import {
  summarizeWatchedPrices,
  type WatchedPriceItem,
} from '@/components/dashboard/watched-price-summary';
import { groupItemsByList } from '@/components/dashboard/lists-at-a-glance';
import { summarizeAlertHealth } from '@/components/dashboard/alert-health';
import { mergeActivityFeed } from '@/components/dashboard/recent-activity-feed';
import { deriveChecklistDone } from '@/components/dashboard/getting-started-checklist';
import { basisLabel } from '@/components/dashboard/savings-history';

// Section 13, Chunk F — dashboard depth. These tests prove the
// pure derivations behind the new dashboard cards, without a
// browser or a database: the watched-price summary ranks only
// recorded moves (an unpriced item is never a 0% move); the
// lists glance sums only recorded prices and counts the unpriced
// ones; alert health has no invented "expired" state; the
// activity feed merges the three sources newest-first and drops
// unparseable dates instead of guessing a position; the
// checklist counts only the two states the dashboard actually
// fetches.

function watchedItem(partial: Partial<WatchedPriceItem> & { slug: string }): WatchedPriceItem {
  return {
    product: { name: partial.slug, slug: partial.slug },
    currentPrice: partial.currentPrice ?? null,
    previousPrice: partial.previousPrice ?? null,
    changePct: partial.changePct ?? null,
    belowTarget: partial.belowTarget ?? false,
    targetPrice: partial.targetPrice ?? null,
  };
}

describe('summarizeWatchedPrices', () => {
  it('picks the biggest drop and rise and counts below-target items', () => {
    const summary = summarizeWatchedPrices([
      watchedItem({ slug: 'a', currentPrice: 80, previousPrice: 100, changePct: -20, belowTarget: true, targetPrice: 90 }),
      watchedItem({ slug: 'b', currentPrice: 110, previousPrice: 100, changePct: 10 }),
      watchedItem({ slug: 'c', currentPrice: 95, previousPrice: 100, changePct: -5 }),
    ]);
    expect(summary.biggestDrop?.product.slug).toBe('a');
    expect(summary.biggestRise?.product.slug).toBe('b');
    expect(summary.belowTargetCount).toBe(1);
    expect(summary.watchedCount).toBe(3);
    expect(summary.pricedCount).toBe(3);
  });

  it('ignores unpriced items in the drop/rise ranking', () => {
    const summary = summarizeWatchedPrices([
      watchedItem({ slug: 'unpriced' }),
      watchedItem({ slug: 'flat', currentPrice: 100, previousPrice: 100, changePct: 0 }),
    ]);
    expect(summary.biggestDrop).toBeNull();
    expect(summary.biggestRise).toBeNull();
    expect(summary.pricedCount).toBe(1);
    expect(summary.watchedCount).toBe(2);
  });

  it('returns nulls for an empty watchlist', () => {
    const summary = summarizeWatchedPrices([]);
    expect(summary.biggestDrop).toBeNull();
    expect(summary.biggestRise).toBeNull();
    expect(summary.belowTargetCount).toBe(0);
  });
});

describe('groupItemsByList', () => {
  it('groups by wishlist with summed prices and unpriced counts', () => {
    const lists = groupItemsByList([
      { wishlistId: 'w1', wishlistName: 'Tech', currentPrice: 100 },
      { wishlistId: 'w1', wishlistName: 'Tech', currentPrice: 50.5 },
      { wishlistId: 'w1', wishlistName: 'Tech', currentPrice: null },
      { wishlistId: 'w2', wishlistName: 'Gifts', currentPrice: null },
    ]);
    expect(lists).toHaveLength(2);
    expect(lists[0]).toEqual({
      wishlistId: 'w1',
      wishlistName: 'Tech',
      itemCount: 3,
      totalCurrentPrice: 150.5,
      unpricedCount: 1,
    });
    expect(lists[1].itemCount).toBe(1);
    expect(lists[1].totalCurrentPrice).toBe(0);
    expect(lists[1].unpricedCount).toBe(1);
  });

  it('returns an empty list when there are no items', () => {
    expect(groupItemsByList([])).toEqual([]);
  });
});

describe('summarizeAlertHealth', () => {
  it('counts active/paused/never-triggered and the latest trigger', () => {
    const summary = summarizeAlertHealth([
      { id: '1', active: true, lastTriggeredAt: '2026-11-10T10:00:00Z', triggerCount: 2 },
      { id: '2', active: false, lastTriggeredAt: null, triggerCount: 0 },
      { id: '3', active: true, lastTriggeredAt: '2026-11-11T09:00:00Z', triggerCount: 1 },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.active).toBe(2);
    expect(summary.paused).toBe(1);
    expect(summary.neverTriggered).toBe(1);
    expect(summary.triggeredTotal).toBe(3);
    expect(summary.lastTriggeredAt).toBe('2026-11-11T09:00:00Z');
  });

  it('has no expired state and reports null last-triggered when nothing fired', () => {
    const summary = summarizeAlertHealth([
      { id: '1', active: true, lastTriggeredAt: null, triggerCount: 0 },
    ]);
    expect(summary.lastTriggeredAt).toBeNull();
    expect(summary.triggeredTotal).toBe(0);
    expect(summary.neverTriggered).toBe(1);
  });
});

describe('mergeActivityFeed', () => {
  it('merges the three sources newest-first with product/search links', () => {
    const entries = mergeActivityFeed({
      items: [{ product: { name: 'MacBook Air 13', slug: 'macbook-air-13' }, addedAt: '2026-11-10T10:00:00Z' }],
      alerts: [{ id: 'a1', productName: 'MacBook Air 13', productSlug: 'macbook-air-13' }],
      alertHistory: [{ id: 'h1', alertId: 'a1', triggeredPrice: 850, sentAt: '2026-11-11T09:00:00Z' }],
      searches: [{ id: 's1', query: 'laptop', resultsCount: 4, createdAt: '2026-11-09T08:00:00Z' }],
    });
    expect(entries).toHaveLength(3);
    expect(entries[0].kind).toBe('alert');
    expect(entries[0].href).toBe('/products/macbook-air-13');
    expect(entries[1].kind).toBe('saved');
    expect(entries[1].href).toBe('/products/macbook-air-13');
    expect(entries[2].kind).toBe('search');
    expect(entries[2].href).toBe('/search?q=laptop');
  });

  it('falls back to the tracking page for an unmatched alert id', () => {
    const entries = mergeActivityFeed({
      items: [],
      alerts: [],
      alertHistory: [{ id: 'h1', alertId: 'gone', triggeredPrice: 100, sentAt: '2026-11-11T09:00:00Z' }],
      searches: [],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].href).toBe('/dashboard/tracking');
    expect(entries[0].label).toBe('Alert triggered');
  });

  it('drops entries with unparseable dates instead of guessing a position', () => {
    const entries = mergeActivityFeed({
      items: [{ product: { name: 'Bad', slug: 'bad' }, addedAt: 'not-a-date' }],
      alerts: [],
      alertHistory: [],
      searches: [{ id: 's1', query: 'ok', resultsCount: 1, createdAt: '2026-11-11T09:00:00Z' }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('search');
  });
});

describe('deriveChecklistDone', () => {
  it('counts only the two states the dashboard fetches', () => {
    expect(deriveChecklistDone({ hasSavedProduct: true, hasAlert: false })).toEqual({
      saveProduct: true,
      setAlert: false,
      doneCount: 1,
      total: 2,
    });
    expect(deriveChecklistDone({ hasSavedProduct: true, hasAlert: true }).doneCount).toBe(2);
  });
});

describe('basisLabel', () => {
  it('labels both savings bases', () => {
    expect(basisLabel('price_drop')).toBe('Price drop purchase');
    expect(basisLabel('alert_purchase')).toBe('Alert purchase');
  });
});
