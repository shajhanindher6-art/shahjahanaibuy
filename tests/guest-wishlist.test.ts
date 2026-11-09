import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GUEST_WISHLIST_KEY,
  getGuestWishlist,
  isGuestWishlisted,
  toggleGuestWishlist,
} from '@/lib/guest-wishlist';

// P0 fix (2026-11-09 audit): guests had no way to save a product —
// the wishlist was sign-in gated with no guest path at all.

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

describe('guest wishlist', () => {
  beforeEach(() => {
    // The module only touches window.localStorage and
    // window.dispatchEvent, so stub exactly that (node test env has
    // no window at all).
    vi.stubGlobal('window', {
      localStorage: memoryStorage(),
      dispatchEvent: vi.fn(() => true),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts empty and toggles one product on and off', () => {
    const item = { id: 'p1', slug: 'macbook-air-13', name: 'MacBook Air 13' };
    expect(getGuestWishlist()).toEqual([]);
    expect(isGuestWishlisted('p1')).toBe(false);

    expect(toggleGuestWishlist(item)).toBe(true);
    expect(isGuestWishlisted('p1')).toBe(true);
    expect(getGuestWishlist()).toHaveLength(1);
    expect(getGuestWishlist()[0].slug).toBe('macbook-air-13');

    expect(toggleGuestWishlist(item)).toBe(false);
    expect(isGuestWishlisted('p1')).toBe(false);
    expect(getGuestWishlist()).toEqual([]);
  });

  it('keeps other products when one is removed', () => {
    toggleGuestWishlist({ id: 'p1', slug: 'a', name: 'A' });
    toggleGuestWishlist({ id: 'p2', slug: 'b', name: 'B' });
    toggleGuestWishlist({ id: 'p1', slug: 'a', name: 'A' });
    expect(getGuestWishlist().map((i) => i.id)).toEqual(['p2']);
  });

  it('ignores corrupt stored data instead of throwing', () => {
    window.localStorage.setItem(GUEST_WISHLIST_KEY, 'not-json{');
    expect(getGuestWishlist()).toEqual([]);
    expect(isGuestWishlisted('p1')).toBe(false);
  });
});
