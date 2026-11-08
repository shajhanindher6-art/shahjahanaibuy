'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { BadgeCheck, ShoppingBag, Hourglass } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MOVING_AVERAGE_WINDOW_DAYS } from '@/lib/price-trend';
import {
  getPredictionBadge,
  latestMovingAverage,
  type PredictionBadgeLabel,
} from '@/services/price-prediction-badge';

type BadgeLabel = Exclude<PredictionBadgeLabel, 'not_enough_data'>;

const BADGE_CONFIG: Record<
  BadgeLabel,
  {
    label: string;
    Icon: ComponentType<{ className?: string }>;
    cardClasses: string;
    pillClasses: string;
  }
> = {
  great_value: {
    label: 'GREAT VALUE',
    Icon: BadgeCheck,
    cardClasses:
      'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50',
    pillClasses:
      'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950',
  },
  buy_now: {
    label: 'BUY NOW',
    Icon: ShoppingBag,
    cardClasses:
      'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50',
    pillClasses: 'bg-blue-600 text-white dark:bg-blue-500 dark:text-blue-950',
  },
  wait: {
    label: 'WAIT',
    Icon: Hourglass,
    cardClasses:
      'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50',
    pillClasses: 'bg-amber-500 text-white dark:bg-amber-400 dark:text-amber-950',
  },
};

/**
 * Compact deterministic price-prediction badge — "GREAT VALUE" /
 * "BUY NOW" / "WAIT" from the 30-day moving average + current price
 * math over the product's REAL recorded price_history points (same
 * endpoint the price history graph uses).
 *
 * Renders NOTHING while loading, on fetch failure, or when there is
 * not enough history for a verdict — the detailed BuyVsWait section
 * already covers that state, and a badge must never show a fake
 * verdict. No exact future price or date is ever shown.
 */
export function PricePredictionBadge({ slug }: { slug: string }) {
  const [badge, setBadge] = useState<{
    label: PredictionBadgeLabel;
    reason: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/v1/products/${slug}/prices?limit=500`, {
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
          .filter((h) => Number.isFinite(h.price) && h.price > 0 && h.recordedAt)
          .sort(
            (a, b) =>
              new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
          );
        if (points.length === 0) return;
        const currentPrice = points[points.length - 1].price;
        const ma30 = latestMovingAverage(points);
        // 30-day lowest, windowed on the latest recorded point (same
        // anchor the trailing moving average uses), not on "now".
        const latestMs = new Date(
          points[points.length - 1].recordedAt
        ).getTime();
        const windowStartMs =
          latestMs - MOVING_AVERAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const inWindow = points.filter(
          (p) => new Date(p.recordedAt).getTime() >= windowStartMs
        );
        const lowest30 =
          inWindow.length > 0
            ? Math.min(...inWindow.map((p) => p.price))
            : null;
        if (!cancelled) {
          setBadge(
            getPredictionBadge({
              currentPrice,
              ma30,
              lowest30,
              pointCount: points.length,
            })
          );
        }
      } catch {
        // Fetch failure → badge stays null → renders nothing.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!badge || badge.label === 'not_enough_data') return null;

  const config = BADGE_CONFIG[badge.label as BadgeLabel];
  const Icon = config.Icon;
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-xl border p-3', config.cardClasses)}>
      <span
        className={cn(
          'inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold',
          config.pillClasses
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {config.label}
      </span>
      <p className="text-sm text-slate-600 dark:text-slate-400">{badge.reason}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        vs 30-day average — deterministic, from recorded prices only.
      </p>
    </div>
  );
}
