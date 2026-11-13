/**
 * Price Volatility Ranking — /tools/volatility-ranking (Section 16, E1).
 *
 * Ranks all products by price stability from the RECORDED
 * price_history rows (currently 4 points per product over 30 days,
 * Amazon only): standard deviation / mean, plus the high–low range
 * %, with a stability label and "from N recorded points" on every
 * row. Server component, no JavaScript needed: the sort is a plain
 * GET form. Data: getProducts + getPriceHistory, ranked by
 * lib/volatility-ranking.ts.
 *
 * Honesty: this measures dispersion only — it is NOT the Price
 * History Explorer (which shows levels: low/high/average/biggest
 * drop). A product with fewer than 5 recorded points, or a stale
 * latest point, gets no volatility stats and an honest gated row
 * with the reason, never a zero-filled ranking. Nothing is smoothed or interpolated.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import {
  buildVolatilityRow,
  sortVolatilityRows,
  parseVolatilitySort,
  volatilityPointLabel,
  VOLATILITY_SORTS,
  VOLATILITY_SORT_LABELS,
  type VolatilitySort,
} from '@/lib/volatility-ranking';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Price Volatility Ranking — SmartBuy AI',
  description:
    'Which products hold a steady price and which jump around? Ranked by price stability from recorded price history only — standard deviation, range %, and a stability label per product.',
  alternates: {
    canonical: `${appConfig.url}/tools/volatility-ranking`,
  },
  openGraph: {
    title: 'Price Volatility Ranking — SmartBuy AI',
    description:
      'Which products hold a steady price and which jump around? Ranked by price stability from recorded price history only — standard deviation, range %, and a stability label per product.',
    url: `${appConfig.url}/tools/volatility-ranking`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Price Volatility Ranking — SmartBuy AI',
    description:
      'Which products hold a steady price and which jump around? Ranked by price stability from recorded price history only.',
  },
};

interface VolatilityRankingProps {
  searchParams: { sort?: string | string[] };
}

export default async function VolatilityRankingPage({
  searchParams,
}: VolatilityRankingProps) {
  const sortBy: VolatilitySort = parseVolatilitySort(searchParams);
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

  const rows = await Promise.all(
    products.map(async (product) => {
      const result = await getPriceHistory(supabase, product.id, { limit: 500 });
      return buildVolatilityRow(
        {
          id: product.id,
          name: product.name,
          slug: product.slug,
          brand: product.brand,
          category: product.category,
        },
        (result.history ?? []).map((h) => ({
          price: Number(h.price),
          recordedAt: h.recordedAt,
          source: h.source ?? null,
        }))
      );
    })
  );
  const sorted = sortVolatilityRows(rows, sortBy);
  const ranked = sorted.filter((r) => r.stats !== null);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 17: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Price Volatility Ranking"
        description="Which products hold a steady price and which jump around? Ranked by price stability from recorded price history only — standard deviation, range %, and a stability label per product."
        path="/tools/volatility-ranking"
        crumbs={[ { name: "Home", path: "/" }, { name: "AI tools", path: "/tools" }, { name: "Price Volatility Ranking" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Activity className="h-7 w-7 text-blue-600" /> Price Volatility Ranking
          </h1>
          <p className="mt-2 text-muted-foreground">
            Which products hold a steady price — and which jump around?
            Ranked by price stability from recorded price history only.
            A product is ranked only once it has at least 5 recorded
            points with a fresh latest point (within 7 days) — fewer
            or stale points are listed unranked with the reason, never
            ranked from thin history. Rank 1 is the most stable product.
            Nothing here is smoothed or interpolated — gaps stay gaps.
          </p>

          <form
            method="get"
            action="/tools/volatility-ranking"
            className="mt-8 rounded-lg border p-6"
          >
            <label htmlFor="sort" className="text-sm font-medium">
              Sort by
            </label>
            <select
              id="sort"
              name="sort"
              defaultValue={sortBy}
              className="mt-1 min-h-[44px] w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {VOLATILITY_SORTS.map((s) => (
                <option key={s} value={s}>
                  {VOLATILITY_SORT_LABELS[s]}
                </option>
              ))}
            </select>
            <Button type="submit" className="mt-4">
              Sort →
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Share this view:
            </span>
            <ShareButtons
              title="Price Volatility Ranking — SmartBuy AI"
              text="Which products hold a steady price? Ranked by recorded price stability. — SmartBuy AI"
            />
          </div>

          {sorted.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No products to rank"
                description="The catalog is empty right now, so there is no recorded price history to rank."
              />
            </div>
          )}

          {sorted.length > 0 && (
            <div className="mt-6 space-y-4">
              {sorted.map((row) => (
                <article key={row.productId} className="rounded-lg border p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold">
                        {row.rank !== null ? `#${row.rank} ` : ''}
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
                        {` · ${volatilityPointLabel(row.pointCount)}`}
                      </p>
                    </div>
                    {row.stats && (
                      <div className="text-right">
                        <p className="text-xl font-bold">{row.stats.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.stats.coefficientOfVariationPercent.toFixed(2)}% variation
                        </p>
                      </div>
                    )}
                  </div>

                  {row.stats === null && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {row.gateReason ??
                        'Not enough recorded price history to measure volatility — at least 5 recorded points with a fresh latest point are needed.'}
                    </p>
                  )}

                  {row.stats && (
                    <>
                      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                        <div className="rounded-md bg-muted p-3">
                          <dt className="text-muted-foreground">Std-dev / mean</dt>
                          <dd className="mt-1 font-semibold">
                            {row.stats.coefficientOfVariationPercent.toFixed(2)}%
                          </dd>
                        </div>
                        <div className="rounded-md bg-muted p-3">
                          <dt className="text-muted-foreground">High–low range</dt>
                          <dd className="mt-1 font-semibold">
                            {row.stats.rangePercent.toFixed(1)}%
                          </dd>
                        </div>
                        <div className="rounded-md bg-muted p-3">
                          <dt className="text-muted-foreground">Recorded mean</dt>
                          <dd className="mt-1 font-semibold">
                            ${row.stats.mean.toFixed(2)}
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-3 text-sm text-muted-foreground">
                        Recorded low ${row.stats.lowest.toFixed(2)} · high $
                        {row.stats.highest.toFixed(2)} · standard deviation $
                        {row.stats.stdDev.toFixed(2)} — {volatilityPointLabel(row.pointCount)}.
                      </p>
                    </>
                  )}

                  <Link
                    href={`/products/${row.slug}`}
                    className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    View product →
                  </Link>
                </article>
              ))}
              <p className="text-xs text-muted-foreground">
                {ranked.length} of {sorted.length} products have enough
                recorded history to rank. Best Buy listings have no
                recorded history rows yet, so Best Buy-only prices do
                not appear in these stats.
              </p>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
