/**
 * Store directory index — /stores (Section 15, A3).
 *
 * Lists all 84 stores (80 local + 4 worldwide) grouped by
 * country, each linking to its /stores/[country]/[slug] page.
 * Built from the static registries only (lib/stores.ts,
 * lib/region.ts) — no database read, so this page is static.
 *
 * Honesty: these are search links to each retailer's OWN
 * search results. SmartBuy shows no price, stock, deal, or
 * partnership for any store listed here.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { appConfig } from '@/lib/config/app';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import {
  STORE_PAGE_COUNT,
  groupStoresByCountry,
} from '@/lib/store-directory';
import { buildBreadcrumbJsonLd, toJsonLd } from '@/lib/json-ld';

export const metadata: Metadata = {
  title: 'All stores — SmartBuy AI',
  description:
    'Every store in the SmartBuy AI directory — 80 local stores across 60 countries plus worldwide retailers. Each store page links to that store’s own search results for every product and category in the catalog.',
  alternates: {
    canonical: `${appConfig.url}/stores`,
  },
};

export default function StoresIndexPage() {
  const groups = groupStoresByCountry();
  const countryCount = groups.length - 1; // last group is Worldwide

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: toJsonLd(
            buildBreadcrumbJsonLd(appConfig.url, [
              { name: 'Home', path: '/' },
              { name: 'Stores' },
            ])
          ),
        }}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-6xl">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
            <Link href="/" className="underline">
              Home
            </Link>
            {' / '}
            <span>Stores</span>
          </nav>
          <h1 className="text-3xl font-bold">All stores</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {STORE_PAGE_COUNT} stores in {countryCount} countries, plus
            worldwide retailers. Each store page links to that store&apos;s
            own search results for every product and category in the
            catalog.
          </p>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            These are search links only — SmartBuy shows no price, stock,
            deal, or discount for any store here, and listing a store
            does not mean we have a partnership with it. Countries
            without a confirmed local store are covered by the worldwide
            retailers below.
          </p>

          {groups.map((group) => (
            <section key={group.country} className="mt-10">
              <h2 className="text-xl font-semibold">
                {group.name}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  ({group.stores.length}{' '}
                  {group.stores.length === 1 ? 'store' : 'stores'})
                </span>
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.stores.map((store) => (
                  <Link
                    key={`${group.country}/${store.slug}`}
                    href={`/stores/${group.country}/${store.slug}`}
                    className="block rounded-lg border p-4 hover:border-primary"
                  >
                    <span className="block text-base font-medium">
                      {store.name}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {group.name} · {store.websiteUrl.replace(/^https?:\/\//, '')}
                    </span>
                    <span className="mt-2 block text-sm text-primary underline">
                      Search this store →
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
