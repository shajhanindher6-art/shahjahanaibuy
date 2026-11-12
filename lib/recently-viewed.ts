/**
 * Guest recently-viewed products (Section 11, Chunk C).
 *
 * The signed-in view history already exists (product_views table +
 * POST /api/v1/product-views, called from the product page) — this
 * module is the guest path only, mirroring the lib/guest-wishlist.ts
 * pattern: device-local localStorage, nothing sent to the server.
 * A guest item is { id, slug, name, brand, category, imageUrl,
 * price, viewedAt } — the minimal fields the homepage strip needs
 * to render a card and link back to the product. The price is
 * whatever was known when the view was recorded (null when unknown
 * — the strip then shows no price, never a guessed one).
 *
 * Signing in later DOES merge this list into product_views
 * (lib/guest-merge.ts, run from the AuthProvider after sign-in):
 * each distinct viewed product is recorded on the account, and the
 * device key is cleared only after the server confirms the merge.
 * Until sign-in, the strip says so honestly: views are saved on
 * this device only. Once signed in, the strip merges this list
 * with the account history (Section 16, #38 — GET
 * /api/v1/product-views) and says "Synced to your account".
 */

export interface RecentlyViewedItem {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  /** Last known price in USD, or null when unknown. */
  price: number | null;
  viewedAt: string;
}

export const RECENTLY_VIEWED_KEY = 'sb-recently-viewed';
export const RECENTLY_VIEWED_EVENT = 'sb-recently-viewed-changed';

/** Maximum number of viewed products kept on one device (oldest dropped first). */
export const MAX_RECENTLY_VIEWED = 20;

function readRaw(): RecentlyViewedItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentlyViewedItem =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as RecentlyViewedItem).id === 'string' &&
        typeof (item as RecentlyViewedItem).slug === 'string' &&
        typeof (item as RecentlyViewedItem).name === 'string'
    );
  } catch {
    return [];
  }
}

function writeRaw(items: RecentlyViewedItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event(RECENTLY_VIEWED_EVENT));
  } catch {
    // Storage full or blocked (private mode) — the view simply
    // does not persist; the page still works.
  }
}

/** Most-recent-first list of viewed products. Never throws. */
export function getRecentlyViewed(): RecentlyViewedItem[] {
  return readRaw();
}

/**
 * Record a product view. Re-viewing a product moves it to the front
 * (dedupe by id) and refreshes viewedAt; the list is capped at
 * MAX_RECENTLY_VIEWED, oldest dropped first. Never throws.
 */
export function recordRecentlyViewed(item: {
  id: string;
  slug: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  price?: number | null;
}): void {
  if (!item.id || !item.slug || !item.name) return;
  const entry: RecentlyViewedItem = {
    id: item.id,
    slug: item.slug,
    name: item.name,
    brand: item.brand ?? null,
    category: item.category ?? null,
    imageUrl: item.imageUrl ?? null,
    price:
      typeof item.price === 'number' && Number.isFinite(item.price)
        ? item.price
        : null,
    viewedAt: new Date().toISOString(),
  };
  const next = [
    entry,
    ...readRaw().filter((i) => i.id !== item.id),
  ].slice(0, MAX_RECENTLY_VIEWED);
  writeRaw(next);
  // Section 16, #40: proactively cache the just-viewed product
  // page for offline reading (best-effort, never throws).
  notifyServiceWorkerOfViewed(item.slug);
}

/**
 * Section 16, #40 — ask the service worker to cache this product
 * page for offline reading. Posts { type: 'CACHE_URLS' } to the
 * controlling worker (public/sw.js), which fetches the page once
 * into its runtime cache. Best-effort and silent: no service
 * worker, no controller, or any error means nothing happens — the
 * view is still recorded locally above. Only the page URL is sent,
 * never the price (the worker never caches price data).
 */
export function notifyServiceWorkerOfViewed(slug: string): void {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const controller = navigator.serviceWorker.controller;
    if (!controller) return;
    controller.postMessage({
      type: 'CACHE_URLS',
      urls: [`/products/${slug}`],
    });
  } catch {
    // Offline precache is progressive enhancement; never throw.
  }
}

/** Remove one product from the history. Never throws. */
export function removeRecentlyViewed(productId: string): void {
  writeRaw(readRaw().filter((i) => i.id !== productId));
}

/** Clear the whole view history on this device. Never throws. */
export function clearRecentlyViewed(): void {
  writeRaw([]);
}
