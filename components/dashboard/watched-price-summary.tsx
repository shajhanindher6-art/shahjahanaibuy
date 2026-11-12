/**
 * Watched-products price summary — Section 13, Chunk F, item 41.
 *
 * "Your watched prices": biggest drop / biggest rise / count below
 * target, each linking to its product page. Data comes from GET
 * /api/v1/tracking, which the dashboard already calls — the parent
 * passes the items through, so this adds no new fetch. Items with
 * no recorded price are excluded from the drop/rise ranking (a
 * missing price is not a 0% change), never shown as a guessed move.
 */

'use client';

import { useRegion } from '@/components/region/region-provider';
import { tFor } from '@/lib/i18n';
import Link from 'next/link';
import { TrendingDown, TrendingUp, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/** Minimal shape of one TrackedItem from GET /api/v1/tracking. */
export interface WatchedPriceItem {
  product: { name: string; slug: string };
  currentPrice: number | null;
  previousPrice: number | null;
  changePct: number | null;
  belowTarget: boolean;
  targetPrice: number | null;
}

export interface WatchedPriceSummary {
  biggestDrop: WatchedPriceItem | null;
  biggestRise: WatchedPriceItem | null;
  belowTargetCount: number;
  watchedCount: number;
  pricedCount: number;
}

/**
 * Pure summary: biggest drop = most negative changePct, biggest
 * rise = most positive changePct, among items with a recorded
 * change. Ties resolve to the first item in list order.
 */
export function summarizeWatchedPrices(items: WatchedPriceItem[]): WatchedPriceSummary {
  let biggestDrop: WatchedPriceItem | null = null;
  let biggestRise: WatchedPriceItem | null = null;
  let belowTargetCount = 0;
  let pricedCount = 0;
  for (const item of items) {
    if (item.belowTarget) belowTargetCount += 1;
    if (item.changePct === null) continue;
    pricedCount += 1;
    if (item.changePct < 0 && (biggestDrop === null || item.changePct < (biggestDrop.changePct ?? 0))) {
      biggestDrop = item;
    }
    if (item.changePct > 0 && (biggestRise === null || item.changePct > (biggestRise.changePct ?? 0))) {
      biggestRise = item;
    }
  }
  return { biggestDrop, biggestRise, belowTargetCount, watchedCount: items.length, pricedCount };
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function WatchedPriceSummary({ items, loading = false }: { items: WatchedPriceItem[]; loading?: boolean }) {
  const { language } = useRegion();
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{tFor(language, 'dashYourWatchedPrices')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="glass-card animate-shimmer h-24" />
        </CardContent>
      </Card>
    );
  }

  const summary = summarizeWatchedPrices(items);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingDown className="h-5 w-5" aria-hidden="true" />
          {tFor(language, 'dashYourWatchedPrices')}
        </CardTitle>
        <CardDescription>
          The biggest moves across the products you are watching.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {summary.watchedCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            You are not watching any products yet — save a product to a wishlist and its price moves will show here.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <TrendingDown className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
                Biggest drop
              </p>
              {summary.biggestDrop ? (
                <Link href={`/products/${summary.biggestDrop.product.slug}`} className="mt-1 block hover:underline">
                  <span className="text-sm font-semibold leading-tight">{summary.biggestDrop.product.name}</span>
                  <span className="mt-0.5 block text-sm text-green-600">
                    {formatPct(summary.biggestDrop.changePct ?? 0)}
                    {summary.biggestDrop.currentPrice !== null && ` · now ${formatUsd(summary.biggestDrop.currentPrice)}`}
                  </span>
                </Link>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{tFor(language, 'dashNoPriceDrops')}</p>
              )}
            </div>
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                Biggest rise
              </p>
              {summary.biggestRise ? (
                <Link href={`/products/${summary.biggestRise.product.slug}`} className="mt-1 block hover:underline">
                  <span className="text-sm font-semibold leading-tight">{summary.biggestRise.product.name}</span>
                  <span className="mt-0.5 block text-sm text-red-600">
                    {formatPct(summary.biggestRise.changePct ?? 0)}
                    {summary.biggestRise.currentPrice !== null && ` · now ${formatUsd(summary.biggestRise.currentPrice)}`}
                  </span>
                </Link>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">No price rises recorded yet</p>
              )}
            </div>
            <div className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Target className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                Below target
              </p>
              <Link href="/dashboard/tracking" className="mt-1 block hover:underline">
                <span className="text-2xl font-bold">{summary.belowTargetCount}</span>
                <span className="ml-1 text-sm text-muted-foreground">
                  of {summary.watchedCount} watched
                  {summary.pricedCount < summary.watchedCount &&
                    ` · ${summary.watchedCount - summary.pricedCount} unpriced`}
                </span>
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
