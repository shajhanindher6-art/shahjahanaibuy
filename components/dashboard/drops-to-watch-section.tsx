/**
 * Drops to Watch section — AI Glass dashboard.
 *
 * The user's tracked products whose real price history simulates a
 * future drop window (GET /api/v1/dashboard/drops-to-watch, Option
 * 10 drop-window simulator reused). Data is fetched once by the
 * dashboard page and passed in — the sidebar's mini summary reads
 * the same list, so there is exactly one request. Every value is a
 * simulation: windowDays and the target range are ranges, never a
 * single date or price, and the section labels them as simulated
 * on every render — never a forecast or a guarantee.
 *
 * An empty list is honest: it means nothing the user tracks
 * simulates a drop right now.
 */

'use client';

import Link from 'next/link';
import { TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Price } from '@/components/region/price';

export interface DropToWatch {
  productId: string;
  productName: string;
  productSlug: string;
  currentPrice: number | null;
  windowDays: [number, number] | null;
  simulatedTargetRangeUsd: [number, number] | null;
  confidence: number;
  reason: string;
}

export function DropsToWatchSection({
  drops,
  loading,
}: {
  drops: DropToWatch[];
  loading: boolean;
}) {
  return (
    <section
      id="drops-to-watch"
      className="animate-fade-in motion-reduce:animate-none"
      style={{ animationDelay: '280ms' }}
    >
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <TrendingDown className="h-5 w-5 text-emerald-600" /> Drops to watch
      </h2>
      <p className="-mt-2 mb-4 text-xs text-muted-foreground">
        Simulated from your tracked products&apos; real price history — not a forecast or a guarantee.
      </p>
      {loading ? (
        <div className="glass-card animate-shimmer h-32" />
      ) : drops.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <p className="text-sm font-medium">No drops simulated for your tracked items</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Track more products and check back — a simulated window appears when a real price drop pattern exists.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {drops.map((drop) => (
            <Link
              key={drop.productId}
              href={`/products/${drop.productSlug}`}
              className="glass-card flex flex-wrap items-center justify-between gap-3 p-3 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{drop.productName}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{drop.reason}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {drop.currentPrice !== null && (
                  <span className="text-sm font-bold text-blue-600">
                    <Price usd={drop.currentPrice} />
                  </span>
                )}
                {drop.windowDays && (
                  <Badge variant="secondary">
                    {drop.windowDays[0]}–{drop.windowDays[1]} days
                  </Badge>
                )}
                {drop.simulatedTargetRangeUsd && (
                  <Badge>
                    <Price usd={drop.simulatedTargetRangeUsd[0]} />–
                    <Price usd={drop.simulatedTargetRangeUsd[1]} />
                  </Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
