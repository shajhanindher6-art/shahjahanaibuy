/**
 * Store search links section (Section 15 A1/A2) — server component
 * shared by /brands/[slug] and /categories/[slug].
 *
 * Renders one link per store in the directory (84) for the given
 * query (a brand or category name). Every link opens the store's
 * OWN search results in a new tab — the store shows its price and
 * stock, SmartBuy shows none of either here, and no partnership is
 * claimed. Same link pattern (target _blank, rel noopener
 * noreferrer) as components/products/store-split-section.tsx.
 */

import { buildStoreSearchLinks } from '@/lib/store-search-links';

export function StoreSearchLinks({
  query,
  label,
}: {
  /** Search term — the brand or category name. */
  query: string;
  /** Display name used in the heading and link text. */
  label: string;
}) {
  const links = buildStoreSearchLinks(query);
  if (links.length === 0) return null;

  return (
    <section
      aria-label={`Search for ${label} at every store`}
      className="mt-12"
    >
      <h2 className="text-xl font-bold">
        Search for {label} at every store
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {links.length} stores — each link opens that store&apos;s own
        search results for {label}. Prices and stock are shown by the
        store, not by SmartBuy, and no partnership or affiliate
        relationship is claimed.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {links.map(({ store, searchUrl }) => (
          <li key={`${store.countryCode}-${store.slug}`}>
            <a
              href={searchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline"
            >
              Search {label} on {store.name} (
              {store.countryCode === 'GLOBAL'
                ? 'Global'
                : store.countryCode}
              )
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
