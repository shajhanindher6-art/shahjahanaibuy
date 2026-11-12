/**
 * Extension store search links (Section 15, A12 + C6).
 *
 * Pure builder for the extension price endpoint's `meta.storeLinks`:
 * search links (lib/stores.ts builders) for a product name, so the
 * extension banner can show "also search on" links for stores that
 * have no priced row. These are links to each store's OWN search
 * results, never a SmartBuy price, deal, or stock claim.
 *
 * This lives in lib/ — NOT in app/api/v1/extension/price/route.ts.
 * Next.js route files may only export route handlers (GET/POST/…,
 * dynamic, revalidate); a named helper export from a route file is
 * a build-time type error ("not a valid Route export field"), so
 * the builder was moved here and the route imports it.
 */
import {
  buildStoreSearchUrl,
  getStoresSplit,
  GLOBAL_STORES,
  LOCAL_STORES,
  type LocalStore,
} from '@/lib/stores';

export interface ExtensionStoreLink {
  name: string;
  slug: string;
  countryCode: string;
  url: string;
}

// Section 15, A12 — one flagship entry per newly covered local
// merchant (C6): the store the extension now runs on, in its home
// market. Used only when no `country` is given, so the banner
// still surfaces these stores for shoppers whose country is
// unknown. Slugs/country codes must match lib/stores.ts exactly.
const FLAGSHIP_LOCAL_STORES: Array<{ slug: string; countryCode: string }> = [
  { slug: 'daraz', countryCode: 'PK' },
  { slug: 'priceoye', countryCode: 'PK' },
  { slug: 'noon', countryCode: 'AE' },
  { slug: 'jumia', countryCode: 'NG' },
  { slug: 'flipkart', countryCode: 'IN' },
];

const MAX_STORE_LINKS = 10;

/**
 * Search links for a product name. `country` (when a valid
 * 2-letter code with local stores) puts that country's local
 * stores first, then the international fallback; otherwise the
 * global fallback plus the C6 flagship local stores. Stores
 * already present as priced offers are excluded by name, and the
 * list is deduplicated by slug and capped at 10. Search links
 * only — no price, stock, or partnership is claimed.
 */
export function buildExtensionStoreLinks(
  productName: string,
  country: string | null,
  offerMerchantNames: string[] = []
): ExtensionStoreLink[] {
  const offered = new Set(offerMerchantNames.map((n) => n.toLowerCase()));
  let stores: LocalStore[];
  const split = country ? getStoresSplit(country) : null;
  if (split && split.hasLocal) {
    stores = [...split.local, ...split.international];
  } else {
    const flagships = FLAGSHIP_LOCAL_STORES.map(({ slug, countryCode }) =>
      LOCAL_STORES.find((s) => s.slug === slug && s.countryCode === countryCode)
    ).filter((s): s is LocalStore => s !== undefined);
    stores = [...GLOBAL_STORES, ...flagships];
  }
  const seen = new Set<string>();
  const links: ExtensionStoreLink[] = [];
  for (const store of stores) {
    if (seen.has(store.slug)) continue;
    seen.add(store.slug);
    if (offered.has(store.name.toLowerCase())) continue;
    links.push({
      name: store.name,
      slug: store.slug,
      countryCode: store.countryCode,
      url: buildStoreSearchUrl(store, productName),
    });
    if (links.length >= MAX_STORE_LINKS) break;
  }
  return links;
}
