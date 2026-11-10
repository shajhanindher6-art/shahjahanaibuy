/**
 * Optimistic UI helpers (Section 4, item 2). Client-safe pure logic —
 * no imports, no network. The UI applies the optimistic state
 * immediately on click, then either keeps the server-confirmed state
 * or rolls back with `revert()` when the request fails.
 *
 * Pattern (wishlist / alert actions):
 *   const { next, added, revert } = optimisticWishlistToggle(savedIds, productId);
 *   setSavedIds(next);                       // UI updates instantly
 *   const ok = await saveWishlist(productId); // server confirm
 *   if (!ok) setSavedIds(revert());           // roll back on failure
 *
 * These helpers never touch the server themselves — wiring them into
 * pages is wave 2 (see the batch report's wiring map).
 */

export interface OptimisticResult<T> {
  /** State to render immediately. */
  next: T;
  /** The previous state, for rolling back on failure. */
  revert: () => T;
}

/** Toggle one id in a list of saved ids. Returns whether it was added. */
export function optimisticIdToggle(
  ids: string[],
  id: string
): OptimisticResult<string[]> & { added: boolean } {
  const present = ids.includes(id);
  const next = present ? ids.filter((x) => x !== id) : [...ids, id];
  return { next, added: !present, revert: () => ids };
}

/** Wishlist action: optimistic toggle of a product id in the saved list. */
export function optimisticWishlistToggle(
  savedProductIds: string[],
  productId: string
): OptimisticResult<string[]> & { added: boolean } {
  return optimisticIdToggle(savedProductIds, productId);
}

/** Price-alert action: optimistic toggle of an alert id in the active list. */
export function optimisticAlertToggle(
  activeAlertIds: string[],
  alertId: string
): OptimisticResult<string[]> & { added: boolean } {
  return optimisticIdToggle(activeAlertIds, alertId);
}

/** Optimistically add an item to a list (no-op when already present). */
export function optimisticListAdd<T>(
  list: T[],
  item: T,
  isSame: (a: T, b: T) => boolean = (a, b) => a === b
): OptimisticResult<T[]> & { added: boolean } {
  if (list.some((x) => isSame(x, item))) {
    return { next: list, added: false, revert: () => list };
  }
  return { next: [...list, item], added: true, revert: () => list };
}

/** Optimistically remove items matching a predicate; `removed` is what left. */
export function optimisticListRemove<T>(
  list: T[],
  predicate: (item: T) => boolean
): OptimisticResult<T[]> & { removed: T[] } {
  const removed = list.filter(predicate);
  const next = list.filter((item) => !predicate(item));
  return { next, removed, revert: () => list };
}

/** Optimistically patch one object; revert restores the original. */
export function optimisticPatch<T extends Record<string, unknown>>(
  item: T,
  patch: Partial<T>
): OptimisticResult<T> {
  return { next: { ...item, ...patch }, revert: () => item };
}

/**
 * Generic optimistic state machine for any value: render `optimistic`
 * now, `commit(confirmed)` when the server answers, `rollback()` when
 * it fails. Keeps the three states explicit so a failed request can
 * never leave the UI showing something the server rejected.
 */
export function createOptimisticState<T>(current: T, optimistic: T) {
  return {
    value: optimistic,
    commit: (confirmed: T): T => confirmed,
    rollback: (): T => current,
  };
}
