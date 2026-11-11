import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GUEST_BUY_LIST_KEY,
  getGuestBuyList,
  addGuestBuyListItem,
  removeGuestBuyListItem,
  setGuestBuyListQuantity,
  isGuestBuyListed,
  clearGuestBuyList,
} from '@/lib/guest-buy-list';
import {
  emptyGuestMergeResult,
  formatGuestMergeSummary,
  mergeGuestBuyList,
} from '@/lib/guest-merge';
import {
  buildExportDocument,
  buildExportSection,
  exportFileName,
  exportNonEmptySections,
  exportTotalRows,
} from '@/lib/data-export';
import {
  DELETE_CONFIRMATION_TEXT,
  USER_DATA_TABLES,
  describeDeletionScope,
  isValidDeleteConfirmation,
} from '@/lib/account-deletion';
import {
  selfTestVerdict,
  summarizeSelfTest,
  type SelfTestStep,
} from '@/lib/push-self-test';

// Section 14, Chunk 7 — dashboard / retention: guest buy-list
// store + merge, data export serializer, account-deletion rules,
// push self-test summary. All pure (no network, no database); the
// guest store tests stub window.localStorage like the existing
// guest-wishlist tests do.

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

describe('guest buy list', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: memoryStorage(),
      dispatchEvent: vi.fn(() => true),
    });
  });

  it('adds an item and reports it as listed', () => {
    addGuestBuyListItem({ id: 'p1', slug: 'laptop', name: 'Laptop' });
    expect(getGuestBuyList()).toHaveLength(1);
    expect(isGuestBuyListed('p1')).toBe(true);
    expect(isGuestBuyListed('p2')).toBe(false);
  });

  it('bumps quantity on a duplicate add, capped at 99', () => {
    addGuestBuyListItem({ id: 'p1', slug: 'laptop', name: 'Laptop', quantity: 98 });
    addGuestBuyListItem({ id: 'p1', slug: 'laptop', name: 'Laptop', quantity: 5 });
    const items = getGuestBuyList();
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(99);
  });

  it('normalizes quantity to 1..99 on set', () => {
    addGuestBuyListItem({ id: 'p1', slug: 'laptop', name: 'Laptop' });
    setGuestBuyListQuantity('p1', 0);
    expect(getGuestBuyList()[0].quantity).toBe(1);
    setGuestBuyListQuantity('p1', 500);
    expect(getGuestBuyList()[0].quantity).toBe(99);
  });

  it('removes and clears', () => {
    addGuestBuyListItem({ id: 'p1', slug: 'laptop', name: 'Laptop' });
    removeGuestBuyListItem('p1');
    expect(getGuestBuyList()).toHaveLength(0);
    addGuestBuyListItem({ id: 'p1', slug: 'laptop', name: 'Laptop' });
    clearGuestBuyList();
    expect(window.localStorage.getItem(GUEST_BUY_LIST_KEY)).toBeNull();
  });
});

describe('guest buy-list merge', () => {
  it('adds only items the account does not already have', () => {
    const { toAdd, alreadyHad } = mergeGuestBuyList(
      [
        { productId: 'p1', slug: 'laptop', name: 'Laptop', quantity: 2 },
        { productId: 'p2', slug: 'mouse', name: 'Mouse', quantity: 1 },
      ],
      [{ productId: 'p2' }]
    );
    expect(toAdd).toHaveLength(1);
    expect(toAdd[0].productId).toBe('p1');
    expect(toAdd[0].quantity).toBe(2);
    expect(alreadyHad).toHaveLength(1);
  });

  it('collapses guest-internal duplicates to the first occurrence', () => {
    const { toAdd } = mergeGuestBuyList(
      [
        { productId: 'p1', slug: 'laptop', name: 'Laptop', quantity: 1 },
        { productId: 'p1', slug: 'laptop', name: 'Laptop', quantity: 3 },
      ],
      []
    );
    expect(toAdd).toHaveLength(1);
    expect(toAdd[0].quantity).toBe(1);
  });

  it('skips items with no product id', () => {
    const { toAdd } = mergeGuestBuyList(
      [{ productId: '', slug: 'x', name: 'X', quantity: 1 }],
      []
    );
    expect(toAdd).toHaveLength(0);
  });

  it('mentions the buy list in the merge banner', () => {
    const result = emptyGuestMergeResult();
    result.buyListAdded = 2;
    const summary = formatGuestMergeSummary(result);
    expect(summary).toContain('2 buy-list items');
  });
});

describe('data export serializer', () => {
  it('counts rows and lists non-empty sections', () => {
    const doc = buildExportDocument('u1', {
      profile: buildExportSection([{ id: 'u1' }]),
      wishlists: buildExportSection([]),
      wishlistItems: buildExportSection([{ id: 'w1' }, { id: 'w2' }]),
      alerts: buildExportSection([]),
      buyList: buildExportSection([]),
      savings: buildExportSection([]),
      searchHistory: buildExportSection([]),
      referralLinks: buildExportSection([]),
    });
    expect(doc.format).toBe('smartbuy-user-data-export');
    expect(doc.version).toBe(1);
    expect(exportTotalRows(doc)).toBe(3);
    expect(exportNonEmptySections(doc)).toEqual(['profile', 'wishlistItems']);
  });

  it('treats null rows as an empty section', () => {
    expect(buildExportSection(null)).toEqual({ count: 0, rows: [] });
  });

  it('builds a dated file name', () => {
    expect(exportFileName(new Date('2026-11-11T10:00:00Z'))).toBe(
      'smartbuy-data-export-2026-11-11.json'
    );
  });
});

describe('account deletion rules', () => {
  it('requires exactly DELETE', () => {
    expect(DELETE_CONFIRMATION_TEXT).toBe('DELETE');
    expect(isValidDeleteConfirmation('DELETE')).toBe(true);
    expect(isValidDeleteConfirmation('delete')).toBe(false);
    expect(isValidDeleteConfirmation('')).toBe(false);
    expect(isValidDeleteConfirmation(undefined)).toBe(false);
  });

  it('covers the real user-owned tables and no invented ones', () => {
    expect(USER_DATA_TABLES).toContain('wishlists');
    expect(USER_DATA_TABLES).toContain('alerts');
    expect(USER_DATA_TABLES).toContain('buy_list_items');
    expect(USER_DATA_TABLES).toContain('savings_events');
    expect(USER_DATA_TABLES).not.toContain('user_api_keys');
    expect(describeDeletionScope().length).toBeGreaterThan(0);
  });
});

describe('push self-test summary', () => {
  const step = (id: string, status: SelfTestStep['status']): SelfTestStep => ({
    id,
    label: id,
    status,
    detail: '',
  });

  it('passes only when every run step passed', () => {
    const summary = summarizeSelfTest([
      step('a', 'pass'),
      step('b', 'pass'),
      step('c', 'skipped'),
    ]);
    expect(summary.overall).toBe('pass');
    expect(selfTestVerdict(summary)).toContain('working');
  });

  it('fails when any step failed', () => {
    const summary = summarizeSelfTest([step('a', 'pass'), step('b', 'fail')]);
    expect(summary.overall).toBe('fail');
    expect(summary.failed).toBe(1);
  });

  it('reports not-run when nothing ran', () => {
    const summary = summarizeSelfTest([step('a', 'pending')]);
    expect(summary.overall).toBe('not-run');
  });
});
