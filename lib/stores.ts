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
 *   confirmed (e.g. Otto DE, Walmart Canada, Cdiscount FR, Bol NL,
 *   Galaxus CH, Takealot ZA, Rozetka UA, eMAG RO, Tokopedia ID,
 *   Noon QA/EG, Jumia TN/DZ) are deliberately OMITTED, not guessed.
 * - Amazon and Best Buy are deliberately EXCLUDED from this
 *   registry: they are already the priced "Where to Buy" merchant
 *   rows (Amazon's domain is localised per region), so listing
 *   them again here would duplicate those rows.
 * - Country codes match lib/region.ts exactly (60 regions after the
 *   worldwide expansion, 2026-11-02). 58 of them have ≥1 local
 *   store (70 stores total); QA and ZA are regions without a
 *   confirmed local store, so they get the global fallback.
 * - GLOBAL FALLBACK: getStoresForCountry() returns the local list
 *   when a country has one, otherwise GLOBAL_STORES (Amazon.com,
 *   eBay.com, AliExpress, Google Shopping — search links only,
 *   same honest note, no partnership claimed). A product page
 *   therefore never renders an empty store section.
 * - Verification levels (see the per-group comments below):
 *   "verbatim" = the exact search URL appeared in a search result
 *   or a live page fetch; "platform-family" = the pattern is the
 *   same platform's confirmed pattern on another country domain
 *   of that platform (e.g. Daraz /catalog/?q= confirmed on .pk,
 *   applied to .com.bd/.lk/.com.np; eBay _nkw confirmed on 7
 *   domains, applied to .ie/.at/.be/.nl/.ch). Anything weaker
 *   than that was omitted.
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

  // --- Worldwide expansion (2026-11-02): 55 more stores, 46 more
  // markets. Verification basis is noted per group; see the file
  // header for what "verbatim" vs "platform-family" means.

  // Japan — verbatim: live fetches returned search results for
  // both patterns (Mercari 100+ listings, Rakuten full results).
  { name: 'Mercari', slug: 'mercari', countryCode: 'JP', websiteUrl: 'https://jp.mercari.com', searchUrlTemplate: 'https://jp.mercari.com/search?keyword={q}' },
  { name: 'Rakuten', slug: 'rakuten', countryCode: 'JP', websiteUrl: 'https://www.rakuten.co.jp', searchUrlTemplate: 'https://search.rakuten.co.jp/search/mall/{q}/' },

  // Turkey — verbatim: Trendyol /sr?q= and Hepsiburada /ara?q=
  // both appeared verbatim in search results.
  { name: 'Trendyol', slug: 'trendyol', countryCode: 'TR', websiteUrl: 'https://www.trendyol.com', searchUrlTemplate: 'https://www.trendyol.com/sr?q={q}' },
  { name: 'Hepsiburada', slug: 'hepsiburada', countryCode: 'TR', websiteUrl: 'https://www.hepsiburada.com', searchUrlTemplate: 'https://www.hepsiburada.com/ara?q={q}' },

  // South Korea — verbatim: Coupang /np/search?q= in results.
  { name: 'Coupang', slug: 'coupang', countryCode: 'KR', websiteUrl: 'https://www.coupang.com', searchUrlTemplate: 'https://www.coupang.com/np/search?q={q}' },

  // Poland & Czechia — verbatim: Allegro /listing?string= (PL)
  // and /vyhledavani?string= (CZ) in search results.
  { name: 'Allegro', slug: 'allegro', countryCode: 'PL', websiteUrl: 'https://allegro.pl', searchUrlTemplate: 'https://allegro.pl/listing?string={q}' },
  { name: 'Allegro', slug: 'allegro', countryCode: 'CZ', websiteUrl: 'https://allegro.cz', searchUrlTemplate: 'https://allegro.cz/vyhledavani?string={q}' },

  // Greece — verbatim: live fetch of /search?keyphrase= returned
  // 60+ laptop results.
  { name: 'Skroutz', slug: 'skroutz', countryCode: 'GR', websiteUrl: 'https://www.skroutz.gr', searchUrlTemplate: 'https://www.skroutz.gr/search?keyphrase={q}' },

  // Southeast Asia — Shopee /search?keyword= verbatim for .co.id;
  // Lazada /catalog/?q= verbatim for .com.my; the remaining
  // country domains are the same platforms' own domains, so the
  // platform-family pattern applies.
  { name: 'Shopee', slug: 'shopee', countryCode: 'ID', websiteUrl: 'https://shopee.co.id', searchUrlTemplate: 'https://shopee.co.id/search?keyword={q}' },
  { name: 'Lazada', slug: 'lazada', countryCode: 'ID', websiteUrl: 'https://www.lazada.co.id', searchUrlTemplate: 'https://www.lazada.co.id/catalog/?q={q}' },
  { name: 'Shopee', slug: 'shopee', countryCode: 'MY', websiteUrl: 'https://shopee.com.my', searchUrlTemplate: 'https://shopee.com.my/search?keyword={q}' },
  { name: 'Lazada', slug: 'lazada', countryCode: 'MY', websiteUrl: 'https://www.lazada.com.my', searchUrlTemplate: 'https://www.lazada.com.my/catalog/?q={q}' },
  { name: 'Shopee', slug: 'shopee', countryCode: 'SG', websiteUrl: 'https://shopee.sg', searchUrlTemplate: 'https://shopee.sg/search?keyword={q}' },
  { name: 'Lazada', slug: 'lazada', countryCode: 'SG', websiteUrl: 'https://www.lazada.sg', searchUrlTemplate: 'https://www.lazada.sg/catalog/?q={q}' },
  { name: 'Shopee', slug: 'shopee', countryCode: 'TH', websiteUrl: 'https://shopee.co.th', searchUrlTemplate: 'https://shopee.co.th/search?keyword={q}' },
  { name: 'Lazada', slug: 'lazada', countryCode: 'TH', websiteUrl: 'https://www.lazada.co.th', searchUrlTemplate: 'https://www.lazada.co.th/catalog/?q={q}' },
  { name: 'Shopee', slug: 'shopee', countryCode: 'VN', websiteUrl: 'https://shopee.vn', searchUrlTemplate: 'https://shopee.vn/search?keyword={q}' },
  { name: 'Lazada', slug: 'lazada', countryCode: 'VN', websiteUrl: 'https://www.lazada.vn', searchUrlTemplate: 'https://www.lazada.vn/catalog/?q={q}' },
  { name: 'Shopee', slug: 'shopee', countryCode: 'PH', websiteUrl: 'https://shopee.ph', searchUrlTemplate: 'https://shopee.ph/search?keyword={q}' },
  { name: 'Lazada', slug: 'lazada', countryCode: 'PH', websiteUrl: 'https://www.lazada.com.ph', searchUrlTemplate: 'https://www.lazada.com.ph/catalog/?q={q}' },
  { name: 'Shopee', slug: 'shopee', countryCode: 'TW', websiteUrl: 'https://shopee.tw', searchUrlTemplate: 'https://shopee.tw/search?keyword={q}' },

  // Brazil — Mercado Livre host lista.mercadolivre.com.br is the
  // platform's own search host (platform-family path form); Shopee
  // BR uses the platform-family /search?keyword= pattern.
  { name: 'Mercado Livre', slug: 'mercado-livre', countryCode: 'BR', websiteUrl: 'https://mercadolivre.com.br', searchUrlTemplate: 'https://lista.mercadolivre.com.br/{q}' },
  { name: 'Shopee', slug: 'shopee', countryCode: 'BR', websiteUrl: 'https://shopee.com.br', searchUrlTemplate: 'https://shopee.com.br/search?keyword={q}' },

  // Latin America (Mercado Libre) — listado.{domain}/{q} verbatim
  // for .com.ar and .com.mx; the remaining country domains are
  // the platform's own domains, so the platform-family pattern
  // applies.
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'MX', websiteUrl: 'https://mercadolibre.com.mx', searchUrlTemplate: 'https://listado.mercadolibre.com.mx/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'AR', websiteUrl: 'https://mercadolibre.com.ar', searchUrlTemplate: 'https://listado.mercadolibre.com.ar/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'CL', websiteUrl: 'https://mercadolibre.cl', searchUrlTemplate: 'https://listado.mercadolibre.cl/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'CO', websiteUrl: 'https://mercadolibre.com.co', searchUrlTemplate: 'https://listado.mercadolibre.com.co/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'PE', websiteUrl: 'https://mercadolibre.com.pe', searchUrlTemplate: 'https://listado.mercadolibre.com.pe/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'UY', websiteUrl: 'https://mercadolibre.com.uy', searchUrlTemplate: 'https://listado.mercadolibre.com.uy/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'BO', websiteUrl: 'https://mercadolibre.com.bo', searchUrlTemplate: 'https://listado.mercadolibre.com.bo/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'PY', websiteUrl: 'https://mercadolibre.com.py', searchUrlTemplate: 'https://listado.mercadolibre.com.py/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'VE', websiteUrl: 'https://mercadolibre.com.ve', searchUrlTemplate: 'https://listado.mercadolibre.com.ve/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'CR', websiteUrl: 'https://mercadolibre.co.cr', searchUrlTemplate: 'https://listado.mercadolibre.co.cr/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'EC', websiteUrl: 'https://mercadolibre.com.ec', searchUrlTemplate: 'https://listado.mercadolibre.com.ec/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'GT', websiteUrl: 'https://mercadolibre.com.gt', searchUrlTemplate: 'https://listado.mercadolibre.com.gt/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'DO', websiteUrl: 'https://mercadolibre.com.do', searchUrlTemplate: 'https://listado.mercadolibre.com.do/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'PA', websiteUrl: 'https://mercadolibre.com.pa', searchUrlTemplate: 'https://listado.mercadolibre.com.pa/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'HN', websiteUrl: 'https://mercadolibre.com.hn', searchUrlTemplate: 'https://listado.mercadolibre.com.hn/{q}' },
  { name: 'Mercado Libre', slug: 'mercado-libre', countryCode: 'NI', websiteUrl: 'https://mercadolibre.com.ni', searchUrlTemplate: 'https://listado.mercadolibre.com.ni/{q}' },

  // South Asia (Daraz) — /catalog/?q= confirmed on daraz.pk;
  // .com.bd/.lk/.com.np are Daraz's own domains, so the
  // platform-family pattern applies.
  { name: 'Daraz', slug: 'daraz', countryCode: 'BD', websiteUrl: 'https://www.daraz.com.bd', searchUrlTemplate: 'https://www.daraz.com.bd/catalog/?q={q}' },
  { name: 'Daraz', slug: 'daraz', countryCode: 'LK', websiteUrl: 'https://www.daraz.lk', searchUrlTemplate: 'https://www.daraz.lk/catalog/?q={q}' },
  { name: 'Daraz', slug: 'daraz', countryCode: 'NP', websiteUrl: 'https://www.daraz.com.np', searchUrlTemplate: 'https://www.daraz.com.np/catalog/?q={q}' },

  // Africa (Jumia) — /catalog/?q= verbatim: a live fetch of the
  // .com.ng search URL returned 40,793 laptop results. The other
  // country domains are Jumia's own domains, so the
  // platform-family pattern applies.
  { name: 'Jumia', slug: 'jumia', countryCode: 'NG', websiteUrl: 'https://www.jumia.com.ng', searchUrlTemplate: 'https://www.jumia.com.ng/catalog/?q={q}' },
  { name: 'Jumia', slug: 'jumia', countryCode: 'EG', websiteUrl: 'https://www.jumia.com.eg', searchUrlTemplate: 'https://www.jumia.com.eg/catalog/?q={q}' },
  { name: 'Jumia', slug: 'jumia', countryCode: 'KE', websiteUrl: 'https://www.jumia.co.ke', searchUrlTemplate: 'https://www.jumia.co.ke/catalog/?q={q}' },
  { name: 'Jumia', slug: 'jumia', countryCode: 'MA', websiteUrl: 'https://www.jumia.ma', searchUrlTemplate: 'https://www.jumia.ma/catalog/?q={q}' },
  { name: 'Jumia', slug: 'jumia', countryCode: 'CI', websiteUrl: 'https://www.jumia.ci', searchUrlTemplate: 'https://www.jumia.ci/catalog/?q={q}' },
  { name: 'Jumia', slug: 'jumia', countryCode: 'SN', websiteUrl: 'https://www.jumia.sn', searchUrlTemplate: 'https://www.jumia.sn/catalog/?q={q}' },
  { name: 'Jumia', slug: 'jumia', countryCode: 'UG', websiteUrl: 'https://www.jumia.ug', searchUrlTemplate: 'https://www.jumia.ug/catalog/?q={q}' },
  { name: 'Jumia', slug: 'jumia', countryCode: 'GH', websiteUrl: 'https://www.jumia.com.gh', searchUrlTemplate: 'https://www.jumia.com.gh/catalog/?q={q}' },

  // Europe (eBay) — the _nkw pattern is uniform across every
  // eBay domain (confirmed on 7 domains in the original list),
  // so it applies to these additional eBay country domains.
  { name: 'eBay', slug: 'ebay', countryCode: 'IE', websiteUrl: 'https://www.ebay.ie', searchUrlTemplate: 'https://www.ebay.ie/sch/i.html?_nkw={q}' },
  { name: 'eBay', slug: 'ebay', countryCode: 'AT', websiteUrl: 'https://www.ebay.at', searchUrlTemplate: 'https://www.ebay.at/sch/i.html?_nkw={q}' },
  { name: 'eBay', slug: 'ebay', countryCode: 'BE', websiteUrl: 'https://www.ebay.be', searchUrlTemplate: 'https://www.ebay.be/sch/i.html?_nkw={q}' },
  { name: 'eBay', slug: 'ebay', countryCode: 'NL', websiteUrl: 'https://www.ebay.nl', searchUrlTemplate: 'https://www.ebay.nl/sch/i.html?_nkw={q}' },
  { name: 'eBay', slug: 'ebay', countryCode: 'CH', websiteUrl: 'https://www.ebay.ch', searchUrlTemplate: 'https://www.ebay.ch/sch/i.html?_nkw={q}' },
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
 * Prefer getStoresForCountry() for product pages: it returns the
 * global fallback instead of US stores for unknown countries.
 */
export function getLocalStores(countryCode: string | null | undefined): LocalStore[] {
  if (!countryCode) return BY_COUNTRY.get('US') ?? [];
  return BY_COUNTRY.get(countryCode.toUpperCase()) ?? BY_COUNTRY.get('US') ?? [];
}

/**
 * Global retailer fallback for ANY country with no local stores.
 * Search links only — the same honest rules as local stores: no
 * price, no stock, no deal, no partnership claimed. Amazon.com is
 * listed here, but product pages filter it out when the priced
 * Amazon "Where to Buy" row is already shown (same link would
 * otherwise appear twice); eBay, AliExpress and Google Shopping
 * always remain.
 */
export const GLOBAL_STORES: LocalStore[] = [
  { name: 'Amazon', slug: 'amazon', countryCode: 'GLOBAL', websiteUrl: 'https://www.amazon.com', searchUrlTemplate: 'https://www.amazon.com/s?k={q}' },
  { name: 'eBay', slug: 'ebay', countryCode: 'GLOBAL', websiteUrl: 'https://www.ebay.com', searchUrlTemplate: 'https://www.ebay.com/sch/i.html?_nkw={q}' },
  { name: 'AliExpress', slug: 'aliexpress', countryCode: 'GLOBAL', websiteUrl: 'https://www.aliexpress.com', searchUrlTemplate: 'https://www.aliexpress.com/wholesale?SearchText={q}' },
  { name: 'Google Shopping', slug: 'google-shopping', countryCode: 'GLOBAL', websiteUrl: 'https://www.google.com', searchUrlTemplate: 'https://www.google.com/search?tbm=shop&q={q}' },
];

export type StoreListKind = 'local' | 'global';

export interface StoreListResult {
  kind: StoreListKind;
  stores: LocalStore[];
}

/**
 * Stores for a country code (case-insensitive): the country's
 * local stores when it has any, otherwise the global fallback.
 * This never returns an empty list, so a product page can always
 * render a store section for a valid country.
 */
export function getStoresForCountry(
  countryCode: string | null | undefined
): StoreListResult {
  const code = countryCode?.toUpperCase();
  const local = code ? BY_COUNTRY.get(code) : undefined;
  if (local && local.length > 0) return { kind: 'local', stores: local };
  return { kind: 'global', stores: GLOBAL_STORES };
}

/**
 * Build a store's search URL for a product name. The name is
 * URL-encoded; the result is an outbound link to the store's own
 * search results, never a SmartBuy price or product page.
 */
export function buildStoreSearchUrl(store: LocalStore, productName: string): string {
  return store.searchUrlTemplate.replace('{q}', encodeURIComponent(productName));
}
