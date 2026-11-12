/**
 * Brand / category × store search links (Section 15 A1/A2).
 *
 * Pure link builder: every store in the directory (80 local stores
 * + 4 global fallback stores = 84) crossed with one search term —
 * a brand name on /brands/[slug], a category name on
 * /categories/[slug]. Each link goes to the retailer's OWN search
 * results via the EXISTING verified templates in lib/stores.ts
 * (buildStoreSearchUrl) — no URL pattern is invented here, no
 * product or price is claimed, and no affiliate partnership is
 * implied. The per-page counts are exact: 10 brands × 84 stores =
 * 840 link instances, 6 categories × 84 = 504.
 *
 * Two entries can share a name and URL (eBay US in LOCAL_STORES
 * and eBay Global in GLOBAL_STORES are the same ebay.com search);
 * both are kept so the count stays honest at 84, and the country
 * label the component renders tells them apart.
 */

import {
  GLOBAL_STORES,
  LOCAL_STORES,
  buildStoreSearchUrl,
  type LocalStore,
} from '@/lib/stores';

export interface StoreSearchLink {
  /** The directory entry (name, slug, country, homepage). */
  store: LocalStore;
  /** The store's own search URL for the query. */
  searchUrl: string;
}

/** Every store the directory knows: 80 local + 4 global = 84. */
export const ALL_SEARCH_STORES: LocalStore[] = [
  ...LOCAL_STORES,
  ...GLOBAL_STORES,
];

/**
 * Search links for one query (brand or category name) at every
 * store, in directory order. A blank query links nowhere — [] —
 * rather than a search for nothing.
 */
export function buildStoreSearchLinks(query: string): StoreSearchLink[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return ALL_SEARCH_STORES.map((store) => ({
    store,
    searchUrl: buildStoreSearchUrl(store, trimmed),
  }));
}
