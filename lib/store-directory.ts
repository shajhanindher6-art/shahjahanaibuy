/**
 * Store directory — /stores/[country]/[slug] (Section 15, A3).
 *
 * Pure helpers over the existing registries (lib/stores.ts,
 * lib/region.ts) — no database, no network — so they run in the
 * plain-Node vitest environment.
 *
 * URL SHAPE: the country code is part of the URL because store
 * slugs repeat across countries (eBay ~13 domains, Mercado Libre
 * ~14, Shopee ~7). /stores/us/ebay and /stores/gb/ebay are
 * different stores on different domains.
 *
 * PAGES: 80 local stores + 4 worldwide stores = 84 pages. The
 * worldwide stores live under the pseudo-country `global`
 * (/stores/global/amazon) — they are the getStoresForCountry()
 * fallback, not a real country, and the pages say so.
 *
 * LINKS: every link on a store page goes to the retailer's OWN
 * search results via the EXISTING buildStoreSearchUrl() builder
 * from lib/stores.ts — never an invented URL pattern, never a
 * claimed price, stock, or deal. Each store page links the 10
 * catalog products + the catalog categories by name (16 links
 * per page today, 1,344 instances across the 84 pages).
 */

import {
  GLOBAL_STORES,
  LOCAL_STORES,
  buildStoreSearchUrl,
  type LocalStore,
} from '@/lib/stores';
import { REGIONS, getRegionByCountry } from '@/lib/region';

/** URL country segment for the worldwide stores (not a real country). */
export const GLOBAL_COUNTRY_SEGMENT = 'global';

/** Display name for the worldwide group. */
export const GLOBAL_COUNTRY_NAME = 'Worldwide';

/** Total store pages: 80 local + 4 worldwide. */
export const STORE_PAGE_COUNT = LOCAL_STORES.length + GLOBAL_STORES.length;

/**
 * One store page: the store plus the URL country segment it lives
 * under (lowercase ISO code, or 'global' for worldwide stores).
 */
export interface StorePageEntry {
  store: LocalStore;
  /** Lowercase URL segment: ISO country code or 'global'. */
  country: string;
  /** Canonical path, e.g. '/stores/pk/daraz'. */
  path: string;
}

function toEntry(store: LocalStore): StorePageEntry {
  const country = store.countryCode.toLowerCase();
  return { store, country, path: `/stores/${country}/${store.slug}` };
}

/** All 84 store pages, in registry order (local first, then worldwide). */
export function getAllStorePages(): StorePageEntry[] {
  return [
    ...LOCAL_STORES.map(toEntry),
    ...GLOBAL_STORES.map(toEntry),
  ];
}

/** generateStaticParams() output for app/stores/[country]/[slug]. */
export function getStorePageParams(): Array<{ country: string; slug: string }> {
  return getAllStorePages().map(({ country, store }) => ({
    country,
    slug: store.slug,
  }));
}

/**
 * Resolve a store page by URL segments (case-insensitive).
 * Returns null for an unknown country, an unknown slug, or a
 * slug that exists only in another country — the page 404s.
 */
export function findStorePage(
  country: string | null | undefined,
  slug: string | null | undefined
): StorePageEntry | null {
  if (!country || !slug) return null;
  const countryLower = country.toLowerCase();
  const slugLower = slug.toLowerCase();
  const pool =
    countryLower === GLOBAL_COUNTRY_SEGMENT ? GLOBAL_STORES : LOCAL_STORES;
  const store = pool.find(
    (candidate) =>
      candidate.countryCode.toLowerCase() === countryLower &&
      candidate.slug.toLowerCase() === slugLower
  );
  return store ? toEntry(store) : null;
}

/** Display name for a URL country segment ('Worldwide' for global). */
export function getStoreCountryName(country: string): string | null {
  if (country.toLowerCase() === GLOBAL_COUNTRY_SEGMENT) {
    return GLOBAL_COUNTRY_NAME;
  }
  return getRegionByCountry(country)?.name ?? null;
}

/** Minimal product shape a store page needs (name + slug). */
export interface StoreDirectoryProduct {
  name: string;
  slug: string;
}

/** One outbound link to a store's own search results. */
export interface StoreDirectoryLink {
  /** Link label (product or category name). */
  label: string;
  /** Retailer search URL, built only from the store's own template. */
  searchUrl: string;
  /** SmartBuy product page, for product links only. */
  productPath?: string;
}

/**
 * The links for one store page: one retailer-search link per
 * catalog product (by product name) plus one per catalog
 * category (by category name). Every URL comes from
 * buildStoreSearchUrl() — the store's own verified template —
 * so no URL pattern is ever invented here.
 */
export function buildStoreDirectoryLinks(
  store: LocalStore,
  products: StoreDirectoryProduct[],
  categories: string[]
): { productLinks: StoreDirectoryLink[]; categoryLinks: StoreDirectoryLink[] } {
  return {
    productLinks: products.map((product) => ({
      label: product.name,
      searchUrl: buildStoreSearchUrl(store, product.name),
      productPath: `/products/${product.slug}`,
    })),
    categoryLinks: categories.map((category) => ({
      label: category,
      searchUrl: buildStoreSearchUrl(store, category),
    })),
  };
}

/** One country group on the /stores index. */
export interface StoreCountryGroup {
  /** URL country segment (lowercase code or 'global'). */
  country: string;
  /** Display name. */
  name: string;
  stores: LocalStore[];
}

/**
 * Stores grouped by country for the /stores index, in REGIONS
 * order, with the worldwide group last. Countries with no
 * confirmed local store (ZA today) have no group — they are
 * covered by the worldwide group, and the index says so.
 */
export function groupStoresByCountry(): StoreCountryGroup[] {
  const groups: StoreCountryGroup[] = [];
  for (const region of REGIONS) {
    const stores = LOCAL_STORES.filter(
      (store) => store.countryCode === region.code
    );
    if (stores.length > 0) {
      groups.push({ country: region.code.toLowerCase(), name: region.name, stores });
    }
  }
  groups.push({
    country: GLOBAL_COUNTRY_SEGMENT,
    name: GLOBAL_COUNTRY_NAME,
    stores: [...GLOBAL_STORES],
  });
  return groups;
}
