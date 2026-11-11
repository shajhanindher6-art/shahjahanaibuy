/**
 * Dashboard AI sidebar — AI Glass redesign.
 *
 * The dashboard's always-visible AI column: the embedded AI chat
 * panel plus the user's AI picks (top recommendations, already
 * fetched by the dashboard page — no extra request). On mobile the
 * sidebar stacks below the main content; on large screens it is
 * sticky beside it.
 */

'use client';

import Link from 'next/link';
import { Brain, ArrowRight, Sparkles, TrendingDown } from 'lucide-react';
import { CardContent } from '@/components/ui/card';
import { AIChatPanel } from '@/components/dashboard/ai-chat-panel';
import type { DropToWatch } from '@/components/dashboard/drops-to-watch-section';

interface AIPick {
  productId: string;
  product: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category: string | null;
    imageUrl: string | null;
  };
  score: number;
  reason: string;
}

export function AISidebar({ picks, drops }: { picks: AIPick[]; drops: DropToWatch[] }) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
      <AIChatPanel />

      {drops.length > 0 && (
        <div className="glass-card">
          <CardContent className="p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <TrendingDown className="h-4 w-4 text-emerald-600" />
              Drops to watch
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Simulated from your tracked prices — not a forecast.
            </p>
            <div className="mt-3 space-y-2">
              {drops.slice(0, 2).map((drop) => (
                <Link
                  key={drop.productId}
                  href={`/products/${drop.productSlug}`}
                  className="block rounded-lg border border-white/40 bg-card/50 p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-muted/50"
                >
                  <p className="text-sm font-medium leading-tight">{drop.productName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {drop.windowDays
                      ? `Possible drop in ${drop.windowDays[0]}–${drop.windowDays[1]} days (simulated)`
                      : 'Drop pattern detected (simulated)'}
                  </p>
                </Link>
              ))}
            </div>
            <Link
              href="#drops-to-watch"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
            >
              See all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardContent>
        </div>
      )}

      <div className="glass-card">
        <CardContent className="p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Brain className="h-4 w-4 text-violet-600" />
            AI picks for you
          </h3>
          {picks.length > 0 ? (
            <div className="mt-3 space-y-2">
              {picks.slice(0, 3).map((pick) => (
                <Link
                  key={pick.productId}
                  href={`/products/${pick.product.slug}`}
                  className="block rounded-lg border border-white/40 bg-card/50 p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-muted/50"
                >
                  <p className="text-sm font-medium leading-tight">{pick.product.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{pick.reason}</p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              No picks yet — search or save products and the AI will suggest matches here.
            </p>
          )}
          <Link
            href="/dashboard/recommendations"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
          >
            <Sparkles className="h-3 w-3" /> All recommendations
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardContent>
      </div>
    </aside>
  );
}
