/**
 * Guest → signed-in merge (Section 12, Chunk B).
 *
 * Until now every guest save was lost on sign-in or device change:
 * the guest wishlist (lib/guest-wishlist.ts), guest price alerts
 * (lib/local-alerts.ts) and recently-viewed list
 * (lib/recently-viewed.ts) lived in localStorage only, and the
 * sign-in flow never carried them into the account. This module is
 * the merge.
 *
 * Two layers:
 *
 * 1. Pure, testable helpers (no I/O) — `mergeGuestWishlist`,
 *    `mergeGuestAlerts`, `mergeRecentlyViewed`, `mergeRecentSearches`.
 *    Given guest items + the signed-in account's existing items they
 *    return exactly what is new. Duplicates are removed by slug for
 *    wishlist / recently-viewed and by productId for alerts; on a
 *    conflict the signed-in entry always wins (the guest copy is
 *    dropped, never overwrites).
 * 2. `runGuestMerge` — the client runner, called once after sign-in
 *    from the AuthProvider (the single funnel for password sign-in,
 *    Google OAuth via /auth/callback, and returning sessions). It
 *    reads the guest stores, fetches the account's current server
 *    state through the EXISTING APIs (GET /api/v1/wishlists,
 *    GET /api/v1/wishlists/[id]/items, GET /api/v1/alerts,
 *    POST /api/v1/product-views), posts only the new items, and
 *    clears each guest key ONLY after that category's server writes
 *    all confirmed. A failed category keeps its guest data for the
 *    next sign-in retry. The alerts category also respects the
 *    signed-in tier's alert cap (Section 15 B14): GET /api/v1/alerts
 *    carries maxAlerts in its meta, the merge keeps only the most
 *    recent guest alerts that fit, and any alerts dropped for the
 *    cap are named in the banner — never silently lost. Re-running
 *    the merge is a no-op: the server state is re-read fresh every run, so already-merged items are
 *    deduped out before anything is posted.
 *
 * No new data source, no new migration, no new API route. Recent
 * searches have no signed-in server list (the signed-in
 * search_history table is analytics recorded by the ai-search API,
 * not the /search UI list) — the /search page reads the same
 * `smartbuy-recent-searches` key whether signed in or not, so the
 * searches "merge" only dedupes and caps the device list in place
 * and never claims to have moved anything to the account.
 *
 * Recently-viewed has no GET endpoint, so views are deduped against
 * each other only; a re-run after a successful post finds the guest
 * key already cleared, so views are not re-posted. (A view row is an
 * analytics event — a duplicate row from a pathological retry would
 * be harmless, but the clear-after-confirm makes it not happen.)
 */

import { getGuestWishlist, clearGuestWishlist } from '@/lib/guest-wishlist';
import { loadLocalAlerts, clearLocalAlerts } from '@/lib/local-alerts';
import { getRecentlyViewed, clearRecentlyViewed } from '@/lib/recently-viewed';
import { getGuestBuyList, clearGuestBuyList } from '@/lib/guest-buy-list';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Minimal identity for dedupe: a product is the same product when its
 *  slug matches (case-insensitive) or, when no slug is known, when its
 *  product id matches. Signed-in wishlist items carry no slug
 *  (WishlistItem is { productId, ... }), guest items carry both. */
export interface MergeableProduct {
  productId?: string | null;
  slug?: string | null;
}

export interface GuestWishlistMergeItem extends MergeableProduct {
  productId: string;
  slug: string;
  name: string;
}

export interface GuestAlertMergeItem {
  productId: string;
  alertType: 'price_drop' | 'back_in_stock' | 'deal';
  targetPrice: number | null;
}

export interface SignedInAlertMergeItem {
  productId: string;
  alertType: string;
}

export interface GuestViewMergeItem extends MergeableProduct {
  productId: string;
  slug: string;
}

export interface GuestBuyListMergeItem {
  productId: string;
  slug: string;
  name: string;
  quantity: number;
}

export type MergeCategory = 'wishlist' | 'alerts' | 'views' | 'buyList';

export interface GuestMergeResult {
  wishlistAdded: number;
  wishlistAlreadyHad: number;
  alertsAdded: number;
  alertsAlreadyHad: number;
  /** Guest alerts dropped because the signed-in tier's alert cap
   *  (Section 15 B14) left no room for them — never silently lost:
   *  formatGuestMergeSummary says so plainly. */
  alertsSkippedDueToCap: number;
  /** The tier cap the merge was held to (`null` = unlimited / unknown). */
  alertsCapLimit: number | null;
  viewsRecorded: number;
  buyListAdded: number;
  buyListAlreadyHad: number;
  searchesKept: number;
  /** False when any category failed to confirm — its guest data was
   *  kept on the device for the next sign-in retry. */
  fullyMerged: boolean;
  failedCategories: MergeCategory[];
}

export function emptyGuestMergeResult(): GuestMergeResult {
  return {
    wishlistAdded: 0,
    wishlistAlreadyHad: 0,
    alertsAdded: 0,
    alertsAlreadyHad: 0,
    alertsSkippedDueToCap: 0,
    alertsCapLimit: null,
    viewsRecorded: 0,
    buyListAdded: 0,
    buyListAlreadyHad: 0,
    searchesKept: 0,
    fullyMerged: true,
    failedCategories: [],
  };
}

/** True when the merge actually carried anything over. */
export function hasGuestMergeResult(result: GuestMergeResult): boolean {
  return (
    result.wishlistAdded > 0 ||
    result.alertsAdded > 0 ||
    result.alertsSkippedDueToCap > 0 ||
    result.viewsRecorded > 0 ||
    result.buyListAdded > 0 ||
    result.searchesKept > 0
  );
}

// ---------------------------------------------------------------------------
// Dedupe primitives
// ---------------------------------------------------------------------------

function normalizeSlug(slug: string | null | undefined): string {
  return (slug ?? '').trim().toLowerCase();
}

function normalizeId(id: string | null | undefined): string {
  return (id ?? '').trim();
}

function sameProduct(
  a: MergeableProduct,
  b: MergeableProduct
): boolean {
  const slugA = normalizeSlug(a.slug);
  const slugB = normalizeSlug(b.slug);
  if (slugA !== '' && slugA === slugB) return true;
  const idA = normalizeId(a.productId);
  const idB = normalizeId(b.productId);
  return idA !== '' && idA === idB;
}

/** Alert identity: same product AND same alert type. A different type
 *  for the same product is a different alert (e.g. a price_drop and a
 *  back_in_stock alert can both exist) and is never deduped away. */
function sameAlert(
  a: GuestAlertMergeItem,
  b: SignedInAlertMergeItem
): boolean {
  return (
    normalizeId(a.productId) === normalizeId(b.productId) &&
    a.alertType === b.alertType
  );
}

function plural(count: number, singular: string, pluralForm?: string): string {
  return count === 1 ? singular : (pluralForm ?? `${singular}s`);
}

// ---------------------------------------------------------------------------
// Pure merge helpers
// ---------------------------------------------------------------------------

export interface WishlistMerge {
  /** Guest items not already on the account — safe to add. */
  toAdd: GuestWishlistMergeItem[];
  /** Guest items the account already has — the signed-in entry wins. */
  alreadyHad: GuestWishlistMergeItem[];
}

/**
 * Dedupe guest wishlist items against the account's existing items
 * (by slug, falling back to productId — server items carry no slug).
 * Guest-internal duplicates collapse to the first occurrence.
 * Empty guest data is a no-op. Pure and deterministic.
 */
export function mergeGuestWishlist(
  guest: GuestWishlistMergeItem[],
  existing: MergeableProduct[]
): WishlistMerge {
  const toAdd: GuestWishlistMergeItem[] = [];
  const alreadyHad: GuestWishlistMergeItem[] = [];
  for (const item of guest) {
    if (!normalizeId(item.productId) && !normalizeSlug(item.slug)) continue;
    const seen =
      toAdd.some((t) => sameProduct(t, item)) ||
      alreadyHad.some((t) => sameProduct(t, item));
    if (seen) continue;
    if (existing.some((e) => sameProduct(e, item))) {
      alreadyHad.push(item);
    } else {
      toAdd.push(item);
    }
  }
  return { toAdd, alreadyHad };
}

export interface AlertsMerge {
  toAdd: GuestAlertMergeItem[];
  alreadyHad: GuestAlertMergeItem[];
  /**
   * Guest alerts that passed dedupe but were dropped because the
   * signed-in tier's cap left no room (`maxAlerts` given and the
   * account already holds that many). 0 when uncapped.
   */
  skippedDueToCap: number;
}

export interface MergeGuestAlertsOptions {
  /**
   * Signed-in tier cap (`null` / omitted = unlimited). The merged
   * set is capped at `maxAlerts - existing.length`, keeping the
   * MOST RECENT guest alerts (guest storage is oldest-first, see
   * lib/local-alerts.ts) and dropping the rest into
   * `skippedDueToCap` — the merge never pushes a user over cap.
   */
  maxAlerts?: number | null;
}

/**
 * Dedupe guest alerts against the account's existing alerts, by
 * productId within the same alert type. On a conflict the signed-in
 * alert wins (its target price / channel are untouched). When
 * `options.maxAlerts` is set, the new set is capped so
 * existing + toAdd never exceeds it — most recent guest alerts win
 * the remaining room. Pure and deterministic.
 */
export function mergeGuestAlerts(
  guest: GuestAlertMergeItem[],
  existing: SignedInAlertMergeItem[],
  options: MergeGuestAlertsOptions = {}
): AlertsMerge {
  const deduped: GuestAlertMergeItem[] = [];
  const alreadyHad: GuestAlertMergeItem[] = [];
  for (const item of guest) {
    if (!normalizeId(item.productId)) continue;
    const seen =
      deduped.some((t) => sameAlert(t, item)) ||
      alreadyHad.some((t) => sameAlert(t, item));
    if (seen) continue;
    if (existing.some((e) => sameAlert(item, e))) {
      alreadyHad.push(item);
    } else {
      deduped.push(item);
    }
  }
  const max = options.maxAlerts ?? null;
  if (max === null) {
    return { toAdd: deduped, alreadyHad, skippedDueToCap: 0 };
  }
  const room = Math.max(0, max - existing.length);
  // Guest storage is oldest-first: the tail is the most recent.
  // (slice(-0) is slice(0), so room === 0 needs its own branch.)
  const toAdd = room === 0 ? [] : deduped.slice(-room);
  return {
    toAdd,
    alreadyHad,
    skippedDueToCap: deduped.length - toAdd.length,
  };
}

export interface ViewsMerge {
  /** Distinct guest views to record on the account. */
  toRecord: GuestViewMergeItem[];
  alreadyHad: GuestViewMergeItem[];
}

/**
 * Dedupe guest recently-viewed entries against the account's already
 * recorded views (by slug, falling back to productId). There is no
 * GET product-views endpoint, so callers normally pass [] — the
 * helper still collapses guest-internal duplicates. Pure.
 */
export function mergeRecentlyViewed(
  guest: GuestViewMergeItem[],
  existing: MergeableProduct[]
): ViewsMerge {
  const toRecord: GuestViewMergeItem[] = [];
  const alreadyHad: GuestViewMergeItem[] = [];
  for (const item of guest) {
    if (!normalizeId(item.productId) && !normalizeSlug(item.slug)) continue;
    const seen =
      toRecord.some((t) => sameProduct(t, item)) ||
      alreadyHad.some((t) => sameProduct(t, item));
    if (seen) continue;
    if (existing.some((e) => sameProduct(e, item))) {
      alreadyHad.push(item);
    } else {
      toRecord.push(item);
    }
  }
  return { toRecord, alreadyHad };
}

export interface BuyListMerge {
  /** Guest items not already on the account — safe to add (quantity preserved). */
  toAdd: GuestBuyListMergeItem[];
  /** Guest items the account already has — the signed-in entry wins. */
  alreadyHad: GuestBuyListMergeItem[];
}

/**
 * Dedupe guest buy-list items against the account's existing buy
 * list, by productId. Guest-internal duplicates collapse to the
 * first occurrence (quantities are NOT summed — the first
 * occurrence's quantity is the one posted). Pure and deterministic.
 */
export function mergeGuestBuyList(
  guest: GuestBuyListMergeItem[],
  existing: MergeableProduct[]
): BuyListMerge {
  const toAdd: GuestBuyListMergeItem[] = [];
  const alreadyHad: GuestBuyListMergeItem[] = [];
  for (const item of guest) {
    if (!normalizeId(item.productId)) continue;
    const seen =
      toAdd.some((t) => sameProduct(t, item)) ||
      alreadyHad.some((t) => sameProduct(t, item));
    if (seen) continue;
    if (existing.some((e) => sameProduct(e, item))) {
      alreadyHad.push(item);
    } else {
      toAdd.push(item);
    }
  }
  return { toAdd, alreadyHad };
}

/** Recent-searches key shared by /search and /compare (same key, same
 *  8-item cap, case-insensitive dedupe). Signed-in users read this
 *  same device list — there is no separate signed-in list to merge
 *  into. */
export const RECENT_SEARCHES_KEY = 'smartbuy-recent-searches';
export const MAX_RECENT_SEARCHES = 8;

/**
 * Merge guest recent searches with the account's existing searches:
 * guest terms first (most-recent-first, as stored), then existing
 * terms not already present; case-insensitive dedupe, first
 * occurrence wins, capped at MAX_RECENT_SEARCHES. Order within each
 * list is preserved. Pure.
 */
export function mergeRecentSearches(
  guest: string[],
  existing: string[],
  max = MAX_RECENT_SEARCHES
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const term of [...guest, ...existing]) {
    if (typeof term !== 'string') continue;
    const trimmed = term.trim();
    if (trimmed === '') continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
    if (merged.length >= max) break;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Honest copy
// ---------------------------------------------------------------------------

/**
 * One plain sentence stating exactly what the merge carried over —
 * only confirmed counts, never a claim about a category that did not
 * merge. Returns null when nothing was carried over (so no banner
 * renders). Recent searches are never claimed as "moved to your
 * account": they stay on the device, and the sentence says so.
 */
export function formatGuestMergeSummary(result: GuestMergeResult): string | null {
  const parts: string[] = [];
  if (result.wishlistAdded > 0) {
    parts.push(
      `${result.wishlistAdded} wishlist ${plural(result.wishlistAdded, 'item')}`
    );
  }
  if (result.alertsAdded > 0) {
    parts.push(
      `${result.alertsAdded} price ${plural(result.alertsAdded, 'alert')}`
    );
  }
  if (result.buyListAdded > 0) {
    parts.push(
      `${result.buyListAdded} buy-list ${plural(result.buyListAdded, 'item')}`
    );
  }
  if (result.viewsRecorded > 0) {
    parts.push(
      `${result.viewsRecorded} recently viewed ${plural(result.viewsRecorded, 'product')}`
    );
  }
  if (parts.length === 0) {
    if (result.searchesKept > 0) {
      let sentence = `Welcome back — your ${result.searchesKept} recent ${plural(result.searchesKept, 'search', 'searches')} from this device are still here. Recent searches stay on this device.`;
      const note = capNote(result);
      if (note) sentence += ` ${note}`;
      return sentence;
    }
    return capNote(result);
  }
  let sentence = `Welcome back — we carried over from this device: ${joinParts(parts)}.`;
  if (result.searchesKept > 0) {
    sentence += ' Your recent searches stay on this device.';
  }
  const note = capNote(result);
  if (note) sentence += ` ${note}`;
  return sentence;
}

/**
 * Honest note for guest alerts that could not be carried over
 * because the signed-in tier's alert cap left no room. Returns null
 * when nothing was skipped, so no banner renders for it.
 */
function capNote(result: GuestMergeResult): string | null {
  if (result.alertsSkippedDueToCap <= 0) return null;
  const cap = result.alertsCapLimit;
  const capText =
    cap !== null && cap !== undefined
      ? `Your plan allows up to ${cap} price alerts`
      : 'Your plan has a price-alert limit';
  return (
    `${result.alertsSkippedDueToCap} price ${plural(result.alertsSkippedDueToCap, 'alert')} ` +
    `from this device could not be carried over — ${capText}. ` +
    `Upgrade to Premium for unlimited price alerts: /pricing.`
  );
}

function joinParts(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Merge result handoff to the dashboard (sessionStorage, this tab only)
// ---------------------------------------------------------------------------

export const GUEST_MERGE_RESULT_KEY = 'sb-guest-merge-result';
export const GUEST_MERGE_EVENT = 'sb-guest-merge-done';

export function readGuestMergeResult(): GuestMergeResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(GUEST_MERGE_RESULT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const r = parsed as Partial<GuestMergeResult>;
    if (
      typeof r.wishlistAdded !== 'number' ||
      typeof r.alertsAdded !== 'number' ||
      typeof r.viewsRecorded !== 'number' ||
      typeof r.searchesKept !== 'number'
    ) {
      return null;
    }
    return { ...emptyGuestMergeResult(), ...r } as GuestMergeResult;
  } catch {
    return null;
  }
}

export function clearGuestMergeResult(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(GUEST_MERGE_RESULT_KEY);
  } catch {
    // Ignore storage errors — the banner simply may show again.
  }
}

function storeGuestMergeResult(result: GuestMergeResult): void {
  try {
    window.sessionStorage.setItem(
      GUEST_MERGE_RESULT_KEY,
      JSON.stringify(result)
    );
    window.dispatchEvent(new Event(GUEST_MERGE_EVENT));
  } catch {
    // Storage blocked: the merge itself already happened; only the
    // banner is lost, never the data.
  }
}

// ---------------------------------------------------------------------------
// Client runner — called once after sign-in (see features/auth)
// ---------------------------------------------------------------------------

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const envelope = await fetchEnvelope<T>(url);
  return envelope?.data ?? null;
}

/** Same as fetchJson, but also returns the envelope meta (used by the
 *  alerts category: GET /api/v1/alerts carries maxAlerts there). */
async function fetchJsonWithMeta<T>(url: string): Promise<{
  data: T | null;
  meta: Record<string, unknown> | null;
}> {
  const envelope = await fetchEnvelope<T>(url);
  return { data: envelope?.data ?? null, meta: envelope?.meta ?? null };
}

interface ApiEnvelopeWithMeta<T> {
  success?: boolean;
  data?: T;
  meta?: Record<string, unknown>;
}

async function fetchEnvelope<T>(url: string): Promise<ApiEnvelopeWithMeta<T> | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') return null;
    const envelope = body as ApiEnvelopeWithMeta<T>;
    if (envelope.success !== true) return null;
    return envelope;
  } catch {
    return null;
  }
}

async function postJson(url: string, payload: Record<string, unknown>): Promise<boolean> {
  const { ok } = await postJsonWithStatus(url, payload);
  return ok;
}

/** POST that also reports the HTTP status, so callers can tell a
 *  403 alert-cap rejection (handled, not a failure) from a real
 *  write failure (guest data kept for retry). */
async function postJsonWithStatus(
  url: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body: unknown = await res.json().catch(() => null);
    return {
      ok: !!body && typeof body === 'object' && (body as ApiEnvelope<unknown>).success === true,
      status: res.status,
    };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Read the device recent-searches list (same key / shape as /search). */
export function readRecentSearches(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((q): q is string => typeof q === 'string')
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

function writeRecentSearches(searches: string[]): void {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches));
  } catch {
    // Storage blocked: the in-memory list on /search still works.
  }
}

let mergeInFlight: Promise<GuestMergeResult | null> | null = null;

/**
 * Run the guest → signed-in merge once. Safe to call from every
 * sign-in path: it returns immediately (no network at all) when the
 * guest stores are empty, concurrent calls share one run, and a
 * re-run after a completed merge is a no-op because the guest keys
 * were cleared and the server state is re-read first. Never throws
 * and never blocks sign-in: callers fire-and-forget it.
 *
 * Returns the confirmed result, or null when there was nothing to
 * merge or the merge could not run at all (guest data is left in
 * place for the next sign-in retry in both cases).
 */
export function runGuestMerge(): Promise<GuestMergeResult | null> {
  if (mergeInFlight) return mergeInFlight;
  mergeInFlight = doRunGuestMerge().finally(() => {
    mergeInFlight = null;
  });
  return mergeInFlight;
}

async function doRunGuestMerge(): Promise<GuestMergeResult | null> {
  if (typeof window === 'undefined') return null;
  const result = emptyGuestMergeResult();
  try {
    const guestWishlist = getGuestWishlist();
    const guestAlerts = loadLocalAlerts();
    const guestViews = getRecentlyViewed();
    const guestBuyList = getGuestBuyList();
    const guestSearches = readRecentSearches();

    if (
      guestWishlist.length === 0 &&
      guestAlerts.length === 0 &&
      guestViews.length === 0 &&
      guestBuyList.length === 0 &&
      guestSearches.length === 0
    ) {
      return null;
    }

    // Recent searches: device-local only — dedupe in place, never
    // sent anywhere. This cannot fail the merge.
    if (guestSearches.length > 0) {
      const merged = mergeRecentSearches(guestSearches, []);
      writeRecentSearches(merged);
      result.searchesKept = merged.length;
    }

    // Wishlist: fetch the account's lists + items, add only what's new.
    if (guestWishlist.length > 0) {
      const wishlistOk = await mergeWishlistCategory(guestWishlist, result);
      if (!wishlistOk) result.failedCategories.push('wishlist');
    }

    // Alerts: fetch the account's alerts, add only what's new.
    if (guestAlerts.length > 0) {
      const alertsOk = await mergeAlertsCategory(guestAlerts, result);
      if (!alertsOk) result.failedCategories.push('alerts');
    }

    // Recently viewed: no GET endpoint — record each distinct view.
    if (guestViews.length > 0) {
      const viewsOk = await mergeViewsCategory(guestViews, result);
      if (!viewsOk) result.failedCategories.push('views');
    }

    // Buy list: fetch the account's buy list, add only what's new
    // (quantities preserved; the server dedupes by product).
    if (guestBuyList.length > 0) {
      const buyListOk = await mergeBuyListCategory(guestBuyList, result);
      if (!buyListOk) result.failedCategories.push('buyList');
    }

    result.fullyMerged = result.failedCategories.length === 0;
    if (!hasGuestMergeResult(result)) return null;
    storeGuestMergeResult(result);
    return result;
  } catch {
    // Any unexpected failure: guest data stays put for the next retry.
    return null;
  }
}

async function mergeWishlistCategory(
  guestWishlist: ReturnType<typeof getGuestWishlist>,
  result: GuestMergeResult
): Promise<boolean> {
  const wishlists = await fetchJson<Array<{ id: string }>>('/api/v1/wishlists');
  if (wishlists === null) return false;

  let wishlistId: string | undefined = wishlists[0]?.id;
  let existing: MergeableProduct[] = [];
  if (wishlistId) {
    const items = await fetchJson<Array<{ productId: string }>>(
      `/api/v1/wishlists/${wishlistId}/items`
    );
    if (items === null) return false;
    existing = items;
  }

  const { toAdd, alreadyHad } = mergeGuestWishlist(
    guestWishlist.map((g) => ({ productId: g.id, slug: g.slug, name: g.name })),
    existing
  );
  result.wishlistAlreadyHad = alreadyHad.length;
  if (toAdd.length === 0) {
    // Everything was already on the account — safe to clear.
    clearGuestWishlist();
    return true;
  }

  if (!wishlistId) {
    const created = await postJson('/api/v1/wishlists', { name: 'My Wishlist' });
    if (!created) return false;
    const refetched = await fetchJson<Array<{ id: string }>>('/api/v1/wishlists');
    wishlistId = refetched?.[0]?.id;
    if (!wishlistId) return false;
  }

  for (const item of toAdd) {
    const ok = await postJson(`/api/v1/wishlists/${wishlistId}/items`, {
      productId: item.productId,
    });
    if (!ok) return false;
    result.wishlistAdded += 1;
  }
  // All server writes confirmed — only now clear the guest key.
  clearGuestWishlist();
  return true;
}

async function mergeAlertsCategory(
  guestAlerts: ReturnType<typeof loadLocalAlerts>,
  result: GuestMergeResult
): Promise<boolean> {
  // GET /api/v1/alerts carries the signed-in tier's cap in meta
  // (maxAlerts: number | null) — the merge caps itself at that
  // limit instead of posting alerts the server would reject.
  const { data: existingAlerts, meta } = await fetchJsonWithMeta<
    Array<{ productId: string; alertType: string }>
  >('/api/v1/alerts');
  if (existingAlerts === null) return false;
  const maxAlerts =
    typeof meta?.maxAlerts === 'number' ? meta.maxAlerts : null;

  const { toAdd, alreadyHad, skippedDueToCap } = mergeGuestAlerts(
    guestAlerts.map((a) => ({
      productId: a.productId,
      alertType: a.alertType,
      targetPrice: a.targetPrice,
    })),
    existingAlerts,
    { maxAlerts }
  );
  result.alertsAlreadyHad = alreadyHad.length;
  result.alertsSkippedDueToCap = skippedDueToCap;
  result.alertsCapLimit = maxAlerts;
  if (toAdd.length === 0) {
    // Everything was already on the account, or the cap left no
    // room: the skipped alerts are intentionally NOT kept — keeping
    // them would retry a merge the server will always reject, and
    // the banner says plainly why they were dropped.
    clearLocalAlerts();
    return true;
  }

  for (let i = 0; i < toAdd.length; i++) {
    const alert = toAdd[i];
    const { ok, status } = await postJsonWithStatus('/api/v1/alerts', {
      productId: alert.productId,
      alertType: alert.alertType,
      ...(alert.alertType === 'price_drop' && typeof alert.targetPrice === 'number'
        ? { conditionValue: alert.targetPrice }
        : {}),
    });
    if (ok) {
      result.alertsAdded += 1;
      continue;
    }
    if (status === 403) {
      // Race: the account hit its cap between the GET and this
      // POST (alerts added elsewhere). The remaining guest alerts
      // are cap-skipped, not failed — stop posting, record them,
      // and clear the guest key (the banner explains the drop).
      const remaining = toAdd.length - i;
      result.alertsSkippedDueToCap += remaining;
      if (result.alertsCapLimit === null) {
        result.alertsCapLimit = existingAlerts.length + result.alertsAdded;
      }
      clearLocalAlerts();
      return true;
    }
    return false;
  }
  clearLocalAlerts();
  return true;
}

async function mergeBuyListCategory(
  guestBuyList: ReturnType<typeof getGuestBuyList>,
  result: GuestMergeResult
): Promise<boolean> {
  // GET /api/v1/buy-list returns BuyListItemView rows, whose
  // product id is the snake_case product_id column.
  const existingItems = await fetchJson<
    Array<{ product_id?: string; productId?: string; slug?: string | null }>
  >('/api/v1/buy-list');
  if (existingItems === null) return false;
  const existing: MergeableProduct[] = existingItems.map((i) => ({
    productId: i.product_id ?? i.productId ?? null,
    slug: i.slug ?? null,
  }));

  const { toAdd, alreadyHad } = mergeGuestBuyList(
    guestBuyList.map((g) => ({
      productId: g.id,
      slug: g.slug,
      name: g.name,
      quantity: g.quantity,
    })),
    existing
  );
  result.buyListAlreadyHad = alreadyHad.length;
  if (toAdd.length === 0) {
    // Everything was already on the account — safe to clear.
    clearGuestBuyList();
    return true;
  }

  for (const item of toAdd) {
    // The buy-list API takes camelCase productId (not product_id).
    const ok = await postJson('/api/v1/buy-list', {
      productId: item.productId,
      quantity: item.quantity,
    });
    if (!ok) return false;
    result.buyListAdded += 1;
  }
  // All server writes confirmed — only now clear the guest key.
  clearGuestBuyList();
  return true;
}

async function mergeViewsCategory(
  guestViews: ReturnType<typeof getRecentlyViewed>,
  result: GuestMergeResult
): Promise<boolean> {
  const { toRecord } = mergeRecentlyViewed(
    guestViews.map((v) => ({ productId: v.id, slug: v.slug })),
    []
  );
  for (const view of toRecord) {
    const ok = await postJson('/api/v1/product-views', {
      productId: view.productId,
    });
    if (!ok) return false;
    result.viewsRecorded += 1;
  }
  clearRecentlyViewed();
  return true;
}
