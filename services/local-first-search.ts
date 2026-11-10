/**
 * Local-first retailer search — pure split logic (no I/O, no DB).
 *
 * A search query is split into two honest buckets for the
 * visitor's country:
 *   - localResults: the country's CONFIRMED local stores
 *     (lib/stores.ts), as search links only. No price, stock,
 *     discount, deal, or rating exists for these stores anywhere
 *     in this project, so none is ever rendered for them.
 *   - globalResults: catalog product matches (real recorded
 *     prices only, null = "Price not listed") followed by the
 *     global store links (GLOBAL_STORES). Each entry is honestly
 *     typed ('product' vs 'store-link') so the UI renders them
 *     differently.
 *
 * When a country has no confirmed local store (ZA, or an
 * unknown code), localResults is [] and fallbackTriggered is
 * true — the UI auto-switches to the Global tab with the notice
 * "No local stock found — showing international import options."
 *
 * The route (/api/search) is a thin wrapper: it validates the
 * query, resolves the country, fetches catalog matches with the
 * exact product-query logic of the ai-search route
 * (getCachedAISearch), and calls buildLocalFirstResults.
 */

import {
  buildStoreSearchUrl,
  getLocalOnlyStores,
  GLOBAL_STORES,
  type LocalStore,
} from '@/lib/stores';

/** One local store, as a search link for the query. */
export interface LocalStoreLink {
  storeName: string;
  storeSlug: string;
  countryCode: string;
  websiteUrl: string;
  searchUrl: string;
}

/** A catalog product match in the global bucket. */
export interface GlobalProductEntry {
  kind: 'product';
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  /**
   * Latest recorded USD price, or null when the product has no
   * recorded price ("Price not listed"). Never invented.
   */
  priceUsd: number | null;
  /** Search relevance score (same value the ai-search route returns). */
  score: number;
  /** Merchant/store names listing this product (catalog data only). */
  stores: string[];
}

/** A global store, as a search link for the query. */
export interface GlobalStoreLinkEntry {
  kind: 'store-link';
  storeName: string;
  storeSlug: string;
  countryCode: string;
  websiteUrl: string;
  searchUrl: string;
}

export type GlobalResultEntry = GlobalProductEntry | GlobalStoreLinkEntry;

/** The full /api/search response payload (data field). */
export interface LocalFirstSearchData {
  query: string;
  country: string;
  countryName: string;
  currency: string;
  localResults: LocalStoreLink[];
  globalResults: GlobalResultEntry[];
  fallbackTriggered: boolean;
}

export const LOCAL_FIRST_MAX_QUERY_LENGTH = 200;

/**
 * Verbatim fallback notice, shown when the visitor's country has
 * no confirmed local store. Single source of truth — the
 * component renders this constant, never a retyped copy.
 */
export const LOCAL_FIRST_FALLBACK_NOTICE =
  'No local stock found — showing international import options.';

export function validateLocalFirstQuery(
  raw: unknown
): { ok: true; query: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, error: 'Search query is required' };
  }
  const query = raw.trim();
  if (query.length > LOCAL_FIRST_MAX_QUERY_LENGTH) {
    return {
      ok: false,
      error: `Search query must be ${LOCAL_FIRST_MAX_QUERY_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, query };
}

export function toLocalStoreLink(store: LocalStore, query: string): LocalStoreLink {
  return {
    storeName: store.name,
    storeSlug: store.slug,
    countryCode: store.countryCode,
    websiteUrl: store.websiteUrl,
    searchUrl: buildStoreSearchUrl(store, query),
  };
}

/** The catalog fields the route passes in from getCachedAISearch. */
export interface CatalogProductForLocalFirst {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  currentPrice: number | null;
  score: number;
  stores: string[];
}

/**
 * Split a query's results into local vs global buckets.
 * Pure: no I/O, so it is unit-testable without a database.
 */
export function buildLocalFirstResults(args: {
  query: string;
  country: string;
  products: CatalogProductForLocalFirst[];
}): {
  localResults: LocalStoreLink[];
  globalResults: GlobalResultEntry[];
  fallbackTriggered: boolean;
} {
  const { query, country, products } = args;

  const localResults = getLocalOnlyStores(country).map((store) =>
    toLocalStoreLink(store, query)
  );
  const fallbackTriggered = localResults.length === 0;

  const globalResults: GlobalResultEntry[] = [
    ...products.map(
      (p): GlobalProductEntry => ({
        kind: 'product',
        id: p.id,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        category: p.category,
        imageUrl: p.imageUrl,
        priceUsd: p.currentPrice,
        score: p.score,
        stores: p.stores,
      })
    ),
    ...GLOBAL_STORES.map(
      (store): GlobalStoreLinkEntry => ({
        kind: 'store-link',
        ...toLocalStoreLink(store, query),
      })
    ),
  ];

  return { localResults, globalResults, fallbackTriggered };
}
