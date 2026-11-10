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
import {
  buildTaxonomyJsonLd,
  buildTaxonomyMetadata,
  slugify,
} from '@/lib/brand-category-seo';
import { getBrandPageData } from '@/lib/brand-category-seo-server';

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const page = await getBrandPageData(params.slug);
  if (!page) {
    return { title: 'Brand not found' };
  }
  return buildTaxonomyMetadata(page, appConfig.url);
}

export default async function BrandPage({
  params,
}: {
  params: { slug: string };
}) {
  const page = await getBrandPageData(params.slug);
  if (!page) {
    notFound();
  }

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
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {page.products.map((product) => (
                  <article
                    key={product.slug}
                    className="rounded-lg border p-5 transition-shadow hover:shadow-lg"
                  >
                    <h2 className="text-lg font-semibold leading-tight">
                      <Link
                        href={`/products/${product.slug}`}
                        className="hover:text-primary hover:underline"
                      >
                        {product.name}
                      </Link>
                    </h2>
                    {product.category && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <Link
                          href={`/categories/${slugify(product.category)}`}
                          className="hover:text-primary hover:underline"
                        >
                          {product.category}
                        </Link>
                      </p>
                    )}
                    {product.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {product.description}
                      </p>
                    )}
                    <Link
                      href={`/products/${product.slug}`}
                      className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
                    >
                      Compare prices →
                    </Link>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
