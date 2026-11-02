/**
 * Per-country local-stores directory (Option 2, Phase 1).
 *
 * HONEST LIMITS — read before widening this file:
 * - This is a DIRECTORY + SEARCH LINKS registry, not a price feed.
 *   There is NO live local-store price data anywhere in this project,
 *   and no free official API provides it. Scraping retailer sites is
 *   blocked and must not be attempted.
 * - Clicking a local store takes the shopper to that store's OWN
 *   search results for the product name, where the store itself
 *   shows its price and stock. Nothing here is a SmartBuy price,
 *   deal, discount, rating, or review, and no affiliate partnership
 *   is claimed for any store listed.
 * - Only stores whose public search-URL pattern is known with
 *   confidence are included. Stores whose pattern could not be
 *   confirmed (e.g. Otto DE, Walmart Canada, Cdiscount FR) are
 *   deliberately OMITTED, not guessed.
 * - Amazon and Best Buy are deliberately EXCLUDED from this
 *   registry: they are already the priced "Where to Buy" merchant
 *   rows (Amazon's domain is localised per region), so listing
 *   them again here would duplicate those rows.
 * - Country codes match lib/region.ts exactly (US, PK, GB, DE, FR,
 *   IT, ES, IN, AE, SA, CA, AU). Unknown codes fall back to US.
 */

export interface LocalStore {
  /** Display name, e.g. "Daraz". */
  name: string;
  /** URL-safe slug, unique per country, e.g. "daraz". */
  slug: string;
  /** ISO 3166-1 alpha-2 country code, matching lib/region.ts. */
  countryCode: string;
  /** Store homepage. */
  websiteUrl: string;
  /**
   * Search-URL template. `{q}` is replaced with the
   * URL-encoded product name by buildStoreSearchUrl().
   */
  searchUrlTemplate: string;
}

export const LOCAL_STORES: LocalStore[] = [
  // United States — Amazon/Best Buy excluded (priced rows).
  { name: 'eBay', slug: 'ebay', countryCode: 'US', websiteUrl: 'https://www.ebay.com', searchUrlTemplate: 'https://www.ebay.com/sch/i.html?_nkw={q}' },
  { name: 'Walmart', slug: 'walmart', countryCode: 'US', websiteUrl: 'https://www.walmart.com', searchUrlTemplate: 'https://www.walmart.com/search?q={q}' },
  { name: 'Target', slug: 'target', countryCode: 'US', websiteUrl: 'https://www.target.com', searchUrlTemplate: 'https://www.target.com/s?searchTerm={q}' },

  // Pakistan — Amazon has no local domain here; the priced Amazon
  // row stays amazon.com, so Daraz is a genuine additional store.
  { name: 'Daraz', slug: 'daraz', countryCode: 'PK', websiteUrl: 'https://www.daraz.pk', searchUrlTemplate: 'https://www.daraz.pk/catalog/?q={q}' },

  // United Kingdom — Amazon UK excluded (priced row, localised domain).
  { name: 'eBay', slug: 'ebay', countryCode: 'GB', websiteUrl: 'https://www.ebay.co.uk', searchUrlTemplate: 'https://www.ebay.co.uk/sch/i.html?_nkw={q}' },
  { name: 'Argos', slug: 'argos', countryCode: 'GB', websiteUrl: 'https://www.argos.co.uk', searchUrlTemplate: 'https://www.argos.co.uk/search/{q}/' },

  // Germany — Amazon DE excluded (priced row, localised domain).
  { name: 'eBay', slug: 'ebay', countryCode: 'DE', websiteUrl: 'https://www.ebay.de', searchUrlTemplate: 'https://www.ebay.de/sch/i.html?_nkw={q}' },

  // France — Amazon FR excluded (priced row, localised domain).
  { name: 'eBay', slug: 'ebay', countryCode: 'FR', websiteUrl: 'https://www.ebay.fr', searchUrlTemplate: 'https://www.ebay.fr/sch/i.html?_nkw={q}' },

  // Italy — Amazon IT excluded (priced row, localised domain).
  { name: 'eBay', slug: 'ebay', countryCode: 'IT', websiteUrl: 'https://www.ebay.it', searchUrlTemplate: 'https://www.ebay.it/sch/i.html?_nkw={q}' },

  // Spain — Amazon ES excluded (priced row, localised domain).
  { name: 'eBay', slug: 'ebay', countryCode: 'ES', websiteUrl: 'https://www.ebay.es', searchUrlTemplate: 'https://www.ebay.es/sch/i.html?_nkw={q}' },

  // India — Amazon IN excluded (priced row, localised domain).
  { name: 'Flipkart', slug: 'flipkart', countryCode: 'IN', websiteUrl: 'https://www.flipkart.com', searchUrlTemplate: 'https://www.flipkart.com/search?q={q}' },

  // United Arab Emirates — Amazon AE excluded (priced row, localised domain).
  { name: 'Noon', slug: 'noon', countryCode: 'AE', websiteUrl: 'https://www.noon.com', searchUrlTemplate: 'https://www.noon.com/uae-en/search/?q={q}' },

  // Saudi Arabia — Amazon SA excluded (priced row, localised domain).
  { name: 'Noon', slug: 'noon', countryCode: 'SA', websiteUrl: 'https://www.noon.com', searchUrlTemplate: 'https://www.noon.com/saudi-en/search/?q={q}' },

  // Canada — Amazon CA / Best Buy excluded (priced rows).
  { name: 'eBay', slug: 'ebay', countryCode: 'CA', websiteUrl: 'https://www.ebay.ca', searchUrlTemplate: 'https://www.ebay.ca/sch/i.html?_nkw={q}' },

  // Australia — Amazon AU excluded (priced row, localised domain).
  { name: 'eBay', slug: 'ebay', countryCode: 'AU', websiteUrl: 'https://www.ebay.com.au', searchUrlTemplate: 'https://www.ebay.com.au/sch/i.html?_nkw={q}' },
];

const BY_COUNTRY = new Map<string, LocalStore[]>();
for (const store of LOCAL_STORES) {
  const list = BY_COUNTRY.get(store.countryCode) ?? [];
  list.push(store);
  BY_COUNTRY.set(store.countryCode, list);
}

/**
 * Local stores for a country code (case-insensitive). Unknown or
 * missing codes fall back to the US list, matching lib/region.ts.
 */
export function getLocalStores(countryCode: string | null | undefined): LocalStore[] {
  if (!countryCode) return BY_COUNTRY.get('US') ?? [];
  return BY_COUNTRY.get(countryCode.toUpperCase()) ?? BY_COUNTRY.get('US') ?? [];
}

/**
 * Build a store's search URL for a product name. The name is
 * URL-encoded; the result is an outbound link to the store's own
 * search results, never a SmartBuy price or product page.
 */
export function buildStoreSearchUrl(store: LocalStore, productName: string): string {
  return store.searchUrlTemplate.replace('{q}', encodeURIComponent(productName));
}
