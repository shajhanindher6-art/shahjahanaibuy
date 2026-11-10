/**
 * AI Shopping List Optimizer — Section 7, item 1 (pure, deterministic).
 *
 * Given a shopping list and the REAL recorded merchant listings for
 * those products, work out the cheapest way to buy the whole list:
 * which item from which store, the per-store totals, and the saving
 * versus buying everything from one store.
 *
 * HONESTY: this module invents no price. A listing is only used when
 * it carries a finite price above zero. A product with no listing is
 * reported as `noListing` and excluded from every total, with a note
 * — never priced from thin air. All money is rounded to cents.
 */

export interface ListOptimizerItem {
  productSlug: string;
  quantity: number;
}

export interface MerchantListingInput {
  productSlug: string;
  /** Store / retailer display name, e.g. "Amazon". */
  store: string;
  /** Recorded merchant price (USD). Must be finite and > 0 to count. */
  price: number;
  /** Retailer link-out, when recorded. Never invented. */
  url?: string | null;
}

export interface OptimizedListItem {
  productSlug: string;
  quantity: number;
  /** Cheapest recorded store for this item, or null when no listing. */
  store: string | null;
  unitPrice: number | null;
  lineTotal: number | null;
  url: string | null;
  hasListing: boolean;
}

export interface StoreTotal {
  store: string;
  /** Sum of (cheapest-in-that-store price × quantity) for the items it carries. */
  total: number;
  /** Slugs of the priced items this store carries. */
  items: string[];
  /** True when this store carries every priced item in the list. */
  carriesAllPricedItems: boolean;
}

export interface ListOptimization {
  items: OptimizedListItem[];
  /** Slugs with no recorded merchant listing — excluded from totals. */
  noListingSlugs: string[];
  /** Cheapest-split total (each item at its cheapest store), or null when nothing is priced. */
  splitTotal: number | null;
  /** Per-store totals, cheapest first. */
  storeTotals: StoreTotal[];
  /** Cheapest single store that carries every priced item, or null when no store does. */
  bestSingleStore: StoreTotal | null;
  /** Best single-store total minus the split total, or null when not comparable. */
  savingVsSingleStore: number | null;
  /** Human-readable notes, e.g. the no-listing exclusion note. */
  notes: string[];
}

export const LIST_OPTIMIZER_MAX_ITEMS = 50;
export const LIST_OPTIMIZER_MAX_QUANTITY = 99;

export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function isValidPrice(price: unknown): price is number {
  return typeof price === 'number' && Number.isFinite(price) && price > 0;
}

/**
 * Validate + de-duplicate a raw list. Same slug twice merges quantities.
 * Throws on an empty list, a missing/blank slug, a non-integer quantity,
 * or a quantity outside 1..99 — the caller answers 400/422 instead of
 * optimizing a list that was never well formed.
 */
export function normalizeListItems(items: unknown): ListOptimizerItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items must be a non-empty array.');
  }
  if (items.length > LIST_OPTIMIZER_MAX_ITEMS) {
    throw new Error(`items must contain at most ${LIST_OPTIMIZER_MAX_ITEMS} entries.`);
  }
  const merged = new Map<string, number>();
  for (const raw of items) {
    const entry = raw as { productSlug?: unknown; quantity?: unknown } | null;
    const slug = typeof entry?.productSlug === 'string' ? entry.productSlug.trim() : '';
    if (!slug) throw new Error('Every item needs a product_slug.');
    const quantity = entry?.quantity;
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > LIST_OPTIMIZER_MAX_QUANTITY
    ) {
      throw new Error(`Quantity for "${slug}" must be a whole number from 1 to ${LIST_OPTIMIZER_MAX_QUANTITY}.`);
    }
    merged.set(slug, (merged.get(slug) ?? 0) + quantity);
  }
  return [...merged.entries()].map(([productSlug, quantity]) => ({ productSlug, quantity }));
}

/**
 * Optimize a normalized list against recorded merchant listings.
 * Pure: no I/O, no clock, no invented prices.
 */
export function optimizeShoppingList(
  items: ListOptimizerItem[],
  listings: MerchantListingInput[]
): ListOptimization {
  const notes: string[] = [];

  // Cheapest valid listing per product slug (ties keep the first seen).
  const cheapestBySlug = new Map<string, MerchantListingInput>();
  const listingsByStore = new Map<string, Map<string, MerchantListingInput>>();
  for (const listing of listings ?? []) {
    if (!listing || typeof listing.productSlug !== 'string' || !listing.productSlug.trim()) continue;
    if (typeof listing.store !== 'string' || !listing.store.trim()) continue;
    if (!isValidPrice(listing.price)) continue;
    const slug = listing.productSlug.trim();
    const store = listing.store.trim();
    const existing = cheapestBySlug.get(slug);
    if (!existing || listing.price < existing.price) cheapestBySlug.set(slug, listing);
    const byProduct = listingsByStore.get(store) ?? new Map<string, MerchantListingInput>();
    const storeExisting = byProduct.get(slug);
    if (!storeExisting || listing.price < storeExisting.price) byProduct.set(slug, listing);
    listingsByStore.set(store, byProduct);
  }

  const optimizedItems: OptimizedListItem[] = [];
  const noListingSlugs: string[] = [];
  let splitTotal = 0;
  let pricedCount = 0;

  for (const item of items) {
    const cheapest = cheapestBySlug.get(item.productSlug);
    if (!cheapest) {
      noListingSlugs.push(item.productSlug);
      optimizedItems.push({
        productSlug: item.productSlug,
        quantity: item.quantity,
        store: null,
        unitPrice: null,
        lineTotal: null,
        url: null,
        hasListing: false,
      });
      continue;
    }
    const lineTotal = roundToCents(cheapest.price * item.quantity);
    splitTotal = roundToCents(splitTotal + lineTotal);
    pricedCount += 1;
    optimizedItems.push({
      productSlug: item.productSlug,
      quantity: item.quantity,
      store: cheapest.store,
      unitPrice: roundToCents(cheapest.price),
      lineTotal,
      url: cheapest.url ?? null,
      hasListing: true,
    });
  }

  const pricedSlugs = optimizedItems.filter((i) => i.hasListing).map((i) => i.productSlug);
  const storeTotals: StoreTotal[] = [];
  for (const [store, byProduct] of listingsByStore) {
    let total = 0;
    const carried: string[] = [];
    for (const item of items) {
      const listing = byProduct.get(item.productSlug);
      if (!listing) continue;
      total = roundToCents(total + listing.price * item.quantity);
      carried.push(item.productSlug);
    }
    if (carried.length === 0) continue;
    storeTotals.push({
      store,
      total,
      items: carried,
      carriesAllPricedItems:
        pricedSlugs.length > 0 && pricedSlugs.every((slug) => byProduct.has(slug)),
    });
  }
  storeTotals.sort((a, b) => a.total - b.total || a.store.localeCompare(b.store));

  const bestSingleStore =
    storeTotals.find((s) => s.carriesAllPricedItems) ?? null;
  const savingVsSingleStore =
    bestSingleStore !== null && pricedCount > 0
      ? roundToCents(bestSingleStore.total - splitTotal)
      : null;

  if (noListingSlugs.length > 0) {
    notes.push(
      `${noListingSlugs.length} item${noListingSlugs.length === 1 ? '' : 's'} (${noListingSlugs.join(', ')}) ha${noListingSlugs.length === 1 ? 's' : 've'} no recorded merchant listing and ${noListingSlugs.length === 1 ? 'is' : 'are'} excluded from the totals — no price was invented for ${noListingSlugs.length === 1 ? 'it' : 'them'}.`
    );
  }
  if (pricedCount === 0) {
    notes.push('No item in this list has a recorded merchant listing, so there is no total to optimize yet.');
  } else if (bestSingleStore === null) {
    notes.push('No single store carries every priced item in this list, so there is no one-store total to compare against — the split total above is the cheapest recorded way to buy the priced items.');
  } else if (savingVsSingleStore !== null && savingVsSingleStore > 0) {
    notes.push(
      `Buying each item at its cheapest store saves $${savingVsSingleStore.toFixed(2)} versus buying everything from ${bestSingleStore.store}.`
    );
  } else {
    notes.push(
      `The cheapest split matches buying everything from ${bestSingleStore.store} — no extra saving from splitting across stores.`
    );
  }

  return {
    items: optimizedItems,
    noListingSlugs,
    splitTotal: pricedCount > 0 ? splitTotal : null,
    storeTotals,
    bestSingleStore,
    savingVsSingleStore,
    notes,
  };
}
