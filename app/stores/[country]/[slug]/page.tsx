/**
 * Store page — /stores/[country]/[slug] (Section 15, A3).
 *
 * One page per store (84 total: 80 local + 4 worldwide). Each
 * page links the catalog's products and categories to the
 * store's OWN search results via the existing
 * buildStoreSearchUrl() builder — never an invented URL, never
 * a claimed price, stock, or deal.
 *
 * The country code is part of the URL because store slugs repeat
 * across countries (eBay ~13 domains, Mercado Libre ~14,
 * Shopee ~7). An unknown country or a slug that exists only in
 * another country 404s (app/not-found.tsx).
 *
 * force-dynamic: products and categories are read from the live
 * catalog at request time. A static prerender at build time
 * would run against placeholder env and bake in an empty list
 * (same reason as /products and /categories). generateStaticParams
 * still enumerates the 84 pages (verified by Next 13.5's build:
 * force-dynamic sets revalidate 0, so the params render on
 * demand instead of being prerendered).
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { appConfig } from '@/lib/config/app';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts, getCategories } from '@/services/products';
import { buildBreadcrumbJsonLd, toJsonLd } from '@/lib/json-ld';
import {
  GLOBAL_COUNTRY_SEGMENT,
  buildStoreDirectoryLinks,
  findStorePage,
  getStoreCountryName,
  getStorePageParams,
} from '@/lib/store-directory';

export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return getStorePageParams();
}

export async function generateMetadata({
  params,
}: {
  params: { country: string; slug: string };
}): Promise<Metadata> {
  const entry = findStorePage(params.country, params.slug);
  if (!entry) {
    return { title: 'Store not found — SmartBuy AI' };
  }
  const countryName = getStoreCountryName(entry.country) ?? entry.country;
  const title = `${entry.store.name} (${countryName}) — SmartBuy AI`;
  return {
    title,
    description: `Search ${entry.store.name} ${countryName} for every product and category in the SmartBuy AI catalog — links to the store's own search results.`,
    alternates: {
      canonical: `${appConfig.url}${entry.path}`,
    },
  };
}

export default async function StorePage({
  params,
}: {
  params: { country: string; slug: string };
}) {
  const entry = findStorePage(params.country, params.slug);
  if (!entry) {
    notFound();
  }
  const { store } = entry;
  const countryName = getStoreCountryName(entry.country) ?? entry.country;
  const isGlobal = entry.country === GLOBAL_COUNTRY_SEGMENT;

  // Live catalog: product names + category names only — the
  // links are built from them, nothing else is read. A failed
  // query renders the honest empty state below, never invented
  // products or categories.
  let products: Array<{ name: string; slug: string }> = [];
  let categories: string[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    const [{ products: fetched }, fetchedCategories] = await Promise.all([
      getProducts(supabase, { page: 1, pageSize: 100, sort: 'name', order: 'asc' }),
      getCategories(supabase),
    ]);
    products = fetched.map((product) => ({
      name: product.name,
      slug: product.slug,
    }));
    categories = fetchedCategories;
  } catch {
    // Products / categories stay empty — honest empty state below.
  }

  const { productLinks, categoryLinks } = buildStoreDirectoryLinks(
    store,
    products,
    categories
  );

  // CSP Phase 2 nonce (set per request by middleware.ts), same
  // source the brand/category pages use — the JSON-LD script tag
  // needs it or the strict script-src policy blocks it.
  const nonce = headers().get('x-nonce');

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{
          __html: toJsonLd(
            buildBreadcrumbJsonLd(appConfig.url, [
              { name: 'Home', path: '/' },
              { name: 'Stores', path: '/stores' },
              { name: `${store.name} (${countryName})` },
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
            <Link href="/stores" className="underline">
              Stores
            </Link>
            {' / '}
            <span>
              {store.name} ({countryName})
            </span>
          </nav>
          <h1 className="text-3xl font-bold">
            {store.name} — {countryName}
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Search {store.name} for every product and category in the
            SmartBuy AI catalog. Each link below opens {store.name}
            &apos;s own search results — the store itself shows its
            prices and stock.
          </p>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {isGlobal
              ? 'Worldwide retailer — shown for countries without a confirmed local store. '
              : ''}
            These are search links only: SmartBuy shows no price,
            stock, deal, or discount for this store, and listing it
            does not mean we have a partnership with it.
          </p>
          <p className="mt-4">
            <a
              href={store.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline"
            >
              Visit {store.name} homepage ↗
            </a>
          </p>

          {store.paymentMethods && store.paymentMethods.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">Payment methods</h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                {store.paymentMethods.map((method) => (
                  <li key={method.id}>
                    {method.label}
                    {method.detail ? ` — ${method.detail}` : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                Verified against the store&apos;s own published payment
                information; availability can vary by listing.
              </p>
            </section>
          ) : (
            <p className="mt-8 text-sm text-muted-foreground">
              Payment methods not verified for this store.
            </p>
          )}

          {productLinks.length === 0 && categoryLinks.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                eyebrow="No catalog links yet"
                title={`No products in the catalog to search on ${store.name} yet`}
                description={`The catalog is empty right now, so there are no product or category searches to link to for ${store.name}. Check back later, or browse the full catalog.`}
                action={
                  <Link
                    href="/products"
                    className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Browse the catalog
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              {productLinks.length > 0 && (
                <section className="mt-10">
                  <h2 className="text-xl font-semibold">
                    Search {store.name} for products
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {productLinks.length}{' '}
                    {productLinks.length === 1 ? 'product' : 'products'} in
                    the catalog — each link opens {store.name}&apos;s own
                    search results for that product.
                  </p>
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {productLinks.map((link) => (
                      <li key={link.label} className="rounded-lg border p-4">
                        <a
                          href={link.searchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block font-medium text-primary underline"
                        >
                          {link.label} on {store.name} ↗
                        </a>
                        {link.productPath && (
                          <Link
                            href={link.productPath}
                            className="mt-1 block text-sm text-muted-foreground underline"
                          >
                            Compare prices on SmartBuy
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {categoryLinks.length > 0 && (
                <section className="mt-10">
                  <h2 className="text-xl font-semibold">
                    Search {store.name} by category
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {categoryLinks.length}{' '}
                    {categoryLinks.length === 1 ? 'category' : 'categories'}{' '}
                    in the catalog — each link opens {store.name}&apos;s own
                    search results for that category.
                  </p>
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {categoryLinks.map((link) => (
                      <li key={link.label} className="rounded-lg border p-4">
                        <a
                          href={link.searchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block font-medium text-primary underline"
                        >
                          {link.label} on {store.name} ↗
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
