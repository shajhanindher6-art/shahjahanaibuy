/**
 * AI Already-Own-It Guard — /tools/own-it-check (T4).
 *
 * Before you buy, check whether you already saved this — or an
 * equivalent — product in your OWN saved lists.
 *
 * Server component, no JavaScript needed for the account check:
 * the form submits as a plain GET to this same page
 * (?product=… or ?name=…&brand=…&gtin=…), so the result URL is
 * shareable. The server reads the SIGNED-IN user's lists with the
 * same calls the dashboard uses — getBuyList (lib/buy-list.ts),
 * getWishlists + getWishlistItems (services/wishlists.ts),
 * listSavedSearches (services/saved-searches.ts) — scoped to the
 * user from supabase.auth.getUser(), the pattern app/creators/
 * page.tsx uses. The guest lists live in localStorage on the
 * device only, so no server can read them: the small client leaf
 * components/tools/own-it-guest-check.tsx reads them in the
 * browser and runs the same matching.
 *
 * HONESTY: no purchase history is recorded anywhere — this page
 * states plainly that it checks saved lists only. A non-match
 * reads "No duplicate found in your saved lists" — never "you
 * don't own this". Matching is lib/own-it-check.ts (slug, GTIN,
 * normalized name+brand — the pipeline dedup pattern).
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getBuyList } from '@/lib/buy-list';
import { getWishlists, getWishlistItems } from '@/services/wishlists';
import { listSavedSearches } from '@/services/saved-searches';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { OwnItGuestCheck } from '@/components/tools/own-it-guest-check';
import {
  findOwnItMatches,
  matchOwnItSavedSearches,
  parseOwnItCheckParams,
  type OwnItCandidate,
  type OwnItMatch,
  type OwnItQuery,
} from '@/lib/own-it-check';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Already-Own-It Guard — SmartBuy AI',
  description:
    'Before you buy, check whether you already saved this — or an equivalent — product in your buy list, wishlists, or saved searches. Saved lists only — no purchase history is recorded.',
  alternates: {
    canonical: `${appConfig.url}/tools/own-it-check`,
  },
  openGraph: {
    title: 'Already-Own-It Guard — SmartBuy AI',
    description:
      'Before you buy, check whether you already saved this — or an equivalent — product in your buy list, wishlists, or saved searches. Saved lists only — no purchase history is recorded.',
    url: `${appConfig.url}/tools/own-it-check`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Already-Own-It Guard — SmartBuy AI',
    description:
      'Before you buy, check whether you already saved this — or an equivalent — product in your buy list, wishlists, or saved searches. Saved lists only — no purchase history is recorded.',
  },
};

interface OwnItCheckProps {
  searchParams: {
    product?: string | string[];
    name?: string | string[];
    brand?: string | string[];
    gtin?: string | string[];
  };
}

function matchedByLabel(match: OwnItMatch): string {
  switch (match.matchedBy) {
    case 'slug':
      return 'Same product (slug match)';
    case 'gtin':
      return 'Same GTIN';
    case 'name-brand-exact':
      return 'Same name and brand';
    case 'name-exact':
      return 'Same name';
    case 'name-brand-fuzzy':
      return 'Similar name and brand — review it, this is not a confirmed duplicate';
  }
}

export default async function OwnItCheckPage({ searchParams }: OwnItCheckProps) {
  const params = parseOwnItCheckParams(searchParams);
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

  // Resolve the query: a catalog product when ?product= names one,
  // otherwise the free-typed name/brand/GTIN.
  const selectedProduct = params.productSlug
    ? (products.find((p) => p.slug === params.productSlug) ?? null)
    : null;
  const hasQuery = selectedProduct !== null || params.name !== null;
  const query: OwnItQuery | null = selectedProduct
    ? {
        slug: selectedProduct.slug,
        name: selectedProduct.name,
        brand: selectedProduct.brand,
        gtin: selectedProduct.gtin,
      }
    : params.name !== null
      ? { slug: null, name: params.name, brand: params.brand, gtin: params.gtin }
      : null;

  // Signed-in account lists (server-readable). Guests have no
  // account lists — their device lists are checked by the client
  // leaf below, which is the only place localStorage exists.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let buyListEnabled = true;
  let buyListCount = 0;
  let wishlistCount = 0;
  let wishlistItemCount = 0;
  let savedSearchCount = 0;
  let matches: OwnItMatch[] = [];
  let savedSearchMatches: ReturnType<typeof matchOwnItSavedSearches> = [];
  if (user && query && params.error === null) {
    const catalogById = new Map(products.map((p) => [p.id, p]));
    const catalogBySlug = new Map(products.map((p) => [p.slug, p]));
    const candidates: OwnItCandidate[] = [];

    const buyList = await getBuyList(supabase, user.id);
    buyListEnabled = buyList.enabled;
    buyListCount = buyList.items.length;
    for (const item of buyList.items) {
      const catalogProduct = item.productSlug
        ? catalogBySlug.get(item.productSlug)
        : undefined;
      candidates.push({
        id: item.id,
        source: 'buy-list',
        listLabel: 'Buy list',
        slug: item.productSlug,
        name: item.productName ?? catalogProduct?.name ?? 'Saved product',
        brand: catalogProduct?.brand ?? null,
        gtin: catalogProduct?.gtin ?? null,
      });
    }

    const wishlists = await getWishlists(supabase, user.id);
    wishlistCount = wishlists.length;
    for (const wishlist of wishlists) {
      const items = await getWishlistItems(supabase, wishlist.id, user.id);
      wishlistItemCount += items.length;
      for (const item of items) {
        const catalogProduct = catalogById.get(item.productId);
        if (!catalogProduct) continue;
        candidates.push({
          id: item.id,
          source: 'wishlist',
          listLabel: `Wishlist “${wishlist.name}”`,
          slug: catalogProduct.slug,
          name: catalogProduct.name,
          brand: catalogProduct.brand,
          gtin: catalogProduct.gtin,
        });
      }
    }

    const savedSearches = await listSavedSearches(supabase, user.id);
    savedSearchCount = savedSearches.length;
    savedSearchMatches = matchOwnItSavedSearches(query, savedSearches);
    matches = findOwnItMatches(query, candidates);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: WebPage + BreadcrumbList
          (Home → AI tools → this tool). */}
      <PageJsonLd
        name="Already-Own-It Guard"
        description="Before you buy, check whether you already saved this — or an equivalent — product in your buy list, wishlists, or saved searches. Saved lists only — no purchase history is recorded."
        path="/tools/own-it-check"
        crumbs={[
          { name: 'Home', path: '/' },
          { name: 'AI tools', path: '/tools' },
          { name: 'Already-Own-It Guard' },
        ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <ShieldCheck className="h-7 w-7 text-blue-600" /> Already-Own-It Guard
          </h1>
          <p className="mt-2 text-muted-foreground">
            Before you buy, check whether you already saved this — or
            an equivalent — product in your buy list or wishlists.
          </p>
          <p className="mt-2 text-sm font-medium">
            No purchase history is recorded — this checks your saved
            lists only. It cannot tell you whether you already own
            the product, only whether you already saved it.
          </p>

          <form
            method="get"
            action="/tools/own-it-check"
            className="mt-8 rounded-lg border p-6"
          >
            <div>
              <label htmlFor="product" className="text-sm font-medium">
                Pick a product from the catalog
              </label>
              <select
                id="product"
                name="product"
                defaultValue={params.productSlug ?? ''}
                className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose a product…</option>
                {products.map((product) => (
                  <option key={product.id} value={product.slug}>
                    {product.name}
                    {product.brand ? ` (${product.brand})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Or describe a product not in the catalog:
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className="text-sm font-medium">
                  Product name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="e.g. MacBook Air 13"
                  defaultValue={params.name ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="brand" className="text-sm font-medium">
                  Brand (optional)
                </label>
                <input
                  id="brand"
                  name="brand"
                  type="text"
                  placeholder="e.g. Apple"
                  defaultValue={params.brand ?? ''}
                  className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="gtin" className="text-sm font-medium">
                GTIN / barcode (optional)
              </label>
              <input
                id="gtin"
                name="gtin"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 0194253161783"
                defaultValue={params.gtin ?? ''}
                className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            {params.error && (
              <p className="mt-3 text-sm font-medium text-red-600" role="alert">
                {params.error}
              </p>
            )}
            <Button type="submit" className="mt-4">
              Check my saved lists →
            </Button>
          </form>

          {products.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No catalog to pick from"
                description="The catalog is empty right now, so there is no product list to check against — you can still describe a product above and check it against your saved lists."
              />
            </div>
          )}

          {query !== null && params.error === null && (
            <section className="mt-6 rounded-lg border p-6" aria-live="polite">
              <h2 className="text-lg font-semibold">
                Checking: {query.name}
                {query.brand ? ` (${query.brand})` : ''}
              </h2>

              {!user && (
                <p className="mt-3 text-sm text-muted-foreground">
                  You are not signed in, so your account buy list and
                  wishlists cannot be checked here.{' '}
                  <Link href="/login" className="underline underline-offset-4">
                    Sign in
                  </Link>{' '}
                  to check them — your lists saved on this device are
                  checked below.
                </p>
              )}

              {user && (
                <>
                  {!buyListEnabled && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      The account buy list is not available yet, so it
                      was not checked.
                    </p>
                  )}
                  <p className="mt-3 text-sm text-muted-foreground">
                    Checked your account lists: buy list ({buyListCount}{' '}
                    {buyListCount === 1 ? 'item' : 'items'})
                    {buyListEnabled ? '' : ' — unavailable'}, {wishlistCount}{' '}
                    {wishlistCount === 1 ? 'wishlist' : 'wishlists'} (
                    {wishlistItemCount} {wishlistItemCount === 1 ? 'item' : 'items'}
                    ), {savedSearchCount} saved{' '}
                    {savedSearchCount === 1 ? 'search' : 'searches'}.
                  </p>
                  {matches.length === 0 ? (
                    <p className="mt-3 text-sm font-medium">
                      No duplicate found in your saved lists.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {matches.map((match) => (
                        <li
                          key={`${match.candidate.source}-${match.candidate.id}`}
                          className="rounded-md bg-muted p-3 text-sm"
                        >
                          <p className="font-medium">{match.candidate.name}</p>
                          <p className="mt-1 text-muted-foreground">
                            {match.candidate.listLabel} · {matchedByLabel(match)}
                            {!match.exact &&
                              ' (similar — check it yourself before deciding)'}
                          </p>
                          {match.candidate.slug && (
                            <Link
                              href={`/products/${match.candidate.slug}`}
                              className="mt-1 inline-block underline underline-offset-4"
                            >
                              View product →
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {savedSearchMatches.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-sm font-semibold">
                        You searched for this before
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        A saved search is not a saved product — it only
                        means you looked for this before.
                      </p>
                      <ul className="mt-2 space-y-2 text-sm">
                        {savedSearchMatches.map(({ search, matchedQuery }) => (
                          <li key={search.id}>
                            <Link
                              href={`/search?${search.query}`}
                              className="underline underline-offset-4"
                            >
                              {search.name}
                            </Link>{' '}
                            <span className="text-muted-foreground">
                              (matched “{matchedQuery}”)
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    A non-match here does not mean you don&apos;t own
                    this product — it only means it is not in your
                    saved lists.
                  </p>
                </>
              )}
            </section>
          )}

          {query !== null && params.error === null && (
            <OwnItGuestCheck query={query} />
          )}

          {!hasQuery && (
            <p className="mt-8 text-sm text-muted-foreground">
              Tip: try{' '}
              <Link
                href="/tools/own-it-check?product=macbook-air-13"
                className="underline underline-offset-4"
              >
                MacBook Air 13
              </Link>{' '}
              or{' '}
              <Link
                href="/tools/own-it-check?product=sony-wh-1000xm5"
                className="underline underline-offset-4"
              >
                Sony WH-1000XM5
              </Link>
              .
            </p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
