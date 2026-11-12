/**
 * Curated searches index — /find (Section 15, A4).
 *
 * Lists all 500 curated shopping queries from lib/search-terms.ts,
 * grouped by category, each linking to its /find/[query] page.
 *
 * Honest copy: these are search links to retailers, not products or
 * prices. A /find/[query] page opens each store's own search
 * results for that query — SmartBuy shows no price, stock, deal, or
 * review on those pages, and claims no partnership with any store.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { appConfig } from '@/lib/config/app';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import {
  ALL_FIND_STORES,
  SEARCH_TERMS,
  SEARCH_TERM_CATEGORIES,
  getSearchTermsByCategory,
} from '@/lib/search-terms';
import { buildItemListJsonLd, toJsonLd } from '@/lib/json-ld';

export const metadata: Metadata = {
  title: 'Find it in 84 stores — SmartBuy AI',
  description: `500 curated shopping searches, each linked to ${ALL_FIND_STORES.length} retailers' own search results. No prices here — each store shows its own results when you click through.`,
  alternates: {
    canonical: `${appConfig.url}/find`,
  },
};

export default function FindIndexPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
            <Link href="/" className="underline">
              Home
            </Link>
            {' / '}
            <span>Find</span>
          </nav>
          <h1 className="text-3xl font-bold">Find it in 84 stores</h1>
          <p className="mt-2 text-muted-foreground">
            {SEARCH_TERMS.length} curated shopping searches. Pick one and
            we link you to each of {ALL_FIND_STORES.length} retailers&rsquo;
            own search results for it — Daraz, PriceOye, eBay, Walmart,
            Amazon, and more, grouped by country on each page.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            These pages are search links, not products or prices. SmartBuy
            shows no price, stock, deal, or review here, and claims no
            partnership with any store listed — each store shows its own
            results and prices when you click through.
          </p>

          {/* ItemList of the real /find/[query] URLs on this page. */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: toJsonLd(
                buildItemListJsonLd(
                  appConfig.url,
                  SEARCH_TERMS.map((term) => ({
                    name: term.query,
                    path: `/find/${term.slug}`,
                  }))
                )
              ),
            }}
          />

          {SEARCH_TERM_CATEGORIES.map((category) => {
            const terms = getSearchTermsByCategory(category);
            if (terms.length === 0) return null;
            return (
              <section key={category} className="mt-10">
                <h2 className="text-lg font-semibold">
                  {category}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({terms.length})
                  </span>
                </h2>
                <ul className="mt-3 space-y-2">
                  {terms.map((term) => (
                    <li key={term.slug}>
                      <Link
                        href={`/find/${term.slug}`}
                        className="flex min-h-[44px] items-center justify-between rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:border-blue-300 hover:text-primary"
                      >
                        {term.query}
                        <span aria-hidden="true">→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
