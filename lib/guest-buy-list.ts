/**
 * Guest buy-list (Section 14, Chunk 7).
 *
 * The signed-in buy list was sign-in gated with no guest path at
 * all: a logged-out visitor tapping "Save" on a product page got
 * "Sign in to save" and the product was lost. Guests now get a
 * device-local buy list in localStorage — the same "saved on this
 * device" pattern as the guest wishlist (lib/guest-wishlist.ts).
 * Nothing is sent to the server; a guest item is just
 * { id, slug, name, quantity, addedAt }.
 *
 * Signing in later DOES merge the guest list into the account
 * (lib/guest-merge.ts, run from the AuthProvider after sign-in):
 * only items the account does not already have are added, and the
 * device key is cleared only after the server confirms the merge.
 * Quantities are preserved: a guest item with quantity 2 is posted
 * once with quantity 2 (POST /api/v1/buy-list dedupes by product
 * and bumps quantity, so only genuinely new items are posted).
 */

export interface GuestBuyListItem {
  id: string;
  slug: string;
  name: string;
  quantity: number;
  addedAt: string;
}

export const GUEST_BUY_LIST_KEY = 'sb-guest-buy-list';
export const GUEST_BUY_LIST_EVENT = 'sb-guest-buy-list-changed';
export const GUEST_BUY_LIST_MAX_QUANTITY = 99;

function readRaw(): GuestBuyListItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GUEST_BUY_LIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GuestBuyListItem =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as GuestBuyListItem).id === 'string' &&
        typeof (item as GuestBuyListItem).name === 'string'
    );
  } catch {
    return [];
  }
}

function writeRaw(items: GuestBuyListItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_BUY_LIST_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(GUEST_BUY_LIST_EVENT));
  } catch {
    // Storage full or blocked (private mode) — the buy list simply
    // does not persist; the button still reports the save honestly.
  }
}

export function getGuestBuyList(): GuestBuyListItem[] {
  return readRaw();
}

function normalizeQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  const q = Math.floor(value);
  if (q < 1) return 1;
  if (q > GUEST_BUY_LIST_MAX_QUANTITY) return GUEST_BUY_LIST_MAX_QUANTITY;
  return q;
}

/**
 * Add a product to the guest buy list, or bump its quantity when it
 * is already there (capped at 99). Returns the stored item.
 */
export function addGuestBuyListItem(
  item: Omit<GuestBuyListItem, 'addedAt' | 'quantity'> & { quantity?: number }
): GuestBuyListItem {
  const items = readRaw();
  const quantity = normalizeQuantity(item.quantity ?? 1);
  const existing = items.find((i) => i.id === item.id);
  if (existing) {
    existing.quantity = Math.min(
      existing.quantity + quantity,
      GUEST_BUY_LIST_MAX_QUANTITY
    );
    writeRaw(items);
    return existing;
  }
  const stored: GuestBuyListItem = {
    id: item.id,
    slug: item.slug,
    name: item.name,
    quantity,
    addedAt: new Date().toISOString(),
  };
  items.push(stored);
  writeRaw(items);
  return stored;
}

export function removeGuestBuyListItem(productId: string): void {
  writeRaw(readRaw().filter((i) => i.id !== productId));
}

export function setGuestBuyListQuantity(productId: string, quantity: number): void {
  const q = normalizeQuantity(quantity);
  writeRaw(
    readRaw().map((i) => (i.id === productId ? { ...i, quantity: q } : i))
  );
}

export function isGuestBuyListed(productId: string): boolean {
  return readRaw().some((i) => i.id === productId);
}

/**
 * Merge hook: clear the guest buy-list key. Called ONLY by
 * lib/guest-merge.ts after the server has confirmed every new item
 * was added to the account — never before. Clearing also fires the
 * change event so guest UI updates immediately.
 */
export function clearGuestBuyList(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GUEST_BUY_LIST_KEY);
    window.dispatchEvent(new Event(GUEST_BUY_LIST_EVENT));
  } catch {
    // Storage blocked — the key simply stays; the next merge run
    // dedupes the already-added items out before posting anything.
  }
}
