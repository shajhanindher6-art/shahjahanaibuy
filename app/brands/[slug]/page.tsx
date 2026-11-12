/**
 * Brand listing page — /brands/[slug] (Section 9, chunk 2).
 *
 * Public server page built from the same catalog tables as the
 * /api/v1/brands routes: the `brands` reference row (when the slug
 * is one) plus the products whose `brand` text matches. Lists the
 * brand's products with links to their product pages.
 *
 * Honesty: a brand with no products shows an honest empty state,
 * never invented products; a slug matching no brand row and no
 * product 404s (app/not-found.tsx).
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { appConfig } from '@/lib/config/app';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { ProductCard } from '@/components/products/product-card';
import { ShareButtons } from '@/components/products/share-buttons';
import { StoreSearchLinks } from '@/components/taxonomy/store-search-links';
import type { Product } from '@/types';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getLatestPrices } from '@/services/price-history';
import { predictPriceDrop } from '@/services/ai-predictions';
import { dealScoreForDisplay } from '@/lib/deal-score';
import {
  buildTaxonomyJsonLd,
  buildTaxonomyMetadata,
} from '@/lib/brand-category-seo';
import { getBrandPageData } from '@/lib/brand-category-seo-server';

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const page = await getBrandPageData(params.slug);
  if (!page) {
    // Not-found metadata/content for unknown slugs. NOTE (soft-404
    // fix, 2026-11-12): this call alone does NOT set HTTP 404 — see
    // app/products/[slug]/page.tsx. The real 404 status comes from
    // the [slug]/layout.tsx existence check, which runs before the
    // loading Suspense boundary. This stays as the content fallback.
    notFound();
  }
  return buildTaxonomyMetadata(page, appConfig.url);
}

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const page = await getBrandPageData(params.slug);
  if (!page) {
    notFound();
  }

  // Section 13, Chunk A — real prices + Deal Scores on the cards
  // (ProductCard already accepts both props): the latest recorded
  // price per product from price_history (one query) and the cached
  // price-drop prediction per product (same source the product page
  // scores from). Products with no price history show no price;
  // products with no usable prediction — or fewer than 5 price
  // points (Section 15, B1: the badge hides below 5) — show no
  // badge — never a guessed price or score. ?sort=price-asc|price-desc|deal-score
  // reorders the grid; unpriced / unscored products sort last.
  const sortRaw = searchParams?.sort;
  const sortParam = Array.isArray(sortRaw) ? sortRaw[0] : sortRaw;
  const productIds = page.products
    .map((product) => (product as unknown as Product).id ?? product.slug)
    .filter(Boolean);
  let latestPrices = new Map<string, number>();
  let dealScores = new Map<string, number>();
  if (productIds.length > 0) {
    try {
      const supabase = await createSupabaseServerClient();
      latestPrices = await getLatestPrices(supabase, productIds);
      const predictions = await Promise.all(
        productIds.map((id) => predictPriceDrop(supabase, id))
      );
      predictions.forEach((prediction, i) => {
        const score = dealScoreForDisplay(prediction);
        if (score !== null) dealScores.set(productIds[i], score);
      });
    } catch {
      // Prices / scores stay empty — cards render without them.
    }
  }
  const sortedProducts = [...page.products].sort((a, b) => {
    const aId = (a as unknown as Product).id ?? a.slug;
    const bId = (b as unknown as Product).id ?? b.slug;
    if (sortParam === 'price-asc' || sortParam === 'price-desc') {
      const pa = latestPrices.get(aId) ?? null;
      const pb = latestPrices.get(bId) ?? null;
      if (pa === null && pb === null) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return sortParam === 'price-asc' ? pa - pb : pb - pa;
    }
    if (sortParam === 'deal-score') {
      return (dealScores.get(bId) ?? -1) - (dealScores.get(aId) ?? -1);
    }
    return 0;
  });

  // CSP Phase 2 nonce (set per request by middleware.ts), same source
  // the product page uses — the JSON-LD script tag needs it or the
  // strict script-src policy blocks it.
  const nonce = headers().get('x-nonce');

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <script
        type="application/ld+json"
        nonce={nonce ?? undefined}
        dangerouslySetInnerHTML={{
          __html: buildTaxonomyJsonLd(page, appConfig.url),
        }}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-6xl">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
            <Link href="/" className="underline">
              Home
            </Link>
            {' / '}
            <span>{page.name} products</span>
          </nav>
          <h1 className="text-3xl font-bold">{page.name} products</h1>
          {page.description ? (
            <p className="mt-2 max-w-2xl text-muted-foreground">{page.description}</p>
          ) : (
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Every {page.name} product in the SmartBuy AI catalog — compare
              prices across retailers and track price history.
            </p>
          )}

          {/* Section 13, item 55 — share this brand page. */}
          <div className="mt-4">
            <ShareButtons title={`${page.name} products on SmartBuy AI`} />
          </div>

          {page.products.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                eyebrow="No products yet"
                title={`No ${page.name} products in the catalog yet`}
                description={`We have ${page.name} listed as a brand, but no products from ${page.name} have been added to the catalog yet. Check back later, or browse the full catalog.`}
                action={
                  <Link
                    href="/search"
                    className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Browse the catalog
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              <p className="mt-4 text-sm text-muted-foreground">
                {page.products.length}{' '}
                {page.products.length === 1 ? 'product' : 'products'} in the
                catalog
              </p>
              {/* Section 13: sort the grid by price or Deal Score.
                  Links, not client state — the page is a server
                  component and the sort is shareable via ?sort=. */}
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Sort:</span>
                <Link
                  href={`/brands/${page.slug}`}
                  className={sortParam === undefined ? 'font-semibold text-primary' : 'underline'}
                >
                  Default
                </Link>
                <Link
                  href={`/brands/${page.slug}?sort=price-asc`}
                  className={sortParam === 'price-asc' ? 'font-semibold text-primary' : 'underline'}
                >
                  Price: low to high
                </Link>
                <Link
                  href={`/brands/${page.slug}?sort=price-desc`}
                  className={sortParam === 'price-desc' ? 'font-semibold text-primary' : 'underline'}
                >
                  Price: high to low
                </Link>
                <Link
                  href={`/brands/${page.slug}?sort=deal-score`}
                  className={sortParam === 'deal-score' ? 'font-semibold text-primary' : 'underline'}
                >
                  Deal Score
                </Link>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sortedProducts.map((product) => {
                  // Section 10 (2026-11-11): the same product used to
                  // render three different ways (ProductCard on
                  // search/wishlist pages, a bespoke imageless card
                  // here). These pages now render the shared
                  // ProductCard. The page data is typed as the minimal
                  // TaxonomyProduct, but resolveTaxonomyPage passes
                  // the full Product rows through untouched, so id /
                  // imageUrl are present at runtime; the fallbacks
                  // (slug / null) only cover a future shape change.
                  // Section 13: price + Deal Score come from real
                  // data (see above) — a product with no recorded
                  // price or no usable prediction simply shows
                  // neither, never a guessed value.
                  const full = product as unknown as Product;
                  const productId = full.id ?? product.slug;
                  return (
                    <ProductCard
                      key={product.slug}
                      product={{
                        id: productId,
                        name: product.name,
                        slug: product.slug,
                        brand: product.brand,
                        category: product.category,
                        imageUrl: full.imageUrl ?? null,
                        description: product.description,
                        price: latestPrices.get(productId) ?? null,
                        dealScore: dealScores.get(productId) ?? null,
                      }}
                    />
                  );
                })}
              </div>
            </>
          )}

          {/* Section 15 A1 — every store's own search for this
              brand (84 links). Renders for brands with products and
              for brands with none: the links are store searches, not
              catalog products, so an empty catalog changes nothing. */}
          <StoreSearchLinks query={page.name} label={page.name} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
