/**
 * Curated query page — /find/[query] (Section 15, A4).
 *
 * One page per curated search term (500, from lib/search-terms.ts).
 * The page links the query to every store's OWN search results —
 * 84 store entries (80 local + 4 global), deduped to 83 unique URLs
 * where a local and a global entry share a domain (eBay US vs the
 * global eBay entry). It never claims a product, price, deal, stock
 * level, rating, or review: the store itself shows its own results
 * when the shopper clicks through.
 *
 * Unknown slugs call notFound(), matching the /brands/[slug] and
 * /categories/[slug] pages. The middleware (middleware.ts) checks
 * slug existence BEFORE rendering and rewrites unknown slugs to
 * /__smartbuy_not_found__ — a path that matches no route — so
 * Next returns its routing-level 404 (the real app/not-found.tsx
 * UI, HTTP 404) without rendering anything through the loading
 * boundary, and the browser URL stays on the requested slug. The
 * notFound() call here is the in-render fallback for the same
 * case; the old Section 15 soft-404 caveat (notFound() rendering
 * with HTTP 200) no longer applies since that middleware rewrite
 * landed — see middleware.ts and lib/middleware/slug-exists.ts.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { appConfig } from '@/lib/config/app';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import {
  ALL_FIND_STORES,
  SEARCH_TERMS,
  getFindQueryStoreLinks,
  getSearchTermBySlug,
  getSearchTermsByCategory,
  type FindStoreLink,
} from '@/lib/search-terms';
import { getRegionByCountry } from '@/lib/region';

export function generateStaticParams(): Array<{ query: string }> {
  return SEARCH_TERMS.map((term) => ({ query: term.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { query: string };
}): Promise<Metadata> {
  const term = getSearchTermBySlug(params.query);
  if (!term) {
    return { title: 'Search not found — SmartBuy AI' };
  }
  return {
    title: `${term.query} — search ${ALL_FIND_STORES.length} stores | SmartBuy AI`,
    description: `Search for "${term.query}" across ${ALL_FIND_STORES.length} retailers — links to each store's own search results. SmartBuy shows no price or stock here; each store shows its own results.`,
    alternates: {
      canonical: `${appConfig.url}/find/${term.slug}`,
    },
  };
}

/** Group store links by country, in directory order; GLOBAL last. */
function groupLinksByCountry(links: FindStoreLink[]): Array<{
  countryCode: string;
  countryName: string;
  links: FindStoreLink[];
}> {
  const groups = new Map<string, FindStoreLink[]>();
  for (const link of links) {
    const code = link.store.countryCode;
    const list = groups.get(code) ?? [];
    list.push(link);
    groups.set(code, list);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    if (a === 'GLOBAL') return 1;
    if (b === 'GLOBAL') return -1;
    return a.localeCompare(b);
  });
  return ordered.map(([countryCode, countryLinks]) => ({
    countryCode,
    countryName:
      countryCode === 'GLOBAL'
        ? 'Worldwide'
        : (getRegionByCountry(countryCode)?.name ?? countryCode),
    links: countryLinks,
  }));
}

export default function FindQueryPage({
  params,
}: {
  params: { query: string };
}) {
  const term = getSearchTermBySlug(params.query);
  if (!term) {
    notFound();
  }

  const links = getFindQueryStoreLinks(term.query);
  const groups = groupLinksByCountry(links);
  const related = getSearchTermsByCategory(term.category)
    .filter((other) => other.slug !== term.slug)
    .slice(0, 8);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList, ItemList). */}
      <PageJsonLd
        name={term.query}
        description={`Search for "${term.query}" across ${ALL_FIND_STORES.length} retailers — links to each store's own search results. SmartBuy shows no price or stock here; each store shows its own results.`}
        path={`/find/${term.slug}`}
        crumbs={[{ name: 'Home', path: '/' }, { name: 'Find', path: '/find' }, { name: term.query }]}
        items={related.map((other) => ({ name: other.query, path: `/find/${other.slug}` }))}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
            <Link href="/" className="underline">
              Home
            </Link>
            {' / '}
            <Link href="/find" className="underline">
              Find
            </Link>
            {' / '}
            <span>{term.query}</span>
          </nav>
          <h1 className="text-3xl font-bold">{term.query}</h1>
          <p className="mt-2 text-muted-foreground">
            Search for &ldquo;{term.query}&rdquo; at {links.length} stores below.
            Each link opens that store&rsquo;s own search results — SmartBuy
            does not sell this product and shows no price, stock, deal, or
            review here. Prices and availability are whatever the store
            itself shows when you click through.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Category: {term.category} · {ALL_FIND_STORES.length} store
            entries linked
          </p>

          {groups.map((group) => (
            <section key={group.countryCode} className="mt-8">
              <h2 className="text-lg font-semibold">{group.countryName}</h2>
              <ul className="mt-3 space-y-2">
                {group.links.map(({ store, url }) => (
                  <li key={`${store.countryCode}-${store.slug}`}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[44px] items-center justify-between rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:border-blue-300 hover:text-primary"
                    >
                      <span>
                        {store.name}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {new URL(url).hostname}
                        </span>
                      </span>
                      <span aria-hidden="true">→</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {related.length > 0 ? (
            <section className="mt-10">
              <h2 className="text-lg font-semibold">
                More {term.category.toLowerCase()} searches
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {related.map((other) => (
                  <li key={other.slug}>
                    <Link
                      href={`/find/${other.slug}`}
                      className="inline-flex min-h-[44px] items-center rounded-full border px-3 py-1 text-sm transition-colors hover:border-blue-300 hover:text-primary"
                    >
                      {other.query}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm">
                <Link href="/find" className="underline">
                  Browse all 500 searches
                </Link>
              </p>
            </section>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
