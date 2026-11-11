import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RECENTLY_VIEWED_KEY,
  MAX_RECENTLY_VIEWED,
  getRecentlyViewed,
  recordRecentlyViewed,
  removeRecentlyViewed,
  clearRecentlyViewed,
} from '@/lib/recently-viewed';

// Section 11, Chunk C: guest recently-viewed history — device-local
// localStorage, mirroring the guest-wishlist test setup (the module
// only touches window.localStorage and window.dispatchEvent, so stub
// exactly that; node test env has no window at all).

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

const itemA = { id: 'p1', slug: 'macbook-air-13', name: 'MacBook Air 13' };
const itemB = {
  id: 'p2',
  slug: 'pixel-8',
  name: 'Pixel 8',
  brand: 'Google',
  category: 'Phones',
  imageUrl: 'https://example.com/pixel.jpg',
  price: 699,
};

describe('recently viewed', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: memoryStorage(),
      dispatchEvent: vi.fn(() => true),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts empty and records a view most-recent-first', () => {
    expect(getRecentlyViewed()).toEqual([]);
    recordRecentlyViewed(itemA);
    const items = getRecentlyViewed();
    expect(items).toHaveLength(1);
    expect(items[0].slug).toBe('macbook-air-13');
    expect(items[0].brand).toBeNull();
    expect(items[0].price).toBeNull();
    expect(typeof items[0].viewedAt).toBe('string');
  });

  it('keeps optional fields when they are recorded', () => {
    recordRecentlyViewed(itemB);
    const items = getRecentlyViewed();
    expect(items).toHaveLength(1);
    expect(items[0].brand).toBe('Google');
    expect(items[0].category).toBe('Phones');
    expect(items[0].imageUrl).toBe('https://example.com/pixel.jpg');
    expect(items[0].price).toBe(699);
  });

  it('dedupes by id: re-viewing moves the product to the front', () => {
    recordRecentlyViewed(itemA);
    recordRecentlyViewed(itemB);
    expect(getRecentlyViewed().map((i) => i.id)).toEqual(['p2', 'p1']);
    recordRecentlyViewed(itemA);
    const items = getRecentlyViewed();
    expect(items.map((i) => i.id)).toEqual(['p1', 'p2']);
    expect(items).toHaveLength(2);
  });

  it('caps the list at MAX_RECENTLY_VIEWED, oldest dropped first', () => {
    for (let n = 0; n < MAX_RECENTLY_VIEWED + 5; n++) {
      recordRecentlyViewed({ id: `p${n}`, slug: `s${n}`, name: `Product ${n}` });
    }
    const items = getRecentlyViewed();
    expect(items).toHaveLength(MAX_RECENTLY_VIEWED);
    expect(items[0].id).toBe(`p${MAX_RECENTLY_VIEWED + 4}`);
    expect(items.map((i) => i.id)).not.toContain('p0');
  });

  it('persists across reads and supports remove + clear', () => {
    recordRecentlyViewed(itemA);
    recordRecentlyViewed(itemB);
    removeRecentlyViewed('p1');
    expect(getRecentlyViewed().map((i) => i.id)).toEqual(['p2']);
    // Unknown ids are a no-op.
    removeRecentlyViewed('missing');
    expect(getRecentlyViewed()).toHaveLength(1);
    clearRecentlyViewed();
    expect(getRecentlyViewed()).toEqual([]);
  });

  it('ignores corrupt stored data instead of throwing', () => {
    window.localStorage.setItem(RECENTLY_VIEWED_KEY, 'not-json{');
    expect(getRecentlyViewed()).toEqual([]);
    recordRecentlyViewed(itemA);
    expect(getRecentlyViewed()).toHaveLength(1);
  });

  it('ignores stored rows missing id/slug/name instead of throwing', () => {
    window.localStorage.setItem(
      RECENTLY_VIEWED_KEY,
      JSON.stringify([{ id: 'p9' }, { id: 'p1', slug: 'a', name: 'A' }])
    );
    expect(getRecentlyViewed().map((i) => i.id)).toEqual(['p1']);
  });

  it('ignores a view with no id/slug/name', () => {
    recordRecentlyViewed({ id: '', slug: 'a', name: 'A' });
    recordRecentlyViewed({ id: 'p1', slug: '', name: 'A' });
    expect(getRecentlyViewed()).toEqual([]);
  });
});
