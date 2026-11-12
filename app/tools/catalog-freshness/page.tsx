/**
 * Catalog Freshness / Data-Health Dashboard — /tools/catalog-freshness
 * (Section 16, E2).
 *
 * Public per-product transparency table: last recorded price date,
 * price age in days, history point count, and missing image/GTIN
 * flags. Server component, no JavaScript needed. Data: getProducts
 * (dataFreshness, imageUrl, gtin) + getPriceHistory, shaped by
 * lib/catalog-freshness.ts through lib/price-freshness.ts.
 *
 * Honesty: prices are recorded points only — currently 4 points
 * per product, last recorded 2026-11-02, so every product is
 * honestly shown stale (> 7 days). An unknown age renders as
 * "unknown", never a guess, and a product with no history shows
 * "No recorded price history".
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { HeartPulse } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import {
  buildFreshnessRow,
  summarizeFreshness,
} from '@/lib/catalog-freshness';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Catalog Freshness Dashboard — SmartBuy AI',
  description:
    'How fresh is SmartBuy’s catalog data? A public per-product table: last recorded price date, price age in days, history points, and missing image or GTIN flags. Honest data health, no invented freshness.',
  alternates: {
    canonical: `${appConfig.url}/tools/catalog-freshness`,
  },
  openGraph: {
    title: 'Catalog Freshness Dashboard — SmartBuy AI',
    description:
      'How fresh is SmartBuy’s catalog data? A public per-product table: last recorded price date, price age in days, history points, and missing image or GTIN flags.',
    url: `${appConfig.url}/tools/catalog-freshness`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Catalog Freshness Dashboard — SmartBuy AI',
    description:
      'How fresh is SmartBuy’s catalog data? Per-product last recorded price, age in days, and missing-data flags.',
  },
};

export default async function CatalogFreshnessPage() {
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

  const rows = await Promise.all(
    products.map(async (product) => {
      const result = await getPriceHistory(supabase, product.id, { limit: 500 });
      return buildFreshnessRow(
        {
          id: product.id,
          name: product.name,
          slug: product.slug,
          brand: product.brand,
          category: product.category,
          imageUrl: product.imageUrl,
          gtin: product.gtin,
          dataFreshness: product.dataFreshness,
        },
        (result.history ?? []).map((h) => ({ recordedAt: h.recordedAt }))
      );
    })
  );
  const summary = summarizeFreshness(rows);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Catalog Freshness Dashboard"
        description="How fresh is SmartBuy’s catalog data? A public per-product table: last recorded price date, price age in days, history points, and missing image or GTIN flags. Honest data health, no invented freshness."
        path="/tools/catalog-freshness"
        crumbs={[ { name: "Home", path: "/" }, { name: "AI tools", path: "/tools" }, { name: "Catalog Freshness Dashboard" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <HeartPulse className="h-7 w-7 text-blue-600" /> Catalog Freshness Dashboard
          </h1>
          <p className="mt-2 text-muted-foreground">
            How fresh is the data behind SmartBuy? This table shows, for
            every product, when its price was last recorded, how old
            that price is, how many history points back it, and whether
            its image or GTIN is missing. Prices older than 7 days are
            marked stale — no freshness is claimed that the records do
            not support.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Share this view:
            </span>
            <ShareButtons
              title="Catalog Freshness Dashboard — SmartBuy AI"
              text="How fresh is SmartBuy’s catalog data? Per-product transparency. — SmartBuy AI"
            />
          </div>

          {rows.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No products to check"
                description="The catalog is empty right now, so there is no data health to show."
              />
            </div>
          )}

          {rows.length > 0 && (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border p-6">
                <h2 className="text-lg font-semibold">Catalog at a glance</h2>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Products</dt>
                    <dd className="mt-1 font-semibold">{summary.total}</dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Stale prices</dt>
                    <dd className="mt-1 font-semibold">{summary.staleCount}</dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Missing images</dt>
                    <dd className="mt-1 font-semibold">{summary.missingImageCount}</dd>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <dt className="text-muted-foreground">Missing GTINs</dt>
                    <dd className="mt-1 font-semibold">{summary.missingGtinCount}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-sm text-muted-foreground">
                  {summary.totalPoints} recorded price points across{' '}
                  {summary.productsWithHistory} of {summary.total} products
                  with history.
                  {summary.unknownAgeCount > 0 &&
                    ` ${summary.unknownAgeCount} product${summary.unknownAgeCount === 1 ? '' : 's'} ha${summary.unknownAgeCount === 1 ? 's' : 've'} no recorded price, so no age is shown for them.`}
                </p>
              </div>

              {rows.map((row) => (
                <article key={row.productId} className="rounded-lg border p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold">
                        <Link
                          href={`/products/${row.slug}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {row.name}
                        </Link>
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {row.brand ?? 'Unknown brand'}
                        {row.category ? ` · ${row.category}` : ''}
                      </p>
                    </div>
                    {row.stale ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                        Stale
                      </span>
                    ) : row.ageDays !== null ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900 dark:text-green-200">
                        Fresh
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                        Age unknown
                      </span>
                    )}
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">Last recorded</dt>
                      <dd className="mt-1 font-semibold">
                        {row.lastRecordedLabel ?? 'No recorded price history'}
                      </dd>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">Price age</dt>
                      <dd className="mt-1 font-semibold">
                        {row.ageDays === null
                          ? 'Unknown'
                          : `${row.ageDays} day${row.ageDays === 1 ? '' : 's'} old`}
                      </dd>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">History points</dt>
                      <dd className="mt-1 font-semibold">
                        {row.pointCount} recorded point{row.pointCount === 1 ? '' : 's'}
                      </dd>
                    </div>
                    <div className="rounded-md bg-muted p-3">
                      <dt className="text-muted-foreground">Missing data</dt>
                      <dd className="mt-1 font-semibold">
                        {row.missingImage || row.missingGtin
                          ? [
                              row.missingImage ? 'Image' : null,
                              row.missingGtin ? 'GTIN' : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : 'None'}
                      </dd>
                    </div>
                  </dl>

                  <Link
                    href={`/products/${row.slug}`}
                    className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    View product →
                  </Link>
                </article>
              ))}
              <p className="text-xs text-muted-foreground">
                Stale means the last recorded price is older than 7 days.
                Price refresh re-reads the catalog — until a real price
                fetch lands, ages only grow. See /status for the
                aggregate refresh state.
              </p>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
