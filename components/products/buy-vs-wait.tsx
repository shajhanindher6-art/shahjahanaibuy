'use client';

import { useEffect, useState } from 'react';
import {
  TrendingDown,
  ShoppingBag,
  Clock,
  AlertTriangle,
  Bell,
  ArrowLeftRight,
} from 'lucide-react';
import {
  predictBuyVsWait,
  type BuyWaitPrediction,
  type BuyWaitRecommendation,
} from '@/services/buy-wait-prediction';
import { cn } from '@/lib/utils';

/**
 * Buy Now vs Wait block — renders the honest prediction engine over the
 * product's REAL recorded price_history points (same endpoint the price
 * history graph uses). It never shows an exact future price or date:
 * the output is a recommendation + a capped confidence % + a reason,
 * all derived from the points actually recorded.
 *
 * Section 19, Phase 3 (§12 #32/#33): also renders the engine's new
 * 'track_price' and 'compare_alternatives' verdicts, and accepts the
 * visitor's stated max budget (when the product page has one) so an
 * over-budget price is never recommended as a buy.
 */
export function BuyVsWait({
  slug,
  budgetUsd,
}: {
  slug: string;
  /** Visitor's stated max budget in USD, or null when none was stated. */
  budgetUsd?: number | null;
}) {
  const [prediction, setPrediction] = useState<BuyWaitPrediction | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v1/products/${slug}/prices?limit=100`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error('prices request failed');
        const data = await res.json();
        const history = (data?.data?.history ?? []) as Array<{
          price: number;
          recordedAt: string;
        }>;
        const points = history
          .map((h) => ({ price: Number(h.price), recordedAt: h.recordedAt }))
          .filter((h) => Number.isFinite(h.price) && h.recordedAt);
        if (!cancelled) setPrediction(predictBuyVsWait(points, { budgetUsd }));
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug, budgetUsd]);

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        Buy vs Wait estimate could not be loaded. Try again later.
      </p>
    );
  }
  if (!prediction) {
    return <p className="text-sm text-muted-foreground">Loading Buy vs Wait estimate…</p>;
  }

  if (prediction.recommendation === 'not_enough_data') {
    return (
      <div className="rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-6 w-6 flex-shrink-0 text-muted-foreground" />
          <div>
            <h4 className="font-bold">Not enough history yet</h4>
            <p className="mt-1 text-sm text-muted-foreground">{prediction.reason}</p>
          </div>
        </div>
      </div>
    );
  }

  const verdictConfig: Record<
    Exclude<BuyWaitRecommendation, 'not_enough_data'>,
    { label: string; icon: typeof ShoppingBag; styles: string; iconStyles: string }
  > = {
    buy_now: {
      label: 'Buy Now',
      icon: ShoppingBag,
      styles: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50',
      iconStyles: 'text-emerald-500',
    },
    wait: {
      label: 'Wait',
      icon: TrendingDown,
      styles: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50',
      iconStyles: 'text-amber-500',
    },
    track_price: {
      label: 'Track Price',
      icon: Bell,
      styles: 'border-sky-200 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/50',
      iconStyles: 'text-sky-500',
    },
    compare_alternatives: {
      label: 'Compare Alternatives',
      icon: ArrowLeftRight,
      styles: 'border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/50',
      iconStyles: 'text-violet-500',
    },
  };
  const cfg = verdictConfig[prediction.recommendation];
  const Icon = cfg.icon;
  return (
    <div className={cn('rounded-xl border p-4', cfg.styles)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 h-6 w-6 flex-shrink-0', cfg.iconStyles)} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-bold">{cfg.label}</h4>
            <span className="text-xs font-medium text-muted-foreground">
              {prediction.confidence}% confidence (estimate)
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{prediction.reason}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Based on {prediction.pointCount} recorded price point
            {prediction.pointCount === 1 ? '' : 's'}
            {prediction.spanDays > 0 ? ` over ${prediction.spanDays} days` : ''}.
            {prediction.lowConfidence &&
              ' Low confidence — history is thin, so treat this as a rough guide only.'}{' '}
            {prediction.seasonalSupported
              ? 'History is long enough for seasonal analysis.'
              : 'Not enough history for seasonal analysis.'}{' '}
            This is an estimate, not a guaranteed future price.
          </p>
          {prediction.dropCount > 0 && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3" />
              {prediction.dropCount} recorded price drop
              {prediction.dropCount === 1 ? '' : 's'}
              {prediction.daysSinceLastDrop !== null &&
                `, most recent ${prediction.daysSinceLastDrop} days ago`}
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
