/**
 * Price History Explorer — /tools/price-history (Section 13).
 *
 * All 10 products' 30-day histories side by side: biggest % drop,
 * now vs 30-day low / high / average, sortable (?sort=…), shareable.
 *
 * Server component, no JavaScript needed: the sort is a plain GET
 * form. Data: getProducts + getPriceHistory, composed by
 * lib/price-history-explorer.ts (which wraps lib/price-trend.ts).
 *
 * Honesty: every row labels how many recorded points its stats
 * come from (currently 4 points over 30 days, Amazon only) — never
 * smoothed or interpolated, and a product with no history shows
 * "No recorded price history" instead of a zero-filled row.
 */

import { cookies } from 'next/headers';
import { isSupportedLanguage, type Language } from '@/lib/region';
import { tFor } from '@/lib/i18n';
import type { Metadata } from 'next';
import Link from 'next/link';
import { LineChart } from 'lucide-react';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ShareButtons } from '@/components/products/share-buttons';
import { appConfig } from '@/lib/config/app';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProducts } from '@/services/products';
import { getPriceHistory } from '@/services/price-history';
import {
  buildProductHistorySummary,
  EXPLORER_SORT_LABELS,
  EXPLORER_SORTS,
  explorerPointLabel,
  parseExplorerSort,
  sortHistorySummaries,
  type ExplorerSort,
} from '@/lib/price-history-explorer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Price History Explorer — SmartBuy AI',
  description:
    'Every product’s recorded 30-day price history side by side: biggest price drop, now vs low, high and average. Recorded prices only — never smoothed.',
  alternates: {
    canonical: `${appConfig.url}/tools/price-history`,
  },
  openGraph: {
    title: 'Price History Explorer — SmartBuy AI',
    description:
      'Every product’s recorded 30-day price history side by side: biggest price drop, now vs low, high and average. Recorded prices only — never smoothed.',
    url: `${appConfig.url}/tools/price-history`,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Price History Explorer — SmartBuy AI',
    description:
      'Every product’s recorded 30-day price history side by side: biggest price drop, now vs low, high and average. Recorded prices only — never smoothed.',
  },
};

interface PriceHistoryExplorerProps {
  searchParams: { sort?: string | string[] };
}

/**
 * Section 15 (C3): the server reads the same sb-language cookie the
 * root layout and homepage use for dir/lang — a first-visit language
 * switch via localStorage takes effect on the next load.
 */
function toolLanguage(): Language {
  const saved = cookies().get('sb-language')?.value ?? null;
  return saved && isSupportedLanguage(saved) ? saved : 'en';
}

export default async function PriceHistoryExplorerPage({
  searchParams,
}: PriceHistoryExplorerProps) {
  const language = toolLanguage();
  const sortBy: ExplorerSort = parseExplorerSort(searchParams);
  const supabase = await createSupabaseServerClient();
  const { products } = await getProducts(supabase, { page: 1, pageSize: 100 });

  const summaries = await Promise.all(
    products.map(async (product) => {
      const result = await getPriceHistory(supabase, product.id, { limit: 500 });
      return buildProductHistorySummary(
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
        }))
      );
    })
  );
  const sorted = sortHistorySummaries(summaries, sortBy);
  const withHistory = sorted.filter((s) => s.stats !== null);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <LineChart className="h-7 w-7 text-blue-600" /> {tFor(language, 'toolHeadingPriceHistory')}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Every product&apos;s recorded price history, side by side —
            biggest drop, current price vs the 30-day low, high and
            average. Prices are recorded points only: currently 4
            recorded points per product over 30 days (Amazon only).
            Nothing here is smoothed or interpolated — gaps stay gaps.
          </p>

          <form
            method="get"
            action="/tools/price-history"
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
              {EXPLORER_SORTS.map((s) => (
                <option key={s} value={s}>
                  {EXPLORER_SORT_LABELS[s]}
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
              title="Price History Explorer — SmartBuy AI"
              text="Biggest price drops and 30-day highs and lows — recorded prices only. — SmartBuy AI"
            />
          </div>

          {sorted.length === 0 && (
            <div className="mt-6">
              <EmptyState
                eyebrow="No products yet"
                title="No products to compare"
                description="The catalog is empty right now, so there is no recorded price history to show."
              />
            </div>
          )}

          {sorted.length > 0 && (
            <div className="mt-6 space-y-4">
              {sorted.map((summary) => (
                <article key={summary.productId} className="rounded-lg border p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold">
                        <Link
                          href={`/products/${summary.slug}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {summary.name}
                        </Link>
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {summary.brand ?? 'Unknown brand'}
                        {summary.category ? ` · ${summary.category}` : ''}
                        {` · ${explorerPointLabel(summary.pointCount)}`}
                      </p>
                    </div>
                    {summary.stats && (
                      <div className="text-right">
                        <p className="text-xl font-bold">
                          ${summary.stats.current.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">current price</p>
                      </div>
                    )}
                  </div>

                  {summary.stats === null && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      No recorded price history for this product yet.
                    </p>
                  )}

                  {summary.stats && (
                    <>
                      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                        <div className="rounded-md bg-muted p-3">
                          <dt className="text-muted-foreground">30-day low</dt>
                          <dd className="mt-1 font-semibold">
                            ${summary.stats.lowest.toFixed(2)}
                          </dd>
                        </div>
                        <div className="rounded-md bg-muted p-3">
                          <dt className="text-muted-foreground">30-day high</dt>
                          <dd className="mt-1 font-semibold">
                            ${summary.stats.highest.toFixed(2)}
                          </dd>
                        </div>
                        <div className="rounded-md bg-muted p-3">
                          <dt className="text-muted-foreground">30-day average</dt>
                          <dd className="mt-1 font-semibold">
                            ${summary.stats.average.toFixed(2)}
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {summary.stats.vsLowestAmount > 0
                          ? `Now $${summary.stats.vsLowestAmount.toFixed(2)} (${summary.stats.vsLowestPercent.toFixed(1)}%) above the lowest recorded price.`
                          : 'Now at the lowest recorded price.'}{' '}
                        {summary.stats.changePercent !== 0
                          ? `Change over the recorded range: ${summary.stats.changePercent > 0 ? '+' : ''}${summary.stats.changePercent.toFixed(1)}%.`
                          : 'No change over the recorded range.'}
                      </p>
                      {summary.biggestDrop ? (
                        <p className="mt-2 text-sm font-medium text-green-700">
                          Biggest recorded drop: {summary.biggestDrop.dropPercent.toFixed(1)}%
                          (${summary.biggestDrop.oldPrice.toFixed(2)} → $
                          {summary.biggestDrop.newPrice.toFixed(2)}) on{' '}
                          {new Date(summary.biggestDrop.date).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                          .
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          No price drop recorded in this range.
                        </p>
                      )}
                      <p className="mt-3 text-xs text-muted-foreground">
                        Recorded points:{' '}
                        {summary.points
                          .map(
                            (p) =>
                              `$${p.price.toFixed(2)} on ${new Date(p.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                          )
                          .join(' · ')}
                      </p>
                    </>
                  )}

                  <Link
                    href={`/products/${summary.slug}`}
                    className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    View product →
                  </Link>
                </article>
              ))}
              <p className="text-xs text-muted-foreground">
                {withHistory.length} of {sorted.length} products have
                recorded price history. Best Buy listings have no
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
