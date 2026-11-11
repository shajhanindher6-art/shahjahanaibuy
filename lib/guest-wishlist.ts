/**
 * Guest wishlist (P0 fix, 2026-11-09 audit).
 *
 * The signed-in wishlist was sign-in gated with no guest path at all,
 * so a logged-out visitor could not save anything and had no reason
 * to come back. Guests now get a device-local wishlist in localStorage
 * — same "saved on this device" pattern as the existing guest price
 * alerts (lib/local-alerts.ts). Nothing is sent to the server; a
 * guest item is just { id, slug, name, addedAt }.
 *
 * Signing in later DOES merge the guest list into the account
 * (lib/guest-merge.ts, run from the AuthProvider after sign-in):
 * only items the account does not already have are added, and the
 * device key is cleared only after the server confirms the merge —
 * until then the toast still says honestly "saved on this device —
 * sign in to keep it across devices".
 */

export interface GuestWishlistItem {
  id: string;
  slug: string;
  name: string;
  addedAt: string;
}

export const GUEST_WISHLIST_KEY = 'sb-guest-wishlist';
export const GUEST_WISHLIST_EVENT = 'sb-guest-wishlist-changed';

function readRaw(): GuestWishlistItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GUEST_WISHLIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GuestWishlistItem =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as GuestWishlistItem).id === 'string' &&
        typeof (item as GuestWishlistItem).name === 'string'
    );
  } catch {
    return [];
  }
}

function writeRaw(items: GuestWishlistItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_WISHLIST_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(GUEST_WISHLIST_EVENT));
  } catch {
    // Storage full or blocked (private mode) — the wishlist simply
    // does not persist; the button still toggles in-memory state.
  }
}

export function getGuestWishlist(): GuestWishlistItem[] {
  return readRaw();
}

/**
 * Merge hook (Section 12, Chunk B): clear the guest wishlist key.
 * Called ONLY by lib/guest-merge.ts after the server has confirmed
 * every new item was added to the account — never before. Clearing
 * also fires the change event so guest UI updates immediately.
 */
export function clearGuestWishlist(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GUEST_WISHLIST_KEY);
    window.dispatchEvent(new Event(GUEST_WISHLIST_EVENT));
  } catch {
    // Storage blocked — the key simply stays; the next merge run
    // dedupes the already-added items out before posting anything.
  }
}

export function isGuestWishlisted(productId: string): boolean {
  return readRaw().some((item) => item.id === productId);
}

/** Toggle one product. Returns true when the product is saved afterwards. */
export function toggleGuestWishlist(item: {
  id: string;
  slug: string;
  name: string;
}): boolean {
  const items = readRaw();
  const exists = items.some((i) => i.id === item.id);
  const next = exists
    ? items.filter((i) => i.id !== item.id)
    : [
        ...items,
        { ...item, addedAt: new Date().toISOString() },
      ];
  writeRaw(next);
  return !exists;
}
