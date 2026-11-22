// @vitest-environment jsdom
/**
 * PostHog 5-event analytics — WishlistButton event tests.
 *
 * Renders `components/products/wishlist-button.tsx` for real in
 * jsdom. The Supabase boundary is mocked at `fetch` (the wishlist
 * API), the guest wishlist is mocked at `lib/guest-wishlist`, and
 * the tracker is mocked so the test asserts the CALL SITE, not the
 * tracker itself (the tracker has its own unit tests).
 *
 * The component's contract, as coded:
 * - signed-in add success (POST returns success) →
 *   product_added_to_wishlist fires once, with the approved props
 *   only (product_category + source; never a product id);
 * - signed-in add failure → NO event;
 * - guest toggle that ADDS (saved === true) → event fires once;
 * - guest toggle that REMOVES (saved === false) → NO event;
 * - re-rendering after a successful add does NOT re-fire (the
 *   event comes from the click handler, never from an effect).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

const fakeAuth = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

const fakeToast = vi.hoisted(() => ({
  toast: vi.fn(),
}));

const fakeGuest = vi.hoisted(() => ({
  isGuestWishlisted: vi.fn(),
  toggleGuestWishlist: vi.fn(),
}));

const fakeTrack = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));

vi.mock('lucide-react', () => {
  const stub = () => null;
  return { Heart: stub, Check: stub, X: stub };
});

vi.mock('@/features/auth', () => ({
  useAuth: () => ({ user: fakeAuth.user, isLoading: false }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: fakeToast.toast }),
}));

vi.mock('@/lib/guest-wishlist', () => ({
  GUEST_WISHLIST_EVENT: 'sb-guest-wishlist-changed',
  isGuestWishlisted: (...args: unknown[]) =>
    fakeGuest.isGuestWishlisted(...args),
  toggleGuestWishlist: (...args: unknown[]) =>
    fakeGuest.toggleGuestWishlist(...args),
}));

vi.mock('@/components/analytics/track-event', () => ({
  trackEvent: (...args: unknown[]) => fakeTrack.trackEvent(...args),
}));

// Imported after the mocks so the component uses the fakes.
import { WishlistButton } from '@/components/products/wishlist-button';

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('WishlistButton — product_added_to_wishlist event', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fakeAuth.user = null;
    fakeGuest.isGuestWishlisted.mockReturnValue(false);
    fakeGuest.toggleGuestWishlist.mockReturnValue(true);
    // Default fetch: the wishlists list (dialog open) + a
    // successful add. Individual tests override the add response.
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === '/api/v1/wishlists') {
        return jsonResponse({
          success: true,
          data: [
            {
              id: 'wl-1',
              name: 'My List',
              itemCount: 0,
              createdAt: '2026-01-01',
            },
          ],
        });
      }
      if (url.startsWith('/api/v1/wishlists/') && opts?.method === 'POST') {
        return jsonResponse({ success: true });
      }
      return jsonResponse({ success: false });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('fires product_added_to_wishlist exactly once on a signed-in add success, with approved props only', async () => {
    fakeAuth.user = { id: 'user-1' };
    const { rerender } = render(
      createElement(WishlistButton, {
        productId: 'prod-1',
        productName: 'MacBook Air 13',
        productSlug: 'macbook-air-13',
        productCategory: 'Laptops',
        source: 'product_page',
      })
    );
    // Open the dialog and wait for the wishlist to load.
    fireEvent.click(screen.getByRole('button', { name: /^wishlist$/i }));
    await waitFor(() => expect(screen.getByText('My List')).toBeTruthy(), {
      timeout: 5000,
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(
      () => expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).toHaveBeenCalledWith(
      'product_added_to_wishlist',
      { product_category: 'Laptops', source: 'product_page' }
    );
    // No product id, no user id, no wishlist id in the event.
    const props = fakeTrack.trackEvent.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(props).sort()).toEqual([
      'product_category',
      'source',
    ]);
    // Re-rendering after the add must NOT re-fire the event.
    rerender(
      createElement(WishlistButton, {
        productId: 'prod-1',
        productName: 'MacBook Air 13',
        productSlug: 'macbook-air-13',
        productCategory: 'Laptops',
        source: 'product_page',
      })
    );
    expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when the signed-in add fails', async () => {
    fakeAuth.user = { id: 'user-1' };
    fetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url === '/api/v1/wishlists') {
        return jsonResponse({
          success: true,
          data: [
            {
              id: 'wl-1',
              name: 'My List',
              itemCount: 0,
              createdAt: '2026-01-01',
            },
          ],
        });
      }
      if (url.startsWith('/api/v1/wishlists/') && opts?.method === 'POST') {
        return jsonResponse({
          success: false,
          error: { message: 'Please try again.' },
        });
      }
      return jsonResponse({ success: false });
    });
    render(
      createElement(WishlistButton, {
        productId: 'prod-1',
        productName: 'MacBook Air 13',
        productSlug: 'macbook-air-13',
        productCategory: 'Laptops',
        source: 'product_page',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /^wishlist$/i }));
    await waitFor(() => expect(screen.getByText('My List')).toBeTruthy(), {
      timeout: 5000,
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    // The toast is mocked (useToast returns a vi.fn), so no toast
    // UI renders — wait for the failure toast CALL instead.
    await waitFor(
      () =>
        expect(fakeToast.toast).toHaveBeenCalledWith(
          expect.objectContaining({ title: 'Failed to add' })
        ),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).not.toHaveBeenCalled();
  });

  it('fires exactly once when a guest ADDS to the device wishlist', async () => {
    fakeAuth.user = null;
    fakeGuest.toggleGuestWishlist.mockReturnValue(true);
    render(
      createElement(WishlistButton, {
        productId: 'prod-1',
        productName: 'MacBook Air 13',
        productSlug: 'macbook-air-13',
        productCategory: 'Laptops',
        source: 'search_results',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: /^wishlist$/i }));
    await waitFor(
      () => expect(fakeTrack.trackEvent).toHaveBeenCalledTimes(1),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).toHaveBeenCalledWith(
      'product_added_to_wishlist',
      { product_category: 'Laptops', source: 'search_results' }
    );
  });

  it('does NOT fire when a guest REMOVES from the device wishlist', async () => {
    fakeAuth.user = null;
    fakeGuest.isGuestWishlisted.mockReturnValue(true);
    fakeGuest.toggleGuestWishlist.mockReturnValue(false);
    render(
      createElement(WishlistButton, {
        productId: 'prod-1',
        productName: 'MacBook Air 13',
        productSlug: 'macbook-air-13',
        productCategory: 'Laptops',
        source: 'search_results',
      })
    );
    // The button shows "Saved" when already wishlisted.
    fireEvent.click(screen.getByRole('button', { name: /^saved$/i }));
    // Give the synchronous handler a tick, then assert nothing fired.
    await waitFor(
      () => expect(fakeGuest.toggleGuestWishlist).toHaveBeenCalled(),
      { timeout: 5000 }
    );
    expect(fakeTrack.trackEvent).not.toHaveBeenCalled();
  });
});
