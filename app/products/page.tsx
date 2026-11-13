/**
 * Product index — /products (Section 14, chunk 5).
 *
 * Lists every real product in the catalog (getProducts already
 * excludes the 'sample-laptop' health-check row) with search,
 * brand/category filters, sorting, and pagination.
 *
 * Sorting: newest (default), price low→high / high→low (lowest
 * in-stock merchant price; unpriced products sort last), name A–Z /
 * Z–A. There is deliberately no Deal Score sort: the score is
 * 100/100 for every product today, so it would sort nothing.
 *
 * Prices on the cards are the lowest in-stock merchant prices
 * (one batched merchant_products query); a product with no in-stock
 * listing shows no price, never a guessed one. The "at N stores"
 * count counts only merchants with the product in stock.
 *
 * force-dynamic: the list is read at request time. A static
 * prerender at build time would run against placeholder env and
 * bake in an empty list.
 *
 * Honesty: an empty catalog shows an honest empty state; filters
 * with no matches show an honest empty state with a clear-filters
 * link instead of invented products.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { appConfig } from '@/lib/config/app';
import { tFor } from '@/lib/i18n';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { ProductCard } from '@/components/products/product-card';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getProducts,
  getBrands,
  getCategories,
  getLowestMerchantPrices,
  type LowestMerchantPrice,
} from '@/services/products';
import { buildItemListJsonLd, toJsonLd } from '@/lib/json-ld';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'All products — SmartBuy AI',
  description:
    'Every product in the SmartBuy AI catalog — compare the lowest in-stock price across retailers, filter by brand or category, and track price history.',
  alternates: {
    canonical: `${appConfig.url}/products`,
  },
};

const PAGE_SIZE = 24;

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'name-asc', label: 'Name: A to Z' },
  { value: 'name-desc', label: 'Name: Z to A' },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]['value'];

function parseSort(raw: string | string[] | undefined): SortValue {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (SORT_OPTIONS as readonly { value: string }[]).some((o) => o.value === value)
    ? (value as SortValue)
    : 'newest';
}

function first(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Rebuild the query string keeping the current filters, with overrides. */
function withParams(
  current: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...overrides })) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const query = params.toString();
  return query ? `/products?${query}` : '/products';
}

/**
 * Section 16, #42: server-page language from the same sb-language
 * cookie the root layout uses for dir/lang (see app/page.tsx
 * homepageLanguage). No new dict keys — existing keys only.
 */
function pageLanguage(): Language {
  const saved = cookies().get('sb-language')?.value ?? null;
  return saved && isSupportedLanguage(saved) ? saved : 'en';
}

export default async function ProductsIndexPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const language = pageLanguage();
  const q = first(searchParams?.q);
  const brand = first(searchParams?.brand);
  const category = first(searchParams?.category);
  const sort = parseSort(searchParams?.sort);
  const page = Math.max(1, Number(first(searchParams?.page) ?? 1) || 1);

  const sortOptions =
    sort === 'price-asc'
      ? { sort: 'price' as const, order: 'asc' as const }
      : sort === 'price-desc'
        ? { sort: 'price' as const, order: 'desc' as const }
        : sort === 'name-asc'
          ? { sort: 'name' as const, order: 'asc' as const }
          : sort === 'name-desc'
            ? { sort: 'name' as const, order: 'desc' as const }
            : { sort: 'newest' as const, order: 'desc' as const };

  const supabase = await createSupabaseServerClient();
  const [{ products, total, totalPages }, brands, categories] = await Promise.all([
    getProducts(supabase, {
      page,
      pageSize: PAGE_SIZE,
      search: q,
      brand,
      category,
      ...sortOptions,
    }),
    getBrands(supabase),
    getCategories(supabase),
  ]);

  let lowest = new Map<string, LowestMerchantPrice>();
  if (products.length > 0) {
    try {
      lowest = await getLowestMerchantPrices(
        supabase,
        products.map((p) => p.id)
      );
    } catch {
      // Cards render without prices — never a guessed price.
      lowest = new Map();
    }
  }

  const currentParams: Record<string, string | undefined> = {
    q,
    brand,
    category,
    sort: sort === 'newest' ? undefined : sort,
  };
  const hasFilters = Boolean(q || brand || category);
  const nonce = headers().get('x-nonce');

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* ItemList of the real product URLs on this page (same
          pattern as /brands and /categories). */}
      {products.length > 0 && (
        <script
          type="application/ld+json"
          nonce={nonce ?? undefined}
          dangerouslySetInnerHTML={{
            __html: toJsonLd(
              buildItemListJsonLd(
                appConfig.url,
                products.map((product) => ({
                  name: product.name,
                  path: `/products/${product.slug}`,
                }))
              )
            ),
          }}
        />
      )}
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-6xl">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
            <Link href="/" className="underline">
              Home
            </Link>
            {' / '}
            <span>All products</span>
          </nav>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">All products</h1>
              <p className="mt-2 max-w-2xl text-muted-foreground">
                Every product in the catalog. Prices shown are the lowest
                in-stock price across retailers; a product with no in-stock
                listing shows no price.
              </p>
            </div>
            <Link href="/compare" className="text-sm font-medium text-blue-600 underline">
              Compare products →
            </Link>
          </div>

          <form
            method="get"
            action="/products"
            className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border p-4"
          >
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{tFor(language, 'navSearch')}</span>
              <input
                type="search"
                name="q"
                defaultValue={q ?? ''}
                placeholder="Search products…"
                className="min-h-[44px] w-56 rounded-md border px-3"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Brand</span>
              <select
                name="brand"
                defaultValue={brand ?? ''}
                className="min-h-[44px] rounded-md border bg-background px-3"
              >
                <option value="">All brands</option>
                {brands.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Category</span>
              <select
                name="category"
                defaultValue={category ?? ''}
                className="min-h-[44px] rounded-md border bg-background px-3"
              >
                <option value="">All categories</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Sort by</span>
              <select
                name="sort"
                defaultValue={sort}
                className="min-h-[44px] rounded-md border bg-background px-3"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Apply filters
            </button>
            {hasFilters && (
              <Link href="/products" className="inline-flex min-h-[44px] items-center text-sm underline">
                Clear filters
              </Link>
            )}
          </form>

          {products.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                eyebrow={hasFilters ? 'No matching products' : 'No products yet'}
                title={
                  hasFilters
                    ? 'No products match these filters'
                    : 'No products in the catalog yet'
                }
                description={
                  hasFilters
                    ? 'Try a different search term, brand, or category — or clear the filters to see the full catalog.'
                    : 'No products have been added to the catalog yet. Check back later.'
                }
                action={
                  hasFilters ? (
                    <Link
                      href="/products"
                      className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    >
                      Clear filters
                    </Link>
                  ) : (
                    <Link
                      href="/"
                      className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    >
                      Back to home
                    </Link>
                  )
                }
              />
            </div>
          ) : (
            <>
              <p className="mt-6 text-sm text-muted-foreground">
                {total} {total === 1 ? 'product' : 'products'}
                {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ''}
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={{
                      id: product.id,
                      name: product.name,
                      slug: product.slug,
                      brand: product.brand,
                      category: product.category,
                      imageUrl: product.imageUrl,
                      description: product.description,
                      price: lowest.get(product.id)?.price ?? null,
                      merchantCount: lowest.get(product.id)?.merchantCount ?? 0,
                      // Section 17, Stage C item 14: verification of
                      // the cheapest listing rides with the card so
                      // the short honest label can render under the
                      // price (unverified until migration 045 lands
                      // and a real fetch checks it).
                      priceVerificationStatus:
                        lowest.get(product.id)?.priceVerificationStatus ?? 'unverified',
                      // Final 100% (F-P1-04): the brief's 5-state
                      // price label + reason ride with the card, as
                      // on the detail page (getProducts derives it
                      // from the cheapest listing).
                      priceState: product.priceState,
                      // Section 16, item 9: recorded freshness rides
                      // with the card so the stale-price badge + age
                      // can render under the price.
                      dataFreshness: product.dataFreshness ?? null,
                    }}
                  />
                ))}
              </div>
              {totalPages > 1 && (
                <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-4">
                  {page > 1 ? (
                    <Link
                      href={withParams(currentParams, { page: String(page - 1) })}
                      className="inline-flex min-h-[44px] items-center rounded-md border px-4 py-2 text-sm font-medium"
                    >
                      ← Previous
                    </Link>
                  ) : (
                    <span className="inline-flex min-h-[44px] cursor-not-allowed items-center rounded-md border px-4 py-2 text-sm font-medium opacity-50">
                      ← Previous
                    </span>
                  )}
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  {page < totalPages ? (
                    <Link
                      href={withParams(currentParams, { page: String(page + 1) })}
                      className="inline-flex min-h-[44px] items-center rounded-md border px-4 py-2 text-sm font-medium"
                    >
                      Next →
                    </Link>
                  ) : (
                    <span className="inline-flex min-h-[44px] cursor-not-allowed items-center rounded-md border px-4 py-2 text-sm font-medium opacity-50">
                      Next →
                    </span>
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
